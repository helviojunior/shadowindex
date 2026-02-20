from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from sqlalchemy import Column, Integer, String, DateTime, Text, Boolean, inspect
from datetime import datetime, timezone
import os
import logging

logger = logging.getLogger(__name__)

# Usar diretório local (pwd) para o banco de dados
# O caminho será ./data/ops_integration.db (relativo ao diretório do backend)
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
os.makedirs(DATA_DIR, exist_ok=True)  # Garantir que o diretório existe

DATABASE_PATH = os.path.join(DATA_DIR, "ops_integration.db")
DATABASE_URL = f"sqlite+aiosqlite:///{DATABASE_PATH}"

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

class DatabaseType(Base):
    """Tipos de banco de dados suportados"""
    __tablename__ = "database_types"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, unique=True)  # MS-SQL, MySQL, PostgreSQL, etc.
    code = Column(String, nullable=False, unique=True)  # mssql, mysql, postgres, etc.
    icon = Column(String, nullable=True)  # Nome do ícone
    color = Column(String, nullable=True)  # Cor para UI
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class DatabaseConnection(Base):
    __tablename__ = "database_connections"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, unique=True)
    db_type_id = Column(Integer, nullable=True)  # FK para DatabaseType
    connection_string = Column(Text, nullable=False)
    verified = Column(Boolean, default=False)
    last_verified_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class SqlPreset(Base):
    """Comandos SQL pré-definidos"""
    __tablename__ = "sql_presets"
    
    id = Column(Integer, primary_key=True, index=True)
    db_type_id = Column(Integer, nullable=True)  # FK para DatabaseType (null = universal)
    name = Column(String, nullable=False)
    query = Column(Text, nullable=False)
    description = Column(String, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class SqlQueryHistory(Base):
    """Histórico de queries SQL executadas"""
    __tablename__ = "sql_query_history"
    
    id = Column(Integer, primary_key=True, index=True)
    connection_id = Column(Integer, nullable=False, index=True)
    connection_name = Column(String, nullable=False)
    query = Column(Text, nullable=False)
    result = Column(Text, nullable=True)  # JSON string
    success = Column(Boolean, default=True)
    error_message = Column(Text, nullable=True)
    execution_time_ms = Column(Integer, nullable=True)
    executed_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

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


class ServerItem(Base):
    """Armazena arquivos e diretórios descobertos durante a navegação"""
    __tablename__ = "server_items"
    
    id = Column(Integer, primary_key=True, index=True)
    server_guid = Column(String, nullable=False, index=True)
    share_name = Column(String, nullable=False, index=True)
    parent_path = Column(String, nullable=False, index=True)  # Caminho do diretório pai
    item_type = Column(String, nullable=False)  # "File" ou "Directory"
    name = Column(String, nullable=False)
    full_path = Column(String, nullable=False, index=True)
    size = Column(String, nullable=True)
    modified = Column(String, nullable=True)
    access_denied = Column(Boolean, default=False)
    error_message = Column(String, nullable=True)
    has_children = Column(Boolean, default=False)
    children_fetched = Column(Boolean, default=False)
    discovered_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

async def init_db():
    """Initialize database and apply schema migrations"""
    import sqlite3
    
    # Primeiro, criar todas as tabelas que não existem
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    
    # Aplicar migrações manuais para colunas que podem não existir
    db_path = DATABASE_PATH
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
        
        if 'has_children' not in columns:
            cursor.execute('ALTER TABLE server_shares ADD COLUMN has_children BOOLEAN DEFAULT 0')
            logger.info("Added column 'has_children' to server_shares")
        
        if 'children_fetched' not in columns:
            cursor.execute('ALTER TABLE server_shares ADD COLUMN children_fetched BOOLEAN DEFAULT 0')
            logger.info("Added column 'children_fetched' to server_shares")
        
        conn.commit()
        conn.close()
        logger.info("Database migrations completed")
    except Exception as e:
        logger.warning(f"Migration check failed: {e}")
    
    # Migração para database_connections
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        cursor.execute("PRAGMA table_info(database_connections)")
        columns = {col[1] for col in cursor.fetchall()}
        
        if 'verified' not in columns:
            cursor.execute('ALTER TABLE database_connections ADD COLUMN verified BOOLEAN DEFAULT 0')
            logger.info("Added column 'verified' to database_connections")
        
        if 'last_verified_at' not in columns:
            cursor.execute('ALTER TABLE database_connections ADD COLUMN last_verified_at DATETIME')
            logger.info("Added column 'last_verified_at' to database_connections")
        
        if 'db_type_id' not in columns:
            cursor.execute('ALTER TABLE database_connections ADD COLUMN db_type_id INTEGER')
            logger.info("Added column 'db_type_id' to database_connections")
        
        conn.commit()
        conn.close()
    except Exception as e:
        logger.warning(f"Migration check for database_connections failed: {e}")
    
    # Migration for sql_presets table
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        cursor.execute("PRAGMA table_info(sql_presets)")
        columns = {col[1] for col in cursor.fetchall()}
        
        if 'db_type_id' not in columns:
            cursor.execute('ALTER TABLE sql_presets ADD COLUMN db_type_id INTEGER')
            logger.info("Added column 'db_type_id' to sql_presets")
        
        conn.commit()
        conn.close()
    except Exception as e:
        logger.warning(f"Migration check for sql_presets failed: {e}")
    
    # Create default records
    async with AsyncSessionLocal() as session:
        from sqlalchemy import select
        
        # Create default database types
        result = await session.execute(select(DatabaseType))
        existing_types = result.scalars().all()
        
        db_types_map = {}
        if len(existing_types) == 0:
            default_types = [
                DatabaseType(name="Microsoft SQL Server", code="mssql", color="#CC2927"),
                DatabaseType(name="MySQL", code="mysql", color="#4479A1"),
                DatabaseType(name="PostgreSQL", code="postgres", color="#336791"),
                DatabaseType(name="Oracle", code="oracle", color="#F80000"),
                DatabaseType(name="SQLite", code="sqlite", color="#003B57"),
                DatabaseType(name="MariaDB", code="mariadb", color="#003545"),
                DatabaseType(name="MongoDB", code="mongodb", color="#47A248"),
            ]
            for db_type in default_types:
                session.add(db_type)
            await session.flush()
            
            # Refresh to get IDs
            result = await session.execute(select(DatabaseType))
            for t in result.scalars().all():
                db_types_map[t.code] = t.id
            
            logger.info("Created default database types")
        else:
            for t in existing_types:
                db_types_map[t.code] = t.id
        
        # Check if default proxy exists
        
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
        
        # Create default SQL presets if none exist
        result = await session.execute(select(SqlPreset))
        existing_presets = result.scalars().all()
        
        mssql_id = db_types_map.get('mssql')
        mysql_id = db_types_map.get('mysql')
        postgres_id = db_types_map.get('postgres')
        
        if len(existing_presets) == 0:
            default_presets = [
                # MS-SQL Presets
                SqlPreset(
                    db_type_id=mssql_id,
                    name="Is Admin",
                    query="SELECT IS_SRVROLEMEMBER('sysadmin')",
                    description="Verifica se o usuário atual é sysadmin"
                ),
                SqlPreset(
                    db_type_id=mssql_id,
                    name="List Databases",
                    query="SELECT name FROM sys.databases WHERE database_id > 4;",
                    description="Lista todos os bancos de dados do usuário"
                ),
                SqlPreset(
                    db_type_id=mssql_id,
                    name="Current User",
                    query="SELECT SYSTEM_USER, USER_NAME()",
                    description="Retorna o usuário atual do sistema"
                ),
                SqlPreset(
                    db_type_id=mssql_id,
                    name="Database Size",
                    query="SELECT DB_NAME() AS [Database], SUM(size * 8 / 1024) AS [Size (MB)] FROM sys.database_files GROUP BY type_desc",
                    description="Mostra o tamanho do banco de dados atual"
                ),
                SqlPreset(
                    db_type_id=mssql_id,
                    name="List Tables",
                    query="SELECT TABLE_SCHEMA, TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_SCHEMA, TABLE_NAME",
                    description="Lista todas as tabelas do banco atual"
                ),
                SqlPreset(
                    db_type_id=mssql_id,
                    name="Server Version",
                    query="SELECT @@VERSION",
                    description="Retorna a versão do SQL Server"
                ),
                # MySQL Presets
                SqlPreset(
                    db_type_id=mysql_id,
                    name="List Databases",
                    query="SHOW DATABASES;",
                    description="Lista todos os bancos de dados"
                ),
                SqlPreset(
                    db_type_id=mysql_id,
                    name="List Tables",
                    query="SHOW TABLES;",
                    description="Lista todas as tabelas do banco atual"
                ),
                SqlPreset(
                    db_type_id=mysql_id,
                    name="Current User",
                    query="SELECT USER(), CURRENT_USER();",
                    description="Retorna o usuário atual"
                ),
                SqlPreset(
                    db_type_id=mysql_id,
                    name="Server Version",
                    query="SELECT VERSION();",
                    description="Retorna a versão do MySQL"
                ),
                SqlPreset(
                    db_type_id=mysql_id,
                    name="Database Size",
                    query="SELECT table_schema AS 'Database', ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) AS 'Size (MB)' FROM information_schema.tables GROUP BY table_schema;",
                    description="Mostra o tamanho de cada banco de dados"
                ),
                # PostgreSQL Presets
                SqlPreset(
                    db_type_id=postgres_id,
                    name="List Databases",
                    query="SELECT datname FROM pg_database WHERE datistemplate = false;",
                    description="Lista todos os bancos de dados"
                ),
                SqlPreset(
                    db_type_id=postgres_id,
                    name="List Tables",
                    query="SELECT tablename FROM pg_tables WHERE schemaname = 'public';",
                    description="Lista todas as tabelas do schema public"
                ),
                SqlPreset(
                    db_type_id=postgres_id,
                    name="Current User",
                    query="SELECT current_user, session_user;",
                    description="Retorna o usuário atual"
                ),
                SqlPreset(
                    db_type_id=postgres_id,
                    name="Server Version",
                    query="SELECT version();",
                    description="Retorna a versão do PostgreSQL"
                ),
                SqlPreset(
                    db_type_id=postgres_id,
                    name="Database Size",
                    query="SELECT pg_database.datname, pg_size_pretty(pg_database_size(pg_database.datname)) AS size FROM pg_database;",
                    description="Mostra o tamanho de cada banco de dados"
                ),
                # Universal Presets (null db_type_id)
                SqlPreset(
                    db_type_id=None,
                    name="Select All",
                    query="SELECT * FROM table_name LIMIT 100;",
                    description="Seleciona todos os registros de uma tabela (universal)"
                ),
            ]
            for preset in default_presets:
                session.add(preset)
            logger.info("Created default SQL presets")
        
        await session.commit()
    
    logger.info("Database initialized")

async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()