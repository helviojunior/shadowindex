from fastapi import FastAPI, APIRouter, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime, timezone
import logging
import os
from pathlib import Path
from dotenv import load_dotenv

from database import (
    init_db, get_db, 
    Credential, DatabaseConnection, ProxyServer, SoapApiUrl, SoapCache, AppConfig,
    Server, ServerShare, DownloadedFile
)
from soap_service import SoapService, get_default_soap_service
import uuid
from storage_utils import (
    save_downloaded_file, 
    get_server_storage_stats, 
    format_size,
    sanitize_path_component
)

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# Create the main app
app = FastAPI(title="Ops Integration Desk")

# Create router with /api prefix
api_router = APIRouter(prefix="/api")

# Pydantic Models
class CredentialCreate(BaseModel):
    domain: str
    username: str
    password: str

class CredentialResponse(BaseModel):
    id: int
    domain: str
    username: str
    password: str
    created_at: datetime

class DatabaseConnectionCreate(BaseModel):
    name: str
    connection_string: str

class DatabaseConnectionResponse(BaseModel):
    id: int
    name: str
    connection_string: str
    created_at: datetime

class ProxyServerCreate(BaseModel):
    name: str
    ip: str
    port: int

class ProxyServerResponse(BaseModel):
    id: int
    name: str
    ip: str
    port: int
    created_at: datetime

class SoapApiUrlCreate(BaseModel):
    name: str
    uri: str

class SoapApiUrlResponse(BaseModel):
    id: int
    name: str
    uri: str
    created_at: datetime

class SoapOperationRequest(BaseModel):
    operation: Optional[str] = None  # Opcional - cada endpoint já sabe a operação
    s1: Optional[str] = ""
    s2: Optional[str] = ""
    connStr: Optional[str] = None
    query: Optional[str] = None
    ignore_cache: bool = False
    server_id: Optional[int] = None  # Para rastrear operações por servidor

class SoapOperationResponse(BaseModel):
    operation: str
    result: str
    from_cache: bool

class AppConfigUpdate(BaseModel):
    key: str
    value: str

class AppConfigResponse(BaseModel):
    id: int
    key: str
    value: str
    updated_at: datetime

class ActiveProxyResponse(BaseModel):
    active_proxy_id: Optional[int]
    proxy: Optional[ProxyServerResponse]

class SetActiveProxyRequest(BaseModel):
    proxy_id: Optional[int] = None  # None = sem proxy

class ServerCreate(BaseModel):
    name: str
    ip: str

class ServerResponse(BaseModel):
    id: int
    guid: str
    name: str
    ip: str
    verified: bool
    shares_count: int
    downloaded_files_count: int
    last_verified_at: Optional[datetime]
    created_at: datetime

class ServerShareResponse(BaseModel):
    id: int
    server_guid: str
    share_name: str
    share_type: Optional[str]
    remark: Optional[str]
    access_denied: bool = False
    error_message: Optional[str] = None
    discovered_at: datetime

class DownloadedFileResponse(BaseModel):
    id: int
    server_guid: str
    share_name: str
    file_path: str
    sanitized_path: str
    file_size: Optional[int]
    downloaded_at: datetime

# Routes
@api_router.get("/")
async def root():
    return {"message": "Ops Integration Desk API", "version": "1.0.0"}

# Credentials CRUD
@api_router.post("/credentials", response_model=CredentialResponse)
async def create_credential(credential: CredentialCreate, db: AsyncSession = Depends(get_db)):
    db_credential = Credential(**credential.model_dump())
    db.add(db_credential)
    await db.commit()
    await db.refresh(db_credential)
    return db_credential

@api_router.get("/credentials", response_model=List[CredentialResponse])
async def get_credentials(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Credential))
    return result.scalars().all()

@api_router.delete("/credentials/{credential_id}")
async def delete_credential(credential_id: int, db: AsyncSession = Depends(get_db)):
    await db.execute(delete(Credential).where(Credential.id == credential_id))
    await db.commit()
    return {"message": "Credential deleted"}

# Database Connections CRUD
@api_router.post("/db-connections", response_model=DatabaseConnectionResponse)
async def create_db_connection(conn: DatabaseConnectionCreate, db: AsyncSession = Depends(get_db)):
    db_conn = DatabaseConnection(**conn.model_dump())
    db.add(db_conn)
    await db.commit()
    await db.refresh(db_conn)
    return db_conn

@api_router.get("/db-connections", response_model=List[DatabaseConnectionResponse])
async def get_db_connections(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(DatabaseConnection))
    return result.scalars().all()

@api_router.delete("/db-connections/{conn_id}")
async def delete_db_connection(conn_id: int, db: AsyncSession = Depends(get_db)):
    await db.execute(delete(DatabaseConnection).where(DatabaseConnection.id == conn_id))
    await db.commit()
    return {"message": "Database connection deleted"}

# Proxy Servers CRUD
@api_router.post("/proxy-servers", response_model=ProxyServerResponse)
async def create_proxy_server(proxy: ProxyServerCreate, db: AsyncSession = Depends(get_db)):
    db_proxy = ProxyServer(**proxy.model_dump())
    db.add(db_proxy)
    await db.commit()
    await db.refresh(db_proxy)
    return db_proxy

@api_router.get("/proxy-servers", response_model=List[ProxyServerResponse])
async def get_proxy_servers(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(ProxyServer))
    return result.scalars().all()

@api_router.delete("/proxy-servers/{proxy_id}")
async def delete_proxy_server(proxy_id: int, db: AsyncSession = Depends(get_db)):
    await db.execute(delete(ProxyServer).where(ProxyServer.id == proxy_id))
    await db.commit()
    return {"message": "Proxy server deleted"}

# SOAP API URLs CRUD
@api_router.post("/soap-apis", response_model=SoapApiUrlResponse)
async def create_soap_api(soap_api: SoapApiUrlCreate, db: AsyncSession = Depends(get_db)):
    db_soap_api = SoapApiUrl(**soap_api.model_dump())
    db.add(db_soap_api)
    await db.commit()
    await db.refresh(db_soap_api)
    return db_soap_api

@api_router.get("/soap-apis", response_model=List[SoapApiUrlResponse])
async def get_soap_apis(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(SoapApiUrl))
    return result.scalars().all()

@api_router.delete("/soap-apis/{soap_api_id}")
async def delete_soap_api(soap_api_id: int, db: AsyncSession = Depends(get_db)):
    await db.execute(delete(SoapApiUrl).where(SoapApiUrl.id == soap_api_id))
    await db.commit()
    return {"message": "SOAP API deleted"}

# App Config
@api_router.get("/config", response_model=List[AppConfigResponse])
async def get_config(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(AppConfig))
    return result.scalars().all()

@api_router.put("/config", response_model=AppConfigResponse)
async def update_config(config: AppConfigUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(AppConfig).where(AppConfig.key == config.key))
    db_config = result.scalar_one_or_none()
    
    if db_config:
        db_config.value = config.value
        db_config.updated_at = datetime.now(timezone.utc)
    else:
        db_config = AppConfig(**config.model_dump())
        db.add(db_config)
    
    await db.commit()
    await db.refresh(db_config)
    return db_config

# Active Proxy Management
@api_router.get("/active-proxy", response_model=ActiveProxyResponse)
async def get_active_proxy(db: AsyncSession = Depends(get_db)):
    """Retorna o proxy ativo atual"""
    result = await db.execute(select(AppConfig).where(AppConfig.key == "active_proxy_id"))
    config = result.scalar_one_or_none()
    
    if not config or config.value == "" or config.value == "null":
        return {"active_proxy_id": None, "proxy": None}
    
    try:
        proxy_id = int(config.value)
        result = await db.execute(select(ProxyServer).where(ProxyServer.id == proxy_id))
        proxy = result.scalar_one_or_none()
        
        if proxy:
            return {
                "active_proxy_id": proxy_id,
                "proxy": proxy
            }
        else:
            return {"active_proxy_id": None, "proxy": None}
    except (ValueError, TypeError):
        return {"active_proxy_id": None, "proxy": None}

