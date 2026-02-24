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


async def get_critical_search_config() -> dict:
    """Obtém a configuração de Critical Search do banco de dados ou usa o padrão"""
    from database import async_session_maker, AppSettings
    from sqlalchemy import select
    
    # Configuração padrão inline (simplificada)
    default_config = {
        "enabled": True,
        "file_rules": {
            "keywords": [
                "senha", "password", "pwd", "pass",
                "acesso", "access", "login", "auth",
                "credencial", "credential", "cred",
                "secret", "segredo", "chave", "key",
                "token", "api_key", "apikey",
                "config", "configuracao", "settings",
                "backup", "dump", "export",
                "private", "privado", "cert",
                "conexao", "connection", "conn",
                "usuario", "user", "admin",
                "cofre", "safe", "ldap"
            ],
            "extensions": [
                ".pfx", ".p12", ".jks", ".keystore",
                ".pem", ".crt", ".cer", ".der",
                ".kdbx", ".kdb", ".psafe", ".psafe3",
                ".cmd", ".bat", ".sh", ".ps1", ".psm1",
                ".conf", ".ini", ".env", ".yml", ".yaml",
                ".properties", ".cfg", ".config",
                ".htpasswd", ".htaccess",
                ".npmrc", ".pypirc", ".netrc",
                ".pgpass", ".my.cnf",
                ".aws", ".boto",
                ".ssh", ".gnupg",
                ".ppk", ".key", ".priv"
            ],
            "exact_names": [
                ".env", ".env.local", ".env.production",
                "web.config", "app.config", "appsettings.json",
                "settings.py", "config.py", "secrets.yaml",
                "credentials.json", "service-account.json",
                "id_rsa", "id_rsa.pub", "id_dsa", "id_ecdsa", "id_ed25519",
                "credentials", "shadow", "passwd", "htpasswd"
            ],
            "excluded_extensions": [
                # Executáveis Windows
                ".exe", ".msi", ".dll", ".sys", ".drv", ".ocx", ".cpl", ".scr",
                # Bibliotecas Linux/Mac
                ".so", ".dylib", ".a",
                # Binários genéricos
                ".bin", ".dat", ".pdb", ".obj", ".o",
                # Mídia - Vídeo
                ".mp4", ".avi", ".mkv", ".mov", ".wmv", ".flv", ".webm", ".m4v", ".mpeg", ".mpg",
                # Mídia - Áudio
                ".mp3", ".wav", ".wma", ".aac", ".flac", ".ogg", ".m4a",
                # Imagens
                ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".ico", ".webp", ".tiff", ".tif", ".svg", ".psd", ".raw", ".heic", ".heif",
                # Arquivos compactados
                ".zip", ".rar", ".7z", ".tar", ".gz", ".tgz", ".bz2", ".xz", ".lzma",
                # Imagens de disco
                ".iso", ".img", ".vhd", ".vhdx", ".vmdk", ".qcow2",
                # Pacotes Windows
                ".cab", ".msp", ".msm", ".msu",
                # Fontes
                ".ttf", ".otf", ".woff", ".woff2", ".eot",
                # Web (estáticos)
                ".css", ".html", ".htm",
                # Dados compilados/cache
                ".pyc", ".pyo", ".class", ".jar",
                # Databases binários
                ".mdb", ".accdb", ".ldb",
                # Arquivos de sistema Windows
                ".etl", ".evtx", ".dmp"
            ],
            "excluded_files": [
                # Windows
                "Thumbs.db",
                "desktop.ini",
                "ntuser.dat",
                "ntuser.dat.LOG1",
                "ntuser.dat.LOG2",
                "NTUSER.DAT",
                "ntuser.ini",
                "pagefile.sys",
                "hiberfil.sys",
                "swapfile.sys",
                "$MFT",
                "$MFTMirr",
                "$LogFile",
                "$Volume",
                "$AttrDef",
                "$Bitmap",
                "$Boot",
                "$BadClus",
                "$Secure",
                "$UpCase",
                "$Extend",
                "bootmgr",
                "BOOTNXT",
                # Mac
                ".DS_Store",
                ".Spotlight-V100",
                ".Trashes",
                ".fseventsd",
                # Controle de versão
                ".gitignore",
                ".gitattributes"
            ]
        }
    }
    
    try:
        async with async_session_maker() as db:
            result = await db.execute(
                select(AppSettings).where(AppSettings.key == "critical_search_config")
            )
            setting = result.scalar_one_or_none()
            
            if setting:
                return json.loads(setting.value)
    except Exception as e:
        logger.warning(f"Erro ao carregar config de Critical Search: {e}")
    
    return default_config


