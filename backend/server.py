from fastapi import FastAPI, APIRouter, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, desc, update
from pydantic import BaseModel, Field
from typing import List, Optional, Any
from datetime import datetime, timezone
import logging
import os
import json
import time
from pathlib import Path
from dotenv import load_dotenv

from database import (
    init_db, get_db, 
    Credential, DatabaseConnection, ProxyServer, SoapApiUrl, SoapCache, AppConfig,
    Server, ServerShare, DownloadedFile, ServerItem, SqlPreset, SqlQueryHistory, DatabaseType,
    FileVersion
)
from soap_service import SoapService, get_default_soap_service
import uuid
from storage_utils import (
    save_downloaded_file, 
    get_server_storage_stats, 
    format_size,
    sanitize_path_component,
    calculate_sha1_from_base64
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


# Database Type Models
class DatabaseTypeResponse(BaseModel):
    id: int
    name: str
    code: str
    color: Optional[str] = None
    created_at: datetime


class DatabaseConnectionCreate(BaseModel):
    name: str
    db_type_id: Optional[int] = None
    connection_string: str

class DatabaseConnectionResponse(BaseModel):
    id: int
    name: str
    db_type_id: Optional[int] = None
    db_type_name: Optional[str] = None
    db_type_code: Optional[str] = None
    db_type_color: Optional[str] = None
    connection_string: str
    verified: bool = False
    last_verified_at: Optional[datetime] = None
    created_at: datetime


# SQL Presets Models
class SqlPresetCreate(BaseModel):
    db_type_id: Optional[int] = None
    name: str
    query: str
    description: Optional[str] = None

class SqlPresetUpdate(BaseModel):
    db_type_id: Optional[int] = None
    name: Optional[str] = None
    query: Optional[str] = None
    description: Optional[str] = None

class SqlPresetResponse(BaseModel):
    id: int
    db_type_id: Optional[int] = None
    db_type_name: Optional[str] = None
    db_type_code: Optional[str] = None
    name: str
    query: str
    description: Optional[str]
    created_at: datetime
    updated_at: datetime


# SQL Query History Models
class SqlQueryHistoryResponse(BaseModel):
    id: int
    connection_id: int
    connection_name: str
    query: str
    result: Optional[str]
    success: bool
    error_message: Optional[str]
    execution_time_ms: Optional[int]
    executed_at: datetime


# SQL Execution Models
class SqlExecuteRequest(BaseModel):
    connection_id: int
    query: str

class SqlExecuteResponse(BaseModel):
    success: bool
    columns: Optional[List[str]] = None
    rows: Optional[List[List[Any]]] = None
    row_count: int = 0
    execution_time_ms: int = 0
    error_message: Optional[str] = None

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
    has_children: bool = False
    children_fetched: bool = False
    discovered_at: datetime

class DownloadedFileResponse(BaseModel):
    id: int
    server_guid: str
    share_name: str
    file_path: str
    sanitized_path: str
    file_size: Optional[int]
    sha1_hash: Optional[str] = None
    downloaded_at: datetime

class FileVersionResponse(BaseModel):
    id: int
    version_number: int
    sha1_hash: str
    file_size: Optional[int]
    is_current: bool
    created_at: datetime

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


# Database Types CRUD
@api_router.get("/db-types", response_model=List[DatabaseTypeResponse])
async def get_db_types(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(DatabaseType).order_by(DatabaseType.name))
    return result.scalars().all()


# Database Connections CRUD
@api_router.post("/db-connections", response_model=DatabaseConnectionResponse)
async def create_db_connection(conn: DatabaseConnectionCreate, db: AsyncSession = Depends(get_db)):
    db_conn = DatabaseConnection(**conn.model_dump())
    db.add(db_conn)
    await db.commit()
    await db.refresh(db_conn)
    
    # Get type info
    db_type = None
    if db_conn.db_type_id:
        result = await db.execute(select(DatabaseType).where(DatabaseType.id == db_conn.db_type_id))
        db_type = result.scalar_one_or_none()
    
    return {
        **{c.name: getattr(db_conn, c.name) for c in db_conn.__table__.columns},
        "db_type_name": db_type.name if db_type else None,
        "db_type_code": db_type.code if db_type else None,
        "db_type_color": db_type.color if db_type else None,
    }

@api_router.get("/db-connections", response_model=List[DatabaseConnectionResponse])
async def get_db_connections(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(DatabaseConnection).order_by(DatabaseConnection.name))
    connections = result.scalars().all()
    
    # Get all types
    types_result = await db.execute(select(DatabaseType))
    types_map = {t.id: t for t in types_result.scalars().all()}
    
    response = []
    for conn in connections:
        db_type = types_map.get(conn.db_type_id) if conn.db_type_id else None
        response.append({
            **{c.name: getattr(conn, c.name) for c in conn.__table__.columns},
            "db_type_name": db_type.name if db_type else None,
            "db_type_code": db_type.code if db_type else None,
            "db_type_color": db_type.color if db_type else None,
        })
    
    return response

@api_router.delete("/db-connections/{conn_id}")
async def delete_db_connection(conn_id: int, db: AsyncSession = Depends(get_db)):
    await db.execute(delete(DatabaseConnection).where(DatabaseConnection.id == conn_id))
    await db.commit()
    return {"message": "Database connection deleted"}

@api_router.put("/db-connections/{conn_id}", response_model=DatabaseConnectionResponse)
async def update_db_connection(conn_id: int, conn_data: DatabaseConnectionCreate, db: AsyncSession = Depends(get_db)):
    # Check if connection exists
    result = await db.execute(select(DatabaseConnection).where(DatabaseConnection.id == conn_id))
    existing = result.scalar_one_or_none()
    if not existing:
        raise HTTPException(status_code=404, detail="Connection not found")
    
    # Update fields
    existing.name = conn_data.name
    existing.connection_string = conn_data.connection_string
    existing.db_type_id = conn_data.db_type_id
    # Reset verification status when connection string changes
    existing.verified = False
    existing.last_verified_at = None
    
    await db.commit()
    await db.refresh(existing)
    
    # Get type info
    db_type = None
    if existing.db_type_id:
        result = await db.execute(select(DatabaseType).where(DatabaseType.id == existing.db_type_id))
        db_type = result.scalar_one_or_none()
    
    return {
        **{c.name: getattr(existing, c.name) for c in existing.__table__.columns},
        "db_type_name": db_type.name if db_type else None,
        "db_type_code": db_type.code if db_type else None,
        "db_type_color": db_type.color if db_type else None,
    }

@api_router.get("/db-connections/{conn_id}", response_model=DatabaseConnectionResponse)
async def get_db_connection(conn_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(DatabaseConnection).where(DatabaseConnection.id == conn_id))
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    
    # Get type info
    db_type = None
    if conn.db_type_id:
        result = await db.execute(select(DatabaseType).where(DatabaseType.id == conn.db_type_id))
        db_type = result.scalar_one_or_none()
    
    return {
        **{c.name: getattr(conn, c.name) for c in conn.__table__.columns},
        "db_type_name": db_type.name if db_type else None,
        "db_type_code": db_type.code if db_type else None,
        "db_type_color": db_type.color if db_type else None,
    }


# SQL Presets CRUD
@api_router.get("/sql-presets", response_model=List[SqlPresetResponse])
async def get_sql_presets(db_type_id: Optional[int] = None, db: AsyncSession = Depends(get_db)):
    query = select(SqlPreset).order_by(SqlPreset.name)
    
    # Filter by db_type_id if provided (include universal presets with null db_type_id)
    if db_type_id is not None:
        query = query.where((SqlPreset.db_type_id == db_type_id) | (SqlPreset.db_type_id.is_(None)))
    
    result = await db.execute(query)
    presets = result.scalars().all()
    
    # Get all types
    types_result = await db.execute(select(DatabaseType))
    types_map = {t.id: t for t in types_result.scalars().all()}
    
    response = []
    for preset in presets:
        db_type = types_map.get(preset.db_type_id) if preset.db_type_id else None
        response.append({
            **{c.name: getattr(preset, c.name) for c in preset.__table__.columns},
            "db_type_name": db_type.name if db_type else "Universal",
            "db_type_code": db_type.code if db_type else None,
        })
    
    return response

@api_router.post("/sql-presets", response_model=SqlPresetResponse)
async def create_sql_preset(preset: SqlPresetCreate, db: AsyncSession = Depends(get_db)):
    db_preset = SqlPreset(**preset.model_dump())
    db.add(db_preset)
    await db.commit()
    await db.refresh(db_preset)
    
    # Get type info
    db_type = None
    if db_preset.db_type_id:
        result = await db.execute(select(DatabaseType).where(DatabaseType.id == db_preset.db_type_id))
        db_type = result.scalar_one_or_none()
    
    return {
        **{c.name: getattr(db_preset, c.name) for c in db_preset.__table__.columns},
        "db_type_name": db_type.name if db_type else "Universal",
        "db_type_code": db_type.code if db_type else None,
    }

@api_router.put("/sql-presets/{preset_id}", response_model=SqlPresetResponse)
async def update_sql_preset(preset_id: int, preset: SqlPresetUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(SqlPreset).where(SqlPreset.id == preset_id))
    db_preset = result.scalar_one_or_none()
    if not db_preset:
        raise HTTPException(status_code=404, detail="Preset not found")
    
    if preset.db_type_id is not None:
        db_preset.db_type_id = preset.db_type_id
    if preset.name is not None:
        db_preset.name = preset.name
    if preset.query is not None:
        db_preset.query = preset.query
    if preset.description is not None:
        db_preset.description = preset.description
    
    db_preset.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(db_preset)
    
    # Get type info
    db_type = None
    if db_preset.db_type_id:
        result = await db.execute(select(DatabaseType).where(DatabaseType.id == db_preset.db_type_id))
        db_type = result.scalar_one_or_none()
    
    return {
        **{c.name: getattr(db_preset, c.name) for c in db_preset.__table__.columns},
        "db_type_name": db_type.name if db_type else "Universal",
        "db_type_code": db_type.code if db_type else None,
    }

@api_router.delete("/sql-presets/{preset_id}")
async def delete_sql_preset(preset_id: int, db: AsyncSession = Depends(get_db)):
    await db.execute(delete(SqlPreset).where(SqlPreset.id == preset_id))
    await db.commit()
    return {"message": "SQL preset deleted"}


# SQL Execution
@api_router.post("/sql/execute", response_model=SqlExecuteResponse)
async def execute_sql(request: SqlExecuteRequest, db: AsyncSession = Depends(get_db)):
    """Executa uma query SQL usando SOAP Exec"""
    # Buscar a conexão
    result = await db.execute(select(DatabaseConnection).where(DatabaseConnection.id == request.connection_id))
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    
    start_time = time.time()
    
    try:
        # Chamar SOAP Exec
        soap_service = await get_default_soap_service(db)
        params = {"connStr": conn.connection_string, "query": request.query}
        
        result_str = await soap_service.call_soap_operation(db, "Exec", params, True)  # Ignorar cache para SQL
        
        execution_time = int((time.time() - start_time) * 1000)
        
        # Parsear resultado XML
        import xml.etree.ElementTree as ET
        
        columns = []
        rows = []
        
        try:
            root = ET.fromstring(f"<root>{result_str}</root>")
            
            # Verificar erro no formato diffgr (message + stacktrace)
            for result_elem in root.findall(".//Result"):
                message_elem = result_elem.find("message")
                stacktrace_elem = result_elem.find("stacktrace")
                
                # Se tem message e stacktrace, é um erro
                if message_elem is not None and stacktrace_elem is not None:
                    error_message = message_elem.text or ""
                    stacktrace = stacktrace_elem.text or ""
                    full_error = f"{error_message}\n\nStackTrace:\n{stacktrace}" if stacktrace else error_message
                    raise Exception(full_error)
                
                # Verificar erro simples (apenas message com palavras-chave de erro)
                if message_elem is not None and message_elem.text:
                    msg_lower = message_elem.text.lower()
                    if any(keyword in msg_lower for keyword in ["error", "denied", "exception", "failed", "invalid", "cannot", "unable"]):
                        raise Exception(message_elem.text)
            
            # Extrair colunas e dados
            first_result = root.find(".//Result")
            if first_result is not None:
                # Pegar nomes das colunas do primeiro resultado
                for child in first_result:
                    columns.append(child.tag)
                
                # Extrair todas as linhas
                for result_elem in root.findall(".//Result"):
                    row = []
                    for col in columns:
                        elem = result_elem.find(col)
                        row.append(elem.text if elem is not None and elem.text else "")
                    rows.append(row)
        except ET.ParseError:
            # Se não é XML, retorna como string
            columns = ["Result"]
            rows = [[result_str]]
        
        # Marcar conexão como verificada
        conn.verified = True
        conn.last_verified_at = datetime.now(timezone.utc)
        
        # Salvar no histórico
        history = SqlQueryHistory(
            connection_id=conn.id,
            connection_name=conn.name,
            query=request.query,
            result=json.dumps({"columns": columns, "rows": rows}),
            success=True,
            execution_time_ms=execution_time
        )
        db.add(history)
        await db.commit()
        
        return {
            "success": True,
            "columns": columns,
            "rows": rows,
            "row_count": len(rows),
            "execution_time_ms": execution_time
        }
    
    except Exception as e:
        execution_time = int((time.time() - start_time) * 1000)
        
        # Salvar erro no histórico
        history = SqlQueryHistory(
            connection_id=conn.id,
            connection_name=conn.name,
            query=request.query,
            success=False,
            error_message=str(e),
            execution_time_ms=execution_time
        )
        db.add(history)
        await db.commit()
        
        return {
            "success": False,
            "error_message": str(e),
            "execution_time_ms": execution_time
        }


# SQL Query History
@api_router.get("/sql/history", response_model=List[SqlQueryHistoryResponse])
async def get_sql_history(
    connection_id: Optional[int] = None,
    limit: int = 50,
    db: AsyncSession = Depends(get_db)
):
    """Retorna histórico de queries SQL executadas"""
    query = select(SqlQueryHistory).order_by(desc(SqlQueryHistory.executed_at)).limit(limit)
    
    if connection_id:
        query = query.where(SqlQueryHistory.connection_id == connection_id)
    
    result = await db.execute(query)
    return result.scalars().all()

@api_router.get("/sql/history/{history_id}", response_model=SqlQueryHistoryResponse)
async def get_sql_history_item(history_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(SqlQueryHistory).where(SqlQueryHistory.id == history_id))
    history = result.scalar_one_or_none()
    if not history:
        raise HTTPException(status_code=404, detail="History item not found")
    return history

@api_router.delete("/sql/history/{history_id}")
async def delete_sql_history_item(history_id: int, db: AsyncSession = Depends(get_db)):
    await db.execute(delete(SqlQueryHistory).where(SqlQueryHistory.id == history_id))
    await db.commit()
    return {"message": "History item deleted"}

@api_router.delete("/sql/history")
async def clear_sql_history(connection_id: Optional[int] = None, db: AsyncSession = Depends(get_db)):
    """Limpa o histórico de queries (opcionalmente filtrado por conexão)"""
    if connection_id:
        await db.execute(delete(SqlQueryHistory).where(SqlQueryHistory.connection_id == connection_id))
    else:
        await db.execute(delete(SqlQueryHistory))
    await db.commit()
    return {"message": "History cleared"}


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
    Se o IP já for válido, não faz o resolve.
    """
    result = await db.execute(select(Server).where(Server.id == server_id))
    server = result.scalar_one_or_none()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    
    # Função para verificar se é um IP válido
    def is_valid_ip(ip: str) -> bool:
        if not ip:
            return False
        import re
        ip_pattern = r'^(\d{1,3}\.){3}\d{1,3}$'
        if not re.match(ip_pattern, ip):
            return False
        parts = ip.split('.')
        return all(0 <= int(part) <= 255 for part in parts)
    
    # Verificar se precisa atualizar (refresh=True ou nunca verificado)
    should_refresh = refresh or not server.verified
    
    # Se o IP já for válido, não precisa resolver
    if is_valid_ip(server.ip):
        should_refresh = False
        # Marcar como verificado se ainda não estiver
        if not server.verified:
            server.verified = True
            server.last_verified_at = datetime.now(timezone.utc)
            await db.commit()
            await db.refresh(server)
    
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
async def update_server_full(server_id: int, server: ServerCreate, db: AsyncSession = Depends(get_db)):
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
            
            # Obter shares existentes para preservar flags
            existing_shares_result = await db.execute(
                select(ServerShare).where(ServerShare.server_guid == server.guid)
            )
            existing_shares = {s.share_name: s for s in existing_shares_result.scalars().all()}
            
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
                    
                    # Verificar se share já existe
                    if name_text in existing_shares:
                        # Atualizar share existente preservando flags
                        existing_share = existing_shares[name_text]
                        existing_share.share_type = share_data["type"]
                        existing_share.remark = share_data["remark"]
                        # NÃO resetar: children_fetched, has_children, access_denied
                    else:
                        # Adicionar novo share
                        db_share = ServerShare(
                            server_guid=server.guid,
                            share_name=share_data["name"],
                            share_type=share_data["type"],
                            remark=share_data["remark"]
                        )
                        db.add(db_share)
            
            # Remover shares que não existem mais no servidor
            current_share_names = set(s["name"] for s in shares_found)
            for existing_name, existing_share in existing_shares.items():
                if existing_name not in current_share_names:
                    await db.delete(existing_share)
            
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

# Update Server (PATCH)
class ServerUpdateRequest(BaseModel):
    ip: Optional[str] = None
    name: Optional[str] = None

@api_router.patch("/servers/{server_id}")
async def update_server(server_id: int, update_data: ServerUpdateRequest, db: AsyncSession = Depends(get_db)):
    """Atualiza dados do servidor (IP, nome)"""
    result = await db.execute(select(Server).where(Server.id == server_id))
    server = result.scalar_one_or_none()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    
    if update_data.ip is not None:
        server.ip = update_data.ip
    if update_data.name is not None:
        server.name = update_data.name
    
    await db.commit()
    await db.refresh(server)
    
    return {"success": True, "message": "Server updated successfully"}

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


# Update Share flags
class ShareUpdateRequest(BaseModel):
    children_fetched: Optional[bool] = None
    has_children: Optional[bool] = None

@api_router.patch("/servers/{server_id}/shares/{share_name}")
async def update_share(
    server_id: int, 
    share_name: str, 
    update_data: ShareUpdateRequest, 
    db: AsyncSession = Depends(get_db)
):
    """Atualiza flags do share (children_fetched, has_children)"""
    result = await db.execute(select(Server).where(Server.id == server_id))
    server = result.scalar_one_or_none()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    
    result = await db.execute(
        select(ServerShare).where(
            ServerShare.server_guid == server.guid,
            ServerShare.share_name == share_name
        )
    )
    share = result.scalar_one_or_none()
    if not share:
        raise HTTPException(status_code=404, detail="Share not found")
    
    if update_data.children_fetched is not None:
        share.children_fetched = update_data.children_fetched
    if update_data.has_children is not None:
        share.has_children = update_data.has_children
    
    await db.commit()
    return {"success": True, "share_name": share_name}


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


@api_router.get("/servers/{server_id}/shares-tree")
async def get_server_shares_with_children(server_id: int, db: AsyncSession = Depends(get_db)):
    """
    Retorna os shares do servidor com seus filhos já carregados do banco.
    Útil para reconstruir a árvore ao abrir a página.
    """
    # Obter servidor
    result = await db.execute(select(Server).where(Server.id == server_id))
    server = result.scalar_one_or_none()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    
    # Obter shares
    shares_result = await db.execute(
        select(ServerShare).where(ServerShare.server_guid == server.guid)
    )
    shares = shares_result.scalars().all()
    
    # Obter todos os itens do servidor
    items_result = await db.execute(
        select(ServerItem).where(ServerItem.server_guid == server.guid)
    )
    all_items = items_result.scalars().all()
    
    # Construir dicionário de itens por parent_path
    items_by_parent = {}
    for item in all_items:
        if item.parent_path not in items_by_parent:
            items_by_parent[item.parent_path] = []
        items_by_parent[item.parent_path].append({
            "id": item.id,
            "type": item.item_type,
            "name": item.name,
            "fullPath": item.full_path,
            "size": item.size or "---",
            "modified": item.modified or "",
            "accessDenied": item.access_denied,
            "errorMessage": item.error_message,
            "hasChildren": item.has_children,
            "childrenFetched": item.children_fetched
        })
    
    # Construir resposta com shares e seus filhos
    shares_with_children = []
    for share in shares:
        share_path = f"\\\\{server.ip}\\{share.share_name}"
        share_data = {
            "id": share.id,
            "share_name": share.share_name,
            "share_type": share.share_type,
            "remark": share.remark,
            "access_denied": share.access_denied,
            "error_message": share.error_message,
            "has_children": share.has_children,
            "children_fetched": share.children_fetched,
            "discovered_at": share.discovered_at.isoformat() if share.discovered_at else None,
            "children": items_by_parent.get(share_path, [])
        }
        shares_with_children.append(share_data)
    
    return {
        "success": True,
        "shares": shares_with_children,
        "items_by_path": items_by_parent,
        "server_ip": server.ip
    }


@api_router.get("/servers/{server_id}/items")
async def get_server_items_by_path(
    server_id: int, 
    parent_path: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Retorna os itens filhos de um path específico do banco.
    Não faz chamada SOAP, apenas retorna dados em cache.
    """
    # Obter servidor
    result = await db.execute(select(Server).where(Server.id == server_id))
    server = result.scalar_one_or_none()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    
    # Obter itens
    items_result = await db.execute(
        select(ServerItem).where(
            ServerItem.server_guid == server.guid,
            ServerItem.parent_path == parent_path
        )
    )
    items = items_result.scalars().all()
    
    return {
        "success": True,
        "path": parent_path,
        "items": [
            {
                "id": item.id,
                "type": item.item_type,
                "name": item.name,
                "fullPath": item.full_path,
                "size": item.size or "---",
                "modified": item.modified or "",
                "accessDenied": item.access_denied,
                "errorMessage": item.error_message,
                "hasChildren": item.has_children,
                "childrenFetched": item.children_fetched
            }
            for item in items
        ],
        "count": len(items)
    }


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
                    
                    # Só marcar o share como acesso negado se estivermos no nível raiz do share
                    # (path termina com o share_name, sem subdiretórios)
                    if share_name:
                        # Verificar se é o nível raiz do share
                        is_share_root = path.rstrip('\\').endswith(share_name)
                        
                        if is_share_root:
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
                                share.children_fetched = True
                                share.has_children = False
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
        
        # Salvar os itens descobertos no banco de dados
        if share_name and items:
            # Remover itens antigos deste path
            await db.execute(
                delete(ServerItem).where(
                    ServerItem.server_guid == server.guid,
                    ServerItem.parent_path == path
                )
            )
            
            # Adicionar novos itens
            for item in items:
                db_item = ServerItem(
                    server_guid=server.guid,
                    share_name=share_name,
                    parent_path=path,
                    item_type=item["type"],
                    name=item["name"],
                    full_path=item["fullPath"],
                    size=item["size"],
                    modified=item["modified"],
                    access_denied=item.get("accessDenied", False)
                )
                db.add(db_item)
            await db.commit()
        
        # Atualizar o share com informação de que os filhos foram buscados
        # Só atualizar se for no nível raiz do share
        if share_name:
            is_share_root = path.rstrip('\\').endswith(share_name)
            
            if is_share_root:
                share_result = await db.execute(
                    select(ServerShare).where(
                        ServerShare.server_guid == server.guid,
                        ServerShare.share_name == share_name
                    )
                )
                share = share_result.scalar_one_or_none()
                if share:
                    share.children_fetched = True
                    share.has_children = len(items) > 0
                    if not access_denied:
                        share.access_denied = False
                        share.error_message = None
                    await db.commit()
            else:
                # Atualizar o item pai (diretório) para marcar que seus filhos foram carregados
                parent_item_result = await db.execute(
                    select(ServerItem).where(
                        ServerItem.server_guid == server.guid,
                        ServerItem.full_path == path
                    )
                )
                parent_item = parent_item_result.scalar_one_or_none()
                if parent_item:
                    parent_item.children_fetched = True
                    parent_item.has_children = len(items) > 0
                    await db.commit()
        
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
    expected_size: int = 0,  # Tamanho esperado do arquivo (opcional)
    db: AsyncSession = Depends(get_db)
):
    """Baixa um arquivo do servidor via SOAP com versionamento"""
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
            exec5_result = root.find(".//Exec5Result")
            
            if exec5_result is None:
                exec5_result = root.find(".//{http://test/}Exec5Result")
            
            if exec5_result is None:
                for elem in root.iter():
                    if 'Exec5Result' in elem.tag:
                        exec5_result = elem
                        break
            
            if exec5_result is not None and exec5_result.text:
                content_base64 = exec5_result.text.strip()
            else:
                content_base64 = root.text.strip() if root.text else ""
                
        except ET.ParseError:
            content_base64 = result_str.strip()
        
        # Verificar se arquivo está vazio
        if not content_base64:
            # Se o tamanho esperado é 0, criar arquivo vazio
            if expected_size == 0:
                content_base64 = ""  # Arquivo vazio
            else:
                raise Exception("Arquivo vazio ou não encontrado")
        
        # Calcular SHA1 do novo conteúdo (para vazio será hash de string vazia)
        from storage_utils import save_downloaded_file, calculate_sha1_from_base64, save_empty_file
        new_sha1 = calculate_sha1_from_base64(content_base64)
        
        # Verificar se já existe uma versão deste arquivo
        result = await db.execute(
            select(FileVersion).where(
                FileVersion.server_guid == server.guid,
                FileVersion.file_path == file_path,
                FileVersion.is_current.is_(True)
            )
        )
        current_version = result.scalar_one_or_none()
        
        if current_version:
            # Arquivo já existe - verificar se mudou
            if current_version.sha1_hash == new_sha1:
                # Mesmo arquivo - apenas atualizar data
                current_version.created_at = datetime.now(timezone.utc)
                
                # Atualizar downloaded_file também
                result = await db.execute(
                    select(DownloadedFile).where(
                        DownloadedFile.server_guid == server.guid,
                        DownloadedFile.file_path == file_path
                    ).order_by(DownloadedFile.downloaded_at.desc())
                )
                downloaded_file = result.scalar_one_or_none()
                if downloaded_file:
                    downloaded_file.downloaded_at = datetime.now(timezone.utc)
                
                await db.commit()
                
                return {
                    "success": True,
                    "file_path": file_path,
                    "sha1_hash": new_sha1,
                    "status": "unchanged",
                    "message": "Arquivo sem alteração",
                    "version": current_version.version_number,
                    "size": current_version.file_size,
                    "size_formatted": format_size(current_version.file_size) if current_version.file_size else "N/A"
                }
            else:
                # Arquivo mudou - criar nova versão
                new_version_number = current_version.version_number + 1
                
                # Marcar versão atual como não-atual
                current_version.is_current = False
                
                # Salvar nova versão no storage
                full_path, sanitized_path, sha1_hash, file_size = save_downloaded_file(
                    server.guid,
                    share_name,
                    file_path,
                    content_base64,
                    new_version_number
                )
                
                # Criar nova versão no banco
                new_file_version = FileVersion(
                    server_guid=server.guid,
                    share_name=share_name,
                    file_path=file_path,
                    version_number=new_version_number,
                    sha1_hash=sha1_hash,
                    file_size=file_size,
                    local_path=sanitized_path,
                    is_current=True
                )
                db.add(new_file_version)
                
                # Atualizar downloaded_file principal
                result = await db.execute(
                    select(DownloadedFile).where(
                        DownloadedFile.server_guid == server.guid,
                        DownloadedFile.file_path == file_path
                    ).order_by(DownloadedFile.downloaded_at.desc())
                )
                downloaded_file = result.scalar_one_or_none()
                if downloaded_file:
                    downloaded_file.sha1_hash = sha1_hash
                    downloaded_file.file_size = file_size
                    downloaded_file.sanitized_path = sanitized_path
                    downloaded_file.downloaded_at = datetime.now(timezone.utc)
                
                await db.commit()
                
                return {
                    "success": True,
                    "file_path": file_path,
                    "sanitized_path": sanitized_path,
                    "sha1_hash": sha1_hash,
                    "status": "updated",
                    "message": "Arquivo atualizado",
                    "version": new_version_number,
                    "previous_version": current_version.version_number,
                    "size": file_size,
                    "size_formatted": format_size(file_size)
                }
        else:
            # Primeiro download - criar versão 1
            full_path, sanitized_path, sha1_hash, file_size = save_downloaded_file(
                server.guid,
                share_name,
                file_path,
                content_base64,
                1
            )
            
            # Criar primeira versão
            new_file_version = FileVersion(
                server_guid=server.guid,
                share_name=share_name,
                file_path=file_path,
                version_number=1,
                sha1_hash=sha1_hash,
                file_size=file_size,
                local_path=sanitized_path,
                is_current=True
            )
            db.add(new_file_version)
            
            # Salvar registro principal
            downloaded_file = DownloadedFile(
                server_guid=server.guid,
                share_name=share_name,
                file_path=file_path,
                sanitized_path=sanitized_path,
                file_size=file_size,
                sha1_hash=sha1_hash
            )
            db.add(downloaded_file)
            
            # Atualizar contador
            server.downloaded_files_count += 1
            await db.commit()
            
            return {
                "success": True,
                "file_path": file_path,
                "sanitized_path": sanitized_path,
                "sha1_hash": sha1_hash,
                "status": "new",
                "message": "Arquivo sincronizado",
                "version": 1,
                "size": file_size,
                "size_formatted": format_size(file_size)
            }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@api_router.get("/servers/{server_id}/file-versions")
