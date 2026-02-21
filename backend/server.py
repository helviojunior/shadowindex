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

# Importar magic com fallback se não disponível
try:
    import magic
    MAGIC_AVAILABLE = True
except ImportError:
    MAGIC_AVAILABLE = False
    logging.info("libmagic não instalado - mimetype será detectado por extensão")

from database import (
    init_db, get_db, 
    Credential, DatabaseConnection, ProxyServer, SoapApiUrl, SoapCache, AppConfig,
    Server, ServerShare, DownloadedFile, ServerItem, SqlPreset, SqlQueryHistory, DatabaseType,
    FileVersion, PfxPassword, DownloadJob, AppSettings
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

# Regex para validar IPv4
import re
IPV4_REGEX = re.compile(r'^(\d{1,3}\.){3}\d{1,3}$')

def is_valid_ipv4(ip: str) -> bool:
    """Verifica se é um endereço IPv4 válido"""
    if not ip or not IPV4_REGEX.match(ip):
        return False
    parts = ip.split('.')
    return all(0 <= int(part) <= 255 for part in parts)

def extract_ipv4_from_resolve_result(result: str) -> Optional[str]:
    """
    Extrai o primeiro endereço IPv4 válido do resultado da operação Resolve.
    Prioriza IPv4 sobre IPv6.
    
    Args:
        result: String contendo IPs (pode ser XML ou texto simples, separados por vírgula)
    
    Returns:
        O primeiro IPv4 válido encontrado, ou None se não houver
    """
    if not result or not result.strip():
        return None
    
    result = result.strip()
    
    # Se for XML, extrair o conteúdo de texto
    if result.startswith('<'):
        try:
            # Extrair texto de dentro de tags XML usando regex simples
            # Remove todas as tags XML e pega o conteúdo
            text_content = re.sub(r'<[^>]+>', '', result).strip()
            result = text_content
        except Exception:
            pass
    
    # Dividir por vírgula e buscar IPs
    candidates = [ip.strip() for ip in result.split(',') if ip.strip()]
    
    # Primeiro, procurar por IPv4 válido
    for candidate in candidates:
        if is_valid_ipv4(candidate):
            return candidate
    
    # Se não encontrou IPv4, retornar o primeiro candidato (pode ser IPv6 ou hostname)
    return candidates[0] if candidates else None

# Função auxiliar para calcular mimetype
def get_file_mimetype(file_path: str) -> Optional[str]:
    """Calcula o mimetype de um arquivo usando libmagic ou por extensão"""
    if MAGIC_AVAILABLE:
        try:
            mime = magic.Magic(mime=True)
            return mime.from_file(file_path)
        except Exception as e:
            logging.warning(f"Erro ao calcular mimetype com libmagic: {e}")
    
    # Fallback: detectar por extensão
    import mimetypes
    mime_type, _ = mimetypes.guess_type(file_path)
    return mime_type


def parse_exec4_directory_listing(xml_result: str) -> List[dict]:
    """
    Parseia o resultado XML do Exec4 (listagem de diretório).
    Retorna lista de dicts com: type, name, size, modified, fullPath
    """
    import xml.etree.ElementTree as ET
    
    items = []
    if not xml_result or not xml_result.strip():
        return items
    
    try:
        root = ET.fromstring(xml_result)
        
        for result_elem in root.findall(".//Result"):
            # Verificar se é um erro de acesso negado
            message_elem = result_elem.find("message")
            if message_elem is not None and message_elem.text:
                msg_text = message_elem.text.lower()
                if "access" in msg_text and "denied" in msg_text:
                    continue
            
            item_type = result_elem.find("type")
            name = result_elem.find("name")
            length = result_elem.find("length")
            lastwritetime = result_elem.find("lastwritetime")
            fullname = result_elem.find("fullname")
            
            if name is not None and name.text:
                # Parsear o size como número
                size_value = 0
                if length is not None and length.text:
                    try:
                        size_value = int(length.text)
                    except (ValueError, TypeError):
                        size_value = 0
                
                item = {
                    "type": item_type.text if item_type is not None and item_type.text else "Unknown",
                    "name": name.text,
                    "size": size_value,
                    "modified": lastwritetime.text if lastwritetime is not None and lastwritetime.text else "",
                    "fullPath": fullname.text if fullname is not None and fullname.text else ""
                }
                items.append(item)
    except ET.ParseError as e:
        logging.warning(f"Erro ao parsear XML do Exec4: {e}")
    
    return items


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
    plugin_type: Optional[str] = "soap_api"
    plugin_config: Optional[dict] = None

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
    plugin_type: Optional[str] = "soap_api"
    plugin_config: Optional[dict] = None


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
    proxy_type: Optional[str] = "http"  # "http" or "socks5"
    username: Optional[str] = None
    password: Optional[str] = None

class ProxyServerResponse(BaseModel):
    id: int
    name: str
    ip: str
    port: int
    proxy_type: Optional[str] = "http"
    username: Optional[str] = None
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
    plugin_type: Optional[str] = "soap_api"
    plugin_config: Optional[dict] = None

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
    plugin_type: Optional[str] = "soap_api"
    plugin_config: Optional[dict] = None

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
    mimetype: Optional[str] = None
    downloaded_at: datetime

class FileVersionResponse(BaseModel):
    id: int
    version_number: int
    sha1_hash: str
    file_size: Optional[int]
    mimetype: Optional[str] = None
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


# Plugins API
@api_router.get("/plugins")
async def get_available_plugins():
    """Get list of available plugins"""
    from plugins.factory import PluginFactory
    return PluginFactory.get_available_plugins()


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
        
        # Retorna o resultado completo (lista de IPs) para Operações SOAP
        return {
            "operation": "Resolve",
            "result": result,  # Resultado completo com todos os IPs
            "from_cache": not request.ignore_cache
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@api_router.post("/soap/resolve-ipv4")
async def soap_resolve_ipv4(
    request: SoapOperationRequest,
    db: AsyncSession = Depends(get_db)
):
    """Resolve priorizando IPv4 - usado para adicionar servidores"""
    soap_service = await get_default_soap_service(db)
    params = {"s1": request.s1, "s2": request.s2}
    
    try:
        result = await soap_service.call_soap_operation(
            db, "Resolve", params, request.ignore_cache
        )
        
        # Extrair IPv4 prioritário do resultado
        ipv4_result = extract_ipv4_from_resolve_result(result)
        
        return {
            "operation": "Resolve",
            "result": ipv4_result or result,  # Retorna IPv4 se encontrado
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
    params = {"s1": request.s1, "s2": request.s2, "l1": 0, "l2": 0}
    
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
    """Retorna estatísticas do cache em arquivos"""
    cache_dir = Path(__file__).parent / "storage" / ".cache"
    
    stats = {
        "total_entries": 0,
        "total_size_bytes": 0,
        "operations": {}
    }
    
    if cache_dir.exists():
        for cache_file in cache_dir.glob("*.json"):
            try:
                stats["total_entries"] += 1
                stats["total_size_bytes"] += cache_file.stat().st_size
                
                with open(cache_file, 'r', encoding='utf-8') as f:
                    cache_data = json.load(f)
                    operation = cache_data.get('operation', 'unknown')
                    if operation not in stats["operations"]:
                        stats["operations"][operation] = 0
                    stats["operations"][operation] += 1
            except Exception:
                pass
    
    stats["total_size_formatted"] = format_size(stats["total_size_bytes"])
    return stats

@api_router.delete("/cache/clear")
async def clear_cache(db: AsyncSession = Depends(get_db)):
    """Limpa o cache de arquivos"""
    import shutil
    cache_dir = Path(__file__).parent / "storage" / ".cache"
    
    if cache_dir.exists():
        # Remover todos os arquivos de cache
        for cache_file in cache_dir.glob("*.json"):
            try:
                cache_file.unlink()
            except Exception as e:
                logging.warning(f"Erro ao remover arquivo de cache {cache_file}: {e}")
    
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
            
            # Extrair IPv4 prioritário do resultado
            ipv4_address = extract_ipv4_from_resolve_result(result_str)
            
            # Se retornou IP válido, atualiza
            if ipv4_address:
                server.ip = ipv4_address
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

# ==========================================
# DEPRECATED ENDPOINTS - Use API V2 (/api/v2/...)
# ==========================================

# Server Shares
@api_router.get("/servers/{server_id}/shares", response_model=List[ServerShareResponse], deprecated=True)
async def get_server_shares(
    server_id: int, 
    refresh: bool = False,
    db: AsyncSession = Depends(get_db)
):
    """
    [DEPRECATED] Use GET /api/v2/servers/{server_id}/shares
    
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


@api_router.get("/servers/{server_id}/shares-tree", deprecated=True)
async def get_server_shares_with_children(server_id: int, db: AsyncSession = Depends(get_db)):
    """
    [DEPRECATED] Use GET /api/v2/servers/{server_id}/shares-tree
    
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


@api_router.get("/servers/{server_id}/items", deprecated=True)
async def get_server_items_by_path(
    server_id: int, 
    parent_path: str,
    db: AsyncSession = Depends(get_db)
):
    """
    [DEPRECATED] Use GET /api/v2/servers/{server_id}/items
    
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


@api_router.post("/servers/{server_id}/browse", deprecated=True)
async def browse_server_directory(
    server_id: int,
    path: str,
    ignore_cache: bool = False,
    share_name: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """[DEPRECATED] Use POST /api/v2/servers/{server_id}/browse
    
    Lista arquivos e diretórios de um caminho no servidor"""
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
                    
                    # Atualizar status de acesso negado no banco
                    if share_name:
                        await update_directory_access_denied_status(
                            db, server.guid, share_name, path, message_elem.text
                        )
                    
                    continue
            
            item_type = result_elem.find("type")
            name = result_elem.find("name")
            length = result_elem.find("length")
            lastwritetime = result_elem.find("lastwritetime")
            fullname = result_elem.find("fullname")
            
            if name is not None:
                # Parsear o size como número (length vem como long do SOAP)
                size_value = 0
                if length is not None and length.text:
                    try:
                        size_value = int(length.text)
                    except (ValueError, TypeError):
                        size_value = 0
                
                item = {
                    "type": item_type.text if item_type is not None and item_type.text else "Unknown",
                    "name": name.text if name.text else "",
                    "size": size_value,
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


async def update_file_access_denied_status(db: AsyncSession, server_guid: str, share_name: str, file_path: str, error_message: str = None):
    """
    Atualiza o status de acesso negado para um ARQUIVO específico.
    Cria ou atualiza o item no banco de dados.
    """
    # Extrair o caminho do diretório pai
    parent_path = '\\'.join(file_path.rstrip('\\').split('\\')[:-1])
    file_name = file_path.rstrip('\\').split('\\')[-1]
    
    if not parent_path or not file_name:
        return
    
    # Verificar se o item já existe no banco
    result = await db.execute(
        select(ServerItem).where(
            ServerItem.server_guid == server_guid,
            ServerItem.full_path == file_path
        )
    )
    item = result.scalar_one_or_none()
    
    if item:
        # Atualizar item existente
        item.access_denied = True
        item.error_message = error_message or "Acesso negado"
    else:
        # Criar novo item para representar o arquivo com erro
        new_item = ServerItem(
            server_guid=server_guid,
            share_name=share_name,
            parent_path=parent_path,
            item_type="File",
            name=file_name,
            full_path=file_path,
            access_denied=True,
            error_message=error_message or "Acesso negado"
        )
        db.add(new_item)
    
    await db.commit()


async def update_directory_access_denied_status(db: AsyncSession, server_guid: str, share_name: str, dir_path: str, error_message: str = None):
    """
    Atualiza o status de acesso negado para uma PASTA ou SHARE.
    """
    # Verificar se é o nível raiz do share
    is_share_root = dir_path.rstrip('\\').endswith(share_name)
    
    if is_share_root:
        # Atualizar o share
        result = await db.execute(
            select(ServerShare).where(
                ServerShare.server_guid == server_guid,
                ServerShare.share_name == share_name
            )
        )
        share = result.scalar_one_or_none()
        if share:
            share.access_denied = True
            share.error_message = error_message or "Acesso negado"
            await db.commit()
    else:
        # Atualizar o item do diretório
        result = await db.execute(
            select(ServerItem).where(
                ServerItem.server_guid == server_guid,
                ServerItem.full_path == dir_path
            )
        )
        dir_item = result.scalar_one_or_none()
        if dir_item:
            dir_item.access_denied = True
            dir_item.error_message = error_message or "Acesso negado"
            await db.commit()


@api_router.post("/servers/{server_id}/clear-access-denied")
async def clear_access_denied_status(
    server_id: int,
    item_path: str = None,
    item_type: str = "file",  # "file", "directory", "share"
    share_id: int = None,  # ID do share (para evitar problemas com caracteres especiais)
    item_id: int = None,  # ID do item (ServerItem)
    db: AsyncSession = Depends(get_db)
):
    """
    Limpa o status de acesso negado de um item (arquivo, pasta ou share).
    Permite re-testar o acesso.
    Usa IDs ao invés de nomes para evitar problemas com caracteres especiais.
    """
    # Obter servidor
    result = await db.execute(select(Server).where(Server.id == server_id))
    server = result.scalar_one_or_none()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    
    if item_type == "share" and share_id:
        # Limpar status do share pelo ID
        result = await db.execute(
            select(ServerShare).where(
                ServerShare.server_guid == server.guid,
                ServerShare.id == share_id
            )
        )
        share = result.scalar_one_or_none()
        if share:
            share.access_denied = False
            share.error_message = None
            share.children_fetched = False  # Permitir re-fetch
            await db.commit()
            return {"success": True, "message": "Status de acesso do share limpo", "share_name": share.share_name}
    elif item_id:
        # Limpar status de arquivo ou diretório pelo ID
        result = await db.execute(
            select(ServerItem).where(
                ServerItem.server_guid == server.guid,
                ServerItem.id == item_id
            )
        )
        item = result.scalar_one_or_none()
        if item:
            item.access_denied = False
            item.error_message = None
            item.children_fetched = False  # Permitir re-fetch
            await db.commit()
            return {"success": True, "message": "Status de acesso do item limpo", "full_path": item.full_path}
    elif item_path:
        # Fallback: buscar pelo path
        result = await db.execute(
            select(ServerItem).where(
                ServerItem.server_guid == server.guid,
                ServerItem.full_path == item_path
            )
        )
        item = result.scalar_one_or_none()
        if item:
            item.access_denied = False
            item.error_message = None
            item.children_fetched = False
            await db.commit()
            return {"success": True, "message": "Status de acesso do item limpo", "full_path": item.full_path}
    
    return {"success": False, "message": "Item não encontrado"}


@api_router.post("/servers/{server_id}/download", deprecated=True)
async def download_server_file(
    server_id: int,
    file_path: str,
    share_name: str,
    expected_size: int = 0,  # Tamanho esperado do arquivo (opcional)
    body: dict = None,  # Body com content_base64 para chunked upload
    db: AsyncSession = Depends(get_db)
):
    """[DEPRECATED] Use POST /api/v2/servers/{server_id}/download
    
    Baixa um arquivo do servidor via SOAP com versionamento"""
    # Obter servidor
    result = await db.execute(select(Server).where(Server.id == server_id))
    server = result.scalar_one_or_none()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    
    # Verificar se recebeu content_base64 do body (chunked upload)
    content_base64_from_body = body.get("content_base64") if body else None
    
    if content_base64_from_body:
        # Usar conteúdo já baixado em chunks
        content_base64 = content_base64_from_body
    else:
        # Chamar SOAP Exec5 (sempre passar l1=0 e l2=0 para download completo)
        soap_service = await get_default_soap_service(db)
        params = {"s1": file_path, "s2": "", "l1": 0, "l2": 0}
        
        try:
            result_str = await soap_service.call_soap_operation(db, "Exec5", params, False)
            
            # Função para verificar se é mensagem de erro e atualizar o DB
            async def check_download_error_and_update(text):
                if not text:
                    return
                text_lower = text.lower()
                if 'is denied' in text_lower or ('access' in text_lower and 'denied' in text_lower):
                    # Atualizar status no banco antes de lançar exceção
                    await update_file_access_denied_status(db, server.guid, share_name, file_path, "Acesso negado ao arquivo")
                    raise HTTPException(status_code=403, detail="Acesso negado ao arquivo")
                elif 'could not find' in text_lower or ('not found' in text_lower and 'file' in text_lower):
                    raise HTTPException(status_code=404, detail="Arquivo não encontrado")
                elif 'at System.' in text:
                    # Erro genérico do .NET - stack trace
                    error_line = text.split('\n')[0] if '\n' in text else text[:200]
                    raise HTTPException(status_code=500, detail=f"Erro no servidor: {error_line}")
            
            # Verificar erro no texto bruto primeiro
            await check_download_error_and_update(result_str)
            
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
                    result_text = exec5_result.text.strip()
                    
                    # Verificar se é mensagem de erro
                    await check_download_error_and_update(result_text)
                    
                    content_base64 = result_text
                else:
                    fallback_text = root.text.strip() if root.text else ""
                    await check_download_error_and_update(fallback_text)
                    content_base64 = fallback_text
                    
            except HTTPException:
                raise  # Re-raise HTTPException
            except ET.ParseError:
                content_base64 = result_str.strip()
        except HTTPException:
            raise  # Re-raise HTTPException
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
    
    # Processar o conteúdo (comum para ambos os casos)
    try:
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
                if content_base64:
                    full_path, sanitized_path, sha1_hash, file_size = save_downloaded_file(
                        server.guid,
                        share_name,
                        file_path,
                        content_base64,
                        new_version_number
                    )
                else:
                    # Arquivo vazio
                    full_path, sanitized_path, sha1_hash, file_size = save_empty_file(
                        server.guid,
                        share_name,
                        file_path,
                        new_version_number
                    )
                
                # Calcular mimetype
                mimetype = get_file_mimetype(full_path)
                
                # Criar nova versão no banco
                new_file_version = FileVersion(
                    server_guid=server.guid,
                    share_name=share_name,
                    file_path=file_path,
                    version_number=new_version_number,
                    sha1_hash=sha1_hash,
                    file_size=file_size,
                    mimetype=mimetype,
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
                    downloaded_file.mimetype = mimetype
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
            if content_base64:
                full_path, sanitized_path, sha1_hash, file_size = save_downloaded_file(
                    server.guid,
                    share_name,
                    file_path,
                    content_base64,
                    1
                )
            else:
                # Arquivo vazio
                full_path, sanitized_path, sha1_hash, file_size = save_empty_file(
                    server.guid,
                    share_name,
                    file_path,
                    1
                )
            
            # Calcular mimetype
            mimetype = get_file_mimetype(full_path)
            
            # Criar primeira versão
            new_file_version = FileVersion(
                server_guid=server.guid,
                share_name=share_name,
                file_path=file_path,
                version_number=1,
                sha1_hash=sha1_hash,
                file_size=file_size,
                mimetype=mimetype,
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
                sha1_hash=sha1_hash,
                mimetype=mimetype
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


@api_router.post("/servers/{server_id}/download-chunk", deprecated=True)
async def download_server_file_chunk(
    server_id: int,
    file_path: str,
    share_name: str,
    offset: int = 0,
    chunk_size: int = 512000,  # 512KB default
    db: AsyncSession = Depends(get_db)
):
    """[DEPRECATED] Use POST /api/v2/servers/{server_id}/download-chunk
    
    Baixa um chunk de arquivo do servidor via SOAP Exec5 com offset e tamanho"""
    # Obter servidor
    result = await db.execute(select(Server).where(Server.id == server_id))
    server = result.scalar_one_or_none()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    
    # Chamar SOAP Exec5 com offset (l1) e tamanho (l2)
    soap_service = await get_default_soap_service(db)
    params = {"s1": file_path, "s2": "", "l1": offset, "l2": chunk_size}
    
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
            
            # Função para verificar se é mensagem de erro e atualizar DB
            async def check_error_message_and_update(text):
                if not text:
                    return
                text_lower = text.lower()
                if 'is denied' in text_lower or ('access' in text_lower and 'denied' in text_lower):
                    # Atualizar status no banco antes de lançar exceção
                    await update_file_access_denied_status(db, server.guid, share_name, file_path, "Acesso negado ao arquivo")
                    raise HTTPException(status_code=403, detail="Acesso negado ao arquivo")
                elif 'could not find' in text_lower or ('not found' in text_lower and 'file' in text_lower):
                    raise HTTPException(status_code=404, detail="Arquivo não encontrado")
                elif 'at System.' in text:
                    # Erro genérico do .NET - stack trace
                    error_line = text.split('\n')[0] if '\n' in text else text[:200]
                    raise HTTPException(status_code=500, detail=f"Erro no servidor: {error_line}")
            
            # Verificar também o texto bruto do resultado para erros
            await check_error_message_and_update(result_str)
            
            if exec5_result is not None and exec5_result.text:
                result_text = exec5_result.text.strip()
                
                # Verificar erro ANTES de decodificar (erro vem em texto claro)
                await check_error_message_and_update(result_text)
                
                content_base64 = result_text
            else:
                # Tentar extrair texto de qualquer elemento filho ou do root
                fallback_text = root.text.strip() if root.text else ""
                await check_error_message_and_update(fallback_text)
                content_base64 = fallback_text
                
        except HTTPException:
            raise  # Re-raise HTTPException
        except ET.ParseError:
            content_base64 = result_str.strip()
        
        # Tentar decodificar base64
        import base64
        try:
            chunk_data = base64.b64decode(content_base64) if content_base64 else b""
            
            # Verificar erro DEPOIS de decodificar (caso o conteúdo decodificado seja texto de erro)
            if chunk_data:
                try:
                    decoded_text = chunk_data.decode('utf-8', errors='ignore')
                    if 'is denied' in decoded_text.lower() or 'at System.' in decoded_text:
                        # É uma mensagem de erro, não conteúdo válido
                        if 'denied' in decoded_text.lower():
                            await update_file_access_denied_status(db, server.guid, share_name, file_path, "Acesso negado ao arquivo")
                            raise HTTPException(status_code=403, detail="Acesso negado ao arquivo")
                        else:
                            error_line = decoded_text.split('\n')[0] if '\n' in decoded_text else decoded_text[:200]
                            raise HTTPException(status_code=500, detail=f"Erro no servidor: {error_line}")
                except UnicodeDecodeError:
                    pass  # Conteúdo binário válido
        except HTTPException:
            raise
        except Exception:
            # Se falhar o decode base64, pode ser mensagem de erro em texto claro
            if 'denied' in content_base64.lower() or 'at System.' in content_base64:
                if 'denied' in content_base64.lower():
                    await update_file_access_denied_status(db, server.guid, share_name, file_path, "Acesso negado ao arquivo")
                    raise HTTPException(status_code=403, detail="Acesso negado ao arquivo")
                else:
                    error_line = content_base64.split('\n')[0] if '\n' in content_base64 else content_base64[:200]
                    raise HTTPException(status_code=500, detail=f"Erro no servidor: {error_line}")
            chunk_data = b""
        
        actual_chunk_size = len(chunk_data)
        
        # É último chunk se: recebeu menos bytes que o solicitado OU recebeu 0 bytes
        is_last = actual_chunk_size < chunk_size or actual_chunk_size == 0
        
        return {
            "success": True,
            "offset": offset,
            "chunk_size": actual_chunk_size,
            "content_base64": content_base64,
            "is_last_chunk": is_last
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
    
    # Verificar se sanitized_path existe
    sanitized_path = downloaded.sanitized_path
    if not sanitized_path:
        # Gerar sanitized_path dinamicamente se não existir no registro
        # Isso pode acontecer com registros antigos
        from storage_utils import sanitize_path_component
        
        # Sanitizar o file_path
        path_to_sanitize = file_path
        # Remover prefixo UNC se existir
        if path_to_sanitize.startswith('\\\\'):
            parts = path_to_sanitize.split('\\')
            if len(parts) > 4:
                path_to_sanitize = '\\'.join(parts[4:])
            else:
                path_to_sanitize = parts[-1] if parts else 'unknown_file'
        
        # Converter barras e sanitizar
        sanitized_path = path_to_sanitize.replace('\\', '/').lstrip('/')
        sanitized_path = sanitized_path.replace('$', '_').replace(':', '_')
        
        import logging
        logging.warning(f"Generated sanitized_path for file_path={file_path}: {sanitized_path}")
    
    # Ler o conteúdo do arquivo
    from storage_utils import get_file_path
    full_path = get_file_path(server.guid, share_name, sanitized_path)
    
    import logging
    logging.info(f"get_file_content: file_path={file_path}, sanitized_path={sanitized_path}, full_path={full_path}")
    
    try:
        import os
        if not os.path.exists(full_path):
            raise HTTPException(status_code=404, detail=f"Arquivo não encontrado no storage: {full_path}")
        
        # Ler arquivo em modo binário primeiro para detectar BOM
        with open(full_path, 'rb') as f:
            raw_content = f.read()
        
        # Detectar e remover BOM UTF-8 se presente
        has_bom = False
        if raw_content.startswith(b'\xef\xbb\xbf'):
            has_bom = True
            raw_content = raw_content[3:]  # Remover BOM
        
        # Decodificar como UTF-8
        try:
            content = raw_content.decode('utf-8')
        except UnicodeDecodeError:
            # Tentar outras codificações comuns
            try:
                content = raw_content.decode('latin-1')
            except UnicodeDecodeError:
                content = raw_content.decode('utf-8', errors='replace')
        
        return {
            "success": True,
            "content": content,
            "file_path": file_path,
            "size": len(content),
            "has_bom": has_bom,
            "encoding": "UTF-8 with BOM" if has_bom else "UTF-8"
        }
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        logging.error(f"Error reading file {full_path}: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Erro ao ler arquivo: {str(e)}")


class CertificateInfoRequest(BaseModel):
    file_path: str
    share_name: str
    password: str = None


@api_router.post("/servers/{server_id}/certificate-info")
async def get_certificate_info(
    server_id: int,
    request: CertificateInfoRequest,
    db: AsyncSession = Depends(get_db)
):
    """Retorna informações detalhadas de um certificado digital"""
    from cryptography import x509
    from cryptography.hazmat.primitives import serialization, hashes
    from cryptography.hazmat.backends import default_backend
    from cryptography.hazmat.primitives.serialization import pkcs12
    import os
    
    file_path = request.file_path
    share_name = request.share_name
    password = request.password
    
    # Debug: verificar valor real da senha
    print(f"DEBUG password: repr={repr(password)}, type={type(password)}, bool={bool(password)}")
    
    # Obter servidor
    result = await db.execute(select(Server).where(Server.id == server_id))
    server = result.scalar_one_or_none()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    
    # Buscar arquivo baixado
    result = await db.execute(
        select(DownloadedFile).where(
            DownloadedFile.server_guid == server.guid,
            DownloadedFile.file_path == file_path
        ).order_by(DownloadedFile.downloaded_at.desc())
    )
    downloaded = result.scalar_one_or_none()
    if not downloaded:
        raise HTTPException(status_code=404, detail="Arquivo não sincronizado")
    
    from storage_utils import get_file_path
    full_path = get_file_path(server.guid, share_name, downloaded.sanitized_path)
    
    if not os.path.exists(full_path):
        raise HTTPException(status_code=404, detail="Arquivo não encontrado no storage")
    
    # Ler arquivo
    with open(full_path, 'rb') as f:
        cert_data = f.read()
    
    ext = file_path.lower().split('.')[-1]
    certificates = []
    private_key = None  # Inicializar para evitar erro em arquivos não-PFX
    private_key_info = None
    used_password = None
    
    try:
        # PFX/P12 - Certificado com chave privada
        if ext in ['pfx', 'p12']:
            
            # Função auxiliar para tentar abrir PFX com senha
            def try_open_pfx(pwd_str, context=""):
                print(f"DEBUG try_open_pfx CALLED: context={context}, pwd_str={repr(pwd_str)}")
                pwd_display = "None" if pwd_str is None else ("empty" if pwd_str == "" else f"***({len(pwd_str)} chars)")
                try:
                    pwd = pwd_str.encode() if pwd_str else None
                    print(f"DEBUG try_open_pfx: calling load_key_and_certificates with pwd={'None' if pwd is None else '***'}")
                    pk, cert, additional = pkcs12.load_key_and_certificates(
                        cert_data, pwd, default_backend()
                    )
                    print(f"DEBUG try_open_pfx: pk={pk is not None}, cert={cert is not None}, additional={additional is not None and len(additional) if additional else 0}")
                    
                    # Verificar se temos pelo menos um certificado (principal ou additional)
                    has_any_cert = cert is not None or (additional and len(additional) > 0)
                    
                    if has_any_cert:
                        # Para log, mostrar o CN do certificado principal ou do primeiro additional
                        log_cert = cert if cert else (additional[0] if additional else None)
                        subject_cn = None
                        if log_cert:
                            for attr in log_cert.subject:
                                if attr.oid._name == 'commonName':
                                    subject_cn = attr.value
                                    break
                        print(f"PFX SUCCESS [{context}]: password={pwd_display}, CN={subject_cn}, main_cert={cert is not None}, additional={len(additional) if additional else 0}")
                        return pk, cert, additional, pwd_str
                    else:
                        print(f"PFX FAILED [{context}]: password={pwd_display}, error=Nenhum certificado encontrado no arquivo")
                        return None, None, None, None
                except Exception as e:
                    error_msg = str(e)
                    print(f"DEBUG try_open_pfx: exception caught: {error_msg[:100]}")
                    # Simplificar mensagem de erro comum
                    if "mac verify failure" in error_msg.lower() or "bad decrypt" in error_msg.lower():
                        print(f"PFX FAILED [{context}]: password={pwd_display}, error=Senha incorreta")
                    else:
                        print(f"PFX FAILED [{context}]: password={pwd_display}, error={error_msg[:100]}")
                    return None, None, None, None
            
            # 1. Primeiro, verificar se já temos a senha salva para este arquivo
            existing_pwd = await db.execute(
                select(PfxPassword).where(
                    PfxPassword.server_guid == server.guid,
                    PfxPassword.file_path == file_path
                )
            )
            existing_pwd = existing_pwd.scalar_one_or_none()
            
            private_key = None
            certificate = None
            additional_certs = None
            
            print(f"PFX OPEN: file={file_path}, user_password={'Yes' if password and len(str(password)) > 0 else 'No'}, saved_password={'Yes' if existing_pwd else 'No'}")
            
            # 0. Primeiro, tentar sem senha (alguns PFX não têm senha)
            if not certificate:
                private_key, certificate, additional_certs, used_password = try_open_pfx(None, "no-password")
                if certificate:
                    used_password = ""  # Sem senha
            
            # 1. Se não funcionou, tentar senha salva
            if not certificate and existing_pwd:
                private_key, certificate, additional_certs, used_password = try_open_pfx(existing_pwd.password, "saved-password")
            
            # 2. Se não funcionou e uma senha foi fornecida, tentar essa
            print(f"DEBUG user-password check: certificate={certificate}, password={repr(password)}, len_check={len(str(password)) if password else 0}")
            print(f"DEBUG conditions: not_cert={not certificate}, has_pwd={bool(password)}, len_ok={len(str(password)) > 0 if password else False}")
            if not certificate and password and len(str(password)) > 0:
                print("DEBUG: Entering user-provided password block")
                private_key, certificate, additional_certs, used_password = try_open_pfx(password, "user-provided")
                
                # Se funcionou, salvar a senha
                if certificate:
                    subject_cn = None
                    for attr in certificate.subject:
                        if attr.oid._name == 'commonName':
                            subject_cn = attr.value
                            break
                    
                    if existing_pwd:
                        existing_pwd.password = password
                        existing_pwd.subject_cn = subject_cn
                    else:
                        new_pwd = PfxPassword(
                            server_guid=server.guid,
                            file_path=file_path,
                            password=password,
                            subject_cn=subject_cn
                        )
                        db.add(new_pwd)
                    await db.commit()
            
            # 3. Se não funcionou, tentar brute-force com senhas conhecidas
            has_any_cert = certificate is not None or (additional_certs and len(additional_certs) > 0)
            if not has_any_cert:
                known_passwords = await db.execute(
                    select(PfxPassword.password).where(
                        PfxPassword.server_guid == server.guid
                    ).distinct()
                )
                known_passwords = [p[0] for p in known_passwords.fetchall()]
                
                print(f"PFX BRUTEFORCE: trying {len(known_passwords)} known passwords")
                for idx, known_pwd in enumerate(known_passwords):
                    private_key, certificate, additional_certs, used_password = try_open_pfx(known_pwd, f"bruteforce-{idx+1}")
                    has_any_cert = certificate is not None or (additional_certs and len(additional_certs) > 0)
                    if has_any_cert:
                        # Salvar a senha que funcionou
                        log_cert = certificate if certificate else additional_certs[0]
                        subject_cn = None
                        for attr in log_cert.subject:
                            if attr.oid._name == 'commonName':
                                subject_cn = attr.value
                                break
                        
                        if existing_pwd:
                            existing_pwd.password = known_pwd
                            existing_pwd.subject_cn = subject_cn
                        else:
                            new_pwd = PfxPassword(
                                server_guid=server.guid,
                                file_path=file_path,
                                password=known_pwd,
                                subject_cn=subject_cn
                            )
                            db.add(new_pwd)
                        await db.commit()
                        break
            
            # 4. Se ainda não funcionou, pedir senha
            has_any_cert = certificate is not None or (additional_certs and len(additional_certs) > 0)
            if not has_any_cert:
                # Buscar senhas conhecidas para sugestão
                known_passwords = await db.execute(
                    select(PfxPassword.password, PfxPassword.subject_cn).where(
                        PfxPassword.server_guid == server.guid
                    ).distinct()
                )
                known_list = [{"password": p[0], "subject_cn": p[1]} for p in known_passwords.fetchall()]
                
                return {
                    "type": "pfx",
                    "error": "Certificado protegido por senha",
                    "requires_password": True,
                    "message": "Forneça a senha para visualizar o certificado",
                    "known_passwords": len(known_list),
                    "file_path": file_path
                }
            
            # Adicionar certificado principal (se existir)
            if certificate:
                certificates.append(certificate)
            # Adicionar certificados adicionais (se existirem)
            if additional_certs:
                certificates.extend(additional_certs)
            
            if private_key:
                private_key_info = {
                    "has_private_key": True,
                    "key_type": type(private_key).__name__,
                    "key_size": getattr(private_key, 'key_size', None)
                }
        
        # PEM - Pode conter múltiplos certificados
        elif ext in ['pem', 'crt', 'cer']:
            # Tentar como PEM primeiro
            try:
                # Verificar se é PEM (texto)
                if b'-----BEGIN' in cert_data:
                    # Extrair todos os certificados PEM
                    pem_certs = []
                    current_cert = []
                    in_cert = False
                    
                    for line in cert_data.decode('utf-8', errors='replace').split('\n'):
                        if '-----BEGIN CERTIFICATE-----' in line:
                            in_cert = True
                            current_cert = [line]
                        elif '-----END CERTIFICATE-----' in line:
                            current_cert.append(line)
                            pem_certs.append('\n'.join(current_cert))
                            in_cert = False
                            current_cert = []
                        elif in_cert:
                            current_cert.append(line)
                    
                    for pem_cert in pem_certs:
                        cert = x509.load_pem_x509_certificate(pem_cert.encode(), default_backend())
                        certificates.append(cert)
                else:
                    # Tentar como DER
                    cert = x509.load_der_x509_certificate(cert_data, default_backend())
                    certificates.append(cert)
            except Exception:
                # Tentar como DER
                cert = x509.load_der_x509_certificate(cert_data, default_backend())
                certificates.append(cert)
        
        # DER - Certificado binário
        elif ext == 'der':
            cert = x509.load_der_x509_certificate(cert_data, default_backend())
            certificates.append(cert)
        
        # P7B/P7C - PKCS#7 (cadeia de certificados)
        elif ext in ['p7b', 'p7c']:
            from cryptography.hazmat.primitives.serialization import pkcs7
            try:
                certs = pkcs7.load_pem_pkcs7_certificates(cert_data)
            except Exception:
                certs = pkcs7.load_der_pkcs7_certificates(cert_data)
            certificates.extend(certs)
        
        # Extrair informações dos certificados
        cert_infos = []
        private_key_cert_index = None  # Índice do certificado que possui a chave privada
        
        # Se temos uma chave privada, identificar qual certificado corresponde
        if private_key:
            try:
                # Obter a chave pública da chave privada
                private_key_public = private_key.public_key()
                private_key_public_bytes = private_key_public.public_bytes(
                    encoding=serialization.Encoding.PEM,
                    format=serialization.PublicFormat.SubjectPublicKeyInfo
                )
                
                # Comparar com cada certificado
                for i, cert in enumerate(certificates):
                    try:
                        cert_public_bytes = cert.public_key().public_bytes(
                            encoding=serialization.Encoding.PEM,
                            format=serialization.PublicFormat.SubjectPublicKeyInfo
                        )
                        if cert_public_bytes == private_key_public_bytes:
                            private_key_cert_index = i
                            print(f"DEBUG: Private key matches certificate index {i}")
                            break
                    except Exception as e:
                        print(f"DEBUG: Error comparing cert {i}: {e}")
                        continue
            except Exception as e:
                print(f"DEBUG: Error getting private key public: {e}")
        
        for i, cert in enumerate(certificates):
            # Extrair Subject
            subject_parts = {}
            for attr in cert.subject:
                name = attr.oid._name
                subject_parts[name] = attr.value
            
            # Extrair Issuer
            issuer_parts = {}
            for attr in cert.issuer:
                name = attr.oid._name
                issuer_parts[name] = attr.value
            
            # Extrair extensões
            extensions = []
            for ext_obj in cert.extensions:
                ext_info = {
                    "name": ext_obj.oid._name,
                    "critical": ext_obj.critical
                }
                
                # Processar algumas extensões conhecidas
                try:
                    if ext_obj.oid._name == 'subjectAltName':
                        san_values = []
                        for name in ext_obj.value:
                            san_values.append(f"{type(name).__name__}: {name.value}")
                        ext_info["values"] = san_values
                    elif ext_obj.oid._name == 'keyUsage':
                        usages = []
                        ku = ext_obj.value
                        if ku.digital_signature:
                            usages.append("Digital Signature")
                        if ku.key_encipherment:
                            usages.append("Key Encipherment")
                        if ku.content_commitment:
                            usages.append("Content Commitment")
                        if ku.data_encipherment:
                            usages.append("Data Encipherment")
                        if ku.key_agreement:
                            usages.append("Key Agreement")
                        if ku.key_cert_sign:
                            usages.append("Key Cert Sign")
                        if ku.crl_sign:
                            usages.append("CRL Sign")
                        ext_info["values"] = usages
                    elif ext_obj.oid._name == 'extendedKeyUsage':
                        eku_values = [oid._name for oid in ext_obj.value]
                        ext_info["values"] = eku_values
                    elif ext_obj.oid._name == 'basicConstraints':
                        bc = ext_obj.value
                        ext_info["values"] = {
                            "ca": bc.ca,
                            "path_length": bc.path_length
                        }
                except Exception:
                    ext_info["values"] = str(ext_obj.value)
                
                extensions.append(ext_info)
            
            # Informações da chave pública
            public_key = cert.public_key()
            public_key_info = {
                "algorithm": type(public_key).__name__,
                "key_size": getattr(public_key, 'key_size', None)
            }
            
            cert_info = {
                "index": i + 1,
                "has_private_key": i == private_key_cert_index,  # Indica se este certificado possui a chave privada
                "version": cert.version.name,
                "serial_number": format(cert.serial_number, 'X'),
                "serial_number_decimal": str(cert.serial_number),
                "subject": subject_parts,
                "subject_str": cert.subject.rfc4514_string(),
                "issuer": issuer_parts,
                "issuer_str": cert.issuer.rfc4514_string(),
                "not_valid_before": cert.not_valid_before_utc.isoformat(),
                "not_valid_after": cert.not_valid_after_utc.isoformat(),
                "is_expired": datetime.now(timezone.utc) > cert.not_valid_after_utc,
                "days_until_expiry": (cert.not_valid_after_utc - datetime.now(timezone.utc)).days,
                "is_self_signed": cert.subject == cert.issuer,
                "signature_algorithm": cert.signature_algorithm_oid._name,
                "public_key": public_key_info,
                "extensions": extensions,
                "fingerprint_sha1": cert.fingerprint(hashes.SHA1()).hex(':').upper(),
                "fingerprint_sha256": cert.fingerprint(hashes.SHA256()).hex(':').upper()
            }
            
            cert_infos.append(cert_info)
        
        # Ordenar certificados: primeiro os que têm chave privada
        cert_infos_sorted = sorted(cert_infos, key=lambda x: (not x.get('has_private_key', False), x.get('index', 0)))
        
        # Reindexar após ordenação
        for i, cert in enumerate(cert_infos_sorted):
            cert['index'] = i + 1
        
        result = {
            "type": ext,
            "file_path": file_path,
            "total_certificates": len(cert_infos_sorted),
            "private_key": private_key_info,
            "certificates": cert_infos_sorted
        }
        
        # Incluir senha usada se for PFX
        if used_password is not None:
            result["password_used"] = used_password
        
        return result
        
    except Exception as e:
        return {
            "type": ext,
            "error": str(e),
            "file_path": file_path
        }


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


# ==================== DOWNLOAD JOBS ENDPOINTS ====================

@api_router.get("/downloads")
async def get_download_jobs(db: AsyncSession = Depends(get_db)):
    """Lista todos os jobs de download"""
    result = await db.execute(
        select(DownloadJob).order_by(desc(DownloadJob.created_at))
    )
    jobs = result.scalars().all()
    
    return [
        {
            "id": job.id,
            "server_id": job.server_id,
            "server_name": job.server_name,
            "server_ip": job.server_ip,
            "share_name": job.share_name,
            "file_path": job.file_path,
            "file_name": job.file_name,
            "file_size": job.file_size,
            "downloaded_bytes": job.downloaded_bytes,
            "total_bytes": job.total_bytes,
            "progress": job.progress,
            "status": job.status,
            "error_message": job.error_message,
            "skip_reason": job.skip_reason,
            "priority": job.priority,
            "max_file_size_bytes": job.max_file_size_bytes,
            "max_depth": job.max_depth,
            "is_directory": job.is_directory,
            "created_at": job.created_at.isoformat() if job.created_at else None,
            "started_at": job.started_at.isoformat() if job.started_at else None,
            "completed_at": job.completed_at.isoformat() if job.completed_at else None,
        }
        for job in jobs
    ]


class CheckQueueRequest(BaseModel):
    server_id: int
    share_name: str
    file_path: str


@api_router.post("/downloads/check-queue")
async def check_file_in_queue(
    request: CheckQueueRequest,
    db: AsyncSession = Depends(get_db)
):
    """Verifica se um arquivo já está na fila de downloads"""
    result = await db.execute(
        select(DownloadJob).where(
            DownloadJob.server_id == request.server_id,
            DownloadJob.file_path == request.file_path,
            DownloadJob.status.in_(['pending', 'downloading'])
        )
    )
    existing_job = result.scalar_one_or_none()
    
    if existing_job:
        return {
            "in_queue": True,
            "job_id": existing_job.id,
            "status": existing_job.status
        }
    
    return {"in_queue": False}


class CreateDownloadJobRequest(BaseModel):
    server_id: int
    share_name: str
    file_path: str
    file_name: Optional[str] = None
    file_size: Optional[int] = None
    priority: int = 0
    force: bool = False  # Forçar download mesmo se exceder limite de tamanho
    max_file_size_bytes: Optional[int] = None  # Limite de tamanho (null = sem limite)
    max_depth: Optional[int] = None  # Limite de profundidade para diretórios
    is_directory: bool = False  # Se é um diretório


@api_router.post("/downloads")
async def create_download_job(
    request: CreateDownloadJobRequest,
    db: AsyncSession = Depends(get_db)
):
    """Cria um novo job de download"""
    # Obter informações do servidor
    result = await db.execute(select(Server).where(Server.id == request.server_id))
    server = result.scalar_one_or_none()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    
    # Verificar se já existe um job para este arquivo
    existing = await db.execute(
        select(DownloadJob).where(
            DownloadJob.server_id == request.server_id,
            DownloadJob.file_path == request.file_path,
            DownloadJob.status.in_(['pending', 'downloading'])
        )
    )
    existing_job = existing.scalar_one_or_none()
    if existing_job:
        status_msg = "pendente" if existing_job.status == 'pending' else "em download"
        raise HTTPException(
            status_code=400, 
            detail=f"Este arquivo já está na fila de downloads ({status_msg})"
        )
    
    # Extrair nome do arquivo do path
    file_name = request.file_name or request.file_path.split('\\')[-1]
    
    # Verificar se deve ser ignorado por tamanho
    status = 'pending'
    skip_reason = None
    if not request.force and request.max_file_size_bytes and request.file_size:
        if request.file_size > request.max_file_size_bytes:
            status = 'skipped'
            skip_reason = f"Arquivo excede limite de {request.max_file_size_bytes / (1024*1024):.1f}MB"
    
    # Criar o job
    job = DownloadJob(
        server_id=request.server_id,
        server_name=server.name,
        server_ip=server.ip,
        share_name=request.share_name,
        file_path=request.file_path,
        file_name=file_name,
        file_size=request.file_size,
        priority=request.priority,
        status=status,
        skip_reason=skip_reason,
        max_file_size_bytes=request.max_file_size_bytes,
        max_depth=request.max_depth,
        is_directory=request.is_directory
    )
    
    db.add(job)
    await db.commit()
    await db.refresh(job)
    
    return {"success": True, "job_id": job.id, "status": status}


class CreateBatchDownloadRequest(BaseModel):
    server_id: int
    share_name: str
    files: List[dict]  # Lista de {file_path, file_name, file_size}
    max_file_size_bytes: Optional[int] = None  # Limite de tamanho por arquivo
    max_depth: Optional[int] = None  # Limite de profundidade
    apply_filters: bool = True  # Se False, ignora filtros de tamanho e extensão


async def get_ignored_extensions(db: AsyncSession) -> List[str]:
    """Obtém a lista de extensões ignoradas das configurações"""
    result = await db.execute(select(AppSettings).where(AppSettings.key == 'ignored_extensions'))
    setting = result.scalar_one_or_none()
    if setting and setting.value:
        return [ext.strip().lower() for ext in setting.value.split(',') if ext.strip()]
    return []


def should_skip_by_extension(file_name: str, ignored_extensions: List[str]) -> bool:
    """Verifica se o arquivo deve ser ignorado pela extensão"""
    if not ignored_extensions:
        return False
    file_lower = file_name.lower()
    for ext in ignored_extensions:
        if file_lower.endswith(ext):
            return True
    return False


@api_router.post("/downloads/batch")
async def create_batch_download_jobs(
    request: CreateBatchDownloadRequest,
    db: AsyncSession = Depends(get_db)
):
    """Cria múltiplos jobs de download em lote"""
    from sqlalchemy.orm import Session
    
    # Obter informações do servidor
    result = await db.execute(select(Server).where(Server.id == request.server_id))
    server = result.scalar_one_or_none()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    
    # Obter extensões ignoradas (apenas se aplicar filtros)
    ignored_extensions = []
    if request.apply_filters:
        ignored_extensions = await get_ignored_extensions(db)
    
    created = 0
    skipped = 0
    skipped_by_extension = 0
    
    jobs_to_add = []
    
    for file_info in request.files:
        file_path = file_info.get('file_path') or file_info.get('fullPath') or file_info.get('path')
        file_name = file_info.get('file_name') or file_info.get('name') or (file_path.split('\\')[-1] if file_path else None)
        file_size = file_info.get('file_size') or file_info.get('size')
        
        # Validar que file_path existe
        if not file_path:
            skipped += 1
            continue
        
        # Verificar se já existe
        existing = await db.execute(
            select(DownloadJob).where(
                DownloadJob.server_id == request.server_id,
                DownloadJob.file_path == file_path,
                DownloadJob.status.in_(['pending', 'downloading'])
            )
        )
        if existing.scalar_one_or_none():
            skipped += 1
            continue
        
        # Verificar extensão ignorada (apenas se aplicar filtros)
        if request.apply_filters and should_skip_by_extension(file_name, ignored_extensions):
            skipped_by_extension += 1
            continue
        
        # Verificar tamanho máximo (apenas se aplicar filtros)
        status = 'pending'
        skip_reason = None
        if request.apply_filters and request.max_file_size_bytes and file_size and file_size > request.max_file_size_bytes:
            status = 'skipped'
            skip_reason = f"Arquivo excede limite de {request.max_file_size_bytes / (1024*1024):.1f}MB"
        
        job = DownloadJob(
            server_id=request.server_id,
            server_name=server.name,
            server_ip=server.ip,
            share_name=request.share_name,
            file_path=file_path,
            file_name=file_name,
            file_size=file_size,
            status=status,
            skip_reason=skip_reason,
            max_file_size_bytes=request.max_file_size_bytes,
            max_depth=request.max_depth
        )
        jobs_to_add.append(job)
        created += 1
    
    # Adicionar todos os jobs de uma vez
    for job in jobs_to_add:
        db.add(job)
    
    await db.commit()
    
    return {
        "success": True, 
        "created": created, 
        "skipped": skipped,
        "skipped_by_extension": skipped_by_extension
    }


class ScanDirectoryRequest(BaseModel):
    server_id: int
    share_name: str
    path: str
    max_depth: Optional[int] = 5
    max_file_size_bytes: Optional[int] = None
    apply_filters: bool = True  # Se False, ignora filtros de tamanho e extensão


@api_router.post("/downloads/scan")
async def scan_directory_for_download(
    request: ScanDirectoryRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Inicia um scan de diretório para download em massa.
    O scanner irá listar recursivamente os arquivos e adicionar à fila de downloads.
    """
    from directory_scanner import queue_directory_scan
    
    # Verificar se o servidor existe
    result = await db.execute(select(Server).where(Server.id == request.server_id))
    server = result.scalar_one_or_none()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    
    # Adicionar à fila de scan
    await queue_directory_scan(
        server_id=request.server_id,
        share_name=request.share_name,
        path=request.path,
        max_depth=request.max_depth,
        max_file_size_bytes=request.max_file_size_bytes,
        apply_filters=request.apply_filters
    )
    
    return {
        "success": True,
        "message": f"Scan iniciado para {request.path}",
        "max_depth": request.max_depth,
        "apply_filters": request.apply_filters
    }


@api_router.get("/scans")
async def get_scan_jobs():
    """Lista todos os scan jobs (pendentes e recentes)"""
    from directory_scanner import get_scanner
    scanner = get_scanner()
    return scanner.get_scan_jobs()


@api_router.post("/scans/{scan_id}/cancel")
async def cancel_scan_job(scan_id: str):
    """Cancela um scan job específico"""
    from directory_scanner import get_scanner
    scanner = get_scanner()
    success = await scanner.cancel_scan(scan_id)
    if not success:
        raise HTTPException(status_code=404, detail="Scan job não encontrado ou já finalizado")
    return {"success": True}


@api_router.post("/scans/cancel-all")
async def cancel_all_scan_jobs():
    """Cancela todos os scan jobs pendentes"""
    from directory_scanner import get_scanner
    scanner = get_scanner()
    count = await scanner.cancel_all_scans()
    return {"success": True, "cancelled": count}


@api_router.post("/scans/clear-finished")
async def clear_finished_scan_jobs():
    """Limpa scans finalizados (completed, cancelled, failed)"""
    from directory_scanner import get_scanner
    scanner = get_scanner()
    count = await scanner.clear_finished_scans()
    return {"success": True, "cleared": count}


@api_router.post("/downloads/{job_id}/cancel")
async def cancel_download_job(
    job_id: int,
    db: AsyncSession = Depends(get_db)
):
    """Cancela um job de download"""
    result = await db.execute(select(DownloadJob).where(DownloadJob.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    if job.status in ['completed', 'cancelled']:
        raise HTTPException(status_code=400, detail="Job já finalizado")
    
    job.status = 'cancelled'
    job.completed_at = datetime.now(timezone.utc)
    await db.commit()
    
    return {"success": True}


@api_router.post("/downloads/cancel-all")
async def cancel_all_download_jobs(db: AsyncSession = Depends(get_db)):
    """Cancela todos os jobs pendentes/em andamento"""
    await db.execute(
        update(DownloadJob)
        .where(DownloadJob.status.in_(['pending', 'downloading']))
        .values(status='cancelled', completed_at=datetime.now(timezone.utc))
    )
    await db.commit()
    
    return {"success": True}


@api_router.post("/downloads/{job_id}/force")
async def force_download_job(
    job_id: int,
    db: AsyncSession = Depends(get_db)
):
    """Força download de um job que foi ignorado"""
    result = await db.execute(select(DownloadJob).where(DownloadJob.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    if job.status != 'skipped':
        raise HTTPException(status_code=400, detail="Apenas jobs ignorados podem ser forçados")
    
    job.status = 'pending'
    job.skip_reason = None
    await db.commit()
    
    return {"success": True}


@api_router.post("/downloads/{job_id}/retry")
async def retry_download_job(
    job_id: int,
    db: AsyncSession = Depends(get_db)
):
    """Reinicia um job que falhou"""
    result = await db.execute(select(DownloadJob).where(DownloadJob.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    if job.status != 'failed':
        raise HTTPException(status_code=400, detail="Apenas jobs com falha podem ser reiniciados")
    
    job.status = 'pending'
    job.error_message = None
    job.downloaded_bytes = 0
    job.progress = 0
    job.started_at = None
    job.completed_at = None
    await db.commit()
    
    return {"success": True}


@api_router.post("/downloads/clear-finished")
async def clear_finished_jobs(db: AsyncSession = Depends(get_db)):
    """Remove jobs concluídos, falhos, cancelados e ignorados"""
    import logging
    logger = logging.getLogger(__name__)
    
    # Primeiro contar quantos serão removidos
    count_result = await db.execute(
        select(DownloadJob).where(
            DownloadJob.status.in_(['completed', 'failed', 'cancelled', 'skipped'])
        )
    )
    jobs_to_delete = count_result.scalars().all()
    logger.info(f"Clearing {len(jobs_to_delete)} finished jobs with statuses: {[j.status for j in jobs_to_delete]}")
    
    # Deletar apenas jobs finalizados (NÃO pending ou downloading)
    await db.execute(
        delete(DownloadJob).where(
            DownloadJob.status.in_(['completed', 'failed', 'cancelled', 'skipped'])
        )
    )
    await db.commit()
    
    return {"success": True, "deleted": len(jobs_to_delete)}


# =====================
# App Settings Endpoints
# =====================

@api_router.get("/settings")
async def get_all_settings(db: AsyncSession = Depends(get_db)):
    """Obtém todas as configurações"""
    result = await db.execute(select(AppSettings))
    settings = result.scalars().all()
    
    return {
        setting.key: {
            "value": setting.value,
            "description": setting.description,
            "updated_at": setting.updated_at.isoformat() if setting.updated_at else None
        }
        for setting in settings
    }


@api_router.get("/settings/{key}")
async def get_setting(key: str, db: AsyncSession = Depends(get_db)):
    """Obtém uma configuração específica"""
    result = await db.execute(select(AppSettings).where(AppSettings.key == key))
    setting = result.scalar_one_or_none()
    
    if not setting:
        raise HTTPException(status_code=404, detail="Setting not found")
    
    return {
        "key": setting.key,
        "value": setting.value,
        "description": setting.description,
        "updated_at": setting.updated_at.isoformat() if setting.updated_at else None
    }


class UpdateSettingRequest(BaseModel):
    value: str


@api_router.put("/settings/{key}")
async def update_setting(key: str, request: UpdateSettingRequest, db: AsyncSession = Depends(get_db)):
    """Atualiza uma configuração"""
    result = await db.execute(select(AppSettings).where(AppSettings.key == key))
    setting = result.scalar_one_or_none()
    
    if not setting:
        raise HTTPException(status_code=404, detail="Setting not found")
    
    setting.value = request.value
    setting.updated_at = datetime.now(timezone.utc)
    await db.commit()
    
    # Se for configuração de downloads simultâneos, atualizar o worker
    if key == 'max_simultaneous_downloads':
        from download_worker import get_worker
        import asyncio
        worker = get_worker()
        worker.semaphore = asyncio.Semaphore(int(request.value))
    
    return {"success": True, "key": key, "value": request.value}


class UpdateMultipleSettingsRequest(BaseModel):
    settings: dict


@api_router.put("/settings")
async def update_multiple_settings(request: UpdateMultipleSettingsRequest, db: AsyncSession = Depends(get_db)):
    """Atualiza múltiplas configurações"""
    for key, value in request.settings.items():
        result = await db.execute(select(AppSettings).where(AppSettings.key == key))
        setting = result.scalar_one_or_none()
        
        if setting:
            setting.value = str(value)
            setting.updated_at = datetime.now(timezone.utc)
    
    await db.commit()
    
    # Atualizar worker se necessário
    if 'max_simultaneous_downloads' in request.settings:
        from download_worker import get_worker
        import asyncio
        worker = get_worker()
        worker.semaphore = asyncio.Semaphore(int(request.settings['max_simultaneous_downloads']))
    
    return {"success": True}


# Include router
app.include_router(api_router)

# Include V2 router (ID-based endpoints)
from routes_v2 import router as router_v2
app.include_router(router_v2)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

@app.on_event("startup")
async def startup_event():
    print("=== STARTUP: Starting application ===", flush=True)
    await init_db()
    print("=== STARTUP: Database initialized ===", flush=True)
    
    # Inicializar serviço OCR/Tika
    try:
        from ocr_service import initialize_tika
        tika_available = await initialize_tika()
        if tika_available:
            print("=== STARTUP: Tika OCR service initialized ===", flush=True)
        else:
            print("=== STARTUP: Tika OCR service not available (will retry on demand) ===", flush=True)
    except Exception as e:
        print(f"=== STARTUP WARNING: Tika OCR service error: {e} ===", flush=True)
    
    # Iniciar worker de downloads em background
    try:
        from download_worker import start_download_worker
        await start_download_worker()
        print("=== STARTUP: Download worker started successfully ===", flush=True)
    except Exception as e:
        print(f"=== STARTUP ERROR: Failed to start download worker: {e} ===", flush=True)
    
    # Iniciar scanner de diretórios em background
    try:
        from directory_scanner import start_directory_scanner
        await start_directory_scanner()
        print("=== STARTUP: Directory scanner started successfully ===", flush=True)
    except Exception as e:
        print(f"=== STARTUP ERROR: Failed to start directory scanner: {e} ===", flush=True)

@app.on_event("shutdown")
async def shutdown_event():
    # Parar worker de downloads
    from download_worker import stop_download_worker
    await stop_download_worker()
    logging.info("Download worker stopped")
    
    # Parar scanner de diretórios
    from directory_scanner import stop_directory_scanner
    await stop_directory_scanner()
    logging.info("Directory scanner stopped")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)