def check_file_matches_critical_rules(file_path: str, config: dict) -> tuple:
    """
    Verifica se um arquivo corresponde às regras do Critical Search.
    
    Args:
        file_path: Caminho completo do arquivo
        config: Configuração do Critical Search
        
    Returns:
        Tuple (matches: bool, rule_type: str, rule_value: str, description: str)
    """
    if not config.get("enabled", True):
        return False, None, None, None
    
    file_rules = config.get("file_rules", {})
    
    # Extrair nome e extensão do arquivo
    file_name = os.path.basename(file_path)
    file_name_lower = file_name.lower()
    _, file_ext = os.path.splitext(file_name_lower)
    
    # Verificar arquivos excluídos por nome exato primeiro
    excluded_files = file_rules.get("excluded_files", [])
    for excluded in excluded_files:
        if file_name_lower == excluded.lower():
            return False, None, None, None
    
    # Verificar extensões excluídas
    excluded_extensions = file_rules.get("excluded_extensions", [])
    if file_ext in excluded_extensions:
        return False, None, None, None
    
    # 1. Verificar nomes exatos (críticos)
    exact_names = file_rules.get("exact_names", [])
    for exact_name in exact_names:
        if file_name_lower == exact_name.lower() or file_name_lower.startswith(exact_name.lower() + '.'):
            return True, "exact_name", exact_name, f"Arquivo crítico: nome exato '{exact_name}'"
    
    # 2. Verificar extensões críticas
    critical_extensions = file_rules.get("extensions", [])
    if file_ext in critical_extensions:
        return True, "extension", file_ext, f"Arquivo crítico: extensão '{file_ext}'"
    
    # 3. Verificar keywords no nome do arquivo
    keywords = file_rules.get("keywords", [])
    for keyword in keywords:
        if keyword.lower() in file_name_lower:
            return True, "keyword", keyword, f"Arquivo crítico: contém keyword '{keyword}'"
    
    return False, None, None, None


