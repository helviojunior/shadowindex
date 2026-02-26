import os
import re
import base64
import hashlib
import datetime
import uuid
from pathlib import Path
from typing import Optional, Tuple


def json_serial(obj):
    """JSON serializer para objetos não serializáveis pelo json padrão."""
    if isinstance(obj, (datetime.datetime, datetime.date)):
        try:
            return obj.astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        except Exception:
            return obj.strftime("%Y-%m-%dT%H:%M:%SZ")
    if isinstance(obj, bytes):
        return base64.b64encode(obj).decode("UTF-8")
    if isinstance(obj, uuid.UUID):
        return str(obj)
    try:
        return str(obj)
    except Exception:
        raise TypeError("Type %s not serializable" % type(obj))

# Usar diretório local (pwd) para armazenamento
# O caminho base será ./data (relativo ao diretório do backend)
STORAGE_BASE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "storage")

def sanitize_path_component(name: str) -> str:
    """Sanitiza um componente de caminho removendo caracteres inválidos"""
    # Remove caracteres especiais mas mantém . _ -
    sanitized = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', name)
    # Remove espaços extras e substitui por underscore
    sanitized = re.sub(r'\s+', '_', sanitized)
    # Remove underscores duplicados
    sanitized = re.sub(r'_+', '_', sanitized)
    # Remove underscore no início e fim
    sanitized = sanitized.strip('_')
    return sanitized if sanitized else 'unnamed'


def get_standard_file_path(server_guid: str, share_id: int, file_version_id: int) -> Path:
    """
    Retorna o caminho padrão para armazenar um arquivo.
    Estrutura: {storage_base}/{server_guid}/{share_id}/{file_version_id}
    
    Esta é a função PADRÃO que deve ser usada por todas as funções de download.
    
    Args:
        server_guid: GUID do servidor
        share_id: ID do share no banco de dados
        file_version_id: ID da versão do arquivo no banco de dados
    
    Returns:
        Path: Caminho completo do arquivo
    """
    return Path(STORAGE_BASE_PATH) / server_guid / str(share_id) / str(file_version_id)


def get_standard_relative_path(server_guid: str, share_id: int, file_version_id: int) -> str:
    """
    Retorna o caminho relativo padrão para armazenar no banco de dados.
    Formato: {server_guid}/{share_id}/{file_version_id}
    
    Args:
        server_guid: GUID do servidor
        share_id: ID do share no banco de dados
        file_version_id: ID da versão do arquivo no banco de dados
    
    Returns:
        str: Caminho relativo
    """
    return f"{server_guid}/{share_id}/{file_version_id}"


def save_file_with_standard_path(
    server_guid: str,
    share_id: int,
    file_version_id: int,
    content: bytes
) -> Tuple[Path, str, str, int]:
    """
    Salva um arquivo usando a estrutura padrão de diretórios.
    Estrutura: {storage_base}/{server_guid}/{share_id}/{file_version_id}
    
    Esta é a função CENTRALIZADA que deve ser usada por todas as funções de download.
    
    Args:
        server_guid: GUID do servidor
        share_id: ID do share no banco de dados
        file_version_id: ID da versão do arquivo no banco de dados
        content: Conteúdo do arquivo em bytes
    
    Returns:
        tuple[Path, str, str, int]: (caminho completo, caminho relativo, sha1_hash, tamanho)
    """
    # Calcular SHA1 hash
    sha1_hash = hashlib.sha1(content).hexdigest()
    file_size = len(content)
    
    # Gerar caminhos
    full_path = get_standard_file_path(server_guid, share_id, file_version_id)
    relative_path = get_standard_relative_path(server_guid, share_id, file_version_id)
    
    # Garantir que o diretório existe
    full_path.parent.mkdir(parents=True, exist_ok=True)
    
    # Salvar arquivo
    try:
        with open(full_path, 'wb') as f:
            f.write(content)
    except Exception as e:
        raise Exception(f"Erro ao salvar arquivo: {str(e)}")
    
    return full_path, relative_path, sha1_hash, file_size

