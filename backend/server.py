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
    operation: str
    s1: Optional[str] = ""
    s2: Optional[str] = ""
    connStr: Optional[str] = None
    query: Optional[str] = None
    ignore_cache: bool = False

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