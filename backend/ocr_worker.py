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
    
    async def _extract_private_key_text(self, file_path: str, file_ext: str, cert_data: bytes, db, 
                                        server_guid: str = None, share_name: str = None, 
                                        file_version_id: int = None, file_name: str = None) -> tuple:
        """
        Extrai informações de arquivos de chave privada (PEM, DER, PPK, SSH keys).
        
        Args:
            file_path: Caminho do arquivo
            file_ext: Extensão do arquivo
            cert_data: Conteúdo binário do arquivo
            db: Sessão do banco de dados
            server_guid: GUID do servidor
            share_name: Nome do share (para enriquecimento de leaks)
            file_version_id: ID da versão do arquivo (para enriquecimento de leaks)
            file_name: Nome original do arquivo
            
        Returns:
            Tuple (text, metadata, error)
        """
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.backends import default_backend
        from database import Server, ServerShare
        
        lines = []
        private_key = None
        key_type = None
        key_description = None
        is_encrypted = False
        
        try:
            # Tentar decodificar como texto para análise
            try:
                text_content = cert_data.decode('utf-8')
            except UnicodeDecodeError:
                try:
                    text_content = cert_data.decode('latin-1')
                except:
                    text_content = None
            
            # Detectar tipo de chave pelo conteúdo
            if text_content:
                # Verificar padrões PEM
                if "-----BEGIN OPENSSH PRIVATE KEY-----" in text_content:
                    key_type = "ssh-openssh"
                    key_description = "Chave Privada SSH (OpenSSH)"
                elif "-----BEGIN RSA PRIVATE KEY-----" in text_content:
                    key_type = "ssh-rsa"
                    key_description = "Chave Privada RSA"
                    # Verificar se está criptografada
                    if "Proc-Type:" in text_content and "ENCRYPTED" in text_content:
                        is_encrypted = True
                        key_description = "Chave Privada RSA (Criptografada)"
                elif "-----BEGIN DSA PRIVATE KEY-----" in text_content:
                    key_type = "ssh-dsa"
                    key_description = "Chave Privada DSA"
                elif "-----BEGIN EC PRIVATE KEY-----" in text_content:
                    key_type = "ssh-ec"
                    key_description = "Chave Privada EC (Elliptic Curve)"
                elif "-----BEGIN ED25519 PRIVATE KEY-----" in text_content:
                    key_type = "ssh-ed25519"
                    key_description = "Chave Privada Ed25519"
                elif "-----BEGIN PRIVATE KEY-----" in text_content:
                    key_type = "pkcs8"
                    key_description = "Chave Privada PKCS#8"
                elif "-----BEGIN ENCRYPTED PRIVATE KEY-----" in text_content:
                    key_type = "pkcs8-encrypted"
                    key_description = "Chave Privada PKCS#8 (Criptografada)"
                    is_encrypted = True
                elif "PuTTY-User-Key-File-" in text_content:
                    key_type = "ppk"
                    key_description = "Chave Privada PuTTY (PPK)"
                    # Verificar se está criptografada
                    if "Encryption:" in text_content and "none" not in text_content.lower():
                        is_encrypted = True
                        key_description = "Chave Privada PuTTY (PPK - Criptografada)"
                elif "-----BEGIN PGP PRIVATE KEY BLOCK-----" in text_content:
                    key_type = "pgp"
                    key_description = "Chave Privada PGP/GPG"
            
            # Se não detectou por padrão PEM, tentar carregar como DER
            if not key_type and file_ext in ['.der', '.p8', '.pkcs8']:
                try:
                    private_key = serialization.load_der_private_key(cert_data, password=None, backend=default_backend())
                    key_type = "der-private"
                    key_description = f"Chave Privada DER ({type(private_key).__name__})"
                except Exception:
                    try:
                        # Tentar com senha vazia (pode estar criptografada)
                        private_key = serialization.load_der_private_key(cert_data, password=b'', backend=default_backend())
                        key_type = "der-private"
                        key_description = f"Chave Privada DER ({type(private_key).__name__})"
                    except Exception:
                        is_encrypted = True
                        key_type = "der-private-encrypted"
                        key_description = "Chave Privada DER (Possivelmente Criptografada)"
            
            # Se ainda não detectou, tentar pelo nome do arquivo (SSH keys)
            if not key_type and file_name:
                base_name = file_name.lower()
                if 'id_rsa' in base_name:
                    key_type = "ssh-rsa"
                    key_description = "Chave Privada SSH RSA"
                elif 'id_dsa' in base_name:
                    key_type = "ssh-dsa"
                    key_description = "Chave Privada SSH DSA"
                elif 'id_ecdsa' in base_name:
                    key_type = "ssh-ec"
                    key_description = "Chave Privada SSH ECDSA"
                elif 'id_ed25519' in base_name:
                    key_type = "ssh-ed25519"
                    key_description = "Chave Privada SSH Ed25519"
                elif 'ssh_host' in base_name:
                    key_type = "ssh-host"
                    key_description = "Chave de Host SSH"
            
            # Tentar carregar a chave para obter mais informações
            if not private_key and text_content and key_type:
                try:
                    if not is_encrypted:
                        private_key = serialization.load_pem_private_key(cert_data, password=None, backend=default_backend())
                except Exception as e:
                    logger.debug(f"Não foi possível carregar chave PEM: {e}")
            
            # Gerar saída de texto
            lines.append("=" * 60)
            lines.append("INFORMAÇÕES DE CHAVE PRIVADA")
            lines.append("=" * 60)
            lines.append("")
            
            if key_type:
                lines.append(f"Tipo: {key_description}")
                lines.append(f"Identificador: {key_type}")
                lines.append(f"Criptografada: {'SIM' if is_encrypted else 'NÃO'}")
                lines.append("")
                lines.append("*** ATENÇÃO: ARQUIVO CONTÉM CHAVE PRIVADA - DADOS SENSÍVEIS! ***")
            else:
                lines.append("Tipo: Não identificado")
                lines.append("O arquivo parece conter dados de chave, mas o formato não foi reconhecido.")
            
            lines.append("")
            lines.append("-" * 40)
            lines.append("ARQUIVO")
            lines.append("-" * 40)
            lines.append(f"  Nome: {file_name or os.path.basename(file_path)}")
            lines.append(f"  Extensão: {file_ext}")
            lines.append(f"  Tamanho: {len(cert_data)} bytes")
            
            # Se conseguiu carregar a chave, mostrar mais informações
            if private_key:
                lines.append("")
                lines.append("-" * 40)
                lines.append("DETALHES DA CHAVE")
                lines.append("-" * 40)
                lines.append(f"  Algoritmo: {type(private_key).__name__}")
                
                # Tentar obter o tamanho da chave
                try:
                    if hasattr(private_key, 'key_size'):
                        lines.append(f"  Tamanho: {private_key.key_size} bits")
                except:
                    pass
            
            ocr_text = '\n'.join(lines)
            metadata = {
                "type": "private_key",
                "key_type": key_type,
                "description": key_description,
                "encrypted": is_encrypted,
                "file_name": file_name or os.path.basename(file_path)
            }
            
            # REGISTRAR LEAK se detectou chave privada
            if key_type and server_guid:
                try:
                    from routes_v2 import auto_register_private_key_leak
                    
                    # Buscar server_id
                    server_result = await db.execute(
                        select(Server).where(Server.guid == server_guid)
                    )
                    server_obj = server_result.scalar_one_or_none()
                    server_id = server_obj.id if server_obj else None
                    
                    # Buscar share_id
                    share_id = None
                    if share_name:
                        share_result = await db.execute(
                            select(ServerShare).where(
                                ServerShare.server_guid == server_guid,
                                ServerShare.share_name == share_name
                            )
                        )
                        share = share_result.scalar_one_or_none()
                        if share:
                            share_id = share.id
                    
                    # Conteúdo para preview (primeiras linhas se for texto)
                    preview_content = key_description or "Chave privada detectada"
                    if text_content:
                        preview_lines = text_content.split('\n')[:5]
                        preview_content = '\n'.join(preview_lines)
                    
                    leak_result = await auto_register_private_key_leak(
                        file_path=file_path,
                        content=preview_content,
                        server_id=server_id,
                        key_type=key_type,
                        description=key_description,
                        file_version_id=file_version_id,
                        share_name=share_name,
                        server_guid=server_guid,
                        share_id=share_id
                    )
                    
                    if not leak_result.get("already_exists"):
                        logger.info(f"Leak auto-registrado para chave privada: {file_path} ({key_type})")
                        print(f"=== OCR WORKER: LEAK REGISTERED - Private key: {file_path} ({key_type}) ===", flush=True)
                    else:
                        logger.debug(f"Leak já existia: {file_path}")
                        
                except Exception as e:
                    logger.warning(f"Erro ao registrar leak de chave privada: {e}")
            
            return ocr_text, metadata, None
            
        except Exception as e:
            logger.error(f"Erro ao extrair informações de chave privada: {e}")
            return None, None, str(e)
    
    async def _extract_certificate_text(self, file_path: str, file_ext: str, db, server_guid: str = None, share_name: str = None, file_version_id: int = None, file_name: str = None) -> tuple:
        """
        Extrai informações de certificados digitais e chaves privadas em formato texto.
        
        Args:
            file_path: Caminho do arquivo do certificado/chave
            file_ext: Extensão do arquivo (.pfx, .p12, .cer, .crt, .pem, .key, .ppk, etc)
            db: Sessão do banco de dados
            server_guid: GUID do servidor (para buscar senhas específicas)
            share_name: Nome do share (para enriquecimento de leaks)
            file_version_id: ID da versão do arquivo (para enriquecimento de leaks)
            file_name: Nome original do arquivo (para detectar SSH keys)
            
        Returns:
            Tuple (text, metadata, error)
        """
        from cryptography import x509
        from cryptography.hazmat.primitives import serialization, hashes
        from cryptography.hazmat.backends import default_backend
        from cryptography.hazmat.primitives.serialization import pkcs12
        from database import PfxPassword, FileVersion, ServerShare
        from sqlalchemy import select, distinct
        
        try:
            with open(file_path, 'rb') as f:
                cert_data = f.read()
            
            cert = None
            private_key = None
            chain = None
            
            # Verificar se é arquivo de chave privada puro (não certificado)
            private_key_only_extensions = ['.key', '.priv', '.private', '.ppk', '.der', '.p8', '.pkcs8']
            ssh_key_names = ['id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519', 'id_ed25519_sk', 'id_ecdsa_sk',
                            'identity', 'ssh_host_rsa_key', 'ssh_host_dsa_key', 'ssh_host_ecdsa_key', 'ssh_host_ed25519_key']
            
            # Detectar arquivo SSH por nome
            is_ssh_file = file_name and any(
                file_name.lower() == name.lower() or file_name.lower().startswith(name.lower() + '.')
                for name in ssh_key_names
            )
            
            # Verificar se é arquivo de chave privada (sem certificado)
            if file_ext in private_key_only_extensions or is_ssh_file:
                return await self._extract_private_key_text(
                    file_path, file_ext, cert_data, db, 
                    server_guid=server_guid, share_name=share_name, 
                    file_version_id=file_version_id, file_name=file_name
                )
            
            if file_ext in ['.pfx', '.p12']:
                passwords_to_try = []
                
                # 1. Buscar senha específica para este arquivo
                if server_guid:
                    try:
                        specific_result = await db.execute(
                            select(PfxPassword).where(
                                PfxPassword.server_guid == server_guid,
                                PfxPassword.file_path == file_path
                            )
                        )
                        specific_pwd = specific_result.scalar_one_or_none()
                        if specific_pwd and specific_pwd.password:
                            passwords_to_try.append(("específica do arquivo", specific_pwd.password.encode()))
                            logger.info(f"Found specific password for {file_path}")
                    except Exception as e:
                        logger.warning(f"Error fetching specific password: {e}")
                
                # 2. Tentar sem senha
                passwords_to_try.append(("sem senha (None)", None))
                passwords_to_try.append(("sem senha (vazio)", b''))
                
                # 3. Senhas comuns
                common_passwords = ['password', '123456', 'changeit', '1234', 'admin', 'senha', '12345678']
                for pwd in common_passwords:
                    passwords_to_try.append((f"comum: {pwd}", pwd.encode()))
                
                # 4. Buscar TODAS as senhas distintas do banco para força bruta
                try:
                    all_passwords_result = await db.execute(
                        select(distinct(PfxPassword.password))
                    )
                    all_passwords = all_passwords_result.scalars().all()
                    
                    for saved_pwd in all_passwords:
                        if saved_pwd:
                            # Evitar duplicatas
                            pwd_bytes = saved_pwd.encode()
                            if not any(p[1] == pwd_bytes for p in passwords_to_try):
                                passwords_to_try.append(("banco de dados", pwd_bytes))
                    
                    if all_passwords:
                        logger.info(f"Found {len(all_passwords)} distinct passwords in database for brute force")
                except Exception as e:
                    logger.warning(f"Error fetching all passwords: {e}")
                
                # Tentar cada senha
                logger.info(f"Attempting to open PFX with {len(passwords_to_try)} passwords")
                for pwd_source, pwd in passwords_to_try:
                    try:
                        private_key, cert, chain = pkcs12.load_key_and_certificates(
                            cert_data, pwd, default_backend()
                        )
                        logger.info(f"Successfully opened PFX with password from: {pwd_source}")
                        
                        # Salvar a senha que funcionou (se não for a específica já salva)
                        if server_guid and pwd and pwd_source != "específica do arquivo":
                            try:
                                # Verificar se já existe
                                existing = await db.execute(
                                    select(PfxPassword).where(
                                        PfxPassword.server_guid == server_guid,
                                        PfxPassword.file_path == file_path
                                    )
                                )
                                if not existing.scalar_one_or_none():
                                    # Salvar nova senha
                                    new_pwd = PfxPassword(
                                        server_guid=server_guid,
                                        file_path=file_path,
                                        password=pwd.decode()
                                    )
                                    db.add(new_pwd)
                                    await db.commit()
                                    logger.info(f"Saved discovered password for {file_path}")
                            except Exception as e:
                                logger.warning(f"Error saving discovered password: {e}")
                        
                        break
                    except Exception:
                        continue
                
                if not cert and not private_key and not chain:
                    return None, None, f"Não foi possível abrir o certificado PFX/P12 (tentadas {len(passwords_to_try)} senhas)"
                
                # Se não tem cert principal mas tem chain, usar o primeiro da chain
                if not cert and chain and len(chain) > 0:
                    cert = chain[0]
                    chain = chain[1:] if len(chain) > 1 else []
                    logger.info("Using first certificate from chain as main certificate")
                    
            elif file_ext in ['.cer', '.crt', '.pem']:
                try:
                    cert = x509.load_pem_x509_certificate(cert_data, default_backend())
                except Exception:
                    try:
                        cert = x509.load_der_x509_certificate(cert_data, default_backend())
                    except Exception as e:
                        return None, None, f"Não foi possível carregar o certificado: {e}"
            
            # Coletar TODOS os certificados
            all_certs = []
            if cert:
                all_certs.append({"cert": cert, "has_private_key": private_key is not None, "source": "principal"})
            if chain:
                for i, chain_cert in enumerate(chain):
                    all_certs.append({"cert": chain_cert, "has_private_key": False, "source": f"chain[{i}]"})
            
            if not all_certs and not private_key:
                return None, None, "Não foi possível extrair informações do certificado"
            
            # Extrair informações de TODOS os certificados
            lines = []
            lines.append("=" * 60)
            lines.append("INFORMAÇÕES DO CERTIFICADO DIGITAL")
            lines.append("=" * 60)
            lines.append("")
            
            # Resumo
            lines.append(f"Total de certificados: {len(all_certs)}")
            lines.append(f"Contém chave privada: {'SIM - DADOS SENSÍVEIS!' if private_key else 'NÃO'}")
            lines.append("")
            
            # Thumbprint do certificado principal para registro de leak
            main_thumbprint = None
            main_subject_cn = None
            
            # Processar cada certificado
            for cert_idx, cert_entry in enumerate(all_certs):
                cert_obj = cert_entry["cert"]
                has_key = cert_entry["has_private_key"]
                source = cert_entry["source"]
                
                # Thumbprint/Fingerprint
                thumbprint = cert_obj.fingerprint(hashes.SHA1()).hex().upper()
                thumbprint_formatted = ':'.join(thumbprint[i:i+2] for i in range(0, len(thumbprint), 2))
                
                if cert_idx == 0:
                    main_thumbprint = thumbprint
                
                lines.append("=" * 60)
                lines.append(f"CERTIFICADO #{cert_idx + 1} ({source})")
                if has_key:
                    lines.append("*** CONTÉM CHAVE PRIVADA ***")
                lines.append("=" * 60)
                lines.append("")
                lines.append(f"Thumbprint (SHA1): {thumbprint_formatted}")
                lines.append("")
                
                # Subject (Assunto)
                lines.append("-" * 40)
                lines.append("SUBJECT (Assunto)")
                lines.append("-" * 40)
                for attr in cert_obj.subject:
                    attr_name = attr.oid._name
                    attr_value = attr.value
                    if attr_name == 'commonName' and cert_idx == 0:
                        main_subject_cn = attr_value
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
                for attr in cert_obj.issuer:
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
                lines.append(f"  Válido de: {cert_obj.not_valid_before_utc.strftime('%Y-%m-%d %H:%M:%S UTC')}")
                lines.append(f"  Válido até: {cert_obj.not_valid_after_utc.strftime('%Y-%m-%d %H:%M:%S UTC')}")
                
                # Verificar se está expirado
                from datetime import datetime, timezone
                now = datetime.now(timezone.utc)
                if now > cert_obj.not_valid_after_utc:
                    lines.append("  Status: EXPIRADO")
                elif now < cert_obj.not_valid_before_utc:
                    lines.append("  Status: AINDA NÃO VÁLIDO")
                else:
                    days_left = (cert_obj.not_valid_after_utc - now).days
                    lines.append(f"  Status: VÁLIDO ({days_left} dias restantes)")
                lines.append("")
                
                # Informações técnicas
                lines.append("-" * 40)
                lines.append("INFORMAÇÕES TÉCNICAS")
                lines.append("-" * 40)
                lines.append(f"  Versão: {cert_obj.version.name} (v{cert_obj.version.value + 1})")
                lines.append(f"  Número de Série: {cert_obj.serial_number}")
                lines.append(f"  Algoritmo de Assinatura: {cert_obj.signature_algorithm_oid._name}")
                
                # Tipo da chave privada (se tiver)
                if has_key and private_key is not None:
                    key_type = type(private_key).__name__
                    lines.append(f"  Tipo da Chave Privada: {key_type}")
                lines.append("")
                
                # Extensões (se houver)
                try:
                    extensions = cert_obj.extensions
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
                                try:
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
                                except Exception:
                                    pass
                                if usages:
                                    lines.append(f"    Usos: {', '.join(usages)}")
                            elif ext_name == 'subjectAltName':
                                try:
                                    for name in ext.value:
                                        lines.append(f"    {type(name).__name__}: {name.value}")
                                except Exception:
                                    pass
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
                'thumbprint': main_thumbprint,
                'has_private_key': private_key is not None,
                'total_certificates': len(all_certs),
                'subject_cn': main_subject_cn,
                'issuer_cn': None,
                'not_before': all_certs[0]["cert"].not_valid_before_utc.isoformat() if all_certs else None,
                'not_after': all_certs[0]["cert"].not_valid_after_utc.isoformat() if all_certs else None,
            }
            
            # Extrair Issuer CN
            if all_certs:
                for attr in all_certs[0]["cert"].issuer:
                    if attr.oid._name == 'commonName':
                        metadata['issuer_cn'] = attr.value
                        break
            
            # REGISTRAR LEAK se tem chave privada
            if private_key is not None and server_guid:
                try:
                    from routes_v2 import auto_register_private_key_leak
                    from database import Server, ServerShare
                    
                    # Buscar server_id e outras informações
                    server_result = await db.execute(
                        select(Server).where(Server.guid == server_guid)
                    )
                    server_obj = server_result.scalar_one_or_none()
                    server_id = server_obj.id if server_obj else None
                    
                    # Buscar share_id
                    share_id = None
                    if share_name:
                        share_result = await db.execute(
                            select(ServerShare).where(
                                ServerShare.server_guid == server_guid,
                                ServerShare.share_name == share_name
                            )
                        )
                        share = share_result.scalar_one_or_none()
                        if share:
                            share_id = share.id
                    
                    # Buscar file_version_id
                    file_version_id = None
                    version_result = await db.execute(
                        select(FileVersion).where(
                            FileVersion.server_guid == server_guid,
                            FileVersion.file_path == file_path,
                            FileVersion.is_current == True
                        )
                    )
                    current_version = version_result.scalar_one_or_none()
                    if current_version:
                        file_version_id = current_version.id
                    
                    # Criar descrição enriquecida
                    key_description = f"Certificado PFX com chave privada: {main_subject_cn or 'Unknown'} (Thumbprint: {main_thumbprint or 'N/A'})"
                    
                    leak_result = await auto_register_private_key_leak(
                        file_path=file_path,
                        content=f"Certificado: {main_subject_cn or 'Unknown'} ({len(all_certs)} cert(s))",
                        server_id=server_id,
                        key_type="pfx-private-key",
                        description=key_description,
                        file_version_id=file_version_id,
                        share_name=share_name,
                        server_guid=server_guid,
                        share_id=share_id
                    )
                    
                    if not leak_result.get("already_exists"):
                        logger.info(f"Leak auto-registrado para PFX com chave privada: {file_path}")
                        print(f"=== OCR WORKER: LEAK REGISTERED - PFX with private key: {file_path} ===", flush=True)
                    else:
                        logger.debug(f"Leak PFX já existia: {file_path}")
                        
                except Exception as e:
                    logger.warning(f"Erro ao registrar leak de PFX: {e}")
            
            print(f"=== OCR WORKER: Certificate extracted successfully ({len(all_certs)} certs, has_key={private_key is not None}) ===", flush=True)
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
                error_msg = str(e)
                # Reportar erro ao DB watchdog
                try:
                    from db_watchdog import report_db_error
                    report_db_error(error_msg)
                except Exception:
                    pass
                
                if "database is locked" in error_msg:
                    logger.warning("Database locked in OCR worker, retrying in 5s...")
                    await asyncio.sleep(5)
                else:
                    logger.error(f"Database error in OCR worker loop: {e}")
            except Exception as e:
                error_msg = str(e)
                # Verificar se é erro de pool/conexão e reportar
                error_lower = error_msg.lower()
                if any(x in error_lower for x in ['pool', 'connection', 'database', 'sqlite']):
                    try:
                        from db_watchdog import report_db_error
                        report_db_error(error_msg)
                    except Exception:
                        pass
                
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
    
    async def _try_auto_index_content(self, job, db):
        """Tenta indexar o conteúdo bruto do arquivo quando OCR não é executado ou falha."""
        from database import AppSettings, FileVersion
        import os
        import mimetypes as mt_module

        try:
            # 1. Verificar se auto_index está habilitado
            settings_result = await db.execute(
                select(AppSettings).where(
                    AppSettings.key.in_([
                        'auto_index_enabled',
                        'auto_index_max_size_mb',
                        'auto_index_extensions',
                        'auto_index_mimetypes'
                    ])
                )
            )
            settings_map = {s.key: s.value for s in settings_result.scalars().all()}

            if settings_map.get('auto_index_enabled', 'true') != 'true':
                return

            # 2. Verificar se o arquivo existe
            if not job.local_path or not os.path.exists(job.local_path):
                return

            # 3. Verificar tamanho do arquivo
            max_size_mb = float(settings_map.get('auto_index_max_size_mb', '10'))
            file_size = os.path.getsize(job.local_path)
            if file_size > max_size_mb * 1024 * 1024:
                logger.debug(f"Auto-index skipped for {job.file_name}: file too large ({file_size} bytes)")
                return

            # 4. Verificar extensão OU mimetype match
            import fnmatch as fnmatch_module
            allowed_extensions = [e.strip().lower() for e in settings_map.get('auto_index_extensions', '').split(',') if e.strip()]
            allowed_mimetypes = [m.strip().lower() for m in settings_map.get('auto_index_mimetypes', '').split(',') if m.strip()]

            file_name_lower = (job.file_name or '').lower()
            file_ext = os.path.splitext(file_name_lower)[1].lower()
            file_mimetype, _ = mt_module.guess_type(job.local_path or job.file_name or '')

            ext_match = False
            for pattern in allowed_extensions:
                if '*' in pattern or '?' in pattern:
                    # Wildcard: ex .env* casa com .env, .env.local, .env.production
                    if fnmatch_module.fnmatch(file_name_lower, '*' + pattern if not pattern.startswith('*') else pattern):
                        ext_match = True
                        break
                else:
                    # Match exato de extensão
                    if file_ext == pattern:
                        ext_match = True
                        break
            mime_match = False
            if file_mimetype:
                for allowed_mime in allowed_mimetypes:
                    if file_mimetype.lower().startswith(allowed_mime):
                        mime_match = True
                        break

            if not ext_match and not mime_match:
                return

            # 5. Ler conteúdo do arquivo (UTF-8 com fallback latin-1)
            content = None
            try:
                with open(job.local_path, 'r', encoding='utf-8') as f:
                    content = f.read()
            except UnicodeDecodeError:
                try:
                    with open(job.local_path, 'r', encoding='latin-1') as f:
                        content = f.read()
                except Exception:
                    return
            except Exception:
                return

            if not content or not content.strip():
                return

            # 6. Salvar em FileVersion.ocr_content
            if job.version_id:
                version_result = await db.execute(
                    select(FileVersion).where(FileVersion.id == job.version_id)
                )
                version = version_result.scalar_one_or_none()
                if version:
                    version.ocr_content = content
                    version.ocr_processed = True
                    version.ocr_processed_at = datetime.now(timezone.utc)
                    await db.commit()
                    logger.info(f"Auto-indexed content for {job.file_name} ({len(content)} chars)")
                    print(f"=== OCR WORKER: Auto-indexed content for {job.file_name} ({len(content)} chars) ===", flush=True)

        except Exception as e:
            logger.warning(f"Auto-index failed for {job.file_name}: {e}")

    async def _process_single_job(self, job_id: int):
        """Processa um único job de OCR (executado como task assíncrona)"""
        from database import AsyncSessionLocal, OCRJob, FileVersion, AppSettings, Server
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
                
                # CONDIÇÃO 1: Verificar se o servidor ainda existe
                if job.server_id:
                    server_result = await db.execute(
                        select(Server).where(Server.id == job.server_id)
                    )
                    server = server_result.scalar_one_or_none()
                    
                    if not server:
                        # Servidor foi excluído - remover o job
                        logger.info(f"OCR job {job_id} - Server {job.server_id} was deleted, removing job")
                        print(f"=== OCR WORKER: Job {job_id} removed - server was deleted ===", flush=True)
                        await db.delete(job)
                        await db.commit()
                        await emit_ocr_stats()
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
                    await self._try_auto_index_content(job, db)
                    await emit_ocr_stats()
                    return
                
                print(f"=== OCR WORKER: Processing job {job.id} for {job.file_name} ===", flush=True)
                logger.info(f"Processing OCR job {job.id} for {job.file_name}")
                
                try:
                    # Verificar se o arquivo existe
                    if not job.local_path or not os.path.exists(job.local_path):
                        raise FileNotFoundError(f"Arquivo não encontrado: {job.local_path}")
                    
                    # Verificar se é certificado digital ou arquivo de chave privada
                    certificate_extensions = ['.pfx', '.p12', '.cer', '.crt', '.pem']
                    private_key_extensions = ['.key', '.priv', '.private', '.ppk', '.der', '.p8', '.pkcs8']
                    ssh_key_names = ['id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519', 'id_ed25519_sk', 'id_ecdsa_sk',
                                    'identity', 'ssh_host_rsa_key', 'ssh_host_dsa_key', 'ssh_host_ecdsa_key', 'ssh_host_ed25519_key']
                    
                    # Verificar se é arquivo de chave SSH pelo nome
                    is_ssh_key_file = job.file_name and any(
                        job.file_name.lower() == name.lower() or 
                        job.file_name.lower().startswith(name.lower() + '.')
                        for name in ssh_key_names
                    )
                    
                    if file_ext in certificate_extensions or file_ext in private_key_extensions or is_ssh_key_file:
                        # Buscar server_guid para pesquisa de senhas
                        server_guid = None
                        share_name = None
                        file_version_id = None
                        
                        if job.server_id:
                            server_result = await db.execute(
                                select(Server).where(Server.id == job.server_id)
                            )
                            server_obj = server_result.scalar_one_or_none()
                            if server_obj:
                                server_guid = server_obj.guid
                        
                        # Buscar share_name e file_version_id do DownloadedFile
                        if job.file_id:
                            from database import DownloadedFile
                            df_result = await db.execute(
                                select(DownloadedFile).where(DownloadedFile.id == job.file_id)
                            )
                            downloaded_file = df_result.scalar_one_or_none()
                            if downloaded_file:
                                share_name = downloaded_file.share_name
                        
                        # Buscar file_version_id
                        if job.version_id:
                            file_version_id = job.version_id
                        elif server_guid and job.file_path:
                            from database import FileVersion
                            version_result = await db.execute(
                                select(FileVersion).where(
                                    FileVersion.server_guid == server_guid,
                                    FileVersion.file_path == job.file_path,
                                    FileVersion.is_current == True
                                )
                            )
                            current_version = version_result.scalar_one_or_none()
                            if current_version:
                                file_version_id = current_version.id
                        
                        # Extrair dados do certificado em formato texto
                        ocr_text, ocr_metadata, error = await self._extract_certificate_text(
                            job.local_path, file_ext, db, 
                            server_guid=server_guid,
                            share_name=share_name,
                            file_version_id=file_version_id,
                            file_name=job.file_name
                        )
                    else:
                        # CONDIÇÃO 2: Executar OCR com retry em caso de erro de comunicação
                        max_retries = 5
                        retry_delay = 10  # segundos
                        ocr_text = None
                        ocr_metadata = None
                        error = None
                        
                        for attempt in range(1, max_retries + 1):
                            try:
                                ocr_service = await self._get_ocr_service()
                                
                                if not ocr_service.is_available:
                                    if attempt < max_retries:
                                        print(f"=== OCR WORKER: Job {job.id} - Tika unavailable, retry {attempt}/{max_retries} in {retry_delay}s ===", flush=True)
                                        logger.warning(f"OCR job {job.id} - Tika unavailable, retry {attempt}/{max_retries}")
                                        await asyncio.sleep(retry_delay)
                                        # Forçar nova verificação do serviço
                                        self._ocr_service = None
                                        continue
                                    else:
                                        error = "Serviço OCR não disponível após 5 tentativas"
                                        break
                                
                                # Executar OCR
                                ocr_text, ocr_metadata, error = await ocr_service.extract_text_and_metadata(
                                    job.local_path,
                                    ocr_language=job.ocr_language
                                )
                                
                                # Se chegou aqui sem exceção, sucesso
                                break
                                
                            except (ConnectionError, TimeoutError, OSError) as conn_error:
                                # Erro de comunicação - fazer retry
                                error_msg = str(conn_error)
                                if attempt < max_retries:
                                    print(f"=== OCR WORKER: Job {job.id} - Connection error, retry {attempt}/{max_retries} in {retry_delay}s: {error_msg} ===", flush=True)
                                    logger.warning(f"OCR job {job.id} - Connection error, retry {attempt}/{max_retries}: {error_msg}")
                                    await asyncio.sleep(retry_delay)
                                    # Forçar nova verificação do serviço
                                    self._ocr_service = None
                                else:
                                    error = f"Erro de comunicação com Tika após {max_retries} tentativas: {error_msg}"
                                    logger.error(f"OCR job {job.id} - Failed after {max_retries} retries: {error_msg}")
                            
                            except Exception as tika_error:
                                # Verificar se é erro de conexão ou timeout (pode vir encapsulado)
                                error_str = str(tika_error).lower()
                                is_connection_error = any(x in error_str for x in [
                                    'connection', 'refused', 'reset', 'broken pipe',
                                    'network', 'unreachable', 'name resolution', 'max retries'
                                ])
                                is_timeout_error = 'timeout' in error_str
                                
                                if is_connection_error and attempt < max_retries:
                                    print(f"=== OCR WORKER: Job {job.id} - Tika connection error, retry {attempt}/{max_retries} in {retry_delay}s: {tika_error} ===", flush=True)
                                    logger.warning(f"OCR job {job.id} - Tika connection error, retry {attempt}/{max_retries}: {tika_error}")
                                    await asyncio.sleep(retry_delay)
                                    self._ocr_service = None
                                elif is_timeout_error:
                                    # Timeout não faz retry - provavelmente arquivo muito grande
                                    error = str(tika_error)
                                    logger.warning(f"OCR job {job.id} - Timeout processing file (file may be too large): {tika_error}")
                                    break
                                else:
                                    # Outro tipo de erro
                                    error = str(tika_error)
                                    if is_connection_error:
                                        error = f"Erro de comunicação com Tika após {max_retries} tentativas: {tika_error}"
                                    break
                        
                        # Verificar se o erro retornado pelo OCR service é de timeout
                        if error and 'timeout' in error.lower():
                            logger.warning(f"OCR job {job.id} - Processing timeout (no retry)")
                    
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
                        await self._try_auto_index_content(job, db)
                    
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
