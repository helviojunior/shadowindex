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
import os

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


class SearchRequest(BaseModel):
    query: Optional[str] = None           # Busca por nome
    sha1: Optional[str] = None            # Busca por hash SHA1
    extension: Optional[str] = None       # Busca por extensão (.aspx, .config, etc)
    date_from: Optional[datetime] = None  # Data inicial
    date_to: Optional[datetime] = None    # Data final
    item_type: Optional[str] = None       # 'File', 'Directory' ou None para ambos
    limit: int = 100                      # Limite de resultados


class SearchResultItem(BaseModel):
    id: int
    type: str  # 'item' ou 'file'
    item_type: Optional[str]  # 'File' ou 'Directory'
    name: str
    full_path: str
    share_name: str
    size: Optional[str]
    sha1_hash: Optional[str]
    modified: Optional[str]
    downloaded_at: Optional[datetime]
    is_downloaded: bool


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
# Search Endpoint
# ==========================================

@router.post("/servers/{server_id}/search", response_model=List[SearchResultItem])
async def search_items(
    server_id: int,
    search: SearchRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Busca arquivos e diretórios no banco de dados.
    Suporta busca por nome, SHA1, extensão e data.
    """
    from sqlalchemy import or_, and_, func
    
    server = await get_server_or_404(db, server_id)
    
    results = []
    
    # 1. Buscar nos itens (ServerItem) - diretórios e arquivos descobertos
    item_conditions = [ServerItem.server_guid == server.guid]
    
    if search.query:
        item_conditions.append(ServerItem.name.ilike(f"%{search.query}%"))
    
    if search.extension:
        ext = search.extension if search.extension.startswith('.') else f".{search.extension}"
        item_conditions.append(ServerItem.name.ilike(f"%{ext}"))
    
    if search.item_type:
        item_conditions.append(ServerItem.item_type == search.item_type)
    
    items_query = select(ServerItem).where(and_(*item_conditions)).limit(search.limit)
    items_result = await db.execute(items_query)
    items = items_result.scalars().all()
    
    # Buscar quais desses itens já foram baixados
    item_paths = [item.full_path for item in items if item.item_type == 'File']
    downloaded_paths = set()
    downloaded_info = {}
    
    if item_paths:
        downloaded_result = await db.execute(
            select(DownloadedFile).where(
                DownloadedFile.server_guid == server.guid,
                DownloadedFile.file_path.in_(item_paths)
            )
        )
        for df in downloaded_result.scalars().all():
            downloaded_paths.add(df.file_path)
            downloaded_info[df.file_path] = df
    
    for item in items:
        df = downloaded_info.get(item.full_path)
        results.append(SearchResultItem(
            id=item.id,
            type='item',
            item_type=item.item_type,
            name=item.name,
            full_path=item.full_path,
            share_name=item.share_name,
            size=item.size,
            sha1_hash=df.sha1_hash if df else None,
            modified=item.modified,
            downloaded_at=df.downloaded_at if df else None,
            is_downloaded=item.full_path in downloaded_paths
        ))
    
    # 2. Buscar nos arquivos baixados (DownloadedFile) - se busca por SHA1 ou data
    if search.sha1 or search.date_from or search.date_to:
        file_conditions = [DownloadedFile.server_guid == server.guid]
        
        if search.query:
            file_conditions.append(DownloadedFile.file_path.ilike(f"%{search.query}%"))
        
        if search.sha1:
            sha1_search = search.sha1.lower()
            file_conditions.append(DownloadedFile.sha1_hash.ilike(f"%{sha1_search}%"))
        
        if search.extension:
            ext = search.extension if search.extension.startswith('.') else f".{search.extension}"
            file_conditions.append(DownloadedFile.file_path.ilike(f"%{ext}"))
        
        if search.date_from:
            file_conditions.append(DownloadedFile.downloaded_at >= search.date_from)
        
        if search.date_to:
            file_conditions.append(DownloadedFile.downloaded_at <= search.date_to)
        
        files_query = select(DownloadedFile).where(and_(*file_conditions)).limit(search.limit)
        files_result = await db.execute(files_query)
        
        # Adicionar arquivos que não estão já nos resultados
        existing_paths = {r.full_path for r in results}
        
        for df in files_result.scalars().all():
            if df.file_path not in existing_paths:
                # Extrair nome do arquivo do path
                name = df.file_path.split('\\')[-1] if '\\' in df.file_path else df.file_path.split('/')[-1]
                
                results.append(SearchResultItem(
                    id=df.id,
                    type='file',
                    item_type='File',
                    name=name,
                    full_path=df.file_path,
                    share_name=df.share_name,
                    size=str(df.file_size) if df.file_size else None,
                    sha1_hash=df.sha1_hash,
                    modified=None,
                    downloaded_at=df.downloaded_at,
                    is_downloaded=True
                ))
    
    # 3. Buscar no conteúdo OCR se houver query de texto
    if search.query and len(search.query) >= 3:
        ocr_conditions = [
            FileVersion.server_guid == server.guid,
            FileVersion.ocr_processed == True,
            FileVersion.ocr_content.ilike(f"%{search.query}%")
        ]
        
        ocr_query = select(FileVersion).where(and_(*ocr_conditions)).limit(search.limit)
        ocr_result = await db.execute(ocr_query)
        
        existing_paths = {r.full_path for r in results}
        
        for version in ocr_result.scalars().all():
            if version.file_path not in existing_paths:
                name = version.file_path.split('\\')[-1] if '\\' in version.file_path else version.file_path.split('/')[-1]
                
                results.append(SearchResultItem(
                    id=version.id,
                    type='ocr',
                    item_type='File',
                    name=name,
                    full_path=version.file_path,
                    share_name=version.share_name,
                    size=str(version.file_size) if version.file_size else None,
                    sha1_hash=version.sha1_hash,
                    modified=None,
                    downloaded_at=version.created_at,
                    is_downloaded=True
                ))
    
    # Ordenar por nome
    results.sort(key=lambda x: (x.item_type != 'Directory', x.name.lower()))
    
    return results[:search.limit]


@router.get("/servers/{server_id}/search/quick")
async def quick_search(
    server_id: int,
    q: str,
    limit: int = 50,
    db: AsyncSession = Depends(get_db)
):
    """
    Busca rápida por nome de arquivo ou diretório.
    Retorna resultados agrupados por tipo.
    """
    from sqlalchemy import or_, and_
    
    server = await get_server_or_404(db, server_id)
    
    # Buscar itens
    items_result = await db.execute(
        select(ServerItem).where(
            ServerItem.server_guid == server.guid,
            ServerItem.name.ilike(f"%{q}%")
        ).limit(limit)
    )
    items = items_result.scalars().all()
    
    # Buscar arquivos baixados por path ou sha1
    files_result = await db.execute(
        select(DownloadedFile).where(
            DownloadedFile.server_guid == server.guid,
            or_(
                DownloadedFile.file_path.ilike(f"%{q}%"),
                DownloadedFile.sha1_hash.ilike(f"%{q}%")
            )
        ).limit(limit)
    )
    downloaded_files = files_result.scalars().all()
    
    # Organizar resultados
    directories = []
    files = []
    downloaded = []
    
    for item in items:
        item_data = {
            "id": item.id,
            "name": item.name,
            "full_path": item.full_path,
            "share_name": item.share_name,
            "size": item.size,
            "modified": item.modified,
            "type": "item"
        }
        if item.item_type == 'Directory':
            directories.append(item_data)
        else:
            files.append(item_data)
    
    # Paths de itens já incluídos
    item_paths = {item.full_path for item in items}
    
    for df in downloaded_files:
        if df.file_path not in item_paths:
            name = df.file_path.split('\\')[-1] if '\\' in df.file_path else df.file_path.split('/')[-1]
            downloaded.append({
                "id": df.id,
                "name": name,
                "full_path": df.file_path,
                "share_name": df.share_name,
                "size": str(df.file_size) if df.file_size else None,
                "sha1_hash": df.sha1_hash,
                "downloaded_at": df.downloaded_at.isoformat() if df.downloaded_at else None,
                "type": "downloaded"
            })
    
    return {
        "query": q,
        "directories": directories,
        "files": files,
        "downloaded": downloaded,
        "total": len(directories) + len(files) + len(downloaded)
    }


# ==========================================
# Share Endpoints
# ==========================================

@router.get("/servers/{server_id}/shares", response_model=List[ShareResponse])
async def list_shares(
    server_id: int, 
    refresh: bool = False,
    db: AsyncSession = Depends(get_db)
):
    """Lista todos os compartilhamentos do servidor"""
    from soap_service import get_default_soap_service
    import xml.etree.ElementTree as ET
    
    server = await get_server_or_404(db, server_id)
    
    if refresh:
        # Buscar shares via SOAP
        try:
            soap_service = await get_default_soap_service(db)
            params = {"s1": server.ip}
            result_str = await soap_service.call_soap_operation(db, "Shares", params, ignore_cache=True)
            
            if result_str:
                shares_data = []
                
                # Tentar parsear como XML (formato diffgram)
                try:
                    # O result_str pode ser o XML completo ou apenas o conteúdo interno
                    # Adicionar root tag se necessário
                    xml_content = result_str
                    if not xml_content.strip().startswith('<'):
                        # Não é XML, tentar formato linha por linha
                        raise ValueError("Not XML format")
                    
                    # Parsear XML
                    root = ET.fromstring(xml_content)
                    
                    # Procurar elementos Result dentro do diffgram
                    # Os elementos Result estão dentro de DocumentElement sem namespace
                    
                    # Procurar todos os elementos Result (podem estar em DocumentElement ou diretamente)
                    results = root.findall('.//Result') or root.findall('.//{urn:schemas-microsoft-com:xml-diffgram-v1}Result')
                    
                    if not results:
                        # Tentar encontrar dentro de DocumentElement
                        doc_elem = root.find('.//DocumentElement')
                        if doc_elem is not None:
                            results = doc_elem.findall('Result')
                    
                    for result in results:
                        # host = result.findtext('host', '').strip()  # Não usado, já sabemos o IP do servidor
                        name = result.findtext('name', '').strip()
                        share_type = result.findtext('type', 'Disk').strip()
                        remark = result.findtext('remark', '').strip()
                        
                        if not name:
                            continue
                        
                        # Ignorar shares especiais (exceto C$, D$, E$)
                        if name.endswith('$') and name not in ['C$', 'D$', 'E$']:
                            continue
                        
                        shares_data.append({
                            'share_name': name,
                            'share_type': share_type,
                            'remark': remark
                        })
                    
                    logger.info(f"Parsed {len(shares_data)} shares from XML for server {server.ip}")
                    
                except (ET.ParseError, ValueError) as parse_error:
                    logger.debug(f"XML parsing failed, trying line format: {parse_error}")
                    # Fallback: tentar formato linha por linha (nome|tipo|remark)
                    for line in result_str.strip().split('\n'):
                        if not line.strip():
                            continue
                        parts = line.split('|')
                        if len(parts) >= 2:
                            share_name = parts[0].strip()
                            share_type = parts[1].strip() if len(parts) > 1 else 'Disk'
                            remark = parts[2].strip() if len(parts) > 2 else ''
                            
                            # Ignorar shares especiais
                            if share_name.endswith('$') and share_name not in ['C$', 'D$', 'E$']:
                                continue
                                
                            shares_data.append({
                                'share_name': share_name,
                                'share_type': share_type,
                                'remark': remark
                            })
                
                # Atualizar banco
                for share_data in shares_data:
                    existing = await db.execute(
                        select(ServerShare).where(
                            ServerShare.server_guid == server.guid,
                            ServerShare.share_name == share_data['share_name']
                        )
                    )
                    share = existing.scalar_one_or_none()
                    
                    if share:
                        share.share_type = share_data['share_type']
                        share.remark = share_data['remark']
                    else:
                        share = ServerShare(
                            server_id=server.id,
                            server_guid=server.guid,
                            share_name=share_data['share_name'],
                            share_type=share_data['share_type'],
                            remark=share_data['remark']
                        )
                        db.add(share)
                
                await db.commit()
                logger.info(f"Updated {len(shares_data)} shares in database for server {server.ip}")
                
        except Exception as e:
            logger.error(f"Error refreshing shares: {e}")
            import traceback
            traceback.print_exc()
    
    # Retornar shares do banco
    result = await db.execute(
        select(ServerShare).where(ServerShare.server_guid == server.guid)
    )
    return result.scalars().all()


@router.get("/servers/{server_id}/shares-tree")
async def get_shares_tree(server_id: int, db: AsyncSession = Depends(get_db)):
    """Retorna shares com todos os itens já visitados (children_fetched=True)"""
    server = await get_server_or_404(db, server_id)
    
    # Buscar shares
    shares_result = await db.execute(
        select(ServerShare).where(ServerShare.server_guid == server.guid)
    )
    shares = shares_result.scalars().all()
    
    # Buscar TODOS os itens do servidor que têm filhos já carregados
    all_items_result = await db.execute(
        select(ServerItem).where(
            ServerItem.server_guid == server.guid
        )
    )
    all_items = all_items_result.scalars().all()
    
    # Organizar itens por parent_path
    items_by_path = {}
    for item in all_items:
        parent_path = item.parent_path
        if parent_path not in items_by_path:
            items_by_path[parent_path] = []
        items_by_path[parent_path].append({
            "id": item.id,
            "type": item.item_type,
            "name": item.name,
            "full_path": item.full_path,
            "size": item.size,
            "modified": item.modified,
            "has_children": item.has_children,
            "children_fetched": item.children_fetched,
            "access_denied": item.access_denied
        })
    
    return {
        "shares": [
            {
                "id": share.id,
                "share_name": share.share_name,
                "share_type": share.share_type,
                "remark": share.remark,
                "access_denied": share.access_denied,
                "error_message": share.error_message,
                "has_children": share.has_children,
                "children_fetched": share.children_fetched
            }
            for share in shares
        ],
        "items_by_path": items_by_path
    }


@router.get("/servers/{server_id}/items")
async def list_items(
    server_id: int,
    parent_path: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """Lista itens do servidor, opcionalmente filtrados por parent_path"""
    server = await get_server_or_404(db, server_id)
    
    query = select(ServerItem).where(ServerItem.server_guid == server.guid)
    
    if parent_path:
        query = query.where(ServerItem.parent_path == parent_path)
    
    result = await db.execute(query)
    items = result.scalars().all()
    
    return {
        "items": [
            {
                "id": item.id,
                "type": item.item_type,
                "itemType": item.item_type,  # Compatibilidade com frontend
                "name": item.name,
                "fullPath": item.full_path,
                "full_path": item.full_path,
                "size": item.size,
                "modified": item.modified,
                "hasChildren": item.has_children,
                "childrenFetched": item.children_fetched,
                "access_denied": item.access_denied
            }
            for item in items
        ],
        "count": len(items)
    }


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
        
        # Parsear resultado
        parsed_items = parse_exec4_directory_listing(result_str)
        
        # Verificar erros de acesso
        if not parsed_items and result_str:
            result_lower = result_str.lower()
            if "access" in result_lower and "denied" in result_lower:
                share.access_denied = True
                share.error_message = "Acesso negado"
                await db.commit()
                return {
                    "success": False,
                    "share_id": share_id,
                    "access_denied": True,
                    "error_message": "Acesso negado",
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


@router.post("/servers/{server_id}/browse")
async def browse_path(
    server_id: int,
    path: str,
    share_name: str,
    ignore_cache: bool = False,
    db: AsyncSession = Depends(get_db)
):
    """Navega em um path via SOAP e atualiza cache - endpoint genérico"""
    from soap_service import get_default_soap_service
    from server import parse_exec4_directory_listing
    
    server = await get_server_or_404(db, server_id)
    
    # Chamar SOAP Exec4
    soap_service = await get_default_soap_service(db)
    params = {"s1": path, "s2": ""}
    
    try:
        result_str = await soap_service.call_soap_operation(db, "Exec4", params, ignore_cache)
        
        # Verificar erros de acesso
        if result_str:
            result_lower = result_str.lower()
            if "access" in result_lower and "denied" in result_lower:
                return {
                    "success": False,
                    "accessDenied": True,
                    "errorMessage": "Acesso negado",
                    "items": []
                }
        
        # Parsear resultado
        parsed_items = parse_exec4_directory_listing(result_str)
        
        # Remover itens antigos deste path
        await db.execute(
            delete(ServerItem).where(
                ServerItem.server_guid == server.guid,
                ServerItem.parent_path == path
            )
        )
        
        # Adicionar novos itens
        items = []
        for item_data in parsed_items:
            db_item = ServerItem(
                server_guid=server.guid,
                share_name=share_name,
                parent_path=path,
                item_type=item_data["type"],
                name=item_data["name"],
                full_path=item_data["fullPath"],
                size=str(item_data["size"]) if item_data["size"] else None,
                modified=item_data["modified"]
            )
            db.add(db_item)
            items.append(db_item)
        
        await db.commit()
        
        # Refresh para obter IDs
        for item in items:
            await db.refresh(item)
        
        return {
            "success": True,
            "accessDenied": False,
            "items": [
                {
                    "id": item.id,
                    "type": item.item_type,
                    "itemType": item.item_type,
                    "name": item.name,
                    "fullPath": item.full_path,
                    "full_path": item.full_path,
                    "size": item.size,
                    "modified": item.modified,
                    "hasChildren": item.item_type == "Directory",
                    "childrenFetched": False
                }
                for item in items
            ],
            "count": len(items)
        }
        
    except Exception as e:
        logger.error(f"Error browsing path {path}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


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


class DownloadRequest(BaseModel):
    content_base64: Optional[str] = None


def process_file_content(raw_content: str) -> bytes:
    """
    Processa o conteúdo de arquivo seguindo o fluxo:
    1. Tenta decodificar de base64
       1.1. Se falhar, trata como texto em claro
       1.2. Se sucesso, usa o conteúdo decodificado
    2. Se conteúdo < 2KB, verifica se é erro de permissão
    
    Retorna: bytes do conteúdo final
    """
    if not raw_content:
        return b''
    
    # Tentar decodificar de base64
    try:
        # Limpar espaços e quebras de linha que podem estar no base64
        cleaned_content = raw_content.strip()
        decoded_content = base64.b64decode(cleaned_content)
        logger.debug(f"Conteúdo decodificado de base64: {len(decoded_content)} bytes")
        final_content = decoded_content
    except Exception as e:
        # Não é base64 válido, tratar como texto em claro
        logger.debug(f"Conteúdo não é base64, tratando como texto: {e}")
        final_content = raw_content.encode('utf-8')
    
    # Verificar erros de permissão (apenas se < 2KB)
    if len(final_content) < 2048:
        try:
            content_str = final_content.decode('utf-8', errors='replace').lower()
            if "access" in content_str and "denied" in content_str:
                raise PermissionError("Acesso negado ao arquivo")
            if "not found" in content_str or "cannot find" in content_str:
                raise FileNotFoundError("Arquivo não encontrado no servidor")
        except (PermissionError, FileNotFoundError):
            raise
        except Exception:
            pass  # Pode ser binário, ignorar
    
    return final_content


class QueueRequest(BaseModel):
    server_id: int
    share_name: str
    file_path: str
    file_name: str
    file_size: Optional[int] = None
    max_file_size_bytes: Optional[int] = None
    max_depth: Optional[int] = None


@router.post("/servers/{server_id}/download")
async def download_file_by_path(
    server_id: int,
    file_path: str,
    share_name: str,
    expected_size: int = 0,
    request: Optional[DownloadRequest] = None,
    db: AsyncSession = Depends(get_db)
):
    """Download de arquivo via path - para compatibilidade com chunked downloads"""
    from soap_service import get_default_soap_service
    from storage_utils import format_size
    from server import get_file_mimetype
    
    server = await get_server_or_404(db, server_id)
    
    raw_content = None
    
    # Se recebeu content_base64, usar isso (chunked download do frontend)
    if request and request.content_base64:
        raw_content = request.content_base64
    else:
        # Buscar via SOAP
        soap_service = await get_default_soap_service(db)
        params = {"s1": file_path, "s2": "", "l1": 0, "l2": 0}
        
        try:
            raw_content = await soap_service.call_soap_operation(db, "Exec5", params, ignore_cache=True)
        except Exception as e:
            logger.error(f"Error downloading file {file_path}: {e}")
            raise HTTPException(status_code=500, detail=str(e))
    
    if not raw_content:
        raise HTTPException(status_code=500, detail="Resposta vazia do servidor")
    
    # Processar conteúdo (decode base64 se necessário, verificar erros)
    try:
        content_bytes = process_file_content(raw_content)
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error processing content: {e}")
        raise HTTPException(status_code=500, detail=f"Erro ao processar conteúdo: {str(e)}")
    
    # Verificar se já existe no banco
    existing_result = await db.execute(
        select(DownloadedFile).where(
            DownloadedFile.server_guid == server.guid,
            DownloadedFile.file_path == file_path
        )
    )
    existing = existing_result.scalar_one_or_none()
    
    # content_bytes já está em bytes após process_file_content()
    
    # Calcular hash do novo conteúdo
    new_hash = hashlib.sha1(content_bytes).hexdigest()
    file_size = len(content_bytes)
    
    # Verificar se arquivo já existe com mesmo hash
    if existing and existing.sha1_hash == new_hash:
        return {
            "success": True,
            "file_id": existing.id,
            "status": "unchanged",
            "message": "Arquivo não modificado",
            "sha1_hash": new_hash,
            "size": existing.file_size,
            "size_formatted": format_size(existing.file_size) if existing.file_size else "0 B",
            "version": 1
        }
    
    # Determinar versão
    version = 1
    if existing:
        # Buscar última versão
        version_result = await db.execute(
            select(FileVersion).where(
                FileVersion.server_guid == server.guid,
                FileVersion.file_path == file_path
            ).order_by(FileVersion.version_number.desc())
        )
        last_version = version_result.scalar_one_or_none()
        if last_version:
            version = last_version.version_number + 1
        
        file_id = existing.id
    else:
        # Criar novo registro primeiro para obter o ID
        downloaded_file = DownloadedFile(
            server_guid=server.guid,
            share_name=share_name,
            file_path=file_path,
            sanitized_path="",  # Será atualizado após salvar
            file_size=file_size,
            sha1_hash=new_hash,
            mimetype=None
        )
        db.add(downloaded_file)
        await db.flush()  # Obtém o ID sem commitar
        file_id = downloaded_file.id
    
    # Salvar arquivo usando estrutura baseada em IDs
    from storage_utils import save_file_by_id, get_file_path_by_id
    local_path, sha1_hash, file_size = save_file_by_id(
        server.id,
        file_id,
        content_bytes,
        version
    )
    
    mimetype = get_file_mimetype(local_path)
    
    # Caminho relativo usando IDs
    sanitized_path = f"{server.id}/{file_id}/{version}"
    
    if existing:
        # Criar nova versão
        new_version = FileVersion(
            server_guid=server.guid,
            share_name=share_name,
            file_path=file_path,
            version_number=version,
            sha1_hash=sha1_hash,
            file_size=file_size,
            mimetype=mimetype,
            local_path=local_path,
            is_current=True
        )
        db.add(new_version)
        
        # Marcar versões anteriores como não-current
        await db.execute(
            select(FileVersion).where(
                FileVersion.server_guid == server.guid,
                FileVersion.file_path == file_path,
                FileVersion.version_number != version
            )
        )
        
        # Atualizar arquivo existente
        existing.sanitized_path = sanitized_path
        existing.sha1_hash = sha1_hash
        existing.file_size = file_size
        existing.mimetype = mimetype
        existing.downloaded_at = datetime.now(timezone.utc)
        await db.commit()
        
        return {
            "success": True,
            "file_id": existing.id,
            "status": "updated",
            "message": "Arquivo atualizado",
            "sha1_hash": sha1_hash,
            "size": file_size,
            "size_formatted": format_size(file_size),
            "version": version
        }
    else:
        # Atualizar registro já criado com caminho sanitizado
        downloaded_file.sanitized_path = sanitized_path
        downloaded_file.mimetype = mimetype
        
        # Criar primeira versão
        first_version = FileVersion(
            server_guid=server.guid,
            share_name=share_name,
            file_path=file_path,
            version_number=1,
            sha1_hash=sha1_hash,
            file_size=file_size,
            mimetype=mimetype,
            local_path=local_path,
            is_current=True
        )
        db.add(first_version)
        
        server.downloaded_files_count = (server.downloaded_files_count or 0) + 1
        await db.commit()
        await db.refresh(downloaded_file)
        
        return {
            "success": True,
            "file_id": downloaded_file.id,
            "status": "new",
            "message": "Arquivo baixado",
            "sha1_hash": sha1_hash,
            "size": file_size,
            "size_formatted": format_size(file_size),
            "version": 1
        }


@router.post("/servers/{server_id}/download-chunk")
async def download_chunk(
    server_id: int,
    file_path: str,
    share_name: str,
    offset: int = 0,
    chunk_size: int = 512000,
    db: AsyncSession = Depends(get_db)
):
    """Download de um chunk de arquivo via SOAP"""
    from soap_service import get_default_soap_service
    
    # Validar servidor existe
    await get_server_or_404(db, server_id)
    
    # Chamar SOAP Exec5 com offset e chunk_size
    soap_service = await get_default_soap_service(db)
    params = {"s1": file_path, "s2": "", "l1": offset, "l2": chunk_size}
    
    try:
        result_str = await soap_service.call_soap_operation(db, "Exec5", params, ignore_cache=True)
        
        if not result_str:
            return {
                "success": True,
                "data": "",
                "bytes_read": 0,
                "is_last": True
            }
        
        # Verificar erros
        result_lower = result_str.lower()
        if "access" in result_lower and "denied" in result_lower:
            raise HTTPException(status_code=403, detail="Acesso negado ao arquivo")
        
        # Codificar em base64
        content_base64 = base64.b64encode(result_str.encode('utf-8')).decode('ascii')
        bytes_read = len(result_str)
        is_last = bytes_read < chunk_size
        
        return {
            "success": True,
            "data": content_base64,
            "bytes_read": bytes_read,
            "is_last": is_last
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error downloading chunk from {file_path}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/downloads")
async def create_download_job(request: QueueRequest, db: AsyncSession = Depends(get_db)):
    """Cria um job de download na fila"""
    server = await get_server_or_404(db, request.server_id)
    
    # Verificar se já está na fila
    existing = await db.execute(
        select(DownloadJob).where(
            DownloadJob.server_id == request.server_id,
            DownloadJob.file_path == request.file_path,
            DownloadJob.status.in_(['pending', 'downloading'])
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Arquivo já está na fila de downloads")
    
    # Criar job
    job = DownloadJob(
        server_id=request.server_id,
        server_name=server.name,
        server_ip=server.ip,
        share_name=request.share_name,
        file_path=request.file_path,
        file_name=request.file_name,
        file_size=request.file_size,
        max_file_size_bytes=request.max_file_size_bytes,
        max_depth=request.max_depth,
        status='pending'
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)
    
    return {
        "success": True,
        "job_id": job.id,
        "message": "Arquivo adicionado à fila de downloads"
    }


@router.post("/downloads/check-queue")
async def check_queue(
    server_id: int,
    file_path: str,
    share_name: str,
    db: AsyncSession = Depends(get_db)
):
    """Verifica se arquivo está na fila de downloads"""
    # Validar servidor existe
    await get_server_or_404(db, server_id)
    
    result = await db.execute(
        select(DownloadJob).where(
            DownloadJob.server_id == server_id,
            DownloadJob.file_path == file_path,
            DownloadJob.status.in_(['pending', 'downloading'])
        )
    )
    job = result.scalar_one_or_none()
    
    if job:
        return {
            "in_queue": True,
            "job_id": job.id,
            "status": job.status
        }
    
    return {"in_queue": False, "job_id": None, "status": None}


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


@router.get("/servers/{server_id}/downloads")
async def list_server_downloads(server_id: int, db: AsyncSession = Depends(get_db)):
    """Lista todos os arquivos baixados de um servidor"""
    server = await get_server_or_404(db, server_id)
    
    result = await db.execute(
        select(DownloadedFile).where(
            DownloadedFile.server_guid == server.guid
        ).order_by(DownloadedFile.downloaded_at.desc())
    )
    files = result.scalars().all()
    
    return [
        {
            "id": f.id,
            "file_path": f.file_path,
            "sanitized_path": f.sanitized_path,
            "sha1_hash": f.sha1_hash,
            "file_size": f.file_size,
            "downloaded_at": f.downloaded_at.isoformat() if f.downloaded_at else None
        }
        for f in files
    ]


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


# ==========================================
# OCR Endpoints
# ==========================================

@router.get("/ocr/status")
async def get_ocr_status():
    """Verifica status do serviço OCR/Tika"""
    from ocr_service import get_tika_service
    
    service = get_tika_service()
    return {
        "available": service.is_available,
        "server_url": service.server_url
    }


@router.post("/servers/{server_id}/files/{file_id}/process-ocr")
async def process_file_ocr_endpoint(
    server_id: int,
    file_id: int,
    ocr_language: str = "eng+por",
    db: AsyncSession = Depends(get_db)
):
    """
    Processa OCR em um arquivo baixado.
    Extrai texto e metadados usando Apache Tika.
    """
    from ocr_service import process_file_ocr, get_tika_service
    from storage_utils import get_file_path
    from datetime import datetime, timezone
    
    server = await get_server_or_404(db, server_id)
    
    # Buscar arquivo
    file_result = await db.execute(
        select(DownloadedFile).where(
            DownloadedFile.id == file_id,
            DownloadedFile.server_guid == server.guid
        )
    )
    file = file_result.scalar_one_or_none()
    
    if not file:
        raise HTTPException(status_code=404, detail="Arquivo não encontrado")
    
    # Verificar se Tika está disponível
    service = get_tika_service()
    if not service.is_available:
        await service.initialize()
        if not service.is_available:
            raise HTTPException(status_code=503, detail="Serviço OCR não disponível")
    
    # Obter caminho do arquivo
    full_path = get_file_path(server.guid, file.share_name, file.sanitized_path)
    
    if not os.path.exists(full_path):
        raise HTTPException(status_code=404, detail=f"Arquivo não encontrado no storage")
    
    # Processar OCR
    content, metadata, error = await process_file_ocr(full_path, ocr_language)
    
    # Salvar arquivos .ocr e .metadata no storage
    if content or metadata:
        import json
        import asyncio
        
        # Caminho base do arquivo (sem extensão para adicionar .ocr e .metadata)
        base_path = full_path
        
        # Salvar arquivo .ocr com o conteúdo extraído
        if content:
            ocr_file_path = f"{base_path}.ocr"
            try:
                def write_ocr_file():
                    with open(ocr_file_path, 'w', encoding='utf-8') as f:
                        f.write(content)
                await asyncio.to_thread(write_ocr_file)
                logger.info(f"OCR content saved to: {ocr_file_path}")
            except Exception as e:
                logger.error(f"Error saving OCR file: {e}")
        
        # Salvar arquivo .metadata com os metadados em JSON
        if metadata:
            metadata_file_path = f"{base_path}.metadata"
            try:
                def write_metadata_file():
                    with open(metadata_file_path, 'w', encoding='utf-8') as f:
                        json.dump(metadata, f, ensure_ascii=False, indent=2, default=str)
                await asyncio.to_thread(write_metadata_file)
                logger.info(f"Metadata saved to: {metadata_file_path}")
            except Exception as e:
                logger.error(f"Error saving metadata file: {e}")
    
    # Buscar versão atual do arquivo para atualizar
    version_result = await db.execute(
        select(FileVersion).where(
            FileVersion.server_guid == server.guid,
            FileVersion.file_path == file.file_path,
            FileVersion.is_current == True
        )
    )
    version = version_result.scalar_one_or_none()
    
    if version:
        version.ocr_content = content
        version.ocr_metadata = metadata
        version.ocr_processed = True
        version.ocr_processed_at = datetime.now(timezone.utc)
        version.ocr_error = error
        await db.commit()
    
    return {
        "success": error is None,
        "content_length": len(content) if content else 0,
        "metadata_fields": len(metadata) if metadata else 0,
        "ocr_file": f"{full_path}.ocr" if content else None,
        "metadata_file": f"{full_path}.metadata" if metadata else None,
        "error": error
    }


@router.get("/servers/{server_id}/files/{file_id}/ocr")
async def get_file_ocr(
    server_id: int,
    file_id: int,
    db: AsyncSession = Depends(get_db)
):
    """
    Obtém dados de OCR de um arquivo.
    Retorna conteúdo extraído e metadados.
    """
    server = await get_server_or_404(db, server_id)
    
    # Buscar arquivo
    file_result = await db.execute(
        select(DownloadedFile).where(
            DownloadedFile.id == file_id,
            DownloadedFile.server_guid == server.guid
        )
    )
    file = file_result.scalar_one_or_none()
    
    if not file:
        raise HTTPException(status_code=404, detail="Arquivo não encontrado")
    
    # Buscar versão atual com dados de OCR
    version_result = await db.execute(
        select(FileVersion).where(
            FileVersion.server_guid == server.guid,
            FileVersion.file_path == file.file_path,
            FileVersion.is_current == True
        )
    )
    version = version_result.scalar_one_or_none()
    
    if not version:
        return {
            "ocr_processed": False,
            "ocr_content": None,
            "ocr_metadata": None,
            "ocr_error": None,
            "ocr_processed_at": None
        }
    
    return {
        "ocr_processed": version.ocr_processed or False,
        "ocr_content": version.ocr_content,
        "ocr_metadata": version.ocr_metadata,
        "ocr_error": version.ocr_error,
        "ocr_processed_at": version.ocr_processed_at.isoformat() if version.ocr_processed_at else None
    }


@router.post("/servers/{server_id}/search-ocr")
async def search_with_ocr(
    server_id: int,
    query: str,
    limit: int = 50,
    db: AsyncSession = Depends(get_db)
):
    """
    Busca arquivos pelo conteúdo OCR extraído.
    """
    from sqlalchemy import or_
    
    server = await get_server_or_404(db, server_id)
    
    # Buscar em FileVersion pelo conteúdo OCR
    results = []
    
    version_result = await db.execute(
        select(FileVersion).where(
            FileVersion.server_guid == server.guid,
            FileVersion.ocr_processed == True,
            FileVersion.ocr_content.ilike(f"%{query}%")
        ).limit(limit)
    )
    
    for version in version_result.scalars().all():
        # Extrair trecho do conteúdo onde aparece a busca
        content = version.ocr_content or ""
        query_lower = query.lower()
        content_lower = content.lower()
        
        # Encontrar posição e extrair trecho
        pos = content_lower.find(query_lower)
        snippet = ""
        if pos >= 0:
            start = max(0, pos - 50)
            end = min(len(content), pos + len(query) + 50)
            snippet = ("..." if start > 0 else "") + content[start:end] + ("..." if end < len(content) else "")
        
        # Extrair nome do arquivo do path
        name = version.file_path.split('\\')[-1] if '\\' in version.file_path else version.file_path.split('/')[-1]
        
        results.append({
            "id": version.id,
            "file_path": version.file_path,
            "name": name,
            "share_name": version.share_name,
            "sha1_hash": version.sha1_hash,
            "mimetype": version.mimetype,
            "ocr_snippet": snippet,
            "ocr_metadata": version.ocr_metadata,
            "created_at": version.created_at.isoformat() if version.created_at else None
        })
    
    return results


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


# ==========================================
# Additional Endpoints (migrated from v1)
# ==========================================

@router.post("/servers/{server_id}/files/{file_id}/set-current")
async def set_file_version_current(
    server_id: int, 
    file_id: int,
    db: AsyncSession = Depends(get_db)
):
    """Define uma versão específica como atual"""
    server = await get_server_or_404(db, server_id)
    file = await get_downloaded_file_or_404(db, server, file_id)
    
    from database import FileVersion
    from storage_utils import get_file_path
    import shutil
    import os
    
    # Buscar a versão
    version_result = await db.execute(
        select(FileVersion).where(
            FileVersion.downloaded_file_id == file.id
        )
    )
    version = version_result.scalar_one_or_none()
    
    if not version:
        raise HTTPException(status_code=404, detail="Versão não encontrada")
    
    # Copiar arquivo da versão para o local atual
    version_path = version.file_path
    current_path = get_file_path(server.guid, file.share_name, file.sanitized_path)
    
    if os.path.exists(version_path):
        shutil.copy2(version_path, current_path)
        
        # Atualizar SHA1 e tamanho no registro principal
        import hashlib
        with open(current_path, 'rb') as f:
            new_sha1 = hashlib.sha1(f.read()).hexdigest()
        file.sha1_hash = new_sha1
        file.file_size = os.path.getsize(current_path)
        await db.commit()
        
        return {"success": True, "message": "Versão definida como atual"}
    else:
        raise HTTPException(status_code=404, detail="Arquivo da versão não encontrado")


@router.post("/servers/{server_id}/clear-access-denied")
async def clear_access_denied_v2(
    server_id: int,
    share_name: str = None,
    db: AsyncSession = Depends(get_db)
):
    """Limpa registros de acesso negado para um servidor/share"""
    from database import ServerItem
    
    server = await get_server_or_404(db, server_id)
    
    # Buscar shares do servidor
    shares_result = await db.execute(
        select(ServerShare).where(ServerShare.server_id == server.id)
    )
    shares = shares_result.scalars().all()
    
    if share_name:
        shares = [s for s in shares if s.share_name == share_name]
    
    deleted_count = 0
    for share in shares:
        result = await db.execute(
            delete(ServerItem).where(
                ServerItem.share_id == share.id,
                ServerItem.access_denied.is_(True)
            )
        )
        deleted_count += result.rowcount
    
    await db.commit()
    
    return {
        "success": True,
        "deleted": deleted_count
    }


@router.post("/downloads/scan")
async def queue_directory_scan_v2(
    server_id: int,
    share_name: str,
    path: str,
    max_depth: int = 10,
    db: AsyncSession = Depends(get_db)
):
    """Adiciona um scan de diretório à fila"""
    from database import ScanJob
    
    server = await get_server_or_404(db, server_id)
    
    # Verificar se já existe scan para este path
    existing = await db.execute(
        select(ScanJob).where(
            ScanJob.server_guid == server.guid,
            ScanJob.share_name == share_name,
            ScanJob.path == path,
            ScanJob.status.in_(['pending', 'running'])
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Scan já em andamento para este diretório")
    
    # Criar job de scan
    scan_job = ScanJob(
        server_guid=server.guid,
        share_name=share_name,
        path=path,
        max_depth=max_depth,
        status='pending'
    )
    db.add(scan_job)
    await db.commit()
    await db.refresh(scan_job)
    
    return {
        "success": True,
        "scan_id": scan_job.id,
        "message": "Scan adicionado à fila"
    }




# ==========================================
# Nmap XML Import Endpoint
# ==========================================

class NmapHostData(BaseModel):
    ip: str
    name: str
    hasSMB: bool
    hasDB: bool
    dbTypes: List[str]

class NmapImportRequest(BaseModel):
    hosts: List[NmapHostData]

class NmapImportResponse(BaseModel):
    success: bool
    imported: int
    failed: int
    skipped: int
    details: List[dict]

@router.post("/servers/import/nmap", response_model=NmapImportResponse)
async def import_servers_from_nmap(
    request: NmapImportRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Importa servidores a partir de dados parseados de um XML do Nmap.
    O parsing do XML é feito no frontend, e este endpoint recebe os hosts já processados.
    
    Para cada host:
    - Verifica se já existe um servidor com o mesmo IP
    - Se não existir, cria um novo servidor com plugin_type='direct_interaction'
    - Se já existir, pula (não atualiza)
    """
    import uuid
    
    results = {
        "imported": [],
        "failed": [],
        "skipped": []
    }
    
    for host in request.hosts:
        try:
            # Verificar se servidor já existe pelo IP
            existing = await db.execute(
                select(Server).where(Server.ip == host.ip)
            )
            existing_server = existing.scalar_one_or_none()
            
            if existing_server:
                results["skipped"].append({
                    "ip": host.ip,
                    "name": host.name,
                    "reason": f"Servidor já existe (ID: {existing_server.id})"
                })
                continue
            
            # Criar novo servidor
            new_server = Server(
                guid=str(uuid.uuid4()),
                name=host.name,
                ip=host.ip,
                plugin_type="direct_interaction",  # Plugin padrão para servidores importados
                plugin_config={
                    "imported_from": "nmap",
                    "has_smb": host.hasSMB,
                    "has_db": host.hasDB,
                    "db_types": host.dbTypes
                }
            )
            db.add(new_server)
            await db.flush()  # Para obter o ID
            
            results["imported"].append({
                "id": new_server.id,
                "ip": host.ip,
                "name": host.name,
                "has_smb": host.hasSMB,
                "db_types": host.dbTypes
            })
            
        except Exception as e:
            logger.error(f"Error importing server {host.ip}: {e}")
            results["failed"].append({
                "ip": host.ip,
                "name": host.name,
                "error": str(e)
            })
    
    await db.commit()
    
    return NmapImportResponse(
        success=True,
        imported=len(results["imported"]),
        failed=len(results["failed"]),
        skipped=len(results["skipped"]),
        details=results["imported"] + results["failed"] + results["skipped"]
    )


@router.post("/servers/import/nmap-xml")
async def import_servers_from_nmap_xml_file(
    file_content: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Endpoint alternativo que recebe o conteúdo XML do Nmap diretamente
    e faz o parsing no backend.
    
    Identifica hosts com:
    - Porta 445 (SMB)
    - Portas de banco de dados: 1433 (MSSQL), 3306 (MySQL), 5432 (PostgreSQL),
      1521 (Oracle), 27017 (MongoDB), 6379 (Redis), 5984 (CouchDB), 9200 (Elasticsearch)
    """
    import xml.etree.ElementTree as ET
    import uuid
    
    # Portas de banco de dados conhecidas
    DB_PORTS = {
        1433: 'MSSQL',
        3306: 'MySQL',
        5432: 'PostgreSQL',
        1521: 'Oracle',
        27017: 'MongoDB',
        6379: 'Redis',
        5984: 'CouchDB',
        9200: 'Elasticsearch'
    }
    SMB_PORT = 445
    
    try:
        root = ET.fromstring(file_content)
    except ET.ParseError as e:
        raise HTTPException(status_code=400, detail=f"XML inválido: {str(e)}")
    
    hosts_to_import = []
    
    # Parsear hosts do XML
    for host_elem in root.findall('.//host'):
        status = host_elem.find('status')
        if status is None or status.get('state') != 'up':
            continue
        
        # Obter IP
        address = host_elem.find("address[@addrtype='ipv4']")
        if address is None:
            continue
        ip = address.get('addr')
        if not ip:
            continue
        
        # Obter hostname
        hostname_elem = host_elem.find('.//hostnames/hostname')
        name = hostname_elem.get('name') if hostname_elem is not None else ip
        
        # Verificar portas abertas
        has_smb = False
        has_db = False
        db_types = []
        
        for port_elem in host_elem.findall('.//ports/port'):
            state = port_elem.find('state')
            if state is None or state.get('state') != 'open':
                continue
            
            port_id = int(port_elem.get('portid', 0))
            
            if port_id == SMB_PORT:
                has_smb = True
            
            if port_id in DB_PORTS:
                has_db = True
                db_types.append(DB_PORTS[port_id])
        
        # Apenas incluir hosts com SMB ou DB
        if has_smb or has_db:
            hosts_to_import.append({
                "ip": ip,
                "name": name,
                "has_smb": has_smb,
                "has_db": has_db,
                "db_types": db_types
            })
    
    if not hosts_to_import:
        return {
            "success": True,
            "message": "Nenhum servidor com porta SMB (445) ou banco de dados encontrado",
            "imported": 0,
            "failed": 0,
            "skipped": 0,
            "hosts_found": 0
        }
    
    # Importar hosts
    results = {
        "imported": [],
        "failed": [],
        "skipped": []
    }
    
    for host in hosts_to_import:
        try:
            # Verificar se servidor já existe pelo IP
            existing = await db.execute(
                select(Server).where(Server.ip == host["ip"])
            )
            existing_server = existing.scalar_one_or_none()
            
            if existing_server:
                results["skipped"].append({
                    "ip": host["ip"],
                    "name": host["name"],
                    "reason": f"Servidor já existe (ID: {existing_server.id})"
                })
                continue
            
            # Criar novo servidor
            new_server = Server(
                guid=str(uuid.uuid4()),
                name=host["name"],
                ip=host["ip"],
                plugin_type="direct_interaction",
                plugin_config={
                    "imported_from": "nmap",
                    "has_smb": host["has_smb"],
                    "has_db": host["has_db"],
                    "db_types": host["db_types"]
                }
            )
            db.add(new_server)
            await db.flush()
            
            results["imported"].append({
                "id": new_server.id,
                "ip": host["ip"],
                "name": host["name"],
                "has_smb": host["has_smb"],
                "db_types": host["db_types"]
            })
            
        except Exception as e:
            logger.error(f"Error importing server {host['ip']}: {e}")
            results["failed"].append({
                "ip": host["ip"],
                "name": host["name"],
                "error": str(e)
            })
    
    await db.commit()
    
    return {
        "success": True,
        "message": f"{len(results['imported'])} servidores importados com sucesso",
        "hosts_found": len(hosts_to_import),
        "imported": len(results["imported"]),
        "failed": len(results["failed"]),
        "skipped": len(results["skipped"]),
        "details": {
            "imported": results["imported"],
            "failed": results["failed"],
            "skipped": results["skipped"]
        }
    }

