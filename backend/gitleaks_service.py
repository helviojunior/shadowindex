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

from websocket_manager import get_websocket_manager

logger = logging.getLogger(__name__)

# Diretório para armazenar resultados do GitLeaks
GITLEAKS_OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "gitleaks")
GITLEAKS_CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "gitleaks_config.toml")
STORAGE_BASE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "storage")

# Garantir que o diretório existe
os.makedirs(GITLEAKS_OUTPUT_DIR, exist_ok=True)


async def emit_gitleaks_stats(service: 'GitleaksService'):
    """Emite estatísticas de GitLeaks via WebSocket"""
    try:
        running = sum(1 for j in service._jobs.values() if j.status == 'running')
        pending = sum(1 for j in service._jobs.values() if j.status == 'pending')
        completed = sum(1 for j in service._jobs.values() if j.status in ['finished', 'completed'])
        failed = sum(1 for j in service._jobs.values() if j.status == 'failed')
        
        stats = {
            "running": running,
            "pending": pending,
            "completed": completed,
            "failed": failed,
            "total": len(service._jobs)
        }
        
        ws_manager = get_websocket_manager()
        await ws_manager.emit_gitleaks_stats(stats)
    except Exception as e:
        logger.error(f"Error emitting gitleaks stats: {e}")


async def save_finding_to_db(finding: Dict[str, Any]) -> bool:
    """
    Salva um finding no banco de dados.
    
    Aplica precedência: findings do arquivo original têm prioridade sobre OCR.
    Se já existir um finding do arquivo original com o mesmo secret, o finding OCR não é salvo.
    
    Returns:
        True se salvou com sucesso, False se já existia ou erro
    """
    from database import async_session_maker, GitleaksFinding
    from sqlalchemy import select, and_
    
    fingerprint = finding.get('Fingerprint')
    if not fingerprint:
        logger.warning("Finding sem Fingerprint, ignorando")
        return False
    
    try:
        async with async_session_maker() as db:
            # Verificar se já existe pelo Fingerprint
            existing = await db.execute(
                select(GitleaksFinding).where(GitleaksFinding.fingerprint == fingerprint)
            )
            if existing.scalar_one_or_none():
                logger.debug(f"Finding {fingerprint} já existe no banco")
                return False
            
            # Se for finding de OCR, verificar se já existe um do arquivo original com o mesmo secret
            detection_source = finding.get('detection_source')
            if detection_source == 'ocr':
                original_file = finding.get('original_file')
                secret = finding.get('Secret')
                
                if original_file and secret:
                    # Buscar finding do arquivo original (detection_source IS NULL ou vazio)
                    existing_original = await db.execute(
                        select(GitleaksFinding).where(
                            and_(
                                GitleaksFinding.original_file == original_file,
                                GitleaksFinding.secret == secret,
                                GitleaksFinding.detection_source.is_(None) | (GitleaksFinding.detection_source == '')
                            )
                        )
                    )
                    if existing_original.scalar_one_or_none():
                        logger.debug(f"Finding OCR ignorado - já existe do arquivo original: {original_file}")
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
                    'scanned_at': f.scanned_at.isoformat() if f.scanned_at else None,
                    'is_false_positive': f.is_false_positive
                })
                findings_list.append(finding_dict)
            
            logger.info(f"Carregados {len(findings_list)} findings do banco de dados")
            return findings_list
            
    except Exception as e:
        logger.error(f"Erro ao carregar findings do banco: {e}")
        return []


