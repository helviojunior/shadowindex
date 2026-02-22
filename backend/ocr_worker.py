"""
OCR Worker - Processador de jobs de OCR em background

Processa arquivos na fila de OCR usando Apache Tika.
"""

import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


class OCRWorker:
    """Worker para processamento de OCR em background"""
    
    def __init__(self):
        self.running = False
        self._task: Optional[asyncio.Task] = None
        self._ocr_service = None
    
    async def start(self):
        """Inicia o worker de OCR"""
        if self.running:
            logger.info("OCR worker already running")
            return
        
        self.running = True
        self._task = asyncio.create_task(self._process_loop())
        logger.info("OCR worker started")
        print("=== OCR WORKER: Started ===", flush=True)
    
    async def stop(self):
        """Para o worker de OCR"""
        self.running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("OCR worker stopped")
        print("=== OCR WORKER: Stopped ===", flush=True)
    
    async def _get_ocr_service(self):
        """Obtém instância do serviço OCR"""
        if self._ocr_service is None:
            from ocr_service import TikaService
            self._ocr_service = TikaService()
            await self._ocr_service.initialize()
        return self._ocr_service
    
    async def _process_loop(self):
        """Loop principal de processamento"""
        from database import AsyncSessionLocal
        
        while self.running:
            try:
                async with AsyncSessionLocal() as db:
                    await self._process_pending_jobs(db)
            except Exception as e:
                logger.error(f"Error in OCR worker loop: {e}")
                print(f"=== OCR WORKER ERROR: {e} ===", flush=True)
            
            # Aguardar antes de verificar novamente
            await asyncio.sleep(5)
    
    async def _process_pending_jobs(self, db: AsyncSession):
        """Processa jobs pendentes de OCR"""
        from database import OCRJob, FileVersion
        
        # Buscar próximo job pendente (ordenado por prioridade e data)
        result = await db.execute(
            select(OCRJob)
            .where(OCRJob.status == 'pending')
            .order_by(OCRJob.priority.desc(), OCRJob.created_at.asc())
            .limit(1)
        )
        job = result.scalar_one_or_none()
        
        if not job:
            return
        
        print(f"=== OCR WORKER: Processing job {job.id} for {job.file_name} ===", flush=True)
        logger.info(f"Processing OCR job {job.id} for {job.file_name}")
        
        # Marcar como em execução
        job.status = 'running'
        job.started_at = datetime.now(timezone.utc)
        await db.commit()
        
        try:
            # Verificar se o arquivo existe
            import os
            if not job.local_path or not os.path.exists(job.local_path):
                raise FileNotFoundError(f"Arquivo não encontrado: {job.local_path}")
            
            # Obter serviço OCR
            ocr_service = await self._get_ocr_service()
            
            if not ocr_service.is_available():
                job.status = 'failed'
                job.error_message = "Serviço OCR não disponível"
                job.completed_at = datetime.now(timezone.utc)
                await db.commit()
                print(f"=== OCR WORKER: Service unavailable for job {job.id} ===", flush=True)
                return
            
            # Executar OCR
            ocr_result = await ocr_service.extract_text(
                job.local_path,
                ocr_language=job.ocr_language
            )
            
            if ocr_result and ocr_result.get('success'):
                job.ocr_text = ocr_result.get('text', '')
                job.ocr_metadata = ocr_result.get('metadata')
                job.status = 'completed'
                
                # Atualizar a versão do arquivo com o texto OCR
                if job.version_id:
                    version_result = await db.execute(
                        select(FileVersion).where(FileVersion.id == job.version_id)
                    )
                    version = version_result.scalar_one_or_none()
                    if version:
                        version.ocr_content = job.ocr_text
                        version.ocr_processed = True
                        version.ocr_processed_at = datetime.now(timezone.utc)
                
                print(f"=== OCR WORKER: Job {job.id} completed, {len(job.ocr_text or '')} chars extracted ===", flush=True)
                logger.info(f"OCR job {job.id} completed: {len(job.ocr_text or '')} chars")
            else:
                job.status = 'failed'
                job.error_message = ocr_result.get('error', 'OCR failed') if ocr_result else 'No result'
                print(f"=== OCR WORKER: Job {job.id} failed: {job.error_message} ===", flush=True)
            
        except FileNotFoundError as e:
            job.status = 'failed'
            job.error_message = str(e)
            logger.warning(f"OCR job {job.id} file not found: {e}")
            print(f"=== OCR WORKER: Job {job.id} file not found ===", flush=True)
            
        except Exception as e:
            job.status = 'failed'
            job.error_message = str(e)
            logger.error(f"OCR job {job.id} failed: {e}")
            print(f"=== OCR WORKER: Job {job.id} error: {e} ===", flush=True)
        
        finally:
            job.completed_at = datetime.now(timezone.utc)
            await db.commit()


# Instância global do worker
_ocr_worker: Optional[OCRWorker] = None


def get_ocr_worker() -> OCRWorker:
    """Retorna a instância global do OCR worker"""
    global _ocr_worker
    if _ocr_worker is None:
        _ocr_worker = OCRWorker()
    return _ocr_worker


async def start_ocr_worker():
    """Inicia o worker de OCR"""
    worker = get_ocr_worker()
    await worker.start()


async def stop_ocr_worker():
    """Para o worker de OCR"""
    worker = get_ocr_worker()
    await worker.stop()


async def queue_ocr_job(
    db: AsyncSession,
    file_id: int,
    version_id: int,
    server_id: int,
    file_path: str,
    file_name: str,
    local_path: str,
    ocr_language: str = "eng+por",
    priority: int = 0
) -> int:
    """
    Adiciona um job de OCR à fila.
    
    Returns:
        ID do job criado
    """
    from database import OCRJob
    
    # Verificar se já existe job pendente para este arquivo/versão
    existing = await db.execute(
        select(OCRJob).where(
            and_(
                OCRJob.version_id == version_id,
                OCRJob.status.in_(['pending', 'running'])
            )
        )
    )
    if existing.scalar_one_or_none():
        logger.info(f"OCR job already exists for version {version_id}")
        return -1
    
    # Criar job
    job = OCRJob(
        file_id=file_id,
        version_id=version_id,
        server_id=server_id,
        file_path=file_path,
        file_name=file_name,
        local_path=local_path,
        ocr_language=ocr_language,
        priority=priority,
        status='pending'
    )
    
    db.add(job)
    await db.commit()
    await db.refresh(job)
    
    logger.info(f"OCR job {job.id} queued for {file_name}")
    print(f"=== OCR WORKER: Job {job.id} queued for {file_name} ===", flush=True)
    
    return job.id
