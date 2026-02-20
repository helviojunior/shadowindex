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
    sha1_hash = Column(String(40), nullable=True)  # SHA1 hash do arquivo
    downloaded_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class FileVersion(Base):
    """Armazena versões de arquivos baixados"""
    __tablename__ = "file_versions"
    
    id = Column(Integer, primary_key=True, index=True)
    server_guid = Column(String, nullable=False, index=True)
    share_name = Column(String, nullable=False, index=True)
    file_path = Column(String, nullable=False, index=True)  # Caminho original do arquivo
    version_number = Column(Integer, nullable=False, default=1)  # Número da versão
    sha1_hash = Column(String(40), nullable=False)  # SHA1 hash desta versão
    file_size = Column(Integer, nullable=True)
    local_path = Column(String, nullable=False)  # Caminho local onde está armazenado
    is_current = Column(Boolean, default=True)  # Se é a versão atual
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


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
    
    # Migration for downloaded_files table
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        cursor.execute("PRAGMA table_info(downloaded_files)")
        columns = {col[1] for col in cursor.fetchall()}
        
        if 'sha1_hash' not in columns:
            cursor.execute('ALTER TABLE downloaded_files ADD COLUMN sha1_hash VARCHAR(40)')
            logger.info("Added column 'sha1_hash' to downloaded_files")
        
        conn.commit()
        conn.close()
    except Exception as e:
        logger.warning(f"Migration check for downloaded_files failed: {e}")
    
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
                # ===========================================
                # MS-SQL Presets
                # ===========================================
                SqlPreset(
                    db_type_id=mssql_id,
                    name="Server Version",
                    query="SELECT @@VERSION",
                    description="Retorna a versão do SQL Server"
                ),
                SqlPreset(
                    db_type_id=mssql_id,
                    name="Current User",
                    query="SELECT SYSTEM_USER, USER_NAME()",
                    description="Retorna o usuário atual do sistema"
                ),
                SqlPreset(
                    db_type_id=mssql_id,
                    name="Current Database",
                    query="SELECT DB_NAME()",
                    description="Retorna o nome do banco de dados atual"
                ),
                SqlPreset(
                    db_type_id=mssql_id,
                    name="Is Admin (sysadmin)",
                    query="SELECT IS_SRVROLEMEMBER('sysadmin')",
                    description="Verifica se o usuário atual é sysadmin (1=sim, 0=não)"
                ),
                SqlPreset(
                    db_type_id=mssql_id,
                    name="Is Public Role",
                    query="SELECT IS_SRVROLEMEMBER('public')",
                    description="Verifica se o usuário pertence ao role public"
                ),
                SqlPreset(
                    db_type_id=mssql_id,
                    name="List Databases",
                    query="SELECT name, state_desc FROM sys.databases WHERE database_id > 4 ORDER BY state_desc DESC, name;",
                    description="Lista todos os bancos de dados do usuário"
                ),
                SqlPreset(
                    db_type_id=mssql_id,
                    name="List Schemas",
                    query="SELECT schema_name FROM information_schema.schemata",
                    description="Lista todos os schemas"
                ),
                SqlPreset(
                    db_type_id=mssql_id,
                    name="List Tables",
                    query="SELECT TABLE_CATALOG, TABLE_SCHEMA, TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_SCHEMA, TABLE_NAME",
                    description="Lista todas as tabelas do banco atual"
                ),
                SqlPreset(
                    db_type_id=mssql_id,
                    name="List Tables (Other Database)",
                    query="SELECT TABLE_CATALOG, TABLE_SCHEMA, TABLE_NAME FROM [DATABASE_NAME].INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_SCHEMA, TABLE_NAME",
                    description="Lista tabelas de outro banco - substitua DATABASE_NAME pelo nome do banco"
                ),
                SqlPreset(
                    db_type_id=mssql_id,
                    name="List Columns (All Tables)",
                    query="""SELECT
    t.name AS Table_Name,
    c.name AS Column_Name
FROM
    sys.columns AS c
INNER JOIN
    sys.tables AS t ON t.object_id = c.object_id
ORDER BY
    Table_Name,
    Column_Name;""",
                    description="Lista todas as colunas de todas as tabelas"
                ),
                SqlPreset(
                    db_type_id=mssql_id,
                    name="Find Sensitive Columns",
                    query="""SELECT
    t.name AS Table_Name,
    c.name AS Column_Name
FROM
    sys.columns AS c
INNER JOIN
    sys.tables AS t ON t.object_id = c.object_id
WHERE c.name LIKE '%pass%' OR c.name LIKE '%senha%' OR c.name LIKE '%config%'
ORDER BY
    Table_Name,
    Column_Name;""",
                    description="Busca colunas com nomes sensíveis (pass, senha, config)"
                ),
                SqlPreset(
                    db_type_id=mssql_id,
                    name="List Users",
                    query="SELECT name FROM sys.database_principals",
                    description="Lista todos os usuários do banco de dados"
                ),
                SqlPreset(
                    db_type_id=mssql_id,
                    name="List Admin Users",
                    query="SELECT name FROM sys.server_principals WHERE IS_SRVROLEMEMBER('sysadmin', name) = 1",
                    description="Lista usuários com privilégios de sysadmin"
                ),
                SqlPreset(
                    db_type_id=mssql_id,
                    name="List Impersonate Permissions",
                    query="""SELECT DISTINCT b.name 
FROM sys.server_permissions a 
INNER JOIN sys.server_principals b ON a.grantor_principal_id = b.principal_id 
WHERE a.permission_name = 'IMPERSONATE';""",
                    description="Lista logins com permissão de IMPERSONATE"
                ),
                SqlPreset(
                    db_type_id=mssql_id,
                    name="List Server Roles",
                    query="""SELECT CONCAT('Role: ', spr.name, ', Login: ', spm.name) AS txt
FROM sys.server_role_members m
INNER JOIN sys.server_principals spr ON m.role_principal_id = spr.principal_id
INNER JOIN sys.server_principals spm ON m.member_principal_id = spm.principal_id""",
                    description="Lista roles de servidor e seus membros"
                ),
                SqlPreset(
                    db_type_id=mssql_id,
                    name="List SQL Services",
                    query="SELECT servicename, service_account FROM sys.dm_server_services;",
                    description="Lista serviços SQL Server e suas contas de serviço"
                ),
                SqlPreset(
                    db_type_id=mssql_id,
                    name="SQL Services Detail",
                    query="""SELECT DSS.servicename,
    DSS.startup_type_desc,
    DSS.status_desc,
    DSS.last_startup_time,
    DSS.service_account,
    DSS.is_clustered,
    DSS.cluster_nodename,
    DSS.filename,
    DSS.startup_type,
    DSS.status,
    DSS.process_id
FROM sys.dm_server_services AS DSS;""",
                    description="Detalhes completos dos serviços SQL Server"
                ),
                SqlPreset(
                    db_type_id=mssql_id,
                    name="Database Size",
                    query="SELECT DB_NAME() AS [Database], SUM(size * 8 / 1024) AS [Size (MB)] FROM sys.database_files GROUP BY type_desc",
                    description="Mostra o tamanho do banco de dados atual"
                ),
                # ===========================================
                # MySQL Presets
                # ===========================================
                SqlPreset(
                    db_type_id=mysql_id,
                    name="Server Version",
                    query="SELECT @@VERSION;",
                    description="Retorna a versão do MySQL"
                ),
                SqlPreset(
                    db_type_id=mysql_id,
                    name="Current User",
                    query="SELECT USER(), CURRENT_USER();",
                    description="Retorna o usuário atual"
                ),
                SqlPreset(
                    db_type_id=mysql_id,
                    name="Current Database",
                    query="SELECT DATABASE();",
                    description="Retorna o nome do banco de dados atual"
                ),
                SqlPreset(
                    db_type_id=mysql_id,
                    name="List Databases",
                    query="SHOW DATABASES;",
                    description="Lista todos os bancos de dados"
                ),
                SqlPreset(
                    db_type_id=mysql_id,
                    name="List Schemas",
                    query="SELECT schema_name FROM information_schema.schemata;",
                    description="Lista todos os schemas"
                ),
                SqlPreset(
                    db_type_id=mysql_id,
                    name="List Tables",
                    query="SHOW TABLES;",
                    description="Lista todas as tabelas do banco atual"
                ),
                SqlPreset(
                    db_type_id=mysql_id,
                    name="List Columns (Table)",
                    query="SELECT column_name, data_type FROM information_schema.columns WHERE table_name='users';",
                    description="Lista colunas de uma tabela específica"
                ),
                SqlPreset(
                    db_type_id=mysql_id,
                    name="Find Sensitive Columns",
                    query="""SELECT table_name, column_name 
FROM information_schema.columns 
WHERE column_name LIKE '%pass%' OR column_name LIKE '%senha%' OR column_name LIKE '%config%';""",
                    description="Busca colunas com nomes sensíveis"
                ),
                SqlPreset(
                    db_type_id=mysql_id,
                    name="List Users",
                    query="SELECT user, host FROM mysql.user;",
                    description="Lista todos os usuários do MySQL"
                ),
                SqlPreset(
                    db_type_id=mysql_id,
                    name="List Admin Users",
                    query="SELECT user, host FROM mysql.user WHERE Super_priv='Y';",
                    description="Lista usuários com privilégios de admin"
                ),
                SqlPreset(
                    db_type_id=mysql_id,
                    name="Database Size",
                    query="SELECT table_schema AS 'Database', ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) AS 'Size (MB)' FROM information_schema.tables GROUP BY table_schema;",
                    description="Mostra o tamanho de cada banco de dados"
                ),
                SqlPreset(
                    db_type_id=mysql_id,
                    name="Show Grants",
                    query="SHOW GRANTS FOR CURRENT_USER();",
                    description="Mostra permissões do usuário atual"
                ),
                SqlPreset(
                    db_type_id=mysql_id,
                    name="Show Variables",
                    query="SHOW VARIABLES LIKE '%version%';",
                    description="Mostra variáveis relacionadas à versão"
                ),
                # ===========================================
                # PostgreSQL Presets
                # ===========================================
                SqlPreset(
                    db_type_id=postgres_id,
                    name="Server Version",
                    query="SELECT version();",
                    description="Retorna a versão do PostgreSQL"
                ),
                SqlPreset(
                    db_type_id=postgres_id,
                    name="Current User",
                    query="SELECT current_user, session_user;",
                    description="Retorna o usuário atual"
                ),
                SqlPreset(
                    db_type_id=postgres_id,
                    name="Current Database",
                    query="SELECT current_database();",
                    description="Retorna o nome do banco de dados atual"
                ),
                SqlPreset(
                    db_type_id=postgres_id,
                    name="List Databases",
                    query="SELECT datname FROM pg_database WHERE datistemplate = false;",
                    description="Lista todos os bancos de dados"
                ),
                SqlPreset(
                    db_type_id=postgres_id,
                    name="List Schemas",
                    query="SELECT schema_name FROM information_schema.schemata;",
                    description="Lista todos os schemas"
                ),
                SqlPreset(
                    db_type_id=postgres_id,
                    name="List Tables",
                    query="SELECT tablename FROM pg_tables WHERE schemaname = 'public';",
                    description="Lista todas as tabelas do schema public"
                ),
                SqlPreset(
                    db_type_id=postgres_id,
                    name="List Columns (Table)",
                    query="SELECT column_name, data_type FROM information_schema.columns WHERE table_name='users';",
                    description="Lista colunas de uma tabela específica"
                ),
                SqlPreset(
                    db_type_id=postgres_id,
                    name="Find Sensitive Columns",
                    query="""SELECT table_name, column_name 
FROM information_schema.columns 
WHERE column_name LIKE '%pass%' OR column_name LIKE '%senha%' OR column_name LIKE '%config%';""",
                    description="Busca colunas com nomes sensíveis"
                ),
                SqlPreset(
                    db_type_id=postgres_id,
                    name="List Users",
                    query="SELECT usename FROM pg_user;",
                    description="Lista todos os usuários"
                ),
                SqlPreset(
                    db_type_id=postgres_id,
                    name="List Admin Users",
                    query="SELECT usename FROM pg_user WHERE usesuper = true;",
                    description="Lista usuários com privilégios de superuser"
                ),
                SqlPreset(
                    db_type_id=postgres_id,
                    name="List Roles",
                    query="SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb FROM pg_roles;",
                    description="Lista roles e suas permissões"
                ),
                SqlPreset(
                    db_type_id=postgres_id,
                    name="Database Size",
                    query="SELECT pg_database.datname, pg_size_pretty(pg_database_size(pg_database.datname)) AS size FROM pg_database;",
                    description="Mostra o tamanho de cada banco de dados"
                ),
                SqlPreset(
                    db_type_id=postgres_id,
                    name="Table Sizes",
                    query="""SELECT 
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables 
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;""",
                    description="Mostra tamanho das tabelas"
                ),
                SqlPreset(
                    db_type_id=postgres_id,
                    name="Active Connections",
                    query="""SELECT pid, usename, application_name, client_addr, state, query 
FROM pg_stat_activity 
WHERE state = 'active';""",
                    description="Lista conexões ativas"
                ),
                # ===========================================
                # Oracle Presets
                # ===========================================
                SqlPreset(
                    db_type_id=db_types_map.get('oracle'),
                    name="Server Version",
                    query="SELECT * FROM V$VERSION WHERE BANNER LIKE 'Oracle%'",
                    description="Retorna a versão do Oracle"
                ),
                SqlPreset(
                    db_type_id=db_types_map.get('oracle'),
                    name="Current User",
                    query="SELECT USER FROM DUAL",
                    description="Retorna o usuário atual"
                ),
                SqlPreset(
                    db_type_id=db_types_map.get('oracle'),
                    name="Current Database",
                    query="SELECT ORA_DATABASE_NAME FROM DUAL",
                    description="Retorna o nome do banco de dados"
                ),
                SqlPreset(
                    db_type_id=db_types_map.get('oracle'),
                    name="List Schemas",
                    query="SELECT DISTINCT OWNER FROM ALL_TABLES ORDER BY OWNER",
                    description="Lista todos os schemas/owners"
                ),
                SqlPreset(
                    db_type_id=db_types_map.get('oracle'),
                    name="List Tables",
                    query="SELECT TABLE_NAME FROM USER_TABLES ORDER BY TABLE_NAME",
                    description="Lista todas as tabelas do usuário atual"
                ),
                SqlPreset(
                    db_type_id=db_types_map.get('oracle'),
                    name="List All Tables",
                    query="SELECT OWNER, TABLE_NAME FROM ALL_TABLES ORDER BY OWNER, TABLE_NAME",
                    description="Lista todas as tabelas de todos os schemas"
                ),
                SqlPreset(
                    db_type_id=db_types_map.get('oracle'),
                    name="List Columns (Table)",
                    query="SELECT COLUMN_NAME, DATA_TYPE FROM USER_TAB_COLUMNS WHERE TABLE_NAME = 'USERS'",
                    description="Lista colunas de uma tabela específica"
                ),
                SqlPreset(
                    db_type_id=db_types_map.get('oracle'),
                    name="Find Sensitive Columns",
                    query="""SELECT TABLE_NAME, COLUMN_NAME 
FROM USER_TAB_COLUMNS 
WHERE COLUMN_NAME LIKE '%PASS%' OR COLUMN_NAME LIKE '%SENHA%' OR COLUMN_NAME LIKE '%CONFIG%'""",
                    description="Busca colunas com nomes sensíveis"
                ),
                SqlPreset(
                    db_type_id=db_types_map.get('oracle'),
                    name="List Users",
                    query="SELECT USERNAME FROM ALL_USERS ORDER BY USERNAME",
                    description="Lista todos os usuários"
                ),
                SqlPreset(
                    db_type_id=db_types_map.get('oracle'),
                    name="List Admin Users",
                    query="SELECT GRANTEE FROM DBA_ROLE_PRIVS WHERE GRANTED_ROLE = 'DBA'",
                    description="Lista usuários com role DBA"
                ),
                SqlPreset(
                    db_type_id=db_types_map.get('oracle'),
                    name="Current Privileges",
                    query="SELECT * FROM USER_SYS_PRIVS",
                    description="Lista privilégios do usuário atual"
                ),
                SqlPreset(
                    db_type_id=db_types_map.get('oracle'),
                    name="Database Size",
                    query="""SELECT 
    TABLESPACE_NAME,
    ROUND(SUM(BYTES)/1024/1024, 2) AS SIZE_MB
FROM DBA_DATA_FILES 
GROUP BY TABLESPACE_NAME""",
                    description="Mostra tamanho dos tablespaces"
                ),
                SqlPreset(
                    db_type_id=db_types_map.get('oracle'),
                    name="Active Sessions",
                    query="""SELECT SID, SERIAL#, USERNAME, STATUS, OSUSER, MACHINE, PROGRAM 
FROM V$SESSION 
WHERE STATUS = 'ACTIVE' AND USERNAME IS NOT NULL""",
                    description="Lista sessões ativas"
                ),
                # ===========================================
                # Universal Presets (null db_type_id)
                # ===========================================
                SqlPreset(
                    db_type_id=None,
                    name="Select All (Limit 100)",
                    query="SELECT * FROM table_name LIMIT 100;",
                    description="Seleciona todos os registros de uma tabela (universal)"
                ),
                SqlPreset(
                    db_type_id=None,
                    name="Count Records",
                    query="SELECT COUNT(*) FROM table_name;",
                    description="Conta registros de uma tabela"
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