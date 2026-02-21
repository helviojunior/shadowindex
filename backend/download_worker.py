"""
Download Worker - Processador de downloads em background

Este módulo gerencia a fila de downloads e processa jobs de forma assíncrona.
Características:
- Máximo de 3 downloads simultâneos
- Processamento em background independente do navegador
- Suporte a downloads em chunks para arquivos grandes
- Atualização de progresso em tempo real
"""

import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.ext.asyncio import async_sessionmaker
from sqlalchemy import select, update, MetaData, Table

logger = logging.getLogger(__name__)

# Configurações do worker
MAX_CONCURRENT_DOWNLOADS = 3
CHUNK_SIZE = 1024 * 1024  # 1MB chunks
WORKER_POLL_INTERVAL = 2  # segundos entre verificações

# Instância global do worker
_worker_instance: Optional['DownloadWorker'] = None

# Criar engine separado para o worker
import os
DATA_DIR = os.path.join(os.path.dirname(__file__), 'data')
DATABASE_PATH = os.path.join(DATA_DIR, "ops_integration.db")
WORKER_DATABASE_URL = f"sqlite+aiosqlite:///{DATABASE_PATH}"

worker_engine = create_async_engine(WORKER_DATABASE_URL, echo=False)
WorkerSessionLocal = async_sessionmaker(autocommit=False, autoflush=False, bind=worker_engine, class_=AsyncSession)

# Configurações do worker
MAX_CONCURRENT_DOWNLOADS = 3
CHUNK_SIZE = 1024 * 1024  # 1MB chunks
WORKER_POLL_INTERVAL = 2  # segundos entre verificações

# Instância global do worker
_worker_instance: Optional['DownloadWorker'] = None