def get_server_storage_path(server_id_or_guid) -> Path:
    """Retorna o caminho base do servidor usando ID ou GUID"""
    return Path(STORAGE_BASE_PATH) / str(server_id_or_guid)

def get_file_storage_path_by_id(server_id: int, file_id: int, version: int = 1) -> Path:
    """
    Retorna o caminho do arquivo usando estrutura baseada em IDs
    Estrutura: {storage_base}/{server_id}/{file_id}/{version}
    """
    base_path = Path(STORAGE_BASE_PATH) / str(server_id) / str(file_id)
    return base_path / str(version)

def ensure_storage_path(path: Path) -> None:
    """Garante que o diretório existe"""
    path.parent.mkdir(parents=True, exist_ok=True)

def save_file_by_id(
    server_id: int,
    file_id: int,
    content: bytes,
    version: int = 1
) -> Tuple[str, str, int]:
    """
    Salva um arquivo usando estrutura baseada em IDs
    
    Args:
        server_id: ID do servidor
        file_id: ID do arquivo no banco
        content: Conteúdo do arquivo em bytes
        version: Número da versão
    
    Returns:
        tuple[str, str, int]: (caminho completo, sha1_hash, tamanho)
    """
    # Calcular SHA1 hash
    sha1_hash = hashlib.sha1(content).hexdigest()
    file_size = len(content)
    
    # Caminho: {storage}/{server_id}/{file_id}/{version}
    file_path = get_file_storage_path_by_id(server_id, file_id, version)
    
    # Garantir que o diretório existe
    ensure_storage_path(file_path)
    
    # Salvar arquivo
    try:
        with open(file_path, 'wb') as f:
            f.write(content)
    except Exception as e:
        raise Exception(f"Erro ao salvar arquivo: {str(e)}")
    
    return str(file_path), sha1_hash, file_size

def save_downloaded_file(
    server_guid: str,
    share_name: str,
    file_path: str,
    content_base64_or_str: str,
    version: int = None,
    server_id: int = None,
    file_id: int = None
) -> Tuple[Path, str, str, int]:
    """
    Salva um arquivo baixado na estrutura de diretórios
    
    Se server_id e file_id são fornecidos, usa nova estrutura baseada em IDs.
    Caso contrário, usa estrutura legada baseada em GUID/path.
    
    Args:
        server_guid: GUID do servidor (legado)
        share_name: Nome do compartilhamento (legado)
        file_path: Caminho do arquivo (legado)
        content_base64_or_str: Conteúdo em base64 ou string
        version: Número da versão (None para auto)
        server_id: ID do servidor (nova estrutura)
        file_id: ID do arquivo (nova estrutura)
    
    Returns:
        tuple[Path, str, str, int]: (caminho completo, caminho sanitizado, sha1_hash, tamanho)
    """
    # Decodificar conteúdo
    if isinstance(content_base64_or_str, str):
        try:
            # Tentar decodificar como base64
            file_content = base64.b64decode(content_base64_or_str)
        except Exception:
            # Se falhar, tratar como string UTF-8
            file_content = content_base64_or_str.encode('utf-8')
    else:
        file_content = content_base64_or_str
    
    # Calcular SHA1 hash
    sha1_hash = hashlib.sha1(file_content).hexdigest()
    file_size = len(file_content)
    
    # Nova estrutura baseada em IDs
    if server_id is not None and file_id is not None:
        ver = version if version else 1
        full_file_path = get_file_storage_path_by_id(server_id, file_id, ver)
        ensure_storage_path(full_file_path)
        
        with open(full_file_path, 'wb') as f:
            f.write(file_content)
        
        # Caminho relativo usando IDs
        relative_path = f"{server_id}/{file_id}/{ver}"
        return full_file_path, relative_path, sha1_hash, file_size
    
    # Estrutura legada baseada em GUID/path
    # Caminho: {storage}/{server_guid}/{sha1_hash[:2]}/{sha1_hash}
    base_path = Path(STORAGE_BASE_PATH) / server_guid / sha1_hash[:2]
    base_path.mkdir(parents=True, exist_ok=True)
    
    # Nome do arquivo é o hash completo (sem extensão)
    if version and version > 1:
        full_file_path = base_path / f"{sha1_hash}_v{version}"
    else:
        full_file_path = base_path / sha1_hash
    
    # Salvar arquivo
    try:
        with open(full_file_path, 'wb') as f:
            f.write(file_content)
    except Exception as e:
        raise Exception(f"Erro ao salvar arquivo: {str(e)}")
    
    # Retornar caminho completo, caminho sanitizado relativo, hash e tamanho
    relative_path = str(full_file_path.relative_to(STORAGE_BASE_PATH))
    
    return full_file_path, relative_path, sha1_hash, file_size


