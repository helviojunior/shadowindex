"""
GitLeaks Service - Executa GitLeaks em background e processa resultados
"""

import asyncio
import json
import os
import re
import subprocess
import uuid
import logging
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List, Tuple
from pathlib import Path

logger = logging.getLogger(__name__)

# Diretório para armazenar resultados do GitLeaks
GITLEAKS_OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "gitleaks")
GITLEAKS_CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "gitleaks_config.toml")
STORAGE_BASE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "storage")

# Garantir que o diretório existe
os.makedirs(GITLEAKS_OUTPUT_DIR, exist_ok=True)


async def save_finding_to_db(finding: Dict[str, Any]) -> bool:
    """
    Salva um finding no banco de dados.
    
    Returns:
        True se salvou com sucesso, False se já existia ou erro
    """
    from database import async_session_maker, GitleaksFinding
    from sqlalchemy import select
    
    fingerprint = finding.get('Fingerprint')
    if not fingerprint:
        logger.warning("Finding sem Fingerprint, ignorando")
        return False
    
    try:
        async with async_session_maker() as db:
            # Verificar se já existe
            existing = await db.execute(
                select(GitleaksFinding).where(GitleaksFinding.fingerprint == fingerprint)
            )
            if existing.scalar_one_or_none():
                logger.debug(f"Finding {fingerprint} já existe no banco")
                return False
            
            # Criar novo finding
            db_finding = GitleaksFinding(
                fingerprint=fingerprint,
                rule_id=finding.get('RuleID', ''),
                description=finding.get('Description'),
                match=finding.get('Match'),
                secret=finding.get('Secret'),
                start_line=finding.get('StartLine'),
                end_line=finding.get('EndLine'),
                start_column=finding.get('StartColumn'),
                end_column=finding.get('EndColumn'),
                entropy=finding.get('Entropy'),
                tags=finding.get('Tags'),
                file_path=finding.get('File'),
                original_file=finding.get('original_file'),
                detection_source=finding.get('detection_source'),
                extracted_server_id=finding.get('extracted_server_id'),
                extracted_file_id=finding.get('extracted_file_id'),
                extracted_version=finding.get('extracted_version'),
                server_name=finding.get('server_name'),
                server_ip=finding.get('server_ip'),
                file_name=finding.get('file_name'),
                server_path=finding.get('server_path'),
                share_name=finding.get('share_name'),
                job_id=finding.get('job_id'),
                server_id=finding.get('server_id'),
                scanned_at=datetime.fromisoformat(finding['scanned_at']) if finding.get('scanned_at') else None,
                raw_data=finding
            )
            
            db.add(db_finding)
            await db.commit()
            logger.info(f"Finding {fingerprint} salvo no banco")
            return True
            
    except Exception as e:
        logger.error(f"Erro ao salvar finding {fingerprint}: {e}")
        return False


async def load_findings_from_db() -> List[Dict[str, Any]]:
    """
    Carrega todos os findings do banco de dados.
    """
    from database import async_session_maker, GitleaksFinding
    from sqlalchemy import select
    
    try:
        async with async_session_maker() as db:
            result = await db.execute(select(GitleaksFinding))
            findings = result.scalars().all()
            
            # Converter para dicionários
            findings_list = []
            for f in findings:
                finding_dict = f.raw_data or {}
                # Garantir que os campos principais estão presentes
                finding_dict.update({
                    'Fingerprint': f.fingerprint,
                    'RuleID': f.rule_id,
                    'Description': f.description,
                    'Match': f.match,
                    'Secret': f.secret,
                    'StartLine': f.start_line,
                    'EndLine': f.end_line,
                    'StartColumn': f.start_column,
                    'EndColumn': f.end_column,
                    'Entropy': f.entropy,
                    'Tags': f.tags,
                    'File': f.file_path,
                    'original_file': f.original_file,
                    'detection_source': f.detection_source,
                    'extracted_server_id': f.extracted_server_id,
                    'extracted_file_id': f.extracted_file_id,
                    'extracted_version': f.extracted_version,
                    'server_name': f.server_name,
                    'server_ip': f.server_ip,
                    'file_name': f.file_name,
                    'server_path': f.server_path,
                    'share_name': f.share_name,
                    'job_id': f.job_id,
                    'server_id': f.server_id,
                    'scanned_at': f.scanned_at.isoformat() if f.scanned_at else None
                })
                findings_list.append(finding_dict)
            
            logger.info(f"Carregados {len(findings_list)} findings do banco de dados")
            return findings_list
            
    except Exception as e:
        logger.error(f"Erro ao carregar findings do banco: {e}")
        return []