async def get_file_versions(
    server_id: int,
    file_path: str,
    db: AsyncSession = Depends(get_db)
):
    """Retorna todas as versões de um arquivo"""
    result = await db.execute(select(Server).where(Server.id == server_id))
    server = result.scalar_one_or_none()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    
    result = await db.execute(
        select(FileVersion).where(
            FileVersion.server_guid == server.guid,
            FileVersion.file_path == file_path
        ).order_by(FileVersion.version_number.desc())
    )
    versions = result.scalars().all()
    
    return [
        {
            "id": v.id,
            "version_number": v.version_number,
            "sha1_hash": v.sha1_hash,
            "file_size": v.file_size,
            "local_path": v.local_path,
            "is_current": v.is_current,
            "created_at": v.created_at
        }
        for v in versions
    ]


@api_router.post("/servers/{server_id}/file-versions/{version_id}/set-current")
async def set_version_as_current(
    server_id: int,
    version_id: int,
    db: AsyncSession = Depends(get_db)
):
    """Define uma versão específica como a versão atual"""
    result = await db.execute(select(Server).where(Server.id == server_id))
    server = result.scalar_one_or_none()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    
    # Obter a versão solicitada
    result = await db.execute(
        select(FileVersion).where(
            FileVersion.id == version_id,
            FileVersion.server_guid == server.guid
        )
    )
    target_version = result.scalar_one_or_none()
    if not target_version:
        raise HTTPException(status_code=404, detail="Version not found")
    
    # Desmarcar todas as versões do mesmo arquivo como não-atuais
    await db.execute(
        update(FileVersion).where(
            FileVersion.server_guid == server.guid,
            FileVersion.file_path == target_version.file_path
        ).values(is_current=False)
    )
    
    # Marcar a versão alvo como atual
    target_version.is_current = True
    
    # Atualizar downloaded_file
    result = await db.execute(
        select(DownloadedFile).where(
            DownloadedFile.server_guid == server.guid,
            DownloadedFile.file_path == target_version.file_path
        )
    )
    downloaded_file = result.scalar_one_or_none()
    if downloaded_file:
        downloaded_file.sha1_hash = target_version.sha1_hash
        downloaded_file.file_size = target_version.file_size
        downloaded_file.sanitized_path = target_version.local_path
    
    await db.commit()
    
    return {
        "success": True,
        "message": f"Versão {target_version.version_number} definida como atual",
        "version": target_version.version_number
    }


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


# Endpoint de teste para demonstrar o Beautify (apenas para desenvolvimento)
@api_router.get("/test/xml-sample")
async def get_xml_sample():
    """Retorna um XML de exemplo para testar o Beautify"""
    xml_content = '''<?xml version="1.0" encoding="UTF-8"?><configuration><appSettings><add key="DatabaseServer" value="192.168.1.100"/><add key="DatabaseName" value="MyApp"/><add key="Timeout" value="30"/></appSettings><connectionStrings><add name="DefaultConnection" connectionString="Server=localhost;Database=mydb;User=admin;Password=secret123;"/></connectionStrings><!-- This is a comment --><system.web><compilation debug="true" targetFramework="4.8"/><httpRuntime targetFramework="4.8"/></system.web></configuration>'''
    return {"content": xml_content, "filename": "config.xml"}


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