@api_router.put("/active-proxy", response_model=ActiveProxyResponse)
async def set_active_proxy(request: SetActiveProxyRequest, db: AsyncSession = Depends(get_db)):
    """Define o proxy ativo para todas as requisições SOAP"""
    # Validar se o proxy existe (se não for None)
    proxy = None
    if request.proxy_id is not None:
        result = await db.execute(select(ProxyServer).where(ProxyServer.id == request.proxy_id))
        proxy = result.scalar_one_or_none()
        if not proxy:
            raise HTTPException(status_code=404, detail="Proxy não encontrado")
    
    # Atualizar ou criar configuração
    result = await db.execute(select(AppConfig).where(AppConfig.key == "active_proxy_id"))
    config = result.scalar_one_or_none()
    
    value = str(request.proxy_id) if request.proxy_id is not None else ""
    
    if config:
        config.value = value
        config.updated_at = datetime.now(timezone.utc)
    else:
        config = AppConfig(key="active_proxy_id", value=value)
        db.add(config)
    
    await db.commit()
    
    return {
        "active_proxy_id": request.proxy_id,
        "proxy": proxy
    }

# SOAP Operations
@api_router.post("/soap/resolve", response_model=SoapOperationResponse)
async def soap_resolve(
    request: SoapOperationRequest,
    db: AsyncSession = Depends(get_db)
):
    soap_service = await get_default_soap_service(db)
    params = {"s1": request.s1, "s2": request.s2}
    
    try:
        result = await soap_service.call_soap_operation(
            db, "Resolve", params, request.ignore_cache
        )
        return {
            "operation": "Resolve",
            "result": result,
            "from_cache": not request.ignore_cache
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/soap/shares", response_model=SoapOperationResponse)
async def soap_shares(
    request: SoapOperationRequest,
    db: AsyncSession = Depends(get_db)
):
    soap_service = await get_default_soap_service(db)
    params = {"s1": request.s1, "s2": request.s2}
    
    try:
        result = await soap_service.call_soap_operation(
            db, "Shares", params, request.ignore_cache
        )
        return {
            "operation": "Shares",
            "result": result,
            "from_cache": not request.ignore_cache
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/soap/exec", response_model=SoapOperationResponse)
async def soap_exec(
    request: SoapOperationRequest,
    db: AsyncSession = Depends(get_db)
):
    if not request.connStr or not request.query:
        raise HTTPException(status_code=400, detail="connStr and query are required")
    
    soap_service = await get_default_soap_service(db)
    params = {"connStr": request.connStr, "query": request.query}
    
    try:
        result = await soap_service.call_soap_operation(
            db, "Exec", params, request.ignore_cache
        )
        return {
            "operation": "Exec",
            "result": result,
            "from_cache": not request.ignore_cache
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/soap/exec4", response_model=SoapOperationResponse)
async def soap_exec4(
    request: SoapOperationRequest,
    db: AsyncSession = Depends(get_db)
):
    soap_service = await get_default_soap_service(db)
    params = {"s1": request.s1, "s2": request.s2}
    
    try:
        result = await soap_service.call_soap_operation(
            db, "Exec4", params, request.ignore_cache
        )
        return {
            "operation": "Exec4",
            "result": result,
            "from_cache": not request.ignore_cache
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/soap/exec5", response_model=SoapOperationResponse)
async def soap_exec5(
    request: SoapOperationRequest,
    db: AsyncSession = Depends(get_db)
):
    soap_service = await get_default_soap_service(db)
    params = {"s1": request.s1, "s2": request.s2}
    
    try:
        result = await soap_service.call_soap_operation(
            db, "Exec5", params, request.ignore_cache
        )
        return {
            "operation": "Exec5",
            "result": result,
            "from_cache": not request.ignore_cache
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Cache management
@api_router.get("/cache/stats")
async def get_cache_stats(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(SoapCache))
    cache_entries = result.scalars().all()
    
    stats = {
        "total_entries": len(cache_entries),
        "operations": {}
    }
    
    for entry in cache_entries:
        if entry.operation not in stats["operations"]:
            stats["operations"][entry.operation] = 0
        stats["operations"][entry.operation] += 1
    
    return stats

@api_router.delete("/cache/clear")
async def clear_cache(db: AsyncSession = Depends(get_db)):
    await db.execute(delete(SoapCache))
    await db.commit()
    return {"message": "Cache cleared"}


# Offline Mode endpoints
@api_router.get("/offline-mode")
async def get_offline_mode(db: AsyncSession = Depends(get_db)):
    """Retorna o status atual do modo offline"""
    result = await db.execute(select(AppConfig).where(AppConfig.key == "offline_mode"))
    config = result.scalar_one_or_none()
    is_offline = config and config.value.lower() == "true"
    return {"offline_mode": is_offline}

@api_router.put("/offline-mode")
async def set_offline_mode(enabled: bool, db: AsyncSession = Depends(get_db)):
    """Define o status do modo offline"""
    result = await db.execute(select(AppConfig).where(AppConfig.key == "offline_mode"))
    config = result.scalar_one_or_none()
    
    if config:
        config.value = "true" if enabled else "false"
        config.updated_at = datetime.now(timezone.utc)
    else:
        config = AppConfig(key="offline_mode", value="true" if enabled else "false")
        db.add(config)
    
    await db.commit()
    return {"offline_mode": enabled, "message": f"Modo offline {'ativado' if enabled else 'desativado'}"}


# Servers CRUD
@api_router.post("/servers", response_model=ServerResponse)
async def create_server(server: ServerCreate, db: AsyncSession = Depends(get_db)):
    db_server = Server(
        guid=str(uuid.uuid4()),
        name=server.name,
        ip=server.ip
    )
    db.add(db_server)
    await db.commit()
    await db.refresh(db_server)
    return db_server

@api_router.get("/servers", response_model=List[ServerResponse])
async def get_servers(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Server))
    return result.scalars().all()

@api_router.get("/servers/{server_id}", response_model=ServerResponse)
async def get_server(
    server_id: int, 
    refresh: bool = False,
    db: AsyncSession = Depends(get_db)
):
    """
    Obtém informações do servidor.
    Se refresh=True ou se nunca foi verificado, atualiza IP via SOAP Resolve.
    """
    result = await db.execute(select(Server).where(Server.id == server_id))
    server = result.scalar_one_or_none()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    
    # Verificar se precisa atualizar (refresh=True ou nunca verificado)
    should_refresh = refresh or not server.verified
    
    if should_refresh:
        try:
            soap_service = await get_default_soap_service(db)
            # Resolve para obter IP atualizado
            params = {"s1": server.name, "s2": ""}
            result_str = await soap_service.call_soap_operation(db, "Resolve", params, refresh)
            
            # Se retornou IP válido, atualiza
            if result_str and result_str.strip():
                server.ip = result_str.strip()
                server.verified = True
                server.last_verified_at = datetime.now(timezone.utc)
                await db.commit()
                await db.refresh(server)
        except Exception as e:
            # Log o erro mas continua retornando os dados do DB
            import logging
            logging.getLogger(__name__).warning(f"Failed to refresh server via SOAP: {e}")
    
    return server

@api_router.put("/servers/{server_id}", response_model=ServerResponse)
async def update_server(server_id: int, server: ServerCreate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Server).where(Server.id == server_id))
    db_server = result.scalar_one_or_none()
    if not db_server:
        raise HTTPException(status_code=404, detail="Server not found")
    
    db_server.name = server.name
    db_server.ip = server.ip
    await db.commit()
    await db.refresh(db_server)
    return db_server

@api_router.delete("/servers/{server_id}")
async def delete_server(server_id: int, db: AsyncSession = Depends(get_db)):
    await db.execute(delete(Server).where(Server.id == server_id))
    await db.commit()
    return {"message": "Server deleted"}

# Server Shares
@api_router.get("/servers/{server_id}/shares", response_model=List[ServerShareResponse])
async def get_server_shares(
    server_id: int, 
    refresh: bool = False,
    db: AsyncSession = Depends(get_db)
):
    """
    Obtém compartilhamentos do servidor.
    Se refresh=True ou se shares_count=0, busca via SOAP Shares primeiro.
    Caso contrário, usa dados do cache/banco.
    """
    # Obter server
    result = await db.execute(select(Server).where(Server.id == server_id))
    server = result.scalar_one_or_none()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    
    # Verificar se precisa buscar via SOAP
    should_fetch_soap = refresh or server.shares_count == 0 or not server.verified
    
    if should_fetch_soap:
        try:
            soap_service = await get_default_soap_service(db)
            params = {"s1": server.ip or server.name, "s2": ""}
            result_str = await soap_service.call_soap_operation(db, "Shares", params, refresh)
            
            # Parsear XML e salvar shares
            import xml.etree.ElementTree as ET
            root = ET.fromstring(f"<root>{result_str}</root>")
            
            # Limpar shares antigos antes de adicionar novos (evita duplicação)
            await db.execute(
                delete(ServerShare).where(ServerShare.server_guid == server.guid)
            )
            
            shares_found = []
            seen_names = set()  # Evitar duplicados na mesma resposta
            
            for result_elem in root.findall(".//Result"):
                share_name = result_elem.find("name")
                share_type = result_elem.find("type")
                remark = result_elem.find("remark")
                
                if share_name is not None and share_name.text:
                    name_text = share_name.text.strip()
                    
                    # Pular se já vimos este nome (evita duplicados)
                    if name_text in seen_names:
                        continue
                    seen_names.add(name_text)
                    
                    share_data = {
                        "name": name_text,
                        "type": share_type.text.strip() if share_type is not None and share_type.text else "Unknown",
                        "remark": remark.text.strip() if remark is not None and remark.text else ""
                    }
                    shares_found.append(share_data)
                    
                    # Adicionar novo share
                    db_share = ServerShare(
                        server_guid=server.guid,
                        share_name=share_data["name"],
                        share_type=share_data["type"],
                        remark=share_data["remark"]
                    )
                    db.add(db_share)
            
            # Atualizar contador e marcar como verificado
            server.shares_count = len(shares_found)
            server.verified = True
            server.last_verified_at = datetime.now(timezone.utc)
            await db.commit()
        except Exception as e:
            # Log o erro mas continua retornando os dados do DB
            import logging
            logging.getLogger(__name__).warning(f"Failed to fetch shares via SOAP: {e}")
    
    # Obter shares do banco (ordenado por nome)
    result = await db.execute(
        select(ServerShare).where(ServerShare.server_guid == server.guid).order_by(ServerShare.share_name)
    )
    return result.scalars().all()

# Downloaded Files
@api_router.get("/servers/{server_id}/downloads", response_model=List[DownloadedFileResponse])
async def get_server_downloads(server_id: int, db: AsyncSession = Depends(get_db)):
    # Obter server
    result = await db.execute(select(Server).where(Server.id == server_id))
    server = result.scalar_one_or_none()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    
    # Obter downloads
    result = await db.execute(
        select(DownloadedFile).where(DownloadedFile.server_guid == server.guid)
    )
    return result.scalars().all()

# Server Storage Stats
@api_router.get("/servers/{server_id}/storage-stats")
async def get_server_storage_stats_endpoint(server_id: int, db: AsyncSession = Depends(get_db)):
    # Obter server
    result = await db.execute(select(Server).where(Server.id == server_id))
    server = result.scalar_one_or_none()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    
    stats = get_server_storage_stats(server.guid)
    stats["total_size_formatted"] = format_size(stats["total_size"])
    
    for share in stats["shares"]:
        share["size_formatted"] = format_size(share["size"])
    
    return stats


# Server SOAP Operations
@api_router.post("/servers/{server_id}/shares")
async def get_server_shares_soap(server_id: int, db: AsyncSession = Depends(get_db)):
    """Busca compartilhamentos do servidor via SOAP e atualiza o banco"""
    # Obter servidor
    result = await db.execute(select(Server).where(Server.id == server_id))
    server = result.scalar_one_or_none()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    
    # Chamar SOAP Shares
    soap_service = await get_default_soap_service(db)
    params = {"s1": server.ip, "s2": ""}
    
    try:
        result_str = await soap_service.call_soap_operation(db, "Shares", params, False)
        
        # Parsear XML e salvar shares
        import xml.etree.ElementTree as ET
        root = ET.fromstring(result_str)
        
        # Limpar shares antigos antes de adicionar novos (evita duplicação)
        await db.execute(
            delete(ServerShare).where(ServerShare.server_guid == server.guid)
        )
        
        shares = []
        seen_names = set()
        
        for result_elem in root.findall(".//Result"):
            share_name = result_elem.find("name")
            share_type = result_elem.find("type")
            remark = result_elem.find("remark")
            
            if share_name is not None and share_name.text:
                name_text = share_name.text.strip()
                
                if name_text in seen_names:
                    continue
                seen_names.add(name_text)
                
                share_data = {
                    "name": name_text,
                    "type": share_type.text.strip() if share_type is not None and share_type.text else "Unknown",
                    "remark": remark.text.strip() if remark is not None and remark.text else ""
                }
                shares.append(share_data)
                
                db_share = ServerShare(
                    server_guid=server.guid,
                    share_name=share_data["name"],
                    share_type=share_data["type"],
                    remark=share_data["remark"]
                )
                db.add(db_share)
        
        # Atualizar contador e marcar como verificado
        server.shares_count = len(shares)
        server.verified = True
        server.last_verified_at = datetime.now(timezone.utc)
        await db.commit()
        
        return {
            "success": True,
            "shares": shares,
            "count": len(shares)
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/servers/{server_id}/browse")
async def browse_server_directory(
    server_id: int,
    path: str,
    ignore_cache: bool = False,
    share_name: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """Lista arquivos e diretórios de um caminho no servidor"""
    # Obter servidor
    result = await db.execute(select(Server).where(Server.id == server_id))
    server = result.scalar_one_or_none()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    
    # Chamar SOAP Exec4
    soap_service = await get_default_soap_service(db)
    params = {"s1": path, "s2": ""}
    
    try:
        result_str = await soap_service.call_soap_operation(db, "Exec4", params, ignore_cache)
        
        # Parsear XML
        import xml.etree.ElementTree as ET
        root = ET.fromstring(result_str)
        
        items = []
        access_denied = False
        error_message = None
        
        for result_elem in root.findall(".//Result"):
            # Verificar se é um erro de acesso negado
            message_elem = result_elem.find("message")
            
            if message_elem is not None and message_elem.text:
                msg_text = message_elem.text.lower()
                if "access" in msg_text and "denied" in msg_text:
                    access_denied = True
                    error_message = message_elem.text
                    
                    # Atualizar o share no banco se share_name foi fornecido
                    if share_name:
                        share_result = await db.execute(
                            select(ServerShare).where(
                                ServerShare.server_guid == server.guid,
                                ServerShare.share_name == share_name
                            )
                        )
                        share = share_result.scalar_one_or_none()
                        if share:
                            share.access_denied = True
                            share.error_message = message_elem.text
                            await db.commit()
                    
                    continue
            
            item_type = result_elem.find("type")
            name = result_elem.find("name")
            length = result_elem.find("length")
            lastwritetime = result_elem.find("lastwritetime")
            fullname = result_elem.find("fullname")
            
            if name is not None:
                item = {
                    "type": item_type.text if item_type is not None and item_type.text else "Unknown",
                    "name": name.text if name.text else "",
                    "size": length.text if length is not None and length.text else "---",
                    "modified": lastwritetime.text if lastwritetime is not None and lastwritetime.text else "",
                    "fullPath": fullname.text if fullname is not None and fullname.text else "",
                    "accessDenied": False
                }
                items.append(item)
        
        # Marcar como verificado
        if not server.verified:
            server.verified = True
            server.last_verified_at = datetime.now(timezone.utc)
            await db.commit()
        
        return {
            "success": True,
            "path": path,
            "items": items,
            "count": len(items),
            "accessDenied": access_denied,
            "errorMessage": error_message
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/servers/{server_id}/download")
async def download_server_file(
    server_id: int,
    file_path: str,
    share_name: str,
    db: AsyncSession = Depends(get_db)
):
    """Baixa um arquivo do servidor via SOAP"""
    # Obter servidor
    result = await db.execute(select(Server).where(Server.id == server_id))
    server = result.scalar_one_or_none()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    
    # Chamar SOAP Exec5
    soap_service = await get_default_soap_service(db)
    params = {"s1": file_path, "s2": ""}
    
    try:
        result_str = await soap_service.call_soap_operation(db, "Exec5", params, False)
        
        # Extrair conteúdo base64 do XML
        import xml.etree.ElementTree as ET
        
        content_base64 = ""
        
        # Tentar parsear como XML
        try:
            root = ET.fromstring(result_str)
            
            # Buscar Exec5Result em qualquer namespace
            # Primeiro tenta sem namespace
            exec5_result = root.find(".//Exec5Result")
            
            if exec5_result is None:
                # Tenta com namespace http://test/
                exec5_result = root.find(".//{http://test/}Exec5Result")
            
            if exec5_result is None:
                # Tenta buscar qualquer elemento que contenha "Result" no nome
                for elem in root.iter():
                    if 'Exec5Result' in elem.tag:
                        exec5_result = elem
                        break
            
            if exec5_result is not None and exec5_result.text:
                content_base64 = exec5_result.text.strip()
            else:
                # Se não encontrou elemento específico, tenta o texto do root
                content_base64 = root.text.strip() if root.text else ""
                
        except ET.ParseError:
            # Se não é XML válido, assume que é o conteúdo base64 direto
            content_base64 = result_str.strip()
        
        if not content_base64:
            raise Exception("Arquivo vazio ou não encontrado")
        
        # Salvar arquivo no storage
        from storage_utils import save_downloaded_file
        full_path, sanitized_path = save_downloaded_file(
            server.guid,
            share_name,
            file_path,
            content_base64
        )
        
        # Calcular tamanho
        import base64
        file_size = len(base64.b64decode(content_base64))
        
        # Salvar registro no banco
        downloaded_file = DownloadedFile(
            server_guid=server.guid,
            share_name=share_name,
            file_path=file_path,
            sanitized_path=sanitized_path,
            file_size=file_size
        )
        db.add(downloaded_file)
        
        # Atualizar contador
        server.downloaded_files_count += 1
        await db.commit()
        
        return {
            "success": True,
            "file_path": file_path,
            "sanitized_path": sanitized_path,
            "size": file_size,
            "size_formatted": format_size(file_size)
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@api_router.get("/servers/{server_id}/file-content")
async def get_file_content(
    server_id: int,
    file_path: str,
    share_name: str,
    db: AsyncSession = Depends(get_db)
):
    """Lê o conteúdo de um arquivo sincronizado"""
    # Obter servidor
    result = await db.execute(select(Server).where(Server.id == server_id))
    server = result.scalar_one_or_none()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    
    # Verificar se o arquivo foi sincronizado
    result = await db.execute(
        select(DownloadedFile).where(
            DownloadedFile.server_guid == server.guid,
            DownloadedFile.file_path == file_path
        )
    )
    downloaded = result.scalar_one_or_none()
    if not downloaded:
        raise HTTPException(status_code=404, detail="Arquivo não sincronizado")
    
    # Ler o conteúdo do arquivo
    from storage_utils import get_file_path
    full_path = get_file_path(server.guid, share_name, downloaded.sanitized_path)
    
    try:
        import os
        if not os.path.exists(full_path):
            raise HTTPException(status_code=404, detail="Arquivo não encontrado no storage")
        
        with open(full_path, 'r', encoding='utf-8', errors='replace') as f:
            content = f.read()
        
        return {
            "success": True,
            "content": content,
            "file_path": file_path,
            "size": len(content)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@api_router.get("/servers/{server_id}/file-download")
async def download_file_to_client(
    server_id: int,
    file_path: str,
    share_name: str,
    db: AsyncSession = Depends(get_db)
):
    """Baixa um arquivo sincronizado para o cliente"""
    from fastapi.responses import FileResponse
    import os
    
    # Obter servidor
    result = await db.execute(select(Server).where(Server.id == server_id))
    server = result.scalar_one_or_none()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    
    # Verificar se o arquivo foi sincronizado
    result = await db.execute(
        select(DownloadedFile).where(
            DownloadedFile.server_guid == server.guid,
            DownloadedFile.file_path == file_path
        )
    )
    downloaded = result.scalar_one_or_none()
    if not downloaded:
        raise HTTPException(status_code=404, detail="Arquivo não sincronizado")
    
    # Obter caminho do arquivo
    from storage_utils import get_file_path
    full_path = get_file_path(server.guid, share_name, downloaded.sanitized_path)
    
    if not os.path.exists(full_path):
        raise HTTPException(status_code=404, detail="Arquivo não encontrado no storage")
    
    # Extrair nome do arquivo
    filename = os.path.basename(file_path)
    
    return FileResponse(
        path=full_path,
        filename=filename,
        media_type='application/octet-stream'
    )


# Include router
app.include_router(api_router)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

@app.on_event("startup")
async def startup_event():
    await init_db()
    logging.info("Database initialized")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)