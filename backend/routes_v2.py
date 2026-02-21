"""
API Routes V2 - Endpoints baseados em IDs

Estrutura:
- /api/v2/servers/{server_id}/shares/{share_id} - Info do share
- /api/v2/servers/{server_id}/shares/{share_id}/browse - Navegar no share (SOAP)
- /api/v2/servers/{server_id}/items/{item_id} - Info do item
- /api/v2/servers/{server_id}/items/{item_id}/browse - Navegar no diretório (SOAP)
- /api/v2/servers/{server_id}/items/{item_id}/download - Download direto
- /api/v2/servers/{server_id}/items/{item_id}/queue - Adicionar à fila
- /api/v2/servers/{server_id}/files/{file_id} - Info do arquivo baixado
- /api/v2/servers/{server_id}/files/{file_id}/content - Conteúdo do arquivo
- /api/v2/servers/{server_id}/files/{file_id}/versions - Versões do arquivo
- /api/v2/servers/{server_id}/files/{file_id}/certificate-info - Info certificado
- /api/v2/servers/{server_id}/batch/queue - Batch queue
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime, timezone
import logging
import base64
import hashlib

from database import (
    get_db, Server, ServerShare, ServerItem, DownloadedFile, FileVersion, 
    DownloadJob, PfxPassword
)

logger = logging.getLogger(__name__)

# Router com prefixo /api/v2
router = APIRouter(prefix="/api/v2")


# ==========================================
# Pydantic Models
# ==========================================

class ShareResponse(BaseModel):
    id: int
    server_guid: str
    share_name: str
    share_type: Optional[str]
    remark: Optional[str]
    access_denied: bool
    error_message: Optional[str]
    has_children: bool
    children_fetched: bool
    discovered_at: datetime

class ItemResponse(BaseModel):
    id: int
    server_guid: str
    share_name: str
    parent_path: str
    item_type: str
    name: str
    full_path: str
    size: Optional[str]
    modified: Optional[str]
    access_denied: bool
    error_message: Optional[str]
    has_children: bool
    children_fetched: bool
    discovered_at: datetime

class DownloadedFileResponse(BaseModel):
    id: int
    server_guid: str
    share_name: str
    file_path: str
    sanitized_path: str
    file_size: Optional[int]
    sha1_hash: Optional[str]
    mimetype: Optional[str]
    downloaded_at: datetime

class FileVersionResponse(BaseModel):
    id: int
    version_number: int
    sha1_hash: str
    file_size: Optional[int]
    mimetype: Optional[str]
    is_current: bool
    created_at: datetime

class BatchQueueRequest(BaseModel):
    item_ids: List[int]
    max_depth: int = 5
    max_file_size_mb: Optional[int] = None
    apply_filters: bool = True

class CertificateInfoRequest(BaseModel):
    password: Optional[str] = None


# ==========================================
# Helper Functions
# ==========================================

async def get_server_or_404(db: AsyncSession, server_id: int) -> Server:
    """Obtém servidor ou retorna 404"""
    result = await db.execute(select(Server).where(Server.id == server_id))
    server = result.scalar_one_or_none()
    if not server:
        raise HTTPException(status_code=404, detail="Servidor não encontrado")
    return server

async def get_share_or_404(db: AsyncSession, server: Server, share_id: int) -> ServerShare:
    """Obtém share ou retorna 404"""
    result = await db.execute(
        select(ServerShare).where(
            ServerShare.id == share_id,
            ServerShare.server_guid == server.guid
        )
    )
    share = result.scalar_one_or_none()
    if not share:
        raise HTTPException(status_code=404, detail="Compartilhamento não encontrado")
    return share

async def get_item_or_404(db: AsyncSession, server: Server, item_id: int) -> ServerItem:
    """Obtém item ou retorna 404"""
    result = await db.execute(
        select(ServerItem).where(
            ServerItem.id == item_id,
            ServerItem.server_guid == server.guid
        )
    )
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Item não encontrado")
    return item

async def get_downloaded_file_or_404(db: AsyncSession, server: Server, file_id: int) -> DownloadedFile:
    """Obtém arquivo baixado ou retorna 404"""
    result = await db.execute(
        select(DownloadedFile).where(
            DownloadedFile.id == file_id,
            DownloadedFile.server_guid == server.guid
        )
    )
    file = result.scalar_one_or_none()
    if not file:
        raise HTTPException(status_code=404, detail="Arquivo não encontrado")
    return file


# ==========================================
# Share Endpoints
# ==========================================

@router.get("/servers/{server_id}/shares/{share_id}", response_model=ShareResponse)
async def get_share(server_id: int, share_id: int, db: AsyncSession = Depends(get_db)):
    """Obtém informações de um compartilhamento"""
    server = await get_server_or_404(db, server_id)
    share = await get_share_or_404(db, server, share_id)
    return share


@router.get("/servers/{server_id}/shares/{share_id}/items", response_model=List[ItemResponse])
async def get_share_items(server_id: int, share_id: int, db: AsyncSession = Depends(get_db)):
    """Obtém itens de um compartilhamento do cache"""
    server = await get_server_or_404(db, server_id)
    share = await get_share_or_404(db, server, share_id)
    
    # Construir path do share
    share_path = f"\\\\{server.ip}\\{share.share_name}"
    
    # Buscar itens filhos
    result = await db.execute(
        select(ServerItem).where(
            ServerItem.server_guid == server.guid,
            ServerItem.parent_path == share_path
        )
    )
    return result.scalars().all()


@router.post("/servers/{server_id}/shares/{share_id}/browse")
async def browse_share(
    server_id: int, 
    share_id: int, 
    refresh: bool = False,
    db: AsyncSession = Depends(get_db)
):
    """Navega no compartilhamento via SOAP e atualiza cache"""
    from soap_service import get_default_soap_service
    from server import parse_exec4_directory_listing
    
    server = await get_server_or_404(db, server_id)
    share = await get_share_or_404(db, server, share_id)
    
    # Construir path do share
    share_path = f"\\\\{server.ip}\\{share.share_name}"
    
    # Chamar SOAP Exec4
    soap_service = await get_default_soap_service(db)
    params = {"s1": share_path, "s2": ""}
    
    try:
        result_str = await soap_service.call_soap_operation(db, "Exec4", params, refresh)
        
        items = []
        access_denied = False
        error_message = None
        
        # Parsear resultado
        parsed_items = parse_exec4_directory_listing(result_str)
        
        # Verificar erros de acesso
        if not parsed_items and result_str:
            result_lower = result_str.lower()
            if "access" in result_lower and "denied" in result_lower:
                access_denied = True
                error_message = "Acesso negado"
                share.access_denied = True
                share.error_message = error_message
                await db.commit()
                return {
                    "success": False,
                    "share_id": share_id,
                    "access_denied": True,
                    "error_message": error_message,
                    "items": []
                }
        
        # Remover itens antigos deste path
        await db.execute(
            delete(ServerItem).where(
                ServerItem.server_guid == server.guid,
                ServerItem.parent_path == share_path
            )
        )
        
        # Adicionar novos itens
        for item_data in parsed_items:
            db_item = ServerItem(
                server_guid=server.guid,
                share_name=share.share_name,
                parent_path=share_path,
                item_type=item_data["type"],
                name=item_data["name"],
                full_path=item_data["fullPath"],
                size=str(item_data["size"]) if item_data["size"] else None,
                modified=item_data["modified"]
            )
            db.add(db_item)
            items.append(db_item)
        
        # Atualizar share
        share.children_fetched = True
        share.has_children = len(items) > 0
        share.access_denied = False
        share.error_message = None
        
        await db.commit()
        
        # Refresh para obter IDs
        for item in items:
            await db.refresh(item)
        
        return {
            "success": True,
            "share_id": share_id,
            "items": [
                {
                    "id": item.id,
                    "type": item.item_type,
                    "name": item.name,
                    "full_path": item.full_path,
                    "size": item.size,
                    "modified": item.modified
                }
                for item in items
            ],
            "count": len(items)
        }
        
    except Exception as e:
        logger.error(f"Error browsing share {share_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ==========================================
# Item Endpoints
# ==========================================

# IMPORTANTE: Rotas específicas devem vir ANTES das rotas com parâmetros {item_id}
@router.get("/servers/{server_id}/items/by-path")
async def get_item_by_path(
    server_id: int, 
    full_path: str,
    db: AsyncSession = Depends(get_db)
):
    """Busca um item pelo path (para compatibilidade)"""
    server = await get_server_or_404(db, server_id)
    
    result = await db.execute(
        select(ServerItem).where(
            ServerItem.server_guid == server.guid,
            ServerItem.full_path == full_path
        )
    )
    item = result.scalar_one_or_none()
    
    if not item:
        return {"found": False, "item_id": None}
    
    return {"found": True, "item_id": item.id, "item": item}


@router.get("/servers/{server_id}/items/{item_id}", response_model=ItemResponse)
async def get_item(server_id: int, item_id: int, db: AsyncSession = Depends(get_db)):
    """Obtém informações de um item"""
    server = await get_server_or_404(db, server_id)
    item = await get_item_or_404(db, server, item_id)
    return item


@router.get("/servers/{server_id}/items/{item_id}/children", response_model=List[ItemResponse])
async def get_item_children(server_id: int, item_id: int, db: AsyncSession = Depends(get_db)):
    """Obtém filhos de um item (diretório) do cache"""
    server = await get_server_or_404(db, server_id)
    item = await get_item_or_404(db, server, item_id)
    
    if item.item_type != "Directory":
        raise HTTPException(status_code=400, detail="Item não é um diretório")
    
    result = await db.execute(
        select(ServerItem).where(
            ServerItem.server_guid == server.guid,
            ServerItem.parent_path == item.full_path
        )
    )
    return result.scalars().all()


@router.post("/servers/{server_id}/items/{item_id}/browse")
async def browse_item(
    server_id: int, 
    item_id: int, 
    refresh: bool = False,
    db: AsyncSession = Depends(get_db)
):
    """Navega em um diretório via SOAP e atualiza cache"""
    from soap_service import get_default_soap_service
    from server import parse_exec4_directory_listing
    
    server = await get_server_or_404(db, server_id)
    item = await get_item_or_404(db, server, item_id)
    
    if item.item_type != "Directory":
        raise HTTPException(status_code=400, detail="Item não é um diretório")
    
    # Chamar SOAP Exec4
    soap_service = await get_default_soap_service(db)
    params = {"s1": item.full_path, "s2": ""}
    
    try:
        result_str = await soap_service.call_soap_operation(db, "Exec4", params, refresh)
        
        items = []
        
        # Parsear resultado
        parsed_items = parse_exec4_directory_listing(result_str)
        
        # Verificar erros de acesso
        if not parsed_items and result_str:
            result_lower = result_str.lower()
            if "access" in result_lower and "denied" in result_lower:
                item.access_denied = True
                item.error_message = "Acesso negado"
                await db.commit()
                return {
                    "success": False,
                    "item_id": item_id,
                    "access_denied": True,
                    "error_message": "Acesso negado",
                    "items": []
                }
        
        # Remover itens antigos
        await db.execute(
            delete(ServerItem).where(
                ServerItem.server_guid == server.guid,
                ServerItem.parent_path == item.full_path
            )
        )
        
        # Adicionar novos itens
        for item_data in parsed_items:
            db_item = ServerItem(
                server_guid=server.guid,
                share_name=item.share_name,
                parent_path=item.full_path,
                item_type=item_data["type"],
                name=item_data["name"],
                full_path=item_data["fullPath"],
                size=str(item_data["size"]) if item_data["size"] else None,
                modified=item_data["modified"]
            )
            db.add(db_item)
            items.append(db_item)
        
        # Atualizar item pai
        item.children_fetched = True
        item.has_children = len(items) > 0
        item.access_denied = False
        item.error_message = None
        
        await db.commit()
        
        # Refresh para obter IDs
        for child in items:
            await db.refresh(child)
        
        return {
            "success": True,
            "item_id": item_id,
            "items": [
                {
                    "id": child.id,
                    "type": child.item_type,
                    "name": child.name,
                    "full_path": child.full_path,
                    "size": child.size,
                    "modified": child.modified
                }
                for child in items
            ],
            "count": len(items)
        }
        
    except Exception as e:
        logger.error(f"Error browsing item {item_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/servers/{server_id}/items/{item_id}/download")
async def download_item(server_id: int, item_id: int, db: AsyncSession = Depends(get_db)):
    """Download direto de um arquivo via SOAP"""
    from soap_service import get_default_soap_service
    from storage_utils import save_downloaded_file, format_size
    from server import get_file_mimetype
    
    server = await get_server_or_404(db, server_id)
    item = await get_item_or_404(db, server, item_id)
    
    if item.item_type != "File":
        raise HTTPException(status_code=400, detail="Item não é um arquivo")
    
    # Chamar SOAP Exec5 para download
    soap_service = await get_default_soap_service(db)
    params = {"s1": item.full_path, "s2": "", "l1": 0, "l2": 0}
    
    try:
        result_str = await soap_service.call_soap_operation(db, "Exec5", params, ignore_cache=True)
        
        if not result_str:
            raise HTTPException(status_code=500, detail="Resposta vazia do servidor")
        
        # Verificar erros
        result_lower = result_str.lower()
        if "access" in result_lower and "denied" in result_lower:
            item.access_denied = True
            item.error_message = "Acesso negado"
            await db.commit()
            raise HTTPException(status_code=403, detail="Acesso negado ao arquivo")
        
        if "not found" in result_lower or "cannot find" in result_lower:
            raise HTTPException(status_code=404, detail="Arquivo não encontrado no servidor")
        
        # Verificar se já existe no banco
        existing_result = await db.execute(
            select(DownloadedFile).where(
                DownloadedFile.server_guid == server.guid,
                DownloadedFile.file_path == item.full_path
            )
        )
        existing = existing_result.scalar_one_or_none()
        
        # Salvar arquivo
        full_path, sanitized_path, sha1_hash, file_size = save_downloaded_file(
            server.guid,
            item.share_name,
            item.full_path,
            result_str,
            1
        )
        
        mimetype = get_file_mimetype(full_path)
        
        if existing:
            # Atualizar existente
            existing.sanitized_path = sanitized_path
            existing.sha1_hash = sha1_hash
            existing.file_size = file_size
            existing.mimetype = mimetype
            existing.downloaded_at = datetime.now(timezone.utc)
            await db.commit()
            await db.refresh(existing)
            
            return {
                "success": True,
                "file_id": existing.id,
                "item_id": item_id,
                "status": "updated",
                "sha1_hash": sha1_hash,
                "size": file_size,
                "size_formatted": format_size(file_size)
            }
        else:
            # Criar novo
            downloaded_file = DownloadedFile(
                server_guid=server.guid,
                share_name=item.share_name,
                file_path=item.full_path,
                sanitized_path=sanitized_path,
                file_size=file_size,
                sha1_hash=sha1_hash,
                mimetype=mimetype
            )
            db.add(downloaded_file)
            server.downloaded_files_count = (server.downloaded_files_count or 0) + 1
            await db.commit()
            await db.refresh(downloaded_file)
            
            return {
                "success": True,
                "file_id": downloaded_file.id,
                "item_id": item_id,
                "status": "new",
                "sha1_hash": sha1_hash,
                "size": file_size,
                "size_formatted": format_size(file_size)
            }
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error downloading item {item_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/servers/{server_id}/items/{item_id}/queue")
async def queue_item(server_id: int, item_id: int, db: AsyncSession = Depends(get_db)):
    """Adiciona um arquivo à fila de downloads"""
    server = await get_server_or_404(db, server_id)
    item = await get_item_or_404(db, server, item_id)
    
    if item.item_type != "File":
        raise HTTPException(status_code=400, detail="Item não é um arquivo")
    
    # Verificar se já está na fila
    existing = await db.execute(
        select(DownloadJob).where(
            DownloadJob.server_id == server_id,
            DownloadJob.file_path == item.full_path,
            DownloadJob.status.in_(['pending', 'downloading'])
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Arquivo já está na fila de downloads")
    
    # Criar job
    job = DownloadJob(
        server_id=server_id,
        server_name=server.name,
        server_ip=server.ip,
        share_name=item.share_name,
        file_path=item.full_path,
        file_name=item.name,
        file_size=int(item.size) if item.size and item.size.isdigit() else None,
        status='pending'
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)
    
    return {
        "success": True,
        "job_id": job.id,
        "item_id": item_id,
        "message": "Arquivo adicionado à fila de downloads"
    }


# ==========================================
# Downloaded File Endpoints
# ==========================================

# IMPORTANTE: Rotas específicas devem vir ANTES das rotas com parâmetros {file_id}
@router.get("/servers/{server_id}/files/by-path")
async def get_file_by_path(
    server_id: int, 
    file_path: str,
    db: AsyncSession = Depends(get_db)
):
    """Busca um arquivo baixado pelo path (para compatibilidade)"""
    server = await get_server_or_404(db, server_id)
    
    result = await db.execute(
        select(DownloadedFile).where(
            DownloadedFile.server_guid == server.guid,
            DownloadedFile.file_path == file_path
        )
    )
    file = result.scalar_one_or_none()
    
    if not file:
        return {"found": False, "file_id": None}
    
    return {"found": True, "file_id": file.id, "file": file}


@router.get("/servers/{server_id}/files/{file_id}", response_model=DownloadedFileResponse)
async def get_downloaded_file(server_id: int, file_id: int, db: AsyncSession = Depends(get_db)):
    """Obtém informações de um arquivo baixado"""
    server = await get_server_or_404(db, server_id)
    file = await get_downloaded_file_or_404(db, server, file_id)
    return file


@router.get("/servers/{server_id}/files/{file_id}/content")
async def get_file_content(server_id: int, file_id: int, db: AsyncSession = Depends(get_db)):
    """Obtém o conteúdo de um arquivo baixado"""
    from storage_utils import get_file_path
    import os
    
    server = await get_server_or_404(db, server_id)
    file = await get_downloaded_file_or_404(db, server, file_id)
    
    # Obter caminho do arquivo
    full_path = get_file_path(server.guid, file.share_name, file.sanitized_path)
    
    if not os.path.exists(full_path):
        raise HTTPException(status_code=404, detail=f"Arquivo não encontrado no storage: {full_path}")
    
    try:
        # Ler arquivo em modo binário
        with open(full_path, 'rb') as f:
            raw_content = f.read()
        
        # Detectar e remover BOM UTF-8
        has_bom = False
        if raw_content.startswith(b'\xef\xbb\xbf'):
            has_bom = True
            raw_content = raw_content[3:]
        
        # Decodificar
        try:
            content = raw_content.decode('utf-8')
        except UnicodeDecodeError:
            try:
                content = raw_content.decode('latin-1')
            except UnicodeDecodeError:
                content = raw_content.decode('utf-8', errors='replace')
        
        return {
            "success": True,
            "file_id": file_id,
            "content": content,
            "size": len(content),
            "has_bom": has_bom,
            "encoding": "UTF-8 with BOM" if has_bom else "UTF-8"
        }
        
    except Exception as e:
        logger.error(f"Error reading file {file_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Erro ao ler arquivo: {str(e)}")


@router.get("/servers/{server_id}/files/{file_id}/versions", response_model=List[FileVersionResponse])
async def get_file_versions(server_id: int, file_id: int, db: AsyncSession = Depends(get_db)):
    """Obtém versões de um arquivo baixado"""
    server = await get_server_or_404(db, server_id)
    file = await get_downloaded_file_or_404(db, server, file_id)
    
    result = await db.execute(
        select(FileVersion).where(
            FileVersion.server_guid == server.guid,
            FileVersion.file_path == file.file_path
        ).order_by(FileVersion.version_number.desc())
    )
    return result.scalars().all()


@router.post("/servers/{server_id}/files/{file_id}/certificate-info")
async def get_certificate_info(
    server_id: int, 
    file_id: int, 
    request: CertificateInfoRequest,
    db: AsyncSession = Depends(get_db)
):
    """Obtém informações de um certificado digital"""
    from cryptography import x509
    from cryptography.hazmat.primitives import serialization, hashes
    from cryptography.hazmat.backends import default_backend
    from cryptography.hazmat.primitives.serialization import pkcs12
    from storage_utils import get_file_path
    import os
    
    server = await get_server_or_404(db, server_id)
    file = await get_downloaded_file_or_404(db, server, file_id)
    
    full_path = get_file_path(server.guid, file.share_name, file.sanitized_path)
    
    if not os.path.exists(full_path):
        raise HTTPException(status_code=404, detail="Arquivo não encontrado no storage")
    
    file_ext = os.path.splitext(file.file_path)[1].lower()
    
    try:
        with open(full_path, 'rb') as f:
            cert_data = f.read()
        
        cert = None
        private_key = None
        
        if file_ext in ['.pfx', '.p12']:
            password = request.password.encode() if request.password else None
            
            # Tentar senha salva se não fornecida
            if not password:
                saved_result = await db.execute(
                    select(PfxPassword).where(
                        PfxPassword.server_guid == server.guid,
                        PfxPassword.file_path == file.file_path
                    )
                )
                saved = saved_result.scalar_one_or_none()
                if saved:
                    password = saved.password.encode()
            
            try:
                private_key, cert, chain = pkcs12.load_key_and_certificates(
                    cert_data, password, default_backend()
                )
            except Exception as e:
                if "password" in str(e).lower() or "mac" in str(e).lower():
                    raise HTTPException(status_code=401, detail="Senha incorreta ou não fornecida")
                raise
            
            # Salvar senha se funcionou
            if request.password:
                existing_pwd = await db.execute(
                    select(PfxPassword).where(
                        PfxPassword.server_guid == server.guid,
                        PfxPassword.file_path == file.file_path
                    )
                )
                if not existing_pwd.scalar_one_or_none():
                    new_pwd = PfxPassword(
                        server_guid=server.guid,
                        file_path=file.file_path,
                        password=request.password
                    )
                    db.add(new_pwd)
                    await db.commit()
                    
        elif file_ext in ['.cer', '.crt', '.pem']:
            try:
                cert = x509.load_pem_x509_certificate(cert_data, default_backend())
            except Exception:
                cert = x509.load_der_x509_certificate(cert_data, default_backend())
        else:
            raise HTTPException(status_code=400, detail=f"Tipo de arquivo não suportado: {file_ext}")
        
        if not cert:
            raise HTTPException(status_code=500, detail="Não foi possível extrair o certificado")
        
        # Extrair informações
        subject_parts = {}
        for attr in cert.subject:
            subject_parts[attr.oid._name] = attr.value
        
        issuer_parts = {}
        for attr in cert.issuer:
            issuer_parts[attr.oid._name] = attr.value
        
        thumbprint = cert.fingerprint(hashes.SHA1()).hex().upper()
        
        return {
            "success": True,
            "file_id": file_id,
            "subject": subject_parts,
            "issuer": issuer_parts,
            "serial_number": str(cert.serial_number),
            "not_before": cert.not_valid_before_utc.isoformat(),
            "not_after": cert.not_valid_after_utc.isoformat(),
            "thumbprint": thumbprint,
            "has_private_key": private_key is not None,
            "version": cert.version.value
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error reading certificate {file_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/servers/{server_id}/files/{file_id}/download")
async def download_file(server_id: int, file_id: int, db: AsyncSession = Depends(get_db)):
    """Download de um arquivo baixado (retorna bytes)"""
    from fastapi.responses import FileResponse
    from storage_utils import get_file_path
    import os
    
    server = await get_server_or_404(db, server_id)
    file = await get_downloaded_file_or_404(db, server, file_id)
    
    full_path = get_file_path(server.guid, file.share_name, file.sanitized_path)
    
    if not os.path.exists(full_path):
        raise HTTPException(status_code=404, detail="Arquivo não encontrado no storage")
    
    # Extrair nome do arquivo
    file_name = file.file_path.split('\\')[-1] if '\\' in file.file_path else file.file_path.split('/')[-1]
    
    return FileResponse(
        path=full_path,
        filename=file_name,
        media_type=file.mimetype or 'application/octet-stream'
    )


# ==========================================
# Batch Operations
# ==========================================

@router.post("/servers/{server_id}/batch/queue")
async def batch_queue(
    server_id: int, 
    request: BatchQueueRequest,
    db: AsyncSession = Depends(get_db)
):
    """Adiciona múltiplos itens à fila de downloads"""
    from database import AppSettings
    
    server = await get_server_or_404(db, server_id)
    
    # Obter extensões ignoradas
    ignored_extensions = []
    if request.apply_filters:
        ext_result = await db.execute(
            select(AppSettings).where(AppSettings.key == 'ignored_extensions')
        )
        ext_setting = ext_result.scalar_one_or_none()
        if ext_setting and ext_setting.value:
            ignored_extensions = [ext.strip().lower() for ext in ext_setting.value.split(',')]
    
    max_file_size_bytes = request.max_file_size_mb * 1024 * 1024 if request.max_file_size_mb else None
    
    queued = 0
    skipped = 0
    errors = []
    
    for item_id in request.item_ids:
        try:
            # Obter item
            result = await db.execute(
                select(ServerItem).where(
                    ServerItem.id == item_id,
                    ServerItem.server_guid == server.guid
                )
            )
            item = result.scalar_one_or_none()
            
            if not item:
                errors.append({"item_id": item_id, "error": "Item não encontrado"})
                continue
            
            if item.item_type == "Directory":
                # Adicionar scan job para diretório
                from directory_scanner import get_scanner
                scanner = get_scanner()
                await scanner.add_scan_job(
                    server_id=server_id,
                    share_name=item.share_name,
                    path=item.full_path,
                    max_depth=request.max_depth,
                    max_file_size_bytes=max_file_size_bytes,
                    apply_filters=request.apply_filters
                )
                queued += 1
                
            elif item.item_type == "File":
                # Verificar extensão
                if request.apply_filters and ignored_extensions:
                    file_lower = item.name.lower()
                    if any(file_lower.endswith(ext) for ext in ignored_extensions):
                        skipped += 1
                        continue
                
                # Verificar se já está na fila
                existing = await db.execute(
                    select(DownloadJob).where(
                        DownloadJob.server_id == server_id,
                        DownloadJob.file_path == item.full_path,
                        DownloadJob.status.in_(['pending', 'downloading'])
                    )
                )
                if existing.scalar_one_or_none():
                    skipped += 1
                    continue
                
                # Verificar tamanho
                file_size = int(item.size) if item.size and item.size.isdigit() else 0
                status = 'pending'
                skip_reason = None
                
                if max_file_size_bytes and file_size > max_file_size_bytes:
                    status = 'skipped'
                    skip_reason = f"Arquivo excede limite de {request.max_file_size_mb}MB"
                
                # Criar job
                job = DownloadJob(
                    server_id=server_id,
                    server_name=server.name,
                    server_ip=server.ip,
                    share_name=item.share_name,
                    file_path=item.full_path,
                    file_name=item.name,
                    file_size=file_size,
                    status=status,
                    skip_reason=skip_reason,
                    max_file_size_bytes=max_file_size_bytes,
                    max_depth=request.max_depth
                )
                db.add(job)
                queued += 1
                
        except Exception as e:
            errors.append({"item_id": item_id, "error": str(e)})
    
    await db.commit()
    
    return {
        "success": True,
        "queued": queued,
        "skipped": skipped,
        "errors": errors
    }