def extract_ids_from_path(file_path: str) -> Optional[Dict[str, Any]]:
    """
    Extrai informações de identificação de um caminho de arquivo físico.
    
    Formato NOVO: {storage_base}/{server_guid}/{share_id}/{file_version_id}
    Formato LEGADO: {storage_base}/{server_id}/{file_id}/{version}
    
    Pode ter extensões como .ocr ou .metadata no final.
    
    Args:
        file_path: Caminho físico do arquivo
        
    Returns:
        Dict com:
            - server_guid: GUID do servidor (novo formato) ou None
            - share_id: ID do share (novo formato) ou None
            - file_version_id: ID da versão do arquivo (novo formato) ou None
            - server_id: ID do servidor (formato legado) ou None
            - file_id: ID do arquivo (formato legado) ou None
            - version: Versão (formato legado) ou None
            - format: 'new' ou 'legacy'
        Ou None se não conseguir extrair
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
    
    parts = path.split('/')
    
    # Precisamos de pelo menos 3 partes no final: guid_ou_id/id/id
    if len(parts) < 3:
        return None
    
    # Pegar as últimas 3 partes relevantes
    last_three = parts[-3:]
    
    # Verificar se a primeira parte é um GUID (36 chars com hífens ou 32 sem)
    first_part = last_three[0]
    is_guid = (len(first_part) == 36 and first_part.count('-') == 4) or \
              (len(first_part) == 32 and first_part.isalnum())
    
    try:
        if is_guid:
            # Novo formato: server_guid/share_id/file_version_id
            share_id = int(last_three[1])
            file_version_id = int(last_three[2])
            return {
                'server_guid': first_part,
                'share_id': share_id,
                'file_version_id': file_version_id,
                'server_id': None,
                'file_id': None,
                'version': None,
                'format': 'new'
            }
        elif all(p.isdigit() for p in last_three):
            # Formato legado: server_id/file_id/version
            return {
                'server_guid': None,
                'share_id': None,
                'file_version_id': None,
                'server_id': int(last_three[0]),
                'file_id': int(last_three[1]),
                'version': int(last_three[2]),
                'format': 'legacy'
            }
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


async def enrich_finding_with_db_info(finding: Dict[str, Any]) -> Dict[str, Any]:
    """
    Enriquece um finding com informações do servidor e arquivo buscando no banco de dados.
    
    Usa os IDs extraídos (extracted_server_id, extracted_file_id) para buscar:
    - server_name, server_ip do servidor
    - file_name, share_name, server_path do arquivo baixado
    
    Args:
        finding: Dicionário com os dados do finding (deve ter extracted_server_id e/ou extracted_file_id)
        
    Returns:
        Finding enriquecido com informações do banco de dados
    """
    from database import async_session_maker, Server, DownloadedFile
    from sqlalchemy import select
    
    extracted_server_id = finding.get('extracted_server_id')
    extracted_file_id = finding.get('extracted_file_id')
    server_id = finding.get('server_id')
    
    # Usar server_id do job se não tiver extracted_server_id
    effective_server_id = extracted_server_id or server_id
    
    if not effective_server_id and not extracted_file_id:
        return finding
    
    try:
        async with async_session_maker() as db:
            # Se temos file_id, buscar informações do arquivo baixado
            if extracted_file_id:
                file_result = await db.execute(
                    select(DownloadedFile).where(DownloadedFile.id == extracted_file_id)
                )
                downloaded_file = file_result.scalar_one_or_none()
                
                if downloaded_file:
                    finding['file_name'] = downloaded_file.file_name
                    finding['share_name'] = downloaded_file.share_name
                    finding['server_path'] = downloaded_file.file_path
                    
                    # Buscar servidor pelo GUID do arquivo
                    if downloaded_file.server_guid:
                        server_result = await db.execute(
                            select(Server).where(Server.guid == downloaded_file.server_guid)
                        )
                        server = server_result.scalar_one_or_none()
                        if server:
                            finding['server_name'] = server.name
                            finding['server_ip'] = server.ip
                            # Atualizar server_id se não estava definido
                            if not finding.get('extracted_server_id'):
                                finding['extracted_server_id'] = server.id
            
            # Se temos server_id mas ainda não temos server_name/ip, buscar
            if effective_server_id and not finding.get('server_name'):
                server_result = await db.execute(
                    select(Server).where(Server.id == effective_server_id)
                )
                server = server_result.scalar_one_or_none()
                if server:
                    finding['server_name'] = server.name
                    finding['server_ip'] = server.ip
                    
    except Exception as e:
        logger.warning(f"Erro ao enriquecer finding: {e}")
    
    return finding


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
        
        # Se um server_id foi fornecido, verificar se o servidor existe no banco
        if server_id is not None:
            from database import async_session_maker, Server
            from sqlalchemy import select
            
            async with async_session_maker() as db:
                result = await db.execute(select(Server).where(Server.id == server_id))
                server = result.scalar_one_or_none()
                
                if not server:
                    raise ValueError(f"Servidor {server_id} não encontrado no banco de dados")
        
        # Verificar se o caminho existe
        if not os.path.exists(target_path):
            raise FileNotFoundError(f"Caminho não encontrado: {target_path}")
        
        # Verificar se é um diretório e se não está vazio
        if os.path.isdir(target_path):
            try:
                if not any(os.scandir(target_path)):
                    raise FileNotFoundError(f"Diretório vazio: {target_path}")
            except PermissionError:
                raise FileNotFoundError(f"Sem permissão para acessar: {target_path}")
        
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
                                
                                # Separar findings em originais e OCR para aplicar precedência
                                original_findings = []
                                ocr_findings = []
                                
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
                                    
                                    # Separar por fonte de detecção
                                    if file_info['source'] == 'ocr':
                                        ocr_findings.append(finding)
                                    else:
                                        original_findings.append(finding)
                                
                                # Processar findings originais primeiro (têm precedência)
                                # Chave: (original_file, Secret) para identificar duplicatas
                                processed_keys = set()
                                
                                for finding in original_findings:
                                    # Enriquecer com informações do banco de dados
                                    finding = await enrich_finding_with_db_info(finding)
                                    
                                    fingerprint = finding.get('Fingerprint')
                                    already_in_cache = any(f.get('Fingerprint') == fingerprint for f in self._findings)
                                    
                                    if not already_in_cache:
                                        self._findings.append(finding)
                                    
                                    # Registrar chave para evitar duplicata do OCR
                                    key = (finding.get('original_file', ''), finding.get('Secret', ''))
                                    processed_keys.add(key)
                                    
                                    if await save_finding_to_db(finding):
                                        saved_count += 1
                                
                                # Processar findings de OCR (apenas se não existir do original)
                                ocr_skipped = 0
                                for finding in ocr_findings:
                                    key = (finding.get('original_file', ''), finding.get('Secret', ''))
                                    
                                    # Se já existe um finding do arquivo original com o mesmo secret, pular
                                    if key in processed_keys:
                                        ocr_skipped += 1
                                        logger.debug(f"OCR finding ignorado (já existe no original): {finding.get('original_file')}")
                                        continue
                                    
                                    # Enriquecer com informações do banco de dados
                                    finding = await enrich_finding_with_db_info(finding)
                                    
                                    fingerprint = finding.get('Fingerprint')
                                    already_in_cache = any(f.get('Fingerprint') == fingerprint for f in self._findings)
                                    
                                    if not already_in_cache:
                                        self._findings.append(finding)
                                    
                                    processed_keys.add(key)
                                    
                                    if await save_finding_to_db(finding):
                                        saved_count += 1
                                
                                if ocr_skipped > 0:
                                    logger.info(f"Ignorados {ocr_skipped} findings de OCR (já existiam no arquivo original)")
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
        """Limpa todos os findings do cache (não remove do banco)"""
        count = len(self._findings)
        self._findings = []
        return count
    
    async def clear_findings_from_db(self) -> int:
        """Remove todos os findings do banco de dados"""
        from database import async_session_maker, GitleaksFinding
        from sqlalchemy import delete
        
        try:
            async with async_session_maker() as db:
                result = await db.execute(delete(GitleaksFinding))
                await db.commit()
                count = result.rowcount
                logger.info(f"Removidos {count} findings do banco de dados")
                return count
        except Exception as e:
            logger.error(f"Erro ao limpar findings do banco: {e}")
            return 0
    
    async def delete_finding_from_db(self, fingerprint: str) -> bool:
        """Remove um finding do banco de dados e do cache"""
        from database import async_session_maker, GitleaksFinding
        from sqlalchemy import delete
        
        try:
            # Primeiro remover do cache em memória
            original_count = len(self._findings)
            self._findings = [f for f in self._findings if f.get('Fingerprint') != fingerprint]
            removed_from_cache = len(self._findings) < original_count
            
            # Depois remover do banco de dados
            async with async_session_maker() as db:
                result = await db.execute(
                    delete(GitleaksFinding).where(GitleaksFinding.fingerprint == fingerprint)
                )
                await db.commit()
                removed_from_db = result.rowcount > 0
                
            if removed_from_cache or removed_from_db:
                logger.info(f"Finding {fingerprint} removido (cache: {removed_from_cache}, db: {removed_from_db})")
                return True
            else:
                logger.warning(f"Finding {fingerprint} não encontrado")
                return False
        except Exception as e:
            logger.error(f"Erro ao remover finding {fingerprint}: {e}")
            return False
    
    async def toggle_false_positive(self, fingerprint: str, is_false_positive: bool) -> bool:
        """Marca ou desmarca um finding como falso positivo"""
        from database import async_session_maker, GitleaksFinding
        from sqlalchemy import select
        
        try:
            async with async_session_maker() as db:
                result = await db.execute(
                    select(GitleaksFinding).where(GitleaksFinding.fingerprint == fingerprint)
                )
                finding = result.scalar_one_or_none()
                
                if not finding:
                    logger.warning(f"Finding {fingerprint} não encontrado")
                    return False
                
                finding.is_false_positive = is_false_positive
                await db.commit()
                
                # Atualizar também no cache em memória
                for f in self._findings:
                    if f.get('Fingerprint') == fingerprint:
                        f['is_false_positive'] = is_false_positive
                        break
                
                logger.info(f"Finding {fingerprint} marcado como falso_positivo={is_false_positive}")
                return True
                
        except Exception as e:
            logger.error(f"Erro ao atualizar finding {fingerprint}: {e}")
            return False
    
    async def load_findings_from_db(self) -> int:
        """Carrega findings do banco de dados para o cache em memória"""
        findings = await load_findings_from_db()
        
        # Adicionar ao cache evitando duplicatas
        existing_fingerprints = {f.get('Fingerprint') for f in self._findings}
        added_count = 0
        
        for finding in findings:
            fingerprint = finding.get('Fingerprint')
            if fingerprint and fingerprint not in existing_fingerprints:
                self._findings.append(finding)
                existing_fingerprints.add(fingerprint)
                added_count += 1
        
        logger.info(f"Carregados {added_count} findings do banco para o cache")
        return added_count
    
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
                            # Separar findings em originais e OCR para aplicar precedência
                            original_findings = []
                            ocr_findings = []
                            
                            for finding in findings:
                                # Evitar duplicatas por Fingerprint
                                if any(f.get('Fingerprint') == finding.get('Fingerprint') 
                                      for f in self._findings):
                                    continue
                                
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
                                
                                # Separar por fonte de detecção
                                if file_info['source'] == 'ocr':
                                    ocr_findings.append(finding)
                                else:
                                    original_findings.append(finding)
                            
                            # Processar originais primeiro (têm precedência)
                            processed_keys = set()
                            
                            for finding in original_findings:
                                self._findings.append(finding)
                                loaded_count += 1
                                key = (finding.get('original_file', ''), finding.get('Secret', ''))
                                processed_keys.add(key)
                            
                            # Processar OCR apenas se não existir do original
                            for finding in ocr_findings:
                                key = (finding.get('original_file', ''), finding.get('Secret', ''))
                                if key not in processed_keys:
                                    self._findings.append(finding)
                                    loaded_count += 1
                                    processed_keys.add(key)
                except Exception as e:
                    logger.warning(f"Erro ao carregar {filename}: {e}")
        
        logger.info(f"Carregados {loaded_count} findings de disco")
        return loaded_count


def get_gitleaks_service() -> GitleaksService:
    """Retorna a instância singleton do serviço GitLeaks"""
    return GitleaksService.get_instance()
