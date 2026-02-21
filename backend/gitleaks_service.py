"""
GitLeaks Service - Executa GitLeaks em background e processa resultados
"""

import asyncio
import json
import os
import subprocess
import uuid
import logging
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List
from pathlib import Path

logger = logging.getLogger(__name__)

# Diretório para armazenar resultados do GitLeaks
GITLEAKS_OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "gitleaks")
GITLEAKS_CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "gitleaks_config.toml")

# Garantir que o diretório existe
os.makedirs(GITLEAKS_OUTPUT_DIR, exist_ok=True)


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
        
        job.status = "running"
        job.started_at = datetime.now(timezone.utc)
        
        # Criar arquivo de saída único
        report_filename = f"gitleaks_{job.job_id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        report_path = os.path.join(GITLEAKS_OUTPUT_DIR, report_filename)
        job.report_path = report_path
        
        try:
            # Construir comando
            cmd = [
                "/usr/sbin/gitleaks",
                "dir",
                job.target_path,
                "--report-format", "json",
                "--report-path", report_path,
                "--config", GITLEAKS_CONFIG_PATH,
                "--no-git"  # Não requer que seja um repositório git
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
                                # Adicionar ao cache global com metadata
                                for finding in findings:
                                    finding['job_id'] = job.job_id
                                    finding['server_id'] = job.server_id
                                    finding['scanned_at'] = job.completed_at.isoformat()
                                    self._findings.append(finding)
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
                                    self._findings.append(finding)
                                    loaded_count += 1
                except Exception as e:
                    logger.warning(f"Erro ao carregar {filename}: {e}")
        
        logger.info(f"Carregados {loaded_count} findings de disco")
        return loaded_count


def get_gitleaks_service() -> GitleaksService:
    """Retorna a instância singleton do serviço GitLeaks"""
    return GitleaksService.get_instance()
