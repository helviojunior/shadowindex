import os
import re
import base64
import hashlib
from pathlib import Path
from typing import Optional, Tuple

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

def get_server_storage_path(server_guid: str) -> Path:
    """Retorna o caminho base do servidor"""
    return Path(STORAGE_BASE_PATH) / server_guid

def get_share_storage_path(server_guid: str, share_name: str) -> Path:
    """Retorna o caminho do compartilhamento"""
    sanitized_share = sanitize_path_component(share_name)
    return get_server_storage_path(server_guid) / sanitized_share

def get_file_storage_path(server_guid: str, share_name: str, file_path: str) -> Path:
    """Retorna o caminho completo do arquivo"""
    sanitized_share = sanitize_path_component(share_name)
    
    # Dividir o caminho em componentes e sanitizar cada um
    path_parts = file_path.replace('\\\\', '/').split('/')
    sanitized_parts = [sanitize_path_component(part) for part in path_parts if part]
    
    # Construir caminho final
    base_path = get_server_storage_path(server_guid) / sanitized_share
    for part in sanitized_parts[:-1]:  # Diretórios
        base_path = base_path / part
    
    return base_path

def ensure_storage_path(path: Path) -> None:
    """Garante que o diretório existe"""
    path.mkdir(parents=True, exist_ok=True)

def save_downloaded_file(
    server_guid: str,
    share_name: str,
    file_path: str,
    content_base64: str
) -> tuple[Path, str]:
    """
    Salva um arquivo baixado na estrutura de diretórios
    
    Returns:
        tuple[Path, str]: (caminho completo do arquivo, caminho sanitizado)
    """
    # Obter caminho do arquivo
    file_storage_path = get_file_storage_path(server_guid, share_name, file_path)
    
    # Garantir que o diretório existe
    ensure_storage_path(file_storage_path)
    
    # Extrair nome do arquivo do caminho
    file_name = Path(file_path).name
    sanitized_file_name = sanitize_path_component(file_name)
    full_file_path = file_storage_path / sanitized_file_name
    
    # Decodificar base64 e salvar
    try:
        file_content = base64.b64decode(content_base64)
        with open(full_file_path, 'wb') as f:
            f.write(file_content)
    except Exception as e:
        raise Exception(f"Erro ao salvar arquivo: {str(e)}")
    
    # Retornar caminho completo e caminho sanitizado relativo
    relative_path = str(full_file_path.relative_to(STORAGE_BASE_PATH))
    
    return full_file_path, relative_path

def get_server_storage_stats(server_guid: str) -> dict:
    """Retorna estatísticas de armazenamento do servidor"""
    server_path = get_server_storage_path(server_guid)
    
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
    
    # Iterar por compartilhamentos
    for share_dir in server_path.iterdir():
        if share_dir.is_dir():
            share_files = 0
            share_size = 0
            
            # Contar arquivos e tamanho
            for root, dirs, files in os.walk(share_dir):
                for file in files:
                    file_path = Path(root) / file
                    if file_path.exists():
                        share_files += 1
                        share_size += file_path.stat().st_size
            
            stats["shares"].append({
                "name": share_dir.name,
                "files": share_files,
                "size": share_size
            })
            
            stats["total_files"] += share_files
            stats["total_size"] += share_size
    
    return stats


def get_file_path(server_guid: str, share_name: str, sanitized_path: str) -> str:
    """
    Retorna o caminho completo de um arquivo sincronizado
    
    Args:
        server_guid: GUID do servidor
        share_name: Nome do compartilhamento
        sanitized_path: Caminho sanitizado relativo ao storage
    
    Returns:
        str: Caminho completo do arquivo
    """
    return str(Path(STORAGE_BASE_PATH) / sanitized_path)

def format_size(size_bytes: int) -> str:
    """Formata tamanho em bytes para formato legível"""
    for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
        if size_bytes < 1024.0:
            return f"{size_bytes:.2f} {unit}"
        size_bytes /= 1024.0
    return f"{size_bytes:.2f} PB"