def extract_ids_from_path(file_path: str) -> Optional[Tuple[int, int, int]]:
    """
    Extrai server_id, file_id e version de um caminho de arquivo físico.
    
    O caminho físico segue o padrão: {storage_base}/{server_id}/{file_id}/{version}
    Pode ter extensões como .ocr ou .metadata no final.
    
    Args:
        file_path: Caminho físico do arquivo
        
    Returns:
        Tuple[server_id, file_id, version] ou None se não conseguir extrair
    """
    if not file_path:
        return None
    
    # Normalizar path
    path = file_path.replace('\\', '/')
    
    # Remover extensões .ocr e .metadata para obter o caminho base
    if path.lower().endswith('.ocr'):
        path = path[:-4]
    elif path.lower().endswith('.metadata'):
        path = path[:-9]
    
    # Tentar encontrar o padrão {storage_base}/.../server_id/file_id/version
    # O padrão é: qualquer coisa seguida de /numero/numero/numero no final
    match = re.search(r'/(\d+)/(\d+)/(\d+)$', path)
    if match:
        return int(match.group(1)), int(match.group(2)), int(match.group(3))
    
    # Tentar padrão alternativo apenas com server_id/file_id/version (sem prefixo)
    parts = path.split('/')
    if len(parts) >= 3:
        try:
            # Pegar os últimos 3 componentes
            version = int(parts[-1])
            file_id = int(parts[-2])
            server_id = int(parts[-3])
            return server_id, file_id, version
        except (ValueError, IndexError):
            pass
    
    return None


def normalize_file_path(file_path: str) -> Dict[str, Any]:
    """
    Normaliza o caminho do arquivo removendo extensões .ocr e .metadata
    
    Arquivos com extensão .ocr indicam que o leak foi encontrado através de OCR do arquivo original.
    Arquivos com extensão .metadata indicam que o leak foi encontrado nos metadados do arquivo original.
    
    Retorna:
        {
            "original_file": str - caminho do arquivo original (sem .ocr/.metadata)
            "scanned_file": str - caminho do arquivo escaneado (original)
            "source": str|None - "ocr", "metadata" ou None
        }
    """
    if not file_path:
        return {
            "original_file": file_path,
            "scanned_file": file_path,
            "source": None
        }
    
    source = None
    original_file = file_path
    
    # Verificar e remover extensão .ocr
    if file_path.lower().endswith('.ocr'):
        source = "ocr"
        original_file = file_path[:-4]  # Remove .ocr
    # Verificar e remover extensão .metadata
    elif file_path.lower().endswith('.metadata'):
        source = "metadata"
        original_file = file_path[:-9]  # Remove .metadata
    
    return {
        "original_file": original_file,
        "scanned_file": file_path,
        "source": source
    }


class GitleaksJob:
    """Representa um job de execução do GitLeaks"""
    
    def __init__(self, job_id: str, target_path: str, server_id: Optional[int] = None):
        self.job_id = job_id
        self.target_path = target_path
        self.server_id = server_id
        self.status = "pending"  # pending, running, completed, failed, cancelled
        self.started_at: Optional[datetime] = None
        self.completed_at: Optional[datetime] = None
        self.error_message: Optional[str] = None
        self.report_path: Optional[str] = None
        self.findings_count: int = 0
        self.process: Optional[asyncio.subprocess.Process] = None
        
    def to_dict(self) -> Dict[str, Any]:
        return {
            "job_id": self.job_id,
            "target_path": self.target_path,
            "server_id": self.server_id,
            "status": self.status,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "error_message": self.error_message,
            "report_path": self.report_path,
            "findings_count": self.findings_count
        }