async def register_critical_file_finding(
    file_path: str,
    rule_type: str,
    rule_value: str,
    description: str,
    job_id: str,
    server_id: int = None
) -> dict:
    """
    Registra um finding para arquivo crítico detectado pelas regras do Critical Search.
    
    Args:
        file_path: Caminho físico do arquivo
        rule_type: Tipo da regra que correspondeu (exact_name, extension, keyword)
        rule_value: Valor da regra que correspondeu
        description: Descrição do motivo da detecção
        job_id: ID do job do GitLeaks
        server_id: ID do servidor (opcional)
        
    Returns:
        Dict com informações do finding ou None se já existir
    """
    import hashlib
    from database import async_session_maker, GitleaksFinding, Server, FileVersion, DownloadedFile, ServerShare
    from sqlalchemy import select
    
    file_name = os.path.basename(file_path)
    
    # Gerar fingerprint único
    fingerprint_source = f"{file_path}:critical_search:{rule_type}:{rule_value}"
    fingerprint = hashlib.sha256(fingerprint_source.encode()).hexdigest()[:32]
    full_fingerprint = f"critical_{fingerprint}"
    
    # Verificar se já existe no banco
    try:
        async with async_session_maker() as db:
            existing = await db.execute(
                select(GitleaksFinding).where(GitleaksFinding.fingerprint == full_fingerprint)
            )
            if existing.scalar_one_or_none():
                logger.debug(f"Critical finding já existe: {file_path}")
                return {"already_exists": True}
    except Exception as e:
        logger.warning(f"Erro ao verificar duplicata: {e}")
    
    # Extrair IDs do caminho para enriquecimento
    ids_info = extract_ids_from_path(file_path)
    
    # Preparar dados de enriquecimento
    server_name = None
    server_ip = None
    enriched_file_name = file_name
    server_path = file_path
    share_name = None
    extracted_server_guid = None
    extracted_share_id = None
    extracted_file_version_id = None
    
    try:
        async with async_session_maker() as db:
            if ids_info:
                if ids_info['format'] == 'new':
                    extracted_server_guid = ids_info['server_guid']
                    extracted_share_id = ids_info['share_id']
                    extracted_file_version_id = ids_info['file_version_id']
                    
                    # Buscar servidor pelo GUID
                    server_result = await db.execute(
                        select(Server).where(Server.guid == extracted_server_guid)
                    )
                    server = server_result.scalar_one_or_none()
                    if server:
                        server_name = server.name
                        server_ip = server.ip
                    
                    # Buscar FileVersion
                    if extracted_file_version_id:
                        version_result = await db.execute(
                            select(FileVersion).where(FileVersion.id == extracted_file_version_id)
                        )
                        version = version_result.scalar_one_or_none()
                        if version:
                            enriched_file_name = os.path.basename(version.file_path) if version.file_path else file_name
                            server_path = version.file_path
                            share_name = version.share_name
                    
                    # Buscar share_name se não tiver
                    if not share_name and extracted_share_id:
                        share_result = await db.execute(
                            select(ServerShare).where(ServerShare.id == extracted_share_id)
                        )
                        share = share_result.scalar_one_or_none()
                        if share:
                            share_name = share.share_name
                else:
                    # Formato legado
                    if ids_info['server_id']:
                        server_result = await db.execute(
                            select(Server).where(Server.id == ids_info['server_id'])
                        )
                        server = server_result.scalar_one_or_none()
                        if server:
                            server_name = server.name
                            server_ip = server.ip
                    
                    if ids_info['file_id']:
                        df_result = await db.execute(
                            select(DownloadedFile).where(DownloadedFile.id == ids_info['file_id'])
                        )
                        downloaded_file = df_result.scalar_one_or_none()
                        if downloaded_file:
                            enriched_file_name = downloaded_file.file_name or file_name
                            server_path = downloaded_file.file_path
                            share_name = downloaded_file.share_name
            
            # Se temos server_id mas não conseguiu enriquecer, buscar servidor
            if server_id and not server_name:
                server_result = await db.execute(
                    select(Server).where(Server.id == server_id)
                )
                server = server_result.scalar_one_or_none()
                if server:
                    server_name = server.name
                    server_ip = server.ip
                    
    except Exception as e:
        logger.warning(f"Erro ao enriquecer critical finding: {e}")
    
    # Criar finding
    finding = {
        "RuleID": f"critical-{rule_type}",
        "Description": description,
        "File": file_path,
        "StartLine": 1,
        "EndLine": 1,
        "Match": f"[{rule_type}: {rule_value}]",
        "Secret": f"Arquivo sensível detectado: {enriched_file_name}",
        "Fingerprint": full_fingerprint,
        "Tags": ["critical-search", rule_type, "auto-detected"],
        "Severity": "high",
        
        # Metadados
        "job_id": job_id,
        "server_id": server_id,
        "scanned_at": datetime.now(timezone.utc).isoformat(),
        "original_file": file_path,
        "scanned_file": file_path,
        "detection_source": "critical-search",
        
        # Dados enriquecidos
        "server_name": server_name,
        "server_ip": server_ip,
        "file_name": enriched_file_name,
        "server_path": server_path,
        "share_name": share_name,
        
        # IDs
        "extracted_server_guid": extracted_server_guid,
        "extracted_share_id": extracted_share_id,
        "extracted_file_version_id": extracted_file_version_id
    }
    
    # Salvar no banco
    if await save_finding_to_db(finding):
        logger.info(f"Critical finding registrado: {enriched_file_name} ({rule_type}: {rule_value})")
        return {"already_exists": False, "finding": finding}
    else:
        return {"already_exists": True}


