from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from sqlalchemy import Column, Integer, String, DateTime, Text, Boolean, inspect
from datetime import datetime, timezone
import os
import logging

logger = logging.getLogger(__name__)

DATABASE_URL = "sqlite+aiosqlite:///./ops_integration.db"

engine = create_async_engine(DATABASE_URL, echo=False)
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
Base = declarative_base()

class Credential(Base):
    __tablename__ = "credentials"
    
    id = Column(Integer, primary_key=True, index=True)
    domain = Column(String, nullable=False)
    username = Column(String, nullable=False)
    password = Column(String, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

class DatabaseConnection(Base):
    __tablename__ = "database_connections"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, unique=True)
    connection_string = Column(Text, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

class ProxyServer(Base):
    __tablename__ = "proxy_servers"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, unique=True)
    ip = Column(String, nullable=False)
    port = Column(Integer, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

class SoapApiUrl(Base):
    __tablename__ = "soap_api_urls"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, unique=True)
    uri = Column(String, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

class SoapCache(Base):
    __tablename__ = "soap_cache"
    
    id = Column(Integer, primary_key=True, index=True)
    query_hash = Column(String, nullable=False, unique=True, index=True)
    operation = Column(String, nullable=False)
    request_data = Column(Text, nullable=False)
    response_data = Column(Text, nullable=False)
    timestamp = Column(DateTime, default=lambda: datetime.now(timezone.utc))

class AppConfig(Base):
    __tablename__ = "app_config"
    
    id = Column(Integer, primary_key=True, index=True)
    key = Column(String, nullable=False, unique=True)
    value = Column(String, nullable=False)
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

class Server(Base):
    __tablename__ = "servers"
    
    id = Column(Integer, primary_key=True, index=True)
    guid = Column(String, nullable=False, unique=True, index=True)
    name = Column(String, nullable=False)
    ip = Column(String, nullable=False)
    verified = Column(Boolean, default=False)
    shares_count = Column(Integer, default=0)
    downloaded_files_count = Column(Integer, default=0)
    last_verified_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

class ServerShare(Base):
    __tablename__ = "server_shares"
    
    id = Column(Integer, primary_key=True, index=True)
    server_guid = Column(String, nullable=False, index=True)
    share_name = Column(String, nullable=False)
    share_type = Column(String, nullable=True)
    remark = Column(String, nullable=True)
    access_denied = Column(Boolean, default=False)
    error_message = Column(String, nullable=True)
    has_children = Column(Boolean, default=False)  # True se já fez fetch dos filhos e tem conteúdo
    children_fetched = Column(Boolean, default=False)  # True se já tentou buscar os filhos
    discovered_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

class DownloadedFile(Base):
    __tablename__ = "downloaded_files"
    
    id = Column(Integer, primary_key=True, index=True)
    server_guid = Column(String, nullable=False, index=True)
    share_name = Column(String, nullable=False)
    file_path = Column(String, nullable=False)
    sanitized_path = Column(String, nullable=False)
    file_size = Column(Integer, nullable=True)
    downloaded_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

async def init_db():
    """Initialize database and apply schema migrations"""
    import sqlite3
    
    # Primeiro, criar todas as tabelas que não existem
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    
    # Aplicar migrações manuais para colunas que podem não existir
    db_path = DATABASE_URL.replace("sqlite+aiosqlite:///", "")
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        # Verificar e adicionar colunas na tabela server_shares
        cursor.execute("PRAGMA table_info(server_shares)")
        columns = {col[1] for col in cursor.fetchall()}
        
        if 'access_denied' not in columns:
            cursor.execute('ALTER TABLE server_shares ADD COLUMN access_denied BOOLEAN DEFAULT 0')
            logger.info("Added column 'access_denied' to server_shares")
        
        if 'error_message' not in columns:
            cursor.execute('ALTER TABLE server_shares ADD COLUMN error_message VARCHAR')
            logger.info("Added column 'error_message' to server_shares")
        
        conn.commit()
        conn.close()
        logger.info("Database migrations completed")
    except Exception as e:
        logger.warning(f"Migration check failed: {e}")
    
    # Create default records
    async with AsyncSessionLocal() as session:
        from sqlalchemy import select
        
        # Check if default proxy exists
        result = await session.execute(select(ProxyServer).where(ProxyServer.name == "Default Host Proxy"))
        if not result.scalar_one_or_none():
            default_proxy = ProxyServer(
                name="Default Host Proxy",
                ip="proxy.local",
                port=8080
            )
            session.add(default_proxy)
        
        # Check if offline mode config exists
        result = await session.execute(select(AppConfig).where(AppConfig.key == "offline_mode"))
        if not result.scalar_one_or_none():
            offline_config = AppConfig(key="offline_mode", value="false")
            session.add(offline_config)
        
        # Check if default SOAP API exists
        result = await session.execute(select(SoapApiUrl).where(SoapApiUrl.name == "Default SOAP API"))
        if not result.scalar_one_or_none():
            default_soap = SoapApiUrl(
                name="Default SOAP API",
                uri="https://sdweb.suzanonet.com.br/dna/upload/api_tst.asmx?WSDL"
            )
            session.add(default_soap)
        
        await session.commit()
    
    logger.info("Database initialized")

async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()