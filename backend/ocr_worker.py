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
            password_used = None
            
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
                        password_used = pwd
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
                lines.append(f"  Status: EXPIRADO")
            elif now < cert.not_valid_before_utc:
                lines.append(f"  Status: AINDA NÃO VÁLIDO")
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
            
            print(f"=== OCR WORKER: Certificate extracted successfully ===", flush=True)
            return text, metadata, None
            
        except Exception as e:
            logger.error(f"Error extracting certificate: {e}")
            return None, None, f"Erro ao extrair certificado: {str(e)}"
    
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
            
            # Verificar se é certificado digital
            file_ext = os.path.splitext(job.file_name)[1].lower() if job.file_name else ''
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