def save_empty_file(
    server_guid: str,
    share_name: str,
    file_path: str,
    version: int = None,
    server_id: int = None,
    file_id: int = None
) -> Tuple[Path, str, str, int]:
    """
    Salva um arquivo vazio na estrutura de diretórios
    """
    # SHA1 de arquivo vazio
    sha1_hash = hashlib.sha1(b'').hexdigest()
    
    # Nova estrutura baseada em IDs
    if server_id is not None and file_id is not None:
        ver = version if version else 1
        full_file_path = get_file_storage_path_by_id(server_id, file_id, ver)
        ensure_storage_path(full_file_path)
        
        with open(full_file_path, 'wb'):
            pass  # Arquivo vazio
        
        relative_path = f"{server_id}/{file_id}/{ver}"
        return full_file_path, relative_path, sha1_hash, 0
    
    # Estrutura legada
    base_path = Path(STORAGE_BASE_PATH) / server_guid / sha1_hash[:2]
    base_path.mkdir(parents=True, exist_ok=True)
    
    if version and version > 1:
        full_file_path = base_path / f"{sha1_hash}_v{version}"
    else:
        full_file_path = base_path / sha1_hash
    
    try:
        with open(full_file_path, 'wb'):
            pass
    except Exception as e:
        raise Exception(f"Erro ao criar arquivo vazio: {str(e)}")
    
    relative_path = str(full_file_path.relative_to(STORAGE_BASE_PATH))
    return full_file_path, relative_path, sha1_hash, 0


def calculate_sha1_from_base64(content_base64: str) -> str:
    """Calcula SHA1 hash de conteúdo em base64"""
    if not content_base64:
        return hashlib.sha1(b'').hexdigest()
    file_content = base64.b64decode(content_base64)
    return hashlib.sha1(file_content).hexdigest()


def calculate_sha1_from_file(file_path: str) -> Optional[str]:
    """Calcula SHA1 hash de um arquivo existente"""
    try:
        with open(file_path, 'rb') as f:
            return hashlib.sha1(f.read()).hexdigest()
    except Exception:
        return None


def get_server_storage_stats(server_guid: str) -> dict:
    """Retorna estatísticas de armazenamento do servidor"""
    server_path = Path(STORAGE_BASE_PATH) / server_guid
    
    if not server_path.exists():
        return {
            "total_files": 0,
            "total_size": 0,
            "shares": []
        }
    
    stats = {
        "total_files": 0,
        "total_size": 0,
        "shares": []
    }
    
    # Contar todos os arquivos no diretório do servidor
    for root, dirs, files in os.walk(server_path):
        for file in files:
            file_path_obj = Path(root) / file
            if file_path_obj.exists():
                stats["total_files"] += 1
                stats["total_size"] += file_path_obj.stat().st_size
    
    return stats