class DownloadWorker:
    """Worker que processa downloads em background"""
    
    def __init__(self):
        self.running = False
        self.active_downloads = 0
        self.semaphore = asyncio.Semaphore(MAX_CONCURRENT_DOWNLOADS)
        self._task: Optional[asyncio.Task] = None
    
    async def start(self):
        """Inicia o worker em background"""
        if self.running:
            logger.info("Download worker already running")
            return
        
        self.running = True
        self._task = asyncio.create_task(self._run_loop())
        logger.info("Download worker started")
    
    async def stop(self):
        """Para o worker"""
        self.running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("Download worker stopped")
    
    async def _run_loop(self):
        """Loop principal do worker"""
        while self.running:
            try:
                await self._process_pending_jobs()
            except Exception as e:
                logger.error(f"Error in download worker loop: {e}")
            
            await asyncio.sleep(WORKER_POLL_INTERVAL)
    
    async def _process_pending_jobs(self):
        """Busca e processa jobs pendentes"""
        async with AsyncSessionLocal() as db:
            # Buscar jobs pendentes ordenados por prioridade
            result = await db.execute(
                select(DownloadJob)
                .where(DownloadJob.status == 'pending')
                .order_by(DownloadJob.priority.desc(), DownloadJob.created_at.asc())
                .limit(MAX_CONCURRENT_DOWNLOADS - self.active_downloads)
            )
            jobs = result.scalars().all()
            
            for job in jobs:
                if self.active_downloads < MAX_CONCURRENT_DOWNLOADS:
                    # Iniciar download em task separada
                    asyncio.create_task(self._download_file(job.id))
    
    async def _download_file(self, job_id: int):
        """Processa um job de download"""
        async with self.semaphore:
            self.active_downloads += 1
            try:
                await self._execute_download(job_id)
            except Exception as e:
                logger.error(f"Error downloading job {job_id}: {e}")
                await self._update_job_status(job_id, 'failed', error_message=str(e))
            finally:
                self.active_downloads -= 1
    
    async def _execute_download(self, job_id: int):
        """Executa o download de um arquivo"""
        async with AsyncSessionLocal() as db:
            # Carregar job
            result = await db.execute(select(DownloadJob).where(DownloadJob.id == job_id))
            job = result.scalar_one_or_none()
            
            if not job or job.status != 'pending':
                return
            
            # Marcar como downloading
            job.status = 'downloading'
            job.started_at = datetime.now(timezone.utc)
            await db.commit()
            
            try:
                # Obter servidor
                result = await db.execute(select(Server).where(Server.id == job.server_id))
                server = result.scalar_one_or_none()
                if not server:
                    raise Exception("Server not found")
                
                # Verificar se deve ignorar por tamanho
                if job.max_file_size_bytes and job.file_size:
                    if job.file_size > job.max_file_size_bytes:
                        job.status = 'skipped'
                        job.skip_reason = f"Arquivo excede limite de {job.max_file_size_bytes / (1024*1024):.1f}MB"
                        job.completed_at = datetime.now(timezone.utc)
                        await db.commit()
                        return
                
                # Obter serviço SOAP
                soap_service = await get_default_soap_service(db)
                
                # Preparar path para download
                full_path = f"\\\\{server.ip}\\{job.share_name}\\{job.file_path}"
                
                # Fazer download
                if job.file_size and job.file_size > CHUNK_SIZE:
                    # Download em chunks
                    await self._download_chunked(db, job, soap_service, full_path)
                else:
                    # Download direto
                    await self._download_direct(db, job, soap_service, full_path)
                
                # Marcar como concluído
                job.status = 'completed'
                job.progress = 100
                job.completed_at = datetime.now(timezone.utc)
                await db.commit()
                
                logger.info(f"Download completed: {job.file_path}")
                
            except Exception as e:
                job.status = 'failed'
                job.error_message = str(e)
                job.completed_at = datetime.now(timezone.utc)
                await db.commit()
                raise
    
    async def _download_direct(self, db: AsyncSession, job: DownloadJob, soap_service: SoapService, full_path: str):
        """Download direto (arquivo pequeno)"""
        params = {"s1": full_path, "l1": "0", "l2": "0"}
        result = await soap_service.call_soap_operation(db, "Exec5", params, ignore_cache=True)
        
        if not result:
            raise Exception("Empty response from SOAP")
        
        # Verificar erros
        result_lower = result.lower() if result else ""
        if "access" in result_lower and "denied" in result_lower:
            raise Exception("Access Denied")
        if "not found" in result_lower or "cannot find" in result_lower:
            raise Exception("File not found")
        
        # Salvar arquivo
        await self._save_file_content(db, job, result)
    
    async def _download_chunked(self, db: AsyncSession, job: DownloadJob, soap_service: SoapService, full_path: str):
        """Download em chunks (arquivo grande)"""
        total_size = job.file_size or 0
        downloaded = 0
        chunks = []
        
        while downloaded < total_size:
            chunk_end = min(downloaded + CHUNK_SIZE, total_size)
            
            params = {
                "s1": full_path,
                "l1": str(downloaded),
                "l2": str(CHUNK_SIZE)
            }
            
            result = await soap_service.call_soap_operation(db, "Exec5", params, ignore_cache=True)
            
            if not result:
                break
            
            # Verificar erros
            result_lower = result.lower()
            if "access" in result_lower and "denied" in result_lower:
                raise Exception("Access Denied")
            
            chunks.append(result)
            downloaded = chunk_end
            
            # Atualizar progresso
            job.downloaded_bytes = downloaded
            job.total_bytes = total_size
            job.progress = int((downloaded / total_size) * 100)
            await db.commit()
        
        # Concatenar chunks e salvar
        full_content = ''.join(chunks)
        await self._save_file_content(db, job, full_content)
    
    async def _save_file_content(self, db: AsyncSession, job: DownloadJob, content: str):
        """Salva o conteúdo do arquivo no storage"""
        import base64
        from pathlib import Path
        
        # Obter servidor
        result = await db.execute(select(Server).where(Server.id == job.server_id))
        server = result.scalar_one_or_none()
        if not server:
            return
        
        try:
            # Decodificar base64 e salvar
            file_bytes = base64.b64decode(content)
            
            # Calcular hash
            import hashlib
            sha1_hash = hashlib.sha1(file_bytes).hexdigest()
            
            # Criar estrutura de diretórios
            from storage_utils import get_server_storage_path, sanitize_path_component
            
            storage_base = get_server_storage_path(server.guid)
            relative_path = job.file_path.replace('\\', '/')
            full_storage_path = storage_base / relative_path
            
            # Criar diretórios
            full_storage_path.parent.mkdir(parents=True, exist_ok=True)
            
            # Salvar arquivo
            with open(full_storage_path, 'wb') as f:
                f.write(file_bytes)
            
            # Atualizar job
            job.downloaded_bytes = len(file_bytes)
            job.total_bytes = len(file_bytes)
            
            # Registrar no banco (DownloadedFile)
            existing = await db.execute(
                select(DownloadedFile).where(
                    DownloadedFile.server_guid == server.guid,
                    DownloadedFile.share_name == job.share_name,
                    DownloadedFile.remote_path == job.file_path
                )
            )
            downloaded_file = existing.scalar_one_or_none()
            
            if downloaded_file:
                # Atualizar existente
                downloaded_file.sha1_hash = sha1_hash
                downloaded_file.file_size = len(file_bytes)
                downloaded_file.downloaded_at = datetime.now(timezone.utc)
            else:
                # Criar novo registro
                downloaded_file = DownloadedFile(
                    server_guid=server.guid,
                    share_name=job.share_name,
                    remote_path=job.file_path,
                    local_path=str(full_storage_path),
                    sanitized_path=str(full_storage_path.relative_to(storage_base)),
                    sha1_hash=sha1_hash,
                    file_size=len(file_bytes),
                    downloaded_at=datetime.now(timezone.utc)
                )
                db.add(downloaded_file)
                
                # Incrementar contador do servidor
                server.downloaded_files_count = (server.downloaded_files_count or 0) + 1
            
            await db.commit()
            
        except Exception as e:
            logger.error(f"Error saving file content: {e}")
            raise
    
    async def _update_job_status(self, job_id: int, status: str, error_message: str = None):
        """Atualiza status de um job"""
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(DownloadJob).where(DownloadJob.id == job_id))
            job = result.scalar_one_or_none()
            if job:
                job.status = status
                if error_message:
                    job.error_message = error_message
                job.completed_at = datetime.now(timezone.utc)
                await db.commit()


def get_worker() -> DownloadWorker:
    """Retorna a instância global do worker"""
    global _worker_instance
    if _worker_instance is None:
        _worker_instance = DownloadWorker()
    return _worker_instance


async def start_download_worker():
    """Inicia o worker de downloads"""
    worker = get_worker()
    await worker.start()


async def stop_download_worker():
    """Para o worker de downloads"""
    worker = get_worker()
    await worker.stop()