class GitleaksService:
    """Serviço singleton para gerenciar execuções do GitLeaks"""
    
    _instance = None
    _jobs: Dict[str, GitleaksJob] = {}
    _findings: List[Dict[str, Any]] = []  # Cache de todos os findings
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance
    
    @classmethod
    def get_instance(cls) -> "GitleaksService":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance
    
    def get_job(self, job_id: str) -> Optional[GitleaksJob]:
        return self._jobs.get(job_id)
    
    def get_all_jobs(self) -> List[Dict[str, Any]]:
        return [job.to_dict() for job in self._jobs.values()]
    
    def get_active_jobs(self) -> List[Dict[str, Any]]:
        return [job.to_dict() for job in self._jobs.values() 
                if job.status in ["pending", "running"]]
    
    async def start_scan(self, target_path: str, server_id: Optional[int] = None) -> GitleaksJob:
        """Inicia um scan do GitLeaks em background"""
        
        # Verificar se o caminho existe
        if not os.path.exists(target_path):
            raise FileNotFoundError(f"Caminho não encontrado: {target_path}")
        
        # Criar job
        job_id = str(uuid.uuid4())[:8]
        job = GitleaksJob(job_id, target_path, server_id)
        self._jobs[job_id] = job
        
        # Iniciar execução em background
        asyncio.create_task(self._run_gitleaks(job))
        
        return job
    
    async def _run_gitleaks(self, job: GitleaksJob):
        """Executa o GitLeaks em um processo separado"""
        import shutil
        
        job.status = "running"
        job.started_at = datetime.now(timezone.utc)
        
        # Criar arquivo de saída único
        report_filename = f"gitleaks_{job.job_id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        report_path = os.path.join(GITLEAKS_OUTPUT_DIR, report_filename)
        job.report_path = report_path
        
        # Encontrar o binário do gitleaks
        gitleaks_bin = shutil.which("gitleaks") or "/usr/sbin/gitleaks"
        
        try:
            # Construir comando
            cmd = [
                gitleaks_bin,
                "dir",
                job.target_path,
                "--report-format", "json",
                "--report-path", report_path,
                "--config", GITLEAKS_CONFIG_PATH
            ]
            
            logger.info(f"Executando GitLeaks: {' '.join(cmd)}")
            
            # Executar processo
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env={
                    **os.environ,
                    "GITLEAKS_CONFIG": GITLEAKS_CONFIG_PATH
                }
            )
            job.process = process
            
            stdout, stderr = await process.communicate()
            
            # GitLeaks retorna código 1 se encontrou leaks, 0 se não encontrou
            if process.returncode in [0, 1]:
                job.status = "completed"
                job.completed_at = datetime.now(timezone.utc)
                
                # Processar resultados
                if os.path.exists(report_path):
                    try:
                        with open(report_path, 'r') as f:
                            findings = json.load(f)
                            if findings:
                                job.findings_count = len(findings)
                                saved_count = 0
                                # Adicionar ao cache global com metadata
                                for finding in findings:
                                    # Normalizar caminho do arquivo (tratar .ocr e .metadata)
                                    file_info = normalize_file_path(finding.get('File', ''))
                                    
                                    finding['job_id'] = job.job_id
                                    finding['server_id'] = job.server_id
                                    finding['scanned_at'] = job.completed_at.isoformat()
                                    
                                    # Adicionar informações do arquivo normalizado
                                    finding['original_file'] = file_info['original_file']
                                    finding['scanned_file'] = file_info['scanned_file']
                                    finding['detection_source'] = file_info['source']  # "ocr", "metadata" ou None
                                    
                                    # Atualizar o File para mostrar o arquivo original
                                    finding['File'] = file_info['original_file']
                                    
                                    # Extrair IDs do caminho físico para posterior enriquecimento
                                    ids = extract_ids_from_path(file_info['original_file'])
                                    if ids:
                                        finding['extracted_server_id'] = ids[0]
                                        finding['extracted_file_id'] = ids[1]
                                        finding['extracted_version'] = ids[2]
                                    
                                    # Adicionar ao cache em memória
                                    self._findings.append(finding)
                                    
                                    # Salvar no banco de dados (persistência)
                                    if await save_finding_to_db(finding):
                                        saved_count += 1
                                
                                logger.info(f"Salvos {saved_count} novos findings no banco de dados")
                            else:
                                job.findings_count = 0
                    except json.JSONDecodeError:
                        job.findings_count = 0
                
                logger.info(f"GitLeaks concluído. Job: {job.job_id}, Findings: {job.findings_count}")
            else:
                job.status = "failed"
                job.completed_at = datetime.now(timezone.utc)
                job.error_message = stderr.decode() if stderr else f"Exit code: {process.returncode}"
                logger.error(f"GitLeaks falhou. Job: {job.job_id}, Error: {job.error_message}")
                
        except Exception as e:
            job.status = "failed"
            job.completed_at = datetime.now(timezone.utc)
            job.error_message = str(e)
            logger.error(f"Erro ao executar GitLeaks. Job: {job.job_id}, Error: {e}")
    
    async def cancel_job(self, job_id: str) -> bool:
        """Cancela um job em execução"""
        job = self._jobs.get(job_id)
        if not job:
            return False
        
        if job.status == "running" and job.process:
            try:
                job.process.terminate()
                await asyncio.sleep(0.5)
                if job.process.returncode is None:
                    job.process.kill()
            except Exception as e:
                logger.error(f"Erro ao cancelar job {job_id}: {e}")
        
        job.status = "cancelled"
        job.completed_at = datetime.now(timezone.utc)
        return True
    
    def get_all_findings(self) -> List[Dict[str, Any]]:
        """Retorna todos os findings de todos os scans"""
        return self._findings
    
    def get_findings_by_server(self, server_id: int) -> List[Dict[str, Any]]:
        """Retorna findings de um servidor específico"""
        return [f for f in self._findings if f.get('server_id') == server_id]
    
    def get_findings_by_job(self, job_id: str) -> List[Dict[str, Any]]:
        """Retorna findings de um job específico"""
        return [f for f in self._findings if f.get('job_id') == job_id]
    
    def clear_findings(self) -> int:
        """Limpa todos os findings do cache"""
        count = len(self._findings)
        self._findings = []
        return count
    
    def clear_old_jobs(self) -> int:
        """Remove jobs antigos (completed, failed, cancelled)"""
        old_jobs = [jid for jid, job in self._jobs.items() 
                   if job.status in ["completed", "failed", "cancelled"]]
        for jid in old_jobs:
            del self._jobs[jid]
        return len(old_jobs)
    
    def load_findings_from_disk(self) -> int:
        """Carrega findings de arquivos de relatório existentes"""
        loaded_count = 0
        
        if not os.path.exists(GITLEAKS_OUTPUT_DIR):
            return 0
        
        for filename in os.listdir(GITLEAKS_OUTPUT_DIR):
            if filename.endswith('.json'):
                filepath = os.path.join(GITLEAKS_OUTPUT_DIR, filename)
                try:
                    with open(filepath, 'r') as f:
                        findings = json.load(f)
                        if findings and isinstance(findings, list):
                            for finding in findings:
                                # Evitar duplicatas
                                if not any(f.get('Fingerprint') == finding.get('Fingerprint') 
                                          for f in self._findings):
                                    
                                    # Normalizar caminho do arquivo (tratar .ocr e .metadata)
                                    file_info = normalize_file_path(finding.get('File', ''))
                                    
                                    finding['original_file'] = file_info['original_file']
                                    finding['scanned_file'] = file_info['scanned_file']
                                    finding['detection_source'] = file_info['source']
                                    finding['File'] = file_info['original_file']
                                    
                                    # Extrair IDs do caminho físico
                                    ids = extract_ids_from_path(file_info['original_file'])
                                    if ids:
                                        finding['extracted_server_id'] = ids[0]
                                        finding['extracted_file_id'] = ids[1]
                                        finding['extracted_version'] = ids[2]
                                    
                                    self._findings.append(finding)
                                    loaded_count += 1
                except Exception as e:
                    logger.warning(f"Erro ao carregar {filename}: {e}")
        
        logger.info(f"Carregados {loaded_count} findings de disco")
        return loaded_count


def get_gitleaks_service() -> GitleaksService:
    """Retorna a instância singleton do serviço GitLeaks"""
    return GitleaksService.get_instance()
