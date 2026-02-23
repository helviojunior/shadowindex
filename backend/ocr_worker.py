"""
OCR Worker - Processador de jobs de OCR em background

Processa arquivos na fila de OCR usando Apache Tika.
"""

import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select, and_, func
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


async def emit_ocr_stats():
    """Emite estatísticas de OCR via WebSocket"""
    try:
        from database import async_session_maker, OCRJob
        from websocket_manager import get_websocket_manager
        
        async with async_session_maker() as db:
            # Contar jobs por status
            result = await db.execute(
                select(OCRJob.status, func.count(OCRJob.id))
                .group_by(OCRJob.status)
            )
            status_counts = dict(result.fetchall())
            
            stats = {
                "running": status_counts.get('running', 0),
                "pending": status_counts.get('pending', 0),
                "completed": status_counts.get('completed', 0),
                "failed": status_counts.get('failed', 0),
                "skipped": status_counts.get('skipped', 0),
                "total": sum(status_counts.values())
            }
            
            ws_manager = get_websocket_manager()
            await ws_manager.emit_ocr_stats(stats)
    except Exception as e:
        logger.error(f"Error emitting OCR stats: {e}")


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
    
    async def _extract_certificate_text(self, file_path: str, file_ext: str, db) -> tuple:
        """
        Extrai informações de certificados digitais em formato texto.
        
        Args:
            file_path: Caminho do arquivo do certificado
            file_ext: Extensão do arquivo (.pfx, .p12, .cer, .crt, .pem)
            db: Sessão do banco de dados
            
        Returns:
            Tuple (text, metadata, error)
        """
        from cryptography import x509
        from cryptography.hazmat.primitives import serialization, hashes
        from cryptography.hazmat.backends import default_backend
        from cryptography.hazmat.primitives.serialization import pkcs12
        from database import PfxPassword
        from sqlalchemy import select
        
        try:
            with open(file_path, 'rb') as f:
                cert_data = f.read()
            
            cert = None
            private_key = None
            chain = None
            
            if file_ext in ['.pfx', '.p12']:
                # Tentar sem senha primeiro
                passwords_to_try = [None, b'', b'password', b'123456', b'changeit']
                
                # Buscar senhas salvas no banco
                try:
                    # Extrair informações do path para buscar senha
                    saved_result = await db.execute(
                        select(PfxPassword)
                    )
                    saved_passwords = saved_result.scalars().all()
                    for saved in saved_passwords:
                        if saved.password:
                            passwords_to_try.insert(1, saved.password.encode())
                except Exception:
                    pass
                
                # Tentar cada senha
                for pwd in passwords_to_try:
                    try:
                        private_key, cert, chain = pkcs12.load_key_and_certificates(
                            cert_data, pwd, default_backend()
                        )
                        break
                    except Exception:
                        continue
                
                if not cert:
                    return None, None, "Não foi possível abrir o certificado PFX/P12 (senha incorreta?)"
                    
            elif file_ext in ['.cer', '.crt', '.pem']:
                try:
                    cert = x509.load_pem_x509_certificate(cert_data, default_backend())
                except Exception:
                    try:
                        cert = x509.load_der_x509_certificate(cert_data, default_backend())
                    except Exception as e:
                        return None, None, f"Não foi possível carregar o certificado: {e}"
            
            if not cert:
                return None, None, "Não foi possível extrair informações do certificado"
            
            # Extrair informações do certificado
            lines = []
            lines.append("=" * 60)
            lines.append("INFORMAÇÕES DO CERTIFICADO DIGITAL")
            lines.append("=" * 60)
            lines.append("")
            
            # Thumbprint/Fingerprint
            thumbprint = cert.fingerprint(hashes.SHA1()).hex().upper()
            thumbprint_formatted = ':'.join(thumbprint[i:i+2] for i in range(0, len(thumbprint), 2))
            lines.append(f"Thumbprint (SHA1): {thumbprint_formatted}")
            lines.append("")
            
            # Subject (Assunto)
            lines.append("-" * 40)
            lines.append("SUBJECT (Assunto)")
            lines.append("-" * 40)
            for attr in cert.subject:
                attr_name = attr.oid._name
                attr_value = attr.value
                # Traduzir nomes comuns
                name_map = {
                    'commonName': 'Common Name (CN)',
                    'organizationName': 'Organization (O)',
                    'organizationalUnitName': 'Organizational Unit (OU)',
                    'countryName': 'Country (C)',
                    'stateOrProvinceName': 'State (ST)',
                    'localityName': 'Locality (L)',
                    'emailAddress': 'Email',
                    'serialNumber': 'Serial Number',
                }
                display_name = name_map.get(attr_name, attr_name)
                lines.append(f"  {display_name}: {attr_value}")
            lines.append("")
            
            # Issuer (Emissor)
            lines.append("-" * 40)
            lines.append("ISSUER (Emissor)")
            lines.append("-" * 40)
            for attr in cert.issuer:
                attr_name = attr.oid._name
                attr_value = attr.value
                name_map = {
                    'commonName': 'Common Name (CN)',
                    'organizationName': 'Organization (O)',
                    'organizationalUnitName': 'Organizational Unit (OU)',
                    'countryName': 'Country (C)',
                    'stateOrProvinceName': 'State (ST)',
                    'localityName': 'Locality (L)',
                    'emailAddress': 'Email',
                }
                display_name = name_map.get(attr_name, attr_name)
                lines.append(f"  {display_name}: {attr_value}")
            lines.append("")
            
            # Validade
            lines.append("-" * 40)
            lines.append("VALIDADE")
            lines.append("-" * 40)
            lines.append(f"  Válido de: {cert.not_valid_before_utc.strftime('%Y-%m-%d %H:%M:%S UTC')}")
            lines.append(f"  Válido até: {cert.not_valid_after_utc.strftime('%Y-%m-%d %H:%M:%S UTC')}")
            
            # Verificar se está expirado
            from datetime import datetime, timezone
            now = datetime.now(timezone.utc)
            if now > cert.not_valid_after_utc:
                lines.append("  Status: EXPIRADO")
            elif now < cert.not_valid_before_utc:
                lines.append("  Status: AINDA NÃO VÁLIDO")
            else:
                days_left = (cert.not_valid_after_utc - now).days
                lines.append(f"  Status: VÁLIDO ({days_left} dias restantes)")
            lines.append("")
            
            # Informações técnicas
            lines.append("-" * 40)
            lines.append("INFORMAÇÕES TÉCNICAS")
            lines.append("-" * 40)
            lines.append(f"  Versão: {cert.version.name} (v{cert.version.value + 1})")
            lines.append(f"  Número de Série: {cert.serial_number}")
            lines.append(f"  Algoritmo de Assinatura: {cert.signature_algorithm_oid._name}")
            lines.append("")
            
            # Chave privada
            lines.append("-" * 40)
            lines.append("CHAVE PRIVADA")
            lines.append("-" * 40)
            if private_key is not None:
                lines.append("  Contém chave privada: SIM")
                lines.append("  *** ATENÇÃO: Este arquivo contém a chave privada! ***")
                # Tipo da chave
                key_type = type(private_key).__name__
                lines.append(f"  Tipo da chave: {key_type}")
            else:
                lines.append("  Contém chave privada: NÃO")
            lines.append("")
            
            # Chain de certificados (se PFX)
            if chain:
                lines.append("-" * 40)
                lines.append(f"CADEIA DE CERTIFICADOS ({len(chain)} certificados)")
                lines.append("-" * 40)
                for i, chain_cert in enumerate(chain, 1):
                    chain_cn = None
                    for attr in chain_cert.subject:
                        if attr.oid._name == 'commonName':
                            chain_cn = attr.value
                            break
                    lines.append(f"  [{i}] {chain_cn or 'Unknown'}")
                lines.append("")
            
            # Extensões (se houver)
            try:
                extensions = cert.extensions
                if extensions:
                    lines.append("-" * 40)
                    lines.append("EXTENSÕES")
                    lines.append("-" * 40)
                    for ext in extensions:
                        ext_name = ext.oid._name
                        lines.append(f"  {ext_name}: {ext.critical and '[CRÍTICA]' or ''}")
                        # Algumas extensões comuns
                        if ext_name == 'keyUsage':
                            usages = []
                            if ext.value.digital_signature:
                                usages.append("Digital Signature")
                            if ext.value.key_encipherment:
                                usages.append("Key Encipherment")
                            if ext.value.data_encipherment:
                                usages.append("Data Encipherment")
                            if hasattr(ext.value, 'key_cert_sign') and ext.value.key_cert_sign:
                                usages.append("Certificate Signing")
                            if hasattr(ext.value, 'crl_sign') and ext.value.crl_sign:
                                usages.append("CRL Signing")
                            lines.append(f"    Usos: {', '.join(usages)}")
                        elif ext_name == 'subjectAltName':
                            for name in ext.value:
                                lines.append(f"    {type(name).__name__}: {name.value}")
                    lines.append("")
            except Exception:
                pass
            
            lines.append("=" * 60)
            lines.append("FIM DO CERTIFICADO")
            lines.append("=" * 60)
            
            text = '\n'.join(lines)
            
            # Metadata
            metadata = {
                'type': 'certificate',
                'format': file_ext,
                'thumbprint': thumbprint,
                'has_private_key': private_key is not None,
                'subject_cn': None,
                'issuer_cn': None,
                'not_before': cert.not_valid_before_utc.isoformat(),
                'not_after': cert.not_valid_after_utc.isoformat(),
            }
            
            # Extrair CN
            for attr in cert.subject:
                if attr.oid._name == 'commonName':
                    metadata['subject_cn'] = attr.value
                    break
            for attr in cert.issuer:
                if attr.oid._name == 'commonName':
                    metadata['issuer_cn'] = attr.value
                    break
            
            print("=== OCR WORKER: Certificate extracted successfully ===", flush=True)
            return text, metadata, None
            
        except Exception as e:
            logger.error(f"Error extracting certificate: {e}")
            return None, None, f"Erro ao extrair certificado: {str(e)}"
    
    async def _process_loop(self):
        """Loop principal de processamento"""
        from database import AsyncSessionLocal
        from sqlalchemy.exc import OperationalError
        
        cleanup_counter = 0  # Contador para executar cleanup periodicamente
        watchdog_counter = 0  # Contador para executar watchdog periodicamente
        
        # Reset jobs travados na inicialização
        try:
            async with AsyncSessionLocal() as db:
                await self._reset_stale_running_jobs(db, startup=True)
        except Exception as e:
            logger.error(f"Error resetting stale jobs on startup: {e}")
        
        while self.running:
            try:
                async with AsyncSessionLocal() as db:
                    # Executar limpeza a cada 12 iterações (aproximadamente 1 minuto)
                    cleanup_counter += 1
                    if cleanup_counter >= 12:
                        await self._cleanup_old_completed_jobs(db)
                        cleanup_counter = 0
                    
                    # Executar watchdog a cada 24 iterações (aproximadamente 2 minutos)
                    watchdog_counter += 1
                    if watchdog_counter >= 24:
                        await self._reset_stale_running_jobs(db, startup=False)
                        watchdog_counter = 0
                    
                    await self._process_pending_jobs(db)
            except OperationalError as e:
                if "database is locked" in str(e):
                    logger.warning("Database locked in OCR worker, retrying in 5s...")
                    await asyncio.sleep(5)
                else:
                    logger.error(f"Database error in OCR worker loop: {e}")
            except Exception as e:
                logger.error(f"Error in OCR worker loop: {e}")
                print(f"=== OCR WORKER ERROR: {e} ===", flush=True)
            
            # Aguardar antes de verificar novamente
            await asyncio.sleep(5)
    
    async def _reset_stale_running_jobs(self, db: AsyncSession, startup: bool = False):
        """
        Watchdog: Reseta jobs 'running' que estão travados.
        - No startup: reseta todos os jobs 'running' (pois o worker foi reiniciado)
        - Durante execução: reseta jobs 'running' há mais de 10 minutos sem atualização
        """
        from database import OCRJob
        from sqlalchemy import update
        from datetime import timedelta
        
        try:
            if startup:
                # No startup, resetar TODOS os jobs 'running' pois o worker reiniciou
                result = await db.execute(
                    update(OCRJob)
                    .where(OCRJob.status == 'running')
                    .values(
                        status='pending',
                        started_at=None,
                        error_message=None
                    )
                )
                await db.commit()
                
                if result.rowcount > 0:
                    logger.info(f"OCR Watchdog (startup): Reset {result.rowcount} stale running jobs to pending")
                    print(f"=== OCR WATCHDOG: Reset {result.rowcount} stale jobs on startup ===", flush=True)
                    await emit_ocr_stats()
            else:
                # Durante execução, resetar jobs 'running' há mais de 10 minutos
                stale_cutoff = datetime.now(timezone.utc) - timedelta(minutes=10)
                
                result = await db.execute(
                    update(OCRJob)
                    .where(
                        and_(
                            OCRJob.status == 'running',
                            OCRJob.started_at < stale_cutoff
                        )
                    )
                    .values(
                        status='pending',
                        started_at=None,
                        error_message='Reset pelo watchdog (timeout de 10 minutos)'
                    )
                )
                await db.commit()
                
                if result.rowcount > 0:
                    logger.warning(f"OCR Watchdog: Reset {result.rowcount} stale running jobs (>10min) to pending")
                    print(f"=== OCR WATCHDOG: Reset {result.rowcount} stale jobs (timeout) ===", flush=True)
                    await emit_ocr_stats()
                    
        except Exception as e:
            logger.error(f"Error in OCR watchdog: {e}")
    
    async def _cleanup_old_completed_jobs(self, db: AsyncSession):
        """Remove jobs finalizados com sucesso há mais de X minutos"""
        from database import OCRJob, AppSettings
        from sqlalchemy import delete
        from datetime import timedelta
        
        try:
            # Buscar configuração de tempo de limpeza
            result = await db.execute(
                select(AppSettings).where(AppSettings.key == 'ocr_auto_cleanup_minutes')
            )
            setting = result.scalar_one_or_none()
            cleanup_minutes = int(setting.value) if setting and setting.value else 15
            
            if cleanup_minutes <= 0:
                return  # Limpeza desabilitada
            
            cutoff_time = datetime.now(timezone.utc) - timedelta(minutes=cleanup_minutes)
            
            # Deletar jobs completados antes do cutoff
            delete_result = await db.execute(
                delete(OCRJob).where(
                    and_(
                        OCRJob.status == 'completed',
                        OCRJob.updated_at < cutoff_time
                    )
                )
            )
            await db.commit()
            
            if delete_result.rowcount > 0:
                logger.info(f"OCR cleanup: Removed {delete_result.rowcount} old completed jobs")
                print(f"=== OCR WORKER: Cleaned up {delete_result.rowcount} old completed jobs ===", flush=True)
                await emit_ocr_stats()
                
        except Exception as e:
            logger.error(f"Error in OCR cleanup: {e}")
    
    async def _process_pending_jobs(self, db: AsyncSession):
        """Busca jobs pendentes e dispara tarefas paralelas para processá-los"""
        from database import OCRJob, AppSettings
        
        # Verificar limite de jobs simultâneos (lido dinamicamente a cada chamada)
        max_concurrent_result = await db.execute(
            select(AppSettings).where(AppSettings.key == 'max_simultaneous_ocr_jobs')
        )
        max_concurrent_setting = max_concurrent_result.scalar_one_or_none()
        max_concurrent = int(max_concurrent_setting.value) if max_concurrent_setting and max_concurrent_setting.value else 2
        
        # Contar jobs em execução
        running_count_result = await db.execute(
            select(func.count(OCRJob.id)).where(OCRJob.status == 'running')
        )
        running_count = running_count_result.scalar() or 0
        
        # Calcular quantos jobs podemos iniciar
        slots_available = max_concurrent - running_count
        
        if slots_available <= 0:
            # Já atingiu o limite de jobs simultâneos
            return
        
        # Buscar próximos jobs pendentes (ordenado por prioridade e data)
        result = await db.execute(
            select(OCRJob)
            .where(OCRJob.status == 'pending')
            .order_by(OCRJob.priority.desc(), OCRJob.created_at.asc())
            .limit(slots_available)
        )
        jobs = result.scalars().all()
        
        if not jobs:
            return
        
        print(f"=== OCR WORKER: Starting {len(jobs)} jobs in parallel (max_concurrent={max_concurrent}, running={running_count}) ===", flush=True)
        
        # Marcar todos como 'running' ANTES de disparar as tasks para evitar race condition
        job_ids = []
        for job in jobs:
            job.status = 'running'
            job.started_at = datetime.now(timezone.utc)
            job_ids.append(job.id)
        await db.commit()
        
        # Disparar tasks em paralelo para cada job
        tasks = []
        for job_id in job_ids:
            task = asyncio.create_task(self._process_single_job(job_id))
            tasks.append(task)
        
        # Não aguardamos aqui - as tasks rodam em background
        # Isso permite que o loop principal continue verificando novos jobs
    
    async def _process_single_job(self, job_id: int):
        """Processa um único job de OCR (executado como task assíncrona)"""
        from database import AsyncSessionLocal, OCRJob, FileVersion, AppSettings
        import mimetypes
        import os
        
        # Tentar importar python-magic, fallback para mimetypes
        try:
            import magic
            has_libmagic = True
        except ImportError:
            has_libmagic = False
        
        try:
            async with AsyncSessionLocal() as db:
                # Buscar o job pelo ID
                result = await db.execute(
                    select(OCRJob).where(OCRJob.id == job_id)
                )
                job = result.scalar_one_or_none()
                
                if not job:
                    logger.error(f"OCR job {job_id} not found")
                    return
                
                file_ext = os.path.splitext(job.file_name)[1].lower() if job.file_name else ''
                
                # Carregar lista de extensões excluídas
                excluded_result = await db.execute(
                    select(AppSettings).where(AppSettings.key == 'auto_ocr_excluded_extensions')
                )
                excluded_setting = excluded_result.scalar_one_or_none()
                auto_ocr_excluded_extensions = []
                if excluded_setting and excluded_setting.value:
                    auto_ocr_excluded_extensions = [e.strip().lower() for e in excluded_setting.value.split(',') if e.strip()]
                
                # Verificar se a extensão está na lista de exclusão
                is_excluded = False
                skip_reason = None
                if file_ext and auto_ocr_excluded_extensions:
                    for excluded_ext in auto_ocr_excluded_extensions:
                        excluded_ext_normalized = excluded_ext if excluded_ext.startswith('.') else f'.{excluded_ext}'
                        if file_ext == excluded_ext_normalized:
                            is_excluded = True
                            skip_reason = f'Extensão {file_ext} está na lista de exclusão'
                            break
                
                # HARD-CODED: Sempre ignorar mimetypes text/* - não faz sentido OCR em texto
                if not is_excluded and job.local_path and os.path.exists(job.local_path):
                    file_mimetype = None
                    
                    # Tentar com libmagic primeiro (detecção real pelo conteúdo)
                    if has_libmagic:
                        try:
                            mime = magic.Magic(mime=True)
                            file_mimetype = mime.from_file(job.local_path)
                        except Exception as e:
                            logger.warning(f"libmagic failed for {job.file_name}: {e}, trying mimetypes fallback")
                    
                    # Fallback para mimetypes (baseado em extensão)
                    if not file_mimetype:
                        file_mimetype, _ = mimetypes.guess_type(job.local_path)
                    
                    if file_mimetype and file_mimetype.startswith('text/'):
                        is_excluded = True
                        skip_reason = f'Mimetype {file_mimetype} é texto (não requer OCR)'
                
                if is_excluded:
                    # Marcar como skipped e não processar
                    job.status = 'skipped'
                    job.error_message = skip_reason
                    job.completed_at = datetime.now(timezone.utc)
                    await db.commit()
                    print(f"=== OCR WORKER: Skipping job {job.id} for {job.file_name} ({skip_reason}) ===", flush=True)
                    logger.info(f"OCR job {job.id} skipped for {job.file_name} ({skip_reason})")
                    await emit_ocr_stats()
                    return
                
                print(f"=== OCR WORKER: Processing job {job.id} for {job.file_name} ===", flush=True)
                logger.info(f"Processing OCR job {job.id} for {job.file_name}")
                
                try:
                    # Verificar se o arquivo existe
                    if not job.local_path or not os.path.exists(job.local_path):
                        raise FileNotFoundError(f"Arquivo não encontrado: {job.local_path}")
                    
                    # Verificar se é certificado digital
                    certificate_extensions = ['.pfx', '.p12', '.cer', '.crt', '.pem']
                    
                    if file_ext in certificate_extensions:
                        # Extrair dados do certificado em formato texto
                        ocr_text, ocr_metadata, error = await self._extract_certificate_text(job.local_path, file_ext, db)
                    else:
                        # Executar OCR normal via Tika
                        ocr_service = await self._get_ocr_service()
                        
                        if not ocr_service.is_available:
                            job.status = 'failed'
                            job.error_message = "Serviço OCR não disponível"
                            job.completed_at = datetime.now(timezone.utc)
                            await db.commit()
                            print(f"=== OCR WORKER: Service unavailable for job {job.id} ===", flush=True)
                            await emit_ocr_stats()
                            return
                        
                        # Executar OCR
                        ocr_text, ocr_metadata, error = await ocr_service.extract_text_and_metadata(
                            job.local_path,
                            ocr_language=job.ocr_language
                        )
                    
                    if ocr_text is not None:
                        job.ocr_text = ocr_text
                        job.ocr_metadata = ocr_metadata
                        job.status = 'completed'
                        
                        # Salvar também em arquivo .ocr
                        try:
                            ocr_file_path = job.local_path + '.ocr'
                            with open(ocr_file_path, 'w', encoding='utf-8') as f:
                                f.write(ocr_text)
                            print(f"=== OCR WORKER: Saved OCR text to {ocr_file_path} ===", flush=True)
                        except Exception as e:
                            logger.warning(f"Failed to save OCR file: {e}")
                        
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
                        job.error_message = error or 'OCR failed - no text extracted'
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
                    # Emitir estatísticas atualizadas via WebSocket
                    await emit_ocr_stats()
                    
        except Exception as e:
            logger.error(f"Critical error processing OCR job {job_id}: {e}")
            print(f"=== OCR WORKER: Critical error for job {job_id}: {e} ===", flush=True)


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
    version_id: Optional[int],
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
    if version_id:
        existing = await db.execute(
            select(OCRJob).where(
                and_(
                    OCRJob.version_id == version_id,
                    OCRJob.status.in_(['pending', 'running'])
                )
            )
        )
    else:
        # Se não tem version_id, verificar por file_id
        existing = await db.execute(
            select(OCRJob).where(
                and_(
                    OCRJob.file_id == file_id,
                    OCRJob.status.in_(['pending', 'running'])
                )
            )
        )
    
    if existing.scalar_one_or_none():
        logger.info(f"OCR job already exists for file {file_id}/version {version_id}")
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