def get_file_path(server_guid: str, share_name: str, sanitized_path: str) -> str:
    """
    Retorna o caminho completo de um arquivo sincronizado
    
    Args:
        server_guid: GUID do servidor
        share_name: Nome do compartilhamento
        sanitized_path: Caminho sanitizado relativo ao storage 
                        Formato novo: "server_guid/share_id/file_version_id"
                        Formato legado: "server_id/file_id/version" ou "path/to/file"
    
    Returns:
        str: Caminho completo do arquivo
    """
    if not sanitized_path:
        return ""
    
    parts = sanitized_path.split('/')
    
    # Novo formato: server_guid/share_id/file_version_id (3 partes, primeira é GUID)
    if len(parts) == 3:
        first_part = parts[0]
        # Verificar se primeira parte é um GUID (36 chars com hífens ou 32 sem)
        is_guid = (len(first_part) == 36 and first_part.count('-') == 4) or len(first_part) == 32
        
        if is_guid:
            # Novo formato: server_guid/share_id/file_version_id
            # O sanitized_path já contém o caminho completo relativo ao storage
            return str(Path(STORAGE_BASE_PATH) / sanitized_path)
        elif all(p.isdigit() for p in parts):
            # Formato legado: server_id/file_id/version (todos numéricos)
            return str(Path(STORAGE_BASE_PATH) / sanitized_path)
    
    # Verificar se o sanitized_path já começa com o server_guid (evitar duplicação)
    if sanitized_path.startswith(server_guid + '/'):
        return str(Path(STORAGE_BASE_PATH) / sanitized_path)
    
    # Caso contrário, é o caminho relativo legado (path-based)
    # Adiciona o server_guid como prefixo
    return str(Path(STORAGE_BASE_PATH) / server_guid / sanitized_path)


def get_file_path_by_standard(server_guid: str, share_id: int, file_version_id: int) -> str:
    """
    Retorna o caminho completo de um arquivo usando a estrutura padrão
    
    Args:
        server_guid: GUID do servidor
        share_id: ID do share
        file_version_id: ID da versão do arquivo
    
    Returns:
        str: Caminho completo do arquivo
    """
    return str(get_standard_file_path(server_guid, share_id, file_version_id))


def get_file_path_by_id(server_id: int, file_id: int, version: int = 1) -> str:
    """
    Retorna o caminho completo de um arquivo usando IDs
    
    Args:
        server_id: ID do servidor
        file_id: ID do arquivo
        version: Versão do arquivo
    
    Returns:
        str: Caminho completo do arquivo
    """
    return str(get_file_storage_path_by_id(server_id, file_id, version))


## Temp download file helpers

TEMP_DOWNLOAD_DIR = os.path.join(STORAGE_BASE_PATH, ".tmp")


def get_temp_download_path(job_id: int, segment_index: int = None) -> Path:
    """
    Retorna o caminho do arquivo temporário para download.
    Formato: data/storage/.tmp/download_{job_id}[_seg{N}].part
    """
    os.makedirs(TEMP_DOWNLOAD_DIR, exist_ok=True)
    if segment_index is not None:
        filename = f"download_{job_id}_seg{segment_index}.part"
    else:
        filename = f"download_{job_id}.part"
    return Path(TEMP_DOWNLOAD_DIR) / filename


def get_temp_file_size(path) -> int:
    """Retorna o tamanho do arquivo temporário ou 0 se não existir."""
    try:
        return os.path.getsize(path)
    except (OSError, TypeError):
        return 0


def cleanup_temp_files(job_id: int):
    """Remove todos os arquivos .part de um job."""
    try:
        if not os.path.exists(TEMP_DOWNLOAD_DIR):
            return
        prefix = f"download_{job_id}"
        for filename in os.listdir(TEMP_DOWNLOAD_DIR):
            if filename.startswith(prefix) and filename.endswith('.part'):
                try:
                    os.remove(os.path.join(TEMP_DOWNLOAD_DIR, filename))
                except OSError:
                    pass
    except Exception:
        pass


def concatenate_segment_files(job_id: int, segment_count: int) -> bytes:
    """
    Lê e concatena todos os segmentos de um job em ordem.
    Retorna os bytes combinados.
    """
    parts = []
    for i in range(segment_count):
        seg_path = get_temp_download_path(job_id, segment_index=i)
        with open(seg_path, 'rb') as f:
            parts.append(f.read())
    return b''.join(parts)


def format_size(size_bytes: int) -> str:
    """Formata tamanho em bytes para formato legível"""
    if size_bytes is None:
        return "0 B"
    for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
        if size_bytes < 1024.0:
            return f"{size_bytes:.2f} {unit}"
        size_bytes /= 1024.0
    return f"{size_bytes:.2f} PB"