async def scan_directory_for_critical_files(
    target_path: str,
    job_id: str,
    server_id: int = None,
    service: 'GitleaksService' = None
) -> int:
    """
    Escaneia um diretório aplicando as regras do Critical Search.
    
    Args:
        target_path: Caminho do diretório a escanear
        job_id: ID do job do GitLeaks
        server_id: ID do servidor (opcional)
        service: Instância do GitleaksService para adicionar findings ao cache
        
    Returns:
        Número de findings críticos encontrados
    """
    config = await get_critical_search_config()
    
    if not config.get("enabled", True):
        logger.info("Critical Search está desabilitado")
        return 0
    
    found_count = 0
    
    try:
        for root, dirs, files in os.walk(target_path):
            for file_name in files:
                file_path = os.path.join(root, file_name)
                
                # Verificar se corresponde às regras
                matches, rule_type, rule_value, description = check_file_matches_critical_rules(file_path, config)
                
                if matches:
                    result = await register_critical_file_finding(
                        file_path=file_path,
                        rule_type=rule_type,
                        rule_value=rule_value,
                        description=description,
                        job_id=job_id,
                        server_id=server_id
                    )
                    
                    if result and not result.get("already_exists"):
                        found_count += 1
                        
                        # Adicionar ao cache do service se fornecido
                        if service and result.get("finding"):
                            already_in_cache = any(
                                f.get('Fingerprint') == result["finding"].get('Fingerprint') 
                                for f in service._findings
                            )
                            if not already_in_cache:
                                service._findings.append(result["finding"])
                                
    except Exception as e:
        logger.error(f"Erro ao escanear diretório para arquivos críticos: {e}")
    
    if found_count > 0:
        logger.info(f"Critical Search encontrou {found_count} arquivos críticos em {target_path}")
    
    return found_count


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
                # IDs formato legado
                extracted_server_id=finding.get('extracted_server_id'),
                extracted_file_id=finding.get('extracted_file_id'),
                extracted_version=finding.get('extracted_version'),
                # IDs formato novo
                extracted_server_guid=finding.get('extracted_server_guid'),
                extracted_share_id=finding.get('extracted_share_id'),
                extracted_file_version_id=finding.get('extracted_file_version_id'),
                # Dados enriquecidos
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
                    # IDs formato legado
                    'extracted_server_id': f.extracted_server_id,
                    'extracted_file_id': f.extracted_file_id,
                    'extracted_version': f.extracted_version,
                    # IDs formato novo
                    'extracted_server_guid': f.extracted_server_guid,
                    'extracted_share_id': f.extracted_share_id,
                    'extracted_file_version_id': f.extracted_file_version_id,
                    # Dados enriquecidos
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
    
    Suporta dois formatos de identificação:
    - Novo formato: server_guid, share_id, file_version_id
    - Formato legado: extracted_server_id, extracted_file_id
    
    Busca:
    - server_name, server_ip do servidor
    - file_name, share_name, server_path do arquivo baixado
    
    Args:
        finding: Dicionário com os dados do finding
        
    Returns:
        Finding enriquecido com informações do banco de dados
    """
    from database import async_session_maker, Server, DownloadedFile, FileVersion, ServerShare
    from sqlalchemy import select
    
    # Dados extraídos do caminho
    extracted_server_guid = finding.get('extracted_server_guid')
    extracted_share_id = finding.get('extracted_share_id')
    extracted_file_version_id = finding.get('extracted_file_version_id')
    
    # Dados legados
    extracted_server_id = finding.get('extracted_server_id')
    extracted_file_id = finding.get('extracted_file_id')
    server_id = finding.get('server_id')
    
    # Determinar qual formato usar
    use_new_format = extracted_server_guid is not None and extracted_file_version_id is not None
    
    try:
        async with async_session_maker() as db:
            if use_new_format:
                # Novo formato: buscar por server_guid e file_version_id
                
                # Buscar servidor pelo GUID
                server_result = await db.execute(
                    select(Server).where(Server.guid == extracted_server_guid)
                )
                server = server_result.scalar_one_or_none()
                
                if server:
                    finding['server_name'] = server.name
                    finding['server_ip'] = server.ip
                    finding['extracted_server_id'] = server.id  # Compatibilidade
                
                # Buscar FileVersion pelo ID
                version_result = await db.execute(
                    select(FileVersion).where(FileVersion.id == extracted_file_version_id)
                )
                file_version = version_result.scalar_one_or_none()
                
                if file_version:
                    finding['file_name'] = os.path.basename(file_version.file_path) if file_version.file_path else None
                    finding['share_name'] = file_version.share_name
                    finding['server_path'] = file_version.file_path
                    
                    # Buscar DownloadedFile para informações adicionais
                    df_result = await db.execute(
                        select(DownloadedFile).where(
                            DownloadedFile.server_guid == file_version.server_guid,
                            DownloadedFile.file_path == file_version.file_path
                        )
                    )
                    downloaded_file = df_result.scalar_one_or_none()
                    if downloaded_file:
                        finding['file_name'] = downloaded_file.file_name or finding.get('file_name')
                        finding['extracted_file_id'] = downloaded_file.id  # Compatibilidade
                
                # Se temos share_id, buscar nome do share
                if extracted_share_id and not finding.get('share_name'):
                    share_result = await db.execute(
                        select(ServerShare).where(ServerShare.id == extracted_share_id)
                    )
                    share = share_result.scalar_one_or_none()
                    if share:
                        finding['share_name'] = share.share_name
                
            else:
                # Formato legado: buscar por server_id e file_id
                effective_server_id = extracted_server_id or server_id
                
                if not effective_server_id and not extracted_file_id:
                    return finding
                
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
    # Removido _findings cache - agora busca direto do banco
    
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
                                    ids_info = extract_ids_from_path(file_info['original_file'])
                                    if ids_info:
                                        if ids_info['format'] == 'new':
                                            # Novo formato: server_guid/share_id/file_version_id
                                            finding['extracted_server_guid'] = ids_info['server_guid']
                                            finding['extracted_share_id'] = ids_info['share_id']
                                            finding['extracted_file_version_id'] = ids_info['file_version_id']
                                        else:
                                            # Formato legado: server_id/file_id/version
                                            finding['extracted_server_id'] = ids_info['server_id']
                                            finding['extracted_file_id'] = ids_info['file_id']
                                            finding['extracted_version'] = ids_info['version']
                                    
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
                
                # === CRITICAL SEARCH ===
                # Aplicar regras de Critical Search no mesmo diretório
                try:
                    critical_count = await scan_directory_for_critical_files(
                        target_path=job.target_path,
                        job_id=job.job_id,
                        server_id=job.server_id,
                        service=self
                    )
                    if critical_count > 0:
                        job.findings_count = (job.findings_count or 0) + critical_count
                        logger.info(f"Critical Search adicionou {critical_count} findings ao job {job.job_id}")
                except Exception as e:
                    logger.warning(f"Erro ao executar Critical Search: {e}")
                
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
    
    async def get_all_findings(self) -> List[Dict[str, Any]]:
        """Retorna todos os findings do banco de dados"""
        return await load_findings_from_db()
    
    async def get_findings_by_server(self, server_id: int) -> List[Dict[str, Any]]:
        """Retorna findings de um servidor específico do banco"""
        from database import async_session_maker, GitleaksFinding
        from sqlalchemy import select
        
        try:
            async with async_session_maker() as db:
                result = await db.execute(
                    select(GitleaksFinding).where(GitleaksFinding.server_id == server_id)
                )
                findings = result.scalars().all()
                return [self._finding_to_dict(f) for f in findings]
        except Exception as e:
            logger.error(f"Erro ao buscar findings do servidor {server_id}: {e}")
            return []
    
    async def get_findings_by_job(self, job_id: str) -> List[Dict[str, Any]]:
        """Retorna findings de um job específico do banco"""
        from database import async_session_maker, GitleaksFinding
        from sqlalchemy import select
        
        try:
            async with async_session_maker() as db:
                result = await db.execute(
                    select(GitleaksFinding).where(GitleaksFinding.job_id == job_id)
                )
                findings = result.scalars().all()
                return [self._finding_to_dict(f) for f in findings]
        except Exception as e:
            logger.error(f"Erro ao buscar findings do job {job_id}: {e}")
            return []
    
    def _finding_to_dict(self, finding) -> Dict[str, Any]:
        """Converte um objeto GitleaksFinding para dicionário"""
        return {
            'id': finding.id,
            'Description': finding.description,
            'File': finding.file_path,
            'RuleID': finding.rule_id,
            'Secret': finding.secret,
            'StartLine': finding.start_line,
            'EndLine': finding.end_line,
            'Entropy': finding.entropy,
            'Match': finding.match,
            'Fingerprint': finding.fingerprint,
            'severity': finding.severity,
            'server_id': finding.server_id,
            'job_id': finding.job_id,
            'scanned_at': finding.scanned_at.isoformat() if finding.scanned_at else None,
            'is_false_positive': finding.is_false_positive,
            'extracted_server_guid': finding.extracted_server_guid,
            'extracted_share_id': finding.extracted_share_id,
            'extracted_file_version_id': finding.extracted_file_version_id
        }
    
    def clear_findings(self) -> int:
        """Método depreciado - use clear_findings_from_db()"""
        logger.warning("clear_findings() está depreciado. Findings são gerenciados no banco.")
        return 0
    
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
        """Remove um finding do banco de dados"""
        from database import async_session_maker, GitleaksFinding
        from sqlalchemy import delete
        
        try:
            async with async_session_maker() as db:
                result = await db.execute(
                    delete(GitleaksFinding).where(GitleaksFinding.fingerprint == fingerprint)
                )
                await db.commit()
                removed = result.rowcount > 0
                
            if removed:
                logger.info(f"Finding {fingerprint} removido do banco")
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
                
                logger.info(f"Finding {fingerprint} marcado como falso_positivo={is_false_positive}")
                return True
                
        except Exception as e:
            logger.error(f"Erro ao atualizar finding {fingerprint}: {e}")
            return False
    
    async def load_findings_from_db(self) -> int:
        """Método depreciado - findings são carregados sob demanda do banco"""
        logger.info("load_findings_from_db() não é mais necessário - dados são buscados do banco sob demanda")
        return 0
    
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
                                ids_info = extract_ids_from_path(file_info['original_file'])
                                if ids_info:
                                    if ids_info['format'] == 'new':
                                        # Novo formato: server_guid/share_id/file_version_id
                                        finding['extracted_server_guid'] = ids_info['server_guid']
                                        finding['extracted_share_id'] = ids_info['share_id']
                                        finding['extracted_file_version_id'] = ids_info['file_version_id']
                                    else:
                                        # Formato legado: server_id/file_id/version
                                        finding['extracted_server_id'] = ids_info['server_id']
                                        finding['extracted_file_id'] = ids_info['file_id']
                                        finding['extracted_version'] = ids_info['version']
                                
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
