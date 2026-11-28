from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from sqlalchemy import Column, Integer, BigInteger, String, DateTime, Text, Boolean, ForeignKey, inspect, JSON, Float, event, Index
from datetime import datetime, timezone
import os
import uuid
import logging

logger = logging.getLogger(__name__)

# Configuração do banco de dados
# Se POSTGRES_URL estiver definido, usa PostgreSQL, caso contrário usa SQLite
POSTGRES_URL = os.environ.get('POSTGRES_URL')

if POSTGRES_URL:
    # PostgreSQL
    DATABASE_TYPE = 'postgresql'
    # Converter URL síncrona para assíncrona (asyncpg)
    if POSTGRES_URL.startswith('postgresql://'):
        DATABASE_URL = POSTGRES_URL.replace('postgresql://', 'postgresql+asyncpg://')
    elif POSTGRES_URL.startswith('postgres://'):
        DATABASE_URL = POSTGRES_URL.replace('postgres://', 'postgresql+asyncpg://')
    else:
        DATABASE_URL = POSTGRES_URL
    DATABASE_URL_READONLY = DATABASE_URL
    DATABASE_PATH = None
    DATA_DIR = None

    logger.info("Using PostgreSQL database")
    
    # Engine principal para escrita
    engine = create_async_engine(
        DATABASE_URL, 
        echo=False,
        pool_size=10,
        max_overflow=20,
        pool_timeout=60,
        pool_recycle=1800,
    )
    
    # Engine de somente leitura (mesma URL no PostgreSQL)
    engine_readonly = create_async_engine(
        DATABASE_URL_READONLY,
        echo=False,
        pool_size=10,
        max_overflow=20,
        pool_timeout=30,
        pool_recycle=1800,
    )
else:
    # SQLite (fallback)
    DATABASE_TYPE = 'sqlite'
    DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
    os.makedirs(DATA_DIR, exist_ok=True)
    
    DATABASE_PATH = os.path.join(DATA_DIR, "shadowindex.db")
    DATABASE_URL = f"sqlite+aiosqlite:///{DATABASE_PATH}"
    DATABASE_URL_READONLY = f"sqlite+aiosqlite:///{DATABASE_PATH}?mode=ro"
    
    logger.info(f"Using SQLite database at {DATABASE_PATH}")
    
    # Engine principal para escrita (pool menor para evitar locks)
    engine = create_async_engine(
        DATABASE_URL, 
        echo=False,
        pool_size=5,
        max_overflow=10,
        pool_timeout=120,
        pool_recycle=1800,
        connect_args={
            "timeout": 120,
            "check_same_thread": False
        }
    )
    
    # Engine de somente leitura para consultas pesadas
    engine_readonly = create_async_engine(
        DATABASE_URL,
        echo=False,
        pool_size=5,
        max_overflow=10,
        pool_timeout=30,
        pool_recycle=1800,
        connect_args={
            "timeout": 30,
            "check_same_thread": False
        }
    )
    
    # Configurar pragmas do SQLite - WAL mode para melhor concorrência
    @event.listens_for(engine.sync_engine, "connect")
    def set_sqlite_pragma_write(dbapi_connection, connection_record):
        """Configura pragmas do SQLite para engine de escrita"""
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute("PRAGMA temp_store=MEMORY")
        cursor.execute("PRAGMA cache_size=-32768")
        cursor.execute("PRAGMA busy_timeout=60000")
        cursor.close()
    
    @event.listens_for(engine_readonly.sync_engine, "connect")
    def set_sqlite_pragma_read(dbapi_connection, connection_record):
        """Configura pragmas do SQLite para engine de leitura"""
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA query_only=ON")
        cursor.execute("PRAGMA synchronous=OFF")
        cursor.execute("PRAGMA temp_store=MEMORY")
        cursor.execute("PRAGMA cache_size=-65536")
        cursor.execute("PRAGMA busy_timeout=10000")
        cursor.close()

# Session para escrita
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

# Session para leitura (usar para consultas pesadas)
AsyncSessionReadonly = sessionmaker(engine_readonly, class_=AsyncSession, expire_on_commit=False)

# Alias para uso mais limpo
async_session_maker = AsyncSessionLocal
async_session_readonly = AsyncSessionReadonly

Base = declarative_base()

class Credential(Base):
    __tablename__ = "credentials"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=True)  # Optional friendly name
    credential_type = Column(String, nullable=False, default="user_password")  # user_password, token, ssh_key
    # For user_password type
    domain = Column(String, nullable=True)
    username = Column(String, nullable=True)
    password = Column(String, nullable=True)  # Password or NTLM hash required for user_password
    ntlm_hash = Column(String, nullable=True)  # NTLM hash (format: LM:NT or just NT)
    # For kerberos type (ccache ticket)
    kerberos_ccache = Column(Text, nullable=True)  # Base64-encoded Kerberos credential cache (ccache) file
    kdc_host = Column(String, nullable=True)  # Optional KDC/Domain Controller host for Kerberos
    # For token type
    token = Column(Text, nullable=True)
    token_type = Column(String, nullable=True)  # bearer, api_key, etc.
    # For ssh_key type
    ssh_private_key = Column(Text, nullable=True)
    ssh_passphrase = Column(String, nullable=True)
    ssh_public_key = Column(Text, nullable=True)
    # Verification
    verified = Column(Boolean, default=False)
    last_verified_at = Column(DateTime(timezone=True), nullable=True)
    verification_error = Column(String, nullable=True)
    # Timestamps
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    @property
    def kerberos_expires_at(self):
        """Data/hora (UTC) de expiração do ticket ccache, quando aplicável."""
        if self.credential_type != "kerberos" or not self.kerberos_ccache:
            return None
        try:
            from kerberos_utils import get_ccache_expiry
            return get_ccache_expiry(self.kerberos_ccache)
        except Exception:
            return None

    @property
    def kerberos_expired(self):
        """True se o ticket ccache expirou, False se válido, None se desconhecido/não aplicável."""
        if self.credential_type != "kerberos" or not self.kerberos_ccache:
            return None
        try:
            from kerberos_utils import is_ccache_expired
            return is_ccache_expired(self.kerberos_ccache)
        except Exception:
            return None

class DatabaseType(Base):
    """Tipos de banco de dados suportados"""
    __tablename__ = "database_types"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, unique=True)  # MS-SQL, MySQL, PostgreSQL, etc.
    code = Column(String, nullable=False, unique=True)  # mssql, mysql, postgres, etc.
    icon = Column(String, nullable=True)  # Nome do ícone
    color = Column(String, nullable=True)  # Cor para UI
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class DatabaseConnection(Base):
    __tablename__ = "database_connections"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, unique=True)
    db_type_id = Column(Integer, nullable=True)  # FK para DatabaseType
    connection_string = Column(Text, nullable=False)
    verified = Column(Boolean, default=False)
    last_verified_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    # Plugin configuration
    plugin_instance_id = Column(Integer, ForeignKey("plugin_instances.id"), nullable=True)
    plugin_type = Column(String, default="soap_api")  # Deprecated - use plugin_instance_id
    plugin_config = Column(JSON, nullable=True)  # Deprecated - use plugin_instance_id


class SqlPreset(Base):
    """Comandos SQL pré-definidos"""
    __tablename__ = "sql_presets"
    
    id = Column(Integer, primary_key=True, index=True)
    db_type_id = Column(Integer, nullable=True)  # FK para DatabaseType (null = universal)
    name = Column(String, nullable=False)
    query = Column(Text, nullable=False)
    description = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


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
    executed_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

class ProxyServer(Base):
    __tablename__ = "proxy_servers"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, unique=True)
    ip = Column(String, nullable=False)
    port = Column(Integer, nullable=False)
    proxy_type = Column(String, default="http")  # "http" or "socks5"
    credential_id = Column(Integer, nullable=True)  # FK para Credential (user_password type)
    # IPs de servidores DNS separados por vírgula, alcançáveis através deste proxy.
    # Usados para resolver nomes da rede alvo pelo túnel.
    dns_servers = Column(String, nullable=True)
    username = Column(String, nullable=True)  # Deprecated - use credential_id
    password = Column(String, nullable=True)  # Deprecated - use credential_id
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

class ExternalApiCall(Base):
    """Toda chamada HTTP que NÓS fazemos a uma API/URL externa (OUTBOUND),
    registrada pelo helper único `external_http.ExternalClient`. Segredos
    (Authorization, api_key, token) vão mascarados. Sem retenção (eterno)."""
    __tablename__ = "external_api_calls"
    __table_args__ = (
        Index('idx_extcall_created', 'created_at'),
        Index('idx_extcall_provider', 'provider', 'created_at'),
        Index('idx_extcall_status', 'status_code', 'created_at'),
    )

    id = Column(Integer, primary_key=True, index=True)
    provider = Column(String, nullable=True, index=True)    # ex.: github, gitlab, git-dump
    context = Column(String, nullable=True)                 # ex.: search, whoami, projects
    method = Column(String, nullable=True)
    url = Column(String, nullable=True)                     # api_key mascarado
    remote_ip = Column(String, nullable=True)               # IP do host remoto (DNS/hosts)
    status_code = Column(Integer, nullable=True)
    duration_ms = Column(Integer, nullable=True)
    request_headers = Column(JSON, nullable=True)           # Authorization mascarado
    request_payload = Column(JSON, nullable=True)
    response_payload = Column(JSON, nullable=True)          # truncado/mascarado
    error = Column(Text, nullable=True)                     # quando a req nem completou
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)


class DnsOverride(Base):
    """Override de resolução DNS (hostname -> IP), estilo "Hostname resolution
    overrides" do Burp. Aplicado no /etc/hosts do container para valer em todo o
    sistema (clones, httpx, etc.)."""
    __tablename__ = "dns_overrides"

    id = Column(Integer, primary_key=True, index=True)
    hostname = Column(String, nullable=False, unique=True, index=True)
    ip = Column(String, nullable=False)
    enabled = Column(Boolean, default=True, nullable=False)
    comment = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))


class SoapApiUrl(Base):
    __tablename__ = "soap_api_urls"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, unique=True)
    uri = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

class SoapCache(Base):
    __tablename__ = "soap_cache"
    
    id = Column(Integer, primary_key=True, index=True)
    query_hash = Column(String, nullable=False, unique=True, index=True)
    operation = Column(String, nullable=False)
    request_data = Column(Text, nullable=False)
    response_data = Column(Text, nullable=False)
    timestamp = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

class AppConfig(Base):
    __tablename__ = "app_config"
    
    id = Column(Integer, primary_key=True, index=True)
    key = Column(String, nullable=False, unique=True)
    value = Column(String, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class PluginInstance(Base):
    """
    Instâncias de plugins.
    Cada tipo de plugin (soap_api, direct_interaction) pode ter múltiplas instâncias
    com configurações diferentes.
    """
    __tablename__ = "plugin_instances"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)  # Nome amigável da instância
    plugin_type = Column(String, nullable=False)  # "soap_api" ou "direct_interaction"
    description = Column(String, nullable=True)  # Descrição opcional
    config = Column(JSON, nullable=True)  # Configurações específicas do plugin (JSON)
    is_default = Column(Boolean, default=False)  # Se é a instância padrão para o tipo
    is_active = Column(Boolean, default=True)  # Se está ativa
    proxy_id = Column(Integer, ForeignKey("proxy_servers.id", ondelete="SET NULL"), nullable=True)  # Proxy por instância (NULL = sem proxy)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class Server(Base):
    __tablename__ = "servers"
    
    id = Column(Integer, primary_key=True, index=True)
    guid = Column(String, nullable=False, unique=True, index=True)
    name = Column(String, nullable=False)
    ip = Column(String, nullable=False)
    verified = Column(Boolean, default=False)
    favorite = Column(Boolean, default=False)
    is_checked = Column(Boolean, default=False)
    shares_count = Column(Integer, default=0)
    downloaded_files_count = Column(Integer, default=0)
    last_verified_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    # Plugin configuration - referência para instância de plugin
    plugin_instance_id = Column(Integer, ForeignKey("plugin_instances.id"), nullable=True)
    is_unreachable = Column(Boolean, default=False)  # True when server is unreachable (e.g., network error 53)
    has_no_admin_shares = Column(Boolean, default=False)  # True se tem shares que não terminam em $ (ex: "Documents", "Public")
    # Legacy fields (mantidos para compatibilidade)
    plugin_type = Column(String, default="soap_api")  # Deprecated - use plugin_instance_id
    plugin_config = Column(JSON, nullable=True)  # Deprecated - use plugin_instance_id

class ServerShare(Base):
    __tablename__ = "server_shares"
    
    id = Column(Integer, primary_key=True, index=True)
    server_id = Column(Integer, ForeignKey("servers.id"), nullable=True, index=True)
    server_guid = Column(String, nullable=False, index=True)
    share_name = Column(String, nullable=False)
    share_type = Column(String, nullable=True)
    remark = Column(String, nullable=True)
    access_denied = Column(Boolean, default=False)
    error_message = Column(String, nullable=True)
    has_children = Column(Boolean, default=False)  # True se já fez fetch dos filhos e tem conteúdo
    children_fetched = Column(Boolean, default=False)  # True se já tentou buscar os filhos
    discovered_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

class DownloadedFile(Base):
    __tablename__ = "downloaded_files"
    
    id = Column(Integer, primary_key=True, index=True)
    server_id = Column(Integer, ForeignKey("servers.id"), nullable=True, index=True)
    server_guid = Column(String, nullable=False, index=True)
    share_name = Column(String, nullable=False)
    file_path = Column(String, nullable=False)
    file_name = Column(String, nullable=True)  # Nome do arquivo
    sanitized_path = Column(String, nullable=False)
    local_path = Column(String, nullable=True)  # Caminho local completo do arquivo
    file_size = Column(BigInteger, nullable=True)
    sha1_hash = Column(String(40), nullable=True)  # SHA1 hash do arquivo
    mimetype = Column(String, nullable=True)  # MIME type do arquivo (calculado via libmagic)
    downloaded_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class FileVersion(Base):
    """Armazena versões de arquivos baixados"""
    __tablename__ = "file_versions"
    
    id = Column(Integer, primary_key=True, index=True)
    server_guid = Column(String, nullable=False, index=True)
    share_name = Column(String, nullable=False, index=True)
    file_path = Column(String, nullable=False, index=True)  # Caminho original do arquivo
    version_number = Column(Integer, nullable=False, default=1)  # Número da versão
    sha1_hash = Column(String(40), nullable=False)  # SHA1 hash desta versão
    file_size = Column(BigInteger, nullable=True)
    mimetype = Column(String, nullable=True)  # MIME type do arquivo (calculado via libmagic)
    local_path = Column(String, nullable=False)  # Caminho local onde está armazenado
    is_current = Column(Boolean, default=True)  # Se é a versão atual
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    # OCR fields
    ocr_content = Column(Text, nullable=True)  # Texto extraído via OCR/Tika
    ocr_metadata = Column(JSON, nullable=True)  # Metadados do arquivo (autor, título, etc)
    ocr_processed = Column(Boolean, default=False)  # Se OCR foi processado
    ocr_processed_at = Column(DateTime(timezone=True), nullable=True)  # Quando OCR foi processado
    ocr_error = Column(String, nullable=True)  # Erro de OCR se houver


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
    modified_at = Column(DateTime(timezone=True), nullable=True)
    access_denied = Column(Boolean, default=False)
    error_message = Column(String, nullable=True)
    has_children = Column(Boolean, default=False)
    children_fetched = Column(Boolean, default=False)
    discovered_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class PfxPassword(Base):
    """Armazena senhas de arquivos PFX para reutilização"""
    __tablename__ = "pfx_passwords"
    
    id = Column(Integer, primary_key=True, index=True)
    server_guid = Column(String, nullable=False, index=True)
    file_path = Column(String, nullable=False, index=True)
    password = Column(String, nullable=False)  # Senha em texto (ambiente interno)
    subject_cn = Column(String, nullable=True)  # CN do certificado para identificação
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class DownloadJob(Base):
    """Jobs de download de arquivos - processados pelo backend"""
    __tablename__ = "download_jobs"
    
    id = Column(Integer, primary_key=True, index=True)
    server_id = Column(Integer, nullable=False, index=True)
    server_name = Column(String, nullable=True)
    server_ip = Column(String, nullable=True)
    share_name = Column(String, nullable=False)
    file_path = Column(String, nullable=False)
    file_name = Column(String, nullable=True)
    file_size = Column(BigInteger, nullable=True)  # Tamanho esperado
    downloaded_bytes = Column(BigInteger, default=0)  # Bytes baixados
    total_bytes = Column(BigInteger, nullable=True)  # Total a baixar
    progress = Column(Integer, default=0)  # Porcentagem 0-100
    status = Column(String, default='pending')  # pending, downloading, paused, completed, failed, cancelled, skipped
    error_message = Column(String, nullable=True)
    skip_reason = Column(String, nullable=True)  # Motivo se foi ignorado (ex: tamanho)
    priority = Column(Integer, default=0)  # Prioridade na fila
    # Parâmetros de configuração do job
    max_file_size_bytes = Column(BigInteger, nullable=True)  # Limite de tamanho para ignorar (null = sem limite)
    max_depth = Column(Integer, nullable=True)  # Limite de profundidade para diretórios
    is_directory = Column(Boolean, default=False)  # Se é um diretório (download recursivo)
    parent_job_id = Column(Integer, nullable=True)  # Job pai (para downloads recursivos)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)


class DownloadSegment(Base):
    """Segmentos de download para multi-thread e resume"""
    __tablename__ = "download_segments"

    id = Column(Integer, primary_key=True, index=True)
    job_id = Column(Integer, nullable=False, index=True)
    segment_index = Column(Integer, nullable=False)        # 0, 1, 2...
    offset_start = Column(BigInteger, nullable=False)
    offset_end = Column(BigInteger, nullable=False)        # exclusive
    downloaded_bytes = Column(BigInteger, default=0)
    status = Column(String, default='pending')             # pending/downloading/completed/failed
    temp_path = Column(String, nullable=True)
    error_message = Column(String, nullable=True)
    retry_count = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    completed_at = Column(DateTime(timezone=True), nullable=True)


class ScanJob(Base):
    """Jobs de scan de diretório para download em massa"""
    __tablename__ = "scan_jobs"
    
    id = Column(Integer, primary_key=True, index=True)
    server_guid = Column(String, nullable=False)
    share_name = Column(String, nullable=False)
    path = Column(String, nullable=False)
    max_depth = Column(Integer, default=10)
    critical_only = Column(Boolean, default=False)  # Flag para busca crítica
    status = Column(String, default='pending')  # pending, running, completed, failed, cancelled
    total_files = Column(Integer, default=0)
    processed_files = Column(Integer, default=0)
    queued_files = Column(Integer, default=0)
    critical_files_found = Column(Integer, default=0)  # Contador de arquivos críticos
    error_message = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)


class GitleaksFinding(Base):
    """Findings do GitLeaks persistidos no banco de dados"""
    __tablename__ = "gitleaks_findings"
    
    id = Column(Integer, primary_key=True, index=True)
    fingerprint = Column(String, unique=True, nullable=False, index=True)  # Identificador único do finding
    
    # Dados do finding
    rule_id = Column(String, nullable=False, index=True)
    description = Column(String, nullable=True)
    match = Column(Text, nullable=True)
    secret = Column(Text, nullable=True)
    start_line = Column(Integer, nullable=True)
    end_line = Column(Integer, nullable=True)
    start_column = Column(Integer, nullable=True)
    end_column = Column(Integer, nullable=True)
    entropy = Column(Float, nullable=True)
    tags = Column(JSON, nullable=True)  # Lista de tags
    
    # Dados do arquivo
    file_path = Column(String, nullable=True)  # Caminho físico escaneado
    original_file = Column(String, nullable=True)  # Caminho original (sem .ocr/.metadata)
    detection_source = Column(String, nullable=True)  # "ocr", "metadata" ou null
    
    # IDs extraídos do caminho (formato legado)
    extracted_server_id = Column(Integer, nullable=True)
    extracted_file_id = Column(Integer, nullable=True)
    extracted_version = Column(Integer, nullable=True)
    
    # IDs extraídos do caminho (novo formato)
    extracted_server_guid = Column(String, nullable=True, index=True)  # GUID do servidor
    extracted_share_id = Column(Integer, nullable=True)  # ID do share
    extracted_file_version_id = Column(Integer, nullable=True)  # ID da versão do arquivo
    
    # Dados do servidor/arquivo (enriquecidos)
    server_name = Column(String, nullable=True)
    server_ip = Column(String, nullable=True)
    file_name = Column(String, nullable=True)
    server_path = Column(String, nullable=True)
    share_name = Column(String, nullable=True)
    
    # Metadados do scan
    job_id = Column(String, nullable=True, index=True)
    server_id = Column(Integer, nullable=True, index=True)  # Server ID do job
    scanned_at = Column(DateTime(timezone=True), nullable=True)
    
    # Dados adicionais
    raw_data = Column(JSON, nullable=True)  # JSON completo do finding original
    is_false_positive = Column(Boolean, default=False, nullable=False)  # Marcado como falso positivo

    # Vínculo com repositório Git (módulo GIT). Quando preenchido, o finding veio
    # de um repositório clonado e não de um servidor SMB.
    git_repo_id = Column(Integer, nullable=True, index=True)
    git_repo_guid = Column(String, nullable=True, index=True)

    # Vazamentos encontrados no HISTÓRICO do git (gitleaks git). Quando preenchido,
    # o segredo estava num commit específico (possivelmente antigo/removido).
    commit_hash = Column(String, nullable=True, index=True)
    commit_author = Column(String, nullable=True)
    commit_date = Column(DateTime(timezone=True), nullable=True)
    git_file_id = Column(Integer, nullable=True, index=True)  # liga à versão GitRepoFile, quando houver

    # JWT: claims/header decodificados (texto plano) para permitir busca pelo conteúdo.
    decoded_claims = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class OCRJob(Base):
    """Jobs de OCR em background"""
    __tablename__ = "ocr_jobs"
    __table_args__ = (
        Index('idx_ocr_jobs_status', 'status'),
        Index('idx_ocr_jobs_status_priority_created', 'status', 'priority', 'created_at'),
        Index('idx_ocr_jobs_file_id', 'file_id'),
    )
    
    id = Column(Integer, primary_key=True, index=True)
    file_id = Column(Integer, ForeignKey("downloaded_files.id"), nullable=False)
    version_id = Column(Integer, ForeignKey("file_versions.id"), nullable=True)
    server_id = Column(Integer, nullable=False)
    file_path = Column(String, nullable=False)
    file_name = Column(String, nullable=False)
    local_path = Column(String, nullable=True)  # Caminho local do arquivo baixado
    ocr_language = Column(String, default="eng+por")
    status = Column(String, default='pending')  # pending, running, completed, failed, skipped
    ocr_text = Column(Text, nullable=True)
    ocr_metadata = Column(JSON, nullable=True)
    error_message = Column(String, nullable=True)
    priority = Column(Integer, default=0)  # Higher = more priority
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class ScanPool(Base):
    """Pools de configuração para scans de shares"""
    __tablename__ = "scan_pools"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    simultaneous_scanners = Column(Integer, default=3)
    request_delay_min = Column(Integer, default=100)   # ms
    request_delay_max = Column(Integer, default=500)   # ms
    include_servers = Column(String, default="")        # comma-separated
    exclude_servers = Column(String, default="")        # comma-separated
    include_ips = Column(String, default="")            # comma-separated (IPs e subnets)
    exclude_ips = Column(String, default="")            # comma-separated (IPs e subnets)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class ShareScanJob(Base):
    """Jobs de scan de shares em servidores"""
    __tablename__ = "share_scan_jobs"
    __table_args__ = (
        Index('idx_share_scan_jobs_status', 'status'),
        Index('idx_share_scan_jobs_server_id', 'server_id'),
        Index('idx_share_scan_jobs_scan_pool_id', 'scan_pool_id'),
    )

    id = Column(Integer, primary_key=True, index=True)
    server_id = Column(Integer, ForeignKey("servers.id"), nullable=False)
    scan_pool_id = Column(Integer, ForeignKey("scan_pools.id"), nullable=False)
    status = Column(String, default='pending')  # pending, running, completed, failed, cancelled
    shares_found = Column(Integer, default=0)
    error_message = Column(String, nullable=True)
    priority = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class AppSettings(Base):
    """Configurações gerais da aplicação"""
    __tablename__ = "app_settings"
    
    id = Column(Integer, primary_key=True, index=True)
    key = Column(String, unique=True, nullable=False, index=True)
    value = Column(String, nullable=True)
    description = Column(String, nullable=True)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


# ===========================================================================
# AD Explorer - exploração da árvore do Active Directory (base = domínio)
# ===========================================================================

class AdDomain(Base):
    """Domínio do Active Directory explorado (base do AD Explorer).

    A árvore de objetos é armazenada em ad_objects e montada pelo mesmo
    princípio das OUs (via ChildObjects de Domain/OU/Container).
    """
    __tablename__ = "ad_domains"

    id = Column(Integer, primary_key=True, index=True)
    guid = Column(String, unique=True, nullable=False, index=True)
    name = Column(String, nullable=False)              # FQDN do domínio (ex.: sbsp.corp)
    domain_sid = Column(String, nullable=True, index=True)
    netbios = Column(String, nullable=True)
    # Configuração para scan LDAP ao vivo (fases futuras)
    dc_hosts = Column(Text, nullable=True)             # DCs informados manualmente (CSV)
    dc_discovery = Column(Boolean, default=True)       # descobrir DCs via DNS SRV
    use_ldaps = Column(Boolean, default=True)
    auth_method = Column(String, nullable=True)        # cert | user_password | kerberos
    credential_id = Column(Integer, nullable=True)     # FK Credential (user/senha ou kerberos)
    client_cert = Column(Text, nullable=True)          # PEM do certificado cliente (mTLS)
    client_key = Column(Text, nullable=True)           # PEM da chave privada
    selected_dc = Column(String, nullable=True)        # DC escolhido (menor latência)
    # Estado
    source = Column(String, default="bloodhound")      # bloodhound | ldap
    object_count = Column(Integer, default=0)
    last_scan_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class AdObject(Base):
    """Objeto do AD (nó da árvore) com campos no padrão BloodHound v6."""
    __tablename__ = "ad_objects"

    id = Column(Integer, primary_key=True, index=True)
    domain_id = Column(Integer, ForeignKey("ad_domains.id"), nullable=False, index=True)
    object_id = Column(String, nullable=False, index=True)       # ObjectIdentifier (SID/GUID)
    object_type = Column(String, nullable=False, index=True)     # Domain/OU/Container/GPO/Group/User/Computer
    name = Column(String, nullable=True, index=True)             # Properties.name
    distinguished_name = Column(Text, nullable=True)
    samaccountname = Column(String, nullable=True, index=True)
    description = Column(Text, nullable=True)
    parent_object_id = Column(String, nullable=True, index=True) # hierarquia (ChildObjects/ContainedBy)
    parent_dn = Column(String, nullable=True, index=True)        # DN do pai (navegação incremental durante a varredura)
    enabled = Column(Boolean, nullable=True)
    highvalue = Column(Boolean, nullable=True)
    whencreated = Column(BigInteger, nullable=True)
    has_children = Column(Boolean, default=False)
    child_count = Column(Integer, default=0)
    properties = Column(JSON, nullable=True)                     # Properties completos do BH v6
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        Index('idx_ad_objects_domain_objid', 'domain_id', 'object_id', unique=True),
        Index('idx_ad_objects_domain_parent', 'domain_id', 'parent_object_id'),
        Index('idx_ad_objects_domain_parentdn', 'domain_id', 'parent_dn'),
        Index('idx_ad_objects_domain_type', 'domain_id', 'object_type'),
        Index('idx_ad_objects_name', 'name'),
        Index('idx_ad_objects_sam', 'samaccountname'),
    )


class AdGroupMember(Base):
    """Associação de pertinência de grupo (grupo → membro direto).

    Preenchida a partir de BloodHound (`Members`) ou do atributo LDAP `member`.
    Permite expandir um grupo na árvore para ver seus membros, que não fazem
    parte da hierarquia de DN (parent/child)."""
    __tablename__ = "ad_group_members"

    id = Column(Integer, primary_key=True, index=True)
    domain_id = Column(Integer, ForeignKey("ad_domains.id"), nullable=False, index=True)
    group_object_id = Column(String, nullable=False, index=True)   # object_id do grupo
    member_object_id = Column(String, nullable=False, index=True)  # object_id do membro

    __table_args__ = (
        Index('idx_ad_group_members_domain_group', 'domain_id', 'group_object_id'),
        Index('idx_ad_group_members_uniq', 'domain_id', 'group_object_id', 'member_object_id', unique=True),
    )


class AdScanJob(Base):
    """Job de importação/varredura do AD (BloodHound ou LDAP) em background."""
    __tablename__ = "ad_scan_jobs"

    id = Column(Integer, primary_key=True, index=True)
    domain_id = Column(Integer, ForeignKey("ad_domains.id"), nullable=False, index=True)
    job_type = Column(String, default="bloodhound")   # bloodhound | ldap
    status = Column(String, default="pending")        # pending, running, completed, failed, cancelled
    source_path = Column(Text, nullable=True)          # diretório/arquivo de origem (BH)
    total_objects = Column(Integer, default=0)
    processed_objects = Column(Integer, default=0)
    current_step = Column(String, nullable=True)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    started_at = Column(DateTime(timezone=True), nullable=True)
    finished_at = Column(DateTime(timezone=True), nullable=True)


class GitInstance(Base):
    """Instância de uma plataforma Git (GitHub/GHE, GitLab, Gitea, Bitbucket,
    Azure DevOps). Guarda plataforma, URL, token (Credential) e o whoami."""
    __tablename__ = "git_instances"

    id = Column(Integer, primary_key=True, index=True)
    guid = Column(String, nullable=False, unique=True, index=True, default=lambda: uuid.uuid4().hex)
    name = Column(String, nullable=True)            # rótulo (host por padrão)
    platform = Column(String, nullable=False)       # github, github_enterprise, gitlab, gitea, bitbucket, azure_devops
    base_url = Column(String, nullable=False)       # URL informada (normalizada)
    api_url = Column(String, nullable=True)         # base da API resolvida
    web_url = Column(String, nullable=True)
    variant = Column(String, nullable=True)         # bitbucket: cloud|server
    org = Column(String, nullable=True)             # azure devops: organização
    clone_auth = Column(String, default="authenticated")  # anonymous|authenticated
    credential_id = Column(Integer, ForeignKey("credentials.id", ondelete="SET NULL"), nullable=True)
    proxy_id = Column(Integer, nullable=True)
    whoami = Column(JSON, nullable=True)            # info read-only do usuário autenticado
    status = Column(String, default="unknown")      # ok|failed|unknown
    error = Column(Text, nullable=True)
    last_tested_at = Column(DateTime(timezone=True), nullable=True)
    projects_count = Column(Integer, nullable=True)                 # nº de projetos listados (cache)
    projects_refreshed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))


class GitInstanceProject(Base):
    """Projeto/repo listado de uma GitInstance (persistido p/ não refazer a listagem
    a cada vez). Inclui todos os grupos/subgrupos/orgs acessíveis pelo token."""
    __tablename__ = "git_instance_projects"
    __table_args__ = (
        Index('idx_gip_instance', 'instance_id'),
        Index('idx_gip_instance_full', 'instance_id', 'full_name', unique=True),
    )

    id = Column(Integer, primary_key=True, index=True)
    instance_id = Column(Integer, ForeignKey("git_instances.id", ondelete="CASCADE"), nullable=False)
    full_name = Column(String, nullable=False)
    name = Column(String, nullable=True)
    clone_url = Column(String, nullable=True)
    html_url = Column(String, nullable=True)
    description = Column(Text, nullable=True)
    default_branch = Column(String, nullable=True)
    is_private = Column(Boolean, nullable=True)
    size_kb = Column(BigInteger, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))


class GitRepo(Base):
    """Repositório Git descoberto/clonado pelo módulo GIT."""
    __tablename__ = "git_repos"
    __table_args__ = (
        Index('idx_git_repos_clone_status', 'clone_status'),
        Index('idx_git_repos_full_name', 'full_name'),
    )

    id = Column(Integer, primary_key=True, index=True)
    guid = Column(String, nullable=False, unique=True, index=True, default=lambda: uuid.uuid4().hex)
    full_name = Column(String, nullable=False, index=True)  # owner/repo
    owner = Column(String, nullable=True)
    name = Column(String, nullable=True)
    html_url = Column(String, nullable=True)
    clone_url = Column(String, nullable=True)
    description = Column(Text, nullable=True)
    default_branch = Column(String, nullable=True)
    stars = Column(Integer, default=0)
    forks = Column(Integer, default=0)
    language = Column(String, nullable=True)
    topics = Column(JSON, nullable=True)  # lista de tags/topics
    size_kb = Column(BigInteger, nullable=True)
    pushed_at = Column(DateTime(timezone=True), nullable=True, index=True)  # último push no GitHub (prioridade do clone)
    is_private = Column(Boolean, default=False)
    source = Column(String, default="github")  # github, gitlab, ...
    discovered_via = Column(String, nullable=True)  # termo de busca que encontrou o repo
    search_type = Column(String, nullable=True)  # code, repositories
    # Pipeline
    clone_status = Column(String, default="pending")  # pending, cloning, cloned, failed
    local_path = Column(String, nullable=True)  # caminho relativo sob gitclones/
    clone_error = Column(Text, nullable=True)
    scan_status = Column(String, default="pending")  # pending, running, completed, failed, skipped
    ocr_status = Column(String, default="pending")
    index_status = Column(String, default="pending")
    leaks_count = Column(Integer, default=0)
    files_count = Column(Integer, default=0)
    history_indexed = Column(Boolean, default=False)  # True = histórico de commits indexado (clone completo)
    commits_count = Column(Integer, nullable=True)     # nº de commits percorridos
    branches_count = Column(Integer, nullable=True)    # nº de branches percorridas
    cloned_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class GitRepoFile(Base):
    """Arquivo pertencente a um repositório Git clonado."""
    __tablename__ = "git_repo_files"
    __table_args__ = (
        Index('idx_git_repo_files_repo_id', 'repo_id'),
        Index('idx_git_repo_files_repo_guid', 'repo_guid'),
        Index('idx_git_repo_files_rel_path', 'rel_path'),
        Index('idx_git_repo_files_repo_path_date', 'repo_id', 'rel_path', 'commit_date'),
        Index('idx_git_repo_files_repo_head', 'repo_id', 'is_head'),
    )

    id = Column(Integer, primary_key=True, index=True)
    repo_id = Column(Integer, ForeignKey("git_repos.id", ondelete="CASCADE"), nullable=False)
    repo_guid = Column(String, nullable=True, index=True)
    rel_path = Column(String, nullable=False)  # caminho relativo dentro do repo
    name = Column(String, nullable=True)
    extension = Column(String, nullable=True)
    size = Column(BigInteger, nullable=True)
    sha1 = Column(String, nullable=True)
    mimetype = Column(String, nullable=True)
    is_binary = Column(Boolean, default=False)
    content = Column(Text, nullable=True)  # texto extraído (plain/OCR) para indexação
    content_extracted = Column(Boolean, default=False)
    content_error = Column(String, nullable=True)
    indexed = Column(Boolean, default=False)  # indexado no OpenSearch
    indexed_at = Column(DateTime(timezone=True), nullable=True)
    # ----------------------------------------------------------------------
    # Versionamento por commit (indexação de histórico, estilo filecrawler).
    # Cada linha é uma VERSÃO de conteúdo de um path: 1 linha por (repo, rel_path,
    # blob_sha). A versão atual do working tree tem is_head=True; versões antigas e
    # arquivos removidos têm is_head=False. commit_* descreve o commit onde aquela
    # versão apareceu (o mais recente que introduziu aquele blob).
    # ----------------------------------------------------------------------
    blob_sha = Column(String, nullable=True, index=True)   # git object sha do blob (dedup)
    commit_hash = Column(String, nullable=True, index=True)  # hexsha completo do commit
    commit_short = Column(String, nullable=True)            # hexsha curto (7)
    branch = Column(String, nullable=True)                  # branch onde foi observado
    author = Column(String, nullable=True)                  # nome do autor do commit
    author_email = Column(String, nullable=True)
    commit_date = Column(DateTime(timezone=True), nullable=True, index=True)
    change_type = Column(String, nullable=True)             # A / M / D / R
    is_head = Column(Boolean, default=False, index=True)    # versão atual (working tree)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class GitCloneJob(Base):
    """Jobs de clone de repositórios Git - processados em background pelo git_clone_worker."""
    __tablename__ = "git_clone_jobs"
    __table_args__ = (
        Index('idx_git_clone_jobs_status', 'status'),
        Index('idx_git_clone_jobs_status_priority_created', 'status', 'priority', 'created_at'),
    )

    id = Column(Integer, primary_key=True, index=True)
    repo_id = Column(Integer, ForeignKey("git_repos.id", ondelete="SET NULL"), nullable=True)
    repo_url = Column(String, nullable=False)  # https://github.com/owner/repo.git
    repo_full_name = Column(String, nullable=True)  # owner/repo
    clone_auth = Column(String, default="anonymous")  # anonymous, authenticated
    credential_id = Column(Integer, ForeignKey("credentials.id", ondelete="SET NULL"), nullable=True)
    proxy_id = Column(Integer, nullable=True)  # ProxyServer p/ clone (None = sem proxy)
    clone_mode = Column(String, default="clone")  # clone | dump (.git exposto na web)
    depth = Column(Integer, nullable=True)  # git clone --depth
    status = Column(String, default="pending")  # pending, running, completed, failed, cancelled
    priority = Column(Integer, default=0)
    current_step = Column(String, nullable=True)  # clone, gitleaks, ocr, index
    total_files = Column(Integer, default=0)
    processed_files = Column(Integer, default=0)
    leaks_found = Column(Integer, default=0)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


# Configurações padrão
DEFAULT_SETTINGS = {
    'max_simultaneous_downloads': ('3', 'Número máximo de downloads simultâneos'),
    'max_simultaneous_ocr_jobs': ('2', 'Número máximo de jobs OCR simultâneos'),
    'max_simultaneous_scans': ('3', 'Número máximo de scans de diretório simultâneos'),
    'ocr_auto_cleanup_minutes': ('15', 'Minutos para limpeza automática de jobs OCR finalizados com sucesso'),
    'default_depth_levels': ('5', 'Quantidade padrão de níveis de profundidade'),
    'default_max_file_size_mb': ('100', 'Tamanho máximo padrão de arquivo (MB)'),
    'ignored_extensions': ('.log,.tmp,.bak,.log.*', 'Extensões de arquivo a ignorar no batch download (suporta wildcards como .log.*)'),
    'auto_ocr_enabled': ('true', 'Habilita OCR automático após download'),
    'auto_ocr_extensions': ('.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.rtf,.odt,.ods,.odp,.pfx,.p12,.cer,.crt,.pem', 'Extensões de arquivo para OCR automático'),
    'auto_ocr_mimetypes': ('application/pdf,image/,application/msword,application/vnd.openxmlformats-officedocument,application/vnd.ms-excel,application/vnd.ms-powerpoint,application/vnd.oasis.opendocument,application/x-pkcs12,application/x-x509-ca-cert', 'MIME types para OCR automático (parcial match)'),
    'auto_ocr_excluded_extensions': ('.svg,.jpeg,.jpg,.png,.gif,.ico,.webp,.tiff,.tif,.psd,.raw,.heic,.heif,.css,.html,.htm,.ttf,.otf,.woff,.woff2,.eot,.pyc,.pyo,.class,.jar,.exe,.dll,.msi,.sys,.drv,.ocx,.cpl,.scr,.so,.dylib,.a,.bin,.dat,.pdb,.obj,.o,.mp4,.avi,.mkv,.mov,.wmv,.flv,.webm,.m4v,.mpeg,.mpg,.mp3,.wav,.wma,.aac,.flac,.ogg,.m4a,.zip,.rar,.7z,.tar,.gz,.tgz,.bz2,.xz,.lzma,.iso,.img,.vhd,.vhdx,.vmdk,.qcow2,.cab,.msp,.msm,.msu,.mdb,.accdb,.ldb,.etl,.evtx,.dmp,.emf,.bdb,.vox,.pkl,.parquet,.parq,.rsc,.DS_Store,.idea,.svn,.pyenv,.git,.gitignore,.npmrc,.yarnrc,.ascx,.config,.aspx,.asp,.asmx,.json', 'Extensões excluídas do OCR automático (precedência sobre inclusão)'),
    'auto_index_enabled': ('true', 'Habilita auto-indexação de conteúdo bruto quando OCR não é executado'),
    'auto_index_max_size_mb': ('1', 'Tamanho máximo do arquivo (MB) para auto-indexação'),
    'auto_index_extensions': ('.txt,.csv,.xml,.json,.yaml,.yml,.ini,.cfg,.conf,.log,.md,.bat,.ps1,.sh,.py,.js,.ts,.sql,.vbs,.cmd,.reg,.inf,.properties,.env*,.toml', 'Extensões de arquivo para auto-indexação (suporta wildcards como .env*)'),
    'auto_index_mimetypes': ('text/', 'MIME types para auto-indexação (parcial match)'),
    'download_threads_per_file': ('3', 'Segmentos paralelos por arquivo grande (>100MB)'),
    # Importação de servidores
    'import_ports': ('445,3389,1433,3306,5432,1521,27017,6379,5984,9200', 'Portas consideradas na importação de servidores (hosts com alguma dessas portas abertas são importados). SMB 445, RDP 3389 e bancos de dados.'),
    # Aparência / UI
    'ui_logo_url': ('https://media.sec4us.com.br/logo/sec4us-dark-mode.svg', 'URL da logo exibida no cabeçalho do sistema'),
    'ui_logo_alignment': ('center', 'Alinhamento da logo no cabeçalho: left, center ou right'),
    'ui_sidebar_active_color': ('#34d399', 'Cor do item selecionado no menu lateral (sidebar)'),
    'ui_favicon_url': ('https://media.sec4us.com.br/icon/favicon.ico', 'URL do favicon (ícone da aba do navegador)'),
    # Módulo GIT
    'max_simultaneous_git_clones': ('2', 'Número máximo de clones Git simultâneos (fila de rede — roda em paralelo ao pós-processamento)'),
    'max_simultaneous_git_postprocess': ('2', 'Número máximo de pós-processamentos Git simultâneos (gitleaks → extração → indexação; CPU/disco)'),
    'git_clone_depth': ('1', 'Profundidade do git clone (--depth) usada SOMENTE no modo raso (repo grande ou fallback de timeout)'),
    'git_clone_large_repo_mb': ('100', 'Tamanho (MB) a partir do qual o repositório é clonado raso (--depth 1); abaixo disso o clone é completo. 0 = sempre completo. O download nunca é pulado'),
    'git_clone_auth_default': ('anonymous', 'Modo de autenticação padrão para clone: anonymous ou authenticated'),
    'git_index_max_size_mb': ('2', 'Tamanho máximo (MB) de arquivo de repositório Git para extração/indexação de conteúdo'),
    'git_clone_job_timeout_min': ('120', 'Backstop absoluto (min): tempo máx. de um job de clone em execução antes do watchdog reenfileirá-lo, mesmo progredindo. 0 = desativa'),
    'git_clone_stall_min': ('10', 'Watchdog: minutos SEM progresso (bytes do clone / arquivos indexados sem crescer) antes de considerar o job travado e reenfileirá-lo. 0 = desativa a detecção de estagnação'),
    'git_index_history': ('true', 'Indexa TODO o histórico de commits/branches (cada versão de cada arquivo), não apenas o HEAD. Requer clone completo'),
    'git_history_max_commits': ('5000', 'Máximo de commits percorridos por repositório ao indexar histórico (0 = ilimitado). Protege contra repos gigantes'),
    'git_history_max_versions_per_file': ('100', 'Máximo de versões (commits distintos) indexadas por arquivo (0 = ilimitado)'),
    'git_dump_max_objects': ('1000000', 'Git Dump: número máximo de objetos (commits/trees/blobs) baixados de um .git EXPOSTO na web. Protege contra repositórios gigantes; 0 = ilimitado'),
    # User-Agent global aplicado a TODA chamada HTTP externa. {VERSION} é substituído
    # pela versão atual do ShadowIndex.
    'http_user_agent': ('Mozilla/5.0 (ShadowIndex {VERSION} x64) AppleWebKit/537.36 (KHTML like Gecko) Chrome/146.0.0.0 Safari/537.36',
                        'User-Agent usado em todas as requisições HTTP externas. {VERSION} vira a versão do ShadowIndex'),
}


async def apply_pending_migrations():
    """
    Aplica migrações pendentes verificando colunas faltantes em tabelas existentes.
    create_all() do SQLAlchemy NÃO adiciona colunas novas a tabelas já existentes,
    então precisamos fazer isso manualmente.
    """
    from sqlalchemy import text

    async with engine.begin() as conn:
        if DATABASE_TYPE == 'postgresql':
            # Verificar se proxy_id existe em plugin_instances
            result = await conn.execute(text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name = 'plugin_instances' AND column_name = 'proxy_id'"
            ))
            if not result.fetchone():
                logger.info("Applying migration: adding proxy_id to plugin_instances")
                await conn.execute(text(
                    "ALTER TABLE plugin_instances ADD COLUMN proxy_id INTEGER"
                ))
                await conn.execute(text(
                    "ALTER TABLE plugin_instances ADD CONSTRAINT fk_plugin_instances_proxy_id "
                    "FOREIGN KEY (proxy_id) REFERENCES proxy_servers(id) ON DELETE SET NULL"
                ))
                logger.info("Migration applied: proxy_id added to plugin_instances")

            # Verificar se favorite existe em servers
            result = await conn.execute(text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name = 'servers' AND column_name = 'favorite'"
            ))
            if not result.fetchone():
                logger.info("Applying migration: adding favorite to servers")
                await conn.execute(text(
                    "ALTER TABLE servers ADD COLUMN favorite BOOLEAN DEFAULT FALSE"
                ))
                logger.info("Migration applied: favorite added to servers")

            # Verificar se is_checked existe em servers
            result = await conn.execute(text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name = 'servers' AND column_name = 'is_checked'"
            ))
            if not result.fetchone():
                logger.info("Applying migration: adding is_checked to servers")
                await conn.execute(text(
                    "ALTER TABLE servers ADD COLUMN is_checked BOOLEAN DEFAULT FALSE"
                ))
                logger.info("Migration applied: is_checked added to servers")

            # Verificar se retry_count existe em download_segments
            result = await conn.execute(text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name = 'download_segments' AND column_name = 'retry_count'"
            ))
            if not result.fetchone():
                logger.info("Applying migration: adding retry_count to download_segments")
                await conn.execute(text(
                    "ALTER TABLE download_segments ADD COLUMN retry_count INTEGER DEFAULT 0"
                ))
                logger.info("Migration applied: retry_count added to download_segments")

            # Verificar se dns_servers existe em proxy_servers
            result = await conn.execute(text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name = 'proxy_servers' AND column_name = 'dns_servers'"
            ))
            if not result.fetchone():
                logger.info("Applying migration: adding dns_servers to proxy_servers")
                await conn.execute(text(
                    "ALTER TABLE proxy_servers ADD COLUMN dns_servers VARCHAR"
                ))
                logger.info("Migration applied: dns_servers added to proxy_servers")

            # Verificar se kerberos_ccache existe em credentials
            result = await conn.execute(text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name = 'credentials' AND column_name = 'kerberos_ccache'"
            ))
            if not result.fetchone():
                logger.info("Applying migration: adding kerberos_ccache to credentials")
                await conn.execute(text(
                    "ALTER TABLE credentials ADD COLUMN kerberos_ccache TEXT"
                ))
                logger.info("Migration applied: kerberos_ccache added to credentials")

            # Verificar se kdc_host existe em credentials
            result = await conn.execute(text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name = 'credentials' AND column_name = 'kdc_host'"
            ))
            if not result.fetchone():
                logger.info("Applying migration: adding kdc_host to credentials")
                await conn.execute(text(
                    "ALTER TABLE credentials ADD COLUMN kdc_host VARCHAR"
                ))
                logger.info("Migration applied: kdc_host added to credentials")

            # AD Explorer: parent_dn em ad_objects (navegação incremental)
            result = await conn.execute(text(
                "SELECT to_regclass('public.ad_objects')"
            ))
            if result.scalar():
                result = await conn.execute(text(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_name = 'ad_objects' AND column_name = 'parent_dn'"
                ))
                if not result.fetchone():
                    logger.info("Applying migration: adding parent_dn to ad_objects")
                    await conn.execute(text("ALTER TABLE ad_objects ADD COLUMN parent_dn VARCHAR"))
                    await conn.execute(text(
                        "CREATE INDEX IF NOT EXISTS idx_ad_objects_domain_parentdn "
                        "ON ad_objects (domain_id, parent_dn)"
                    ))
                    logger.info("Migration applied: parent_dn added to ad_objects")

            # Módulo GIT: colunas de vínculo em gitleaks_findings
            result = await conn.execute(text(
                "SELECT to_regclass('public.gitleaks_findings')"
            ))
            if result.scalar():
                for col, coltype in (('git_repo_id', 'INTEGER'), ('git_repo_guid', 'VARCHAR')):
                    result = await conn.execute(text(
                        "SELECT column_name FROM information_schema.columns "
                        f"WHERE table_name = 'gitleaks_findings' AND column_name = '{col}'"
                    ))
                    if not result.fetchone():
                        logger.info(f"Applying migration: adding {col} to gitleaks_findings")
                        await conn.execute(text(
                            f"ALTER TABLE gitleaks_findings ADD COLUMN {col} {coltype}"
                        ))
                        logger.info(f"Migration applied: {col} added to gitleaks_findings")

            # Módulo GIT: pushed_at em git_repos (prioridade do clone)
            result = await conn.execute(text("SELECT to_regclass('public.git_repos')"))
            if result.scalar():
                result = await conn.execute(text(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_name = 'git_repos' AND column_name = 'pushed_at'"
                ))
                if not result.fetchone():
                    logger.info("Applying migration: adding pushed_at to git_repos")
                    await conn.execute(text("ALTER TABLE git_repos ADD COLUMN pushed_at TIMESTAMPTZ"))
                    logger.info("Migration applied: pushed_at added to git_repos")

            # Módulo GIT: indexação de histórico (versões por commit)
            async def _pg_add_cols(table, cols):
                if not (await conn.execute(text(f"SELECT to_regclass('public.{table}')"))).scalar():
                    return
                for col, coltype in cols:
                    exists = (await conn.execute(text(
                        "SELECT column_name FROM information_schema.columns "
                        f"WHERE table_name = '{table}' AND column_name = '{col}'"
                    ))).fetchone()
                    if not exists:
                        logger.info(f"Applying migration: adding {col} to {table}")
                        await conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {coltype}"))

            await _pg_add_cols('git_repo_files', [
                ('blob_sha', 'VARCHAR'), ('commit_hash', 'VARCHAR'), ('commit_short', 'VARCHAR'),
                ('branch', 'VARCHAR'), ('author', 'VARCHAR'), ('author_email', 'VARCHAR'),
                ('commit_date', 'TIMESTAMPTZ'), ('change_type', 'VARCHAR'),
                ('is_head', 'BOOLEAN DEFAULT FALSE'),
            ])
            await _pg_add_cols('gitleaks_findings', [
                ('commit_hash', 'VARCHAR'), ('commit_author', 'VARCHAR'),
                ('commit_date', 'TIMESTAMPTZ'), ('git_file_id', 'INTEGER'),
                ('decoded_claims', 'TEXT'),
            ])
            await _pg_add_cols('git_repos', [
                ('history_indexed', 'BOOLEAN DEFAULT FALSE'),
                ('commits_count', 'INTEGER'), ('branches_count', 'INTEGER'),
            ])
            await _pg_add_cols('git_clone_jobs', [
                ('proxy_id', 'INTEGER'),
                ("clone_mode", "VARCHAR DEFAULT 'clone'"),
            ])
            await _pg_add_cols('git_instances', [
                ('projects_count', 'INTEGER'),
                ('projects_refreshed_at', 'TIMESTAMPTZ'),
            ])
            await _pg_add_cols('external_api_calls', [('remote_ip', 'VARCHAR')])
            await conn.execute(text(
                "CREATE INDEX IF NOT EXISTS idx_git_repo_files_repo_path_date "
                "ON git_repo_files (repo_id, rel_path, commit_date)"
            ))
            await conn.execute(text(
                "CREATE INDEX IF NOT EXISTS idx_git_repo_files_repo_head "
                "ON git_repo_files (repo_id, is_head)"
            ))
            # Falso positivo retroativo: findings da regra 'curl-auth-user' cuja
            # "senha" é um placeholder de template/variável (ex.: curl -u admin:{{PASS}}
            # ou admin:${PASS}) não são credenciais reais. Idempotente: só marca
            # como FP (nunca desmarca), então re-execuções não sobrescrevem decisões.
            if await conn.scalar(text("SELECT to_regclass('public.gitleaks_findings')")):
                await conn.execute(text(
                    r"""
                    UPDATE gitleaks_findings
                    SET is_false_positive = TRUE
                    WHERE lower(rule_id) = 'curl-auth-user'
                      AND is_false_positive = FALSE
                      AND (
                        coalesce(secret, '') ~ '(\{\{|\}\}|\$\{|\$\(|<[A-Za-z0-9 ._-]*>|\$[A-Za-z_])'
                        OR coalesce(match, '') ~ '(\{\{|\}\}|\$\{|\$\(|<[A-Za-z0-9 ._-]*>|\$[A-Za-z_])'
                        OR secret ~ ':\s*$'
                      )
                    """
                ))
        else:
            # SQLite: verificar via pragma
            result = await conn.execute(text("PRAGMA table_info(plugin_instances)"))
            columns = [row[1] for row in result.fetchall()]
            if 'proxy_id' not in columns:
                logger.info("Applying migration: adding proxy_id to plugin_instances")
                await conn.execute(text(
                    "ALTER TABLE plugin_instances ADD COLUMN proxy_id INTEGER REFERENCES proxy_servers(id)"
                ))
                logger.info("Migration applied: proxy_id added to plugin_instances")

            # SQLite: verificar se favorite existe em servers
            result = await conn.execute(text("PRAGMA table_info(servers)"))
            columns = [row[1] for row in result.fetchall()]
            if 'favorite' not in columns:
                logger.info("Applying migration: adding favorite to servers")
                await conn.execute(text(
                    "ALTER TABLE servers ADD COLUMN favorite BOOLEAN DEFAULT FALSE"
                ))
                logger.info("Migration applied: favorite added to servers")

            # SQLite: verificar se is_checked existe em servers
            result = await conn.execute(text("PRAGMA table_info(servers)"))
            columns = [row[1] for row in result.fetchall()]
            if 'is_checked' not in columns:
                logger.info("Applying migration: adding is_checked to servers")
                await conn.execute(text(
                    "ALTER TABLE servers ADD COLUMN is_checked BOOLEAN DEFAULT FALSE"
                ))
                logger.info("Migration applied: is_checked added to servers")

            # SQLite: verificar se retry_count existe em download_segments
            result = await conn.execute(text("PRAGMA table_info(download_segments)"))
            columns = [row[1] for row in result.fetchall()]
            if 'retry_count' not in columns:
                logger.info("Applying migration: adding retry_count to download_segments")
                await conn.execute(text(
                    "ALTER TABLE download_segments ADD COLUMN retry_count INTEGER DEFAULT 0"
                ))
                logger.info("Migration applied: retry_count added to download_segments")

            # SQLite: verificar se dns_servers existe em proxy_servers
            result = await conn.execute(text("PRAGMA table_info(proxy_servers)"))
            columns = [row[1] for row in result.fetchall()]
            if 'dns_servers' not in columns:
                logger.info("Applying migration: adding dns_servers to proxy_servers")
                await conn.execute(text(
                    "ALTER TABLE proxy_servers ADD COLUMN dns_servers VARCHAR"
                ))
                logger.info("Migration applied: dns_servers added to proxy_servers")

            # SQLite: verificar colunas de Kerberos em credentials
            result = await conn.execute(text("PRAGMA table_info(credentials)"))
            columns = [row[1] for row in result.fetchall()]
            if 'kerberos_ccache' not in columns:
                logger.info("Applying migration: adding kerberos_ccache to credentials")
                await conn.execute(text(
                    "ALTER TABLE credentials ADD COLUMN kerberos_ccache TEXT"
                ))
                logger.info("Migration applied: kerberos_ccache added to credentials")
            if 'kdc_host' not in columns:
                logger.info("Applying migration: adding kdc_host to credentials")
                await conn.execute(text(
                    "ALTER TABLE credentials ADD COLUMN kdc_host VARCHAR"
                ))
                logger.info("Migration applied: kdc_host added to credentials")

            # SQLite: Módulo GIT - colunas de vínculo em gitleaks_findings
            result = await conn.execute(text("PRAGMA table_info(gitleaks_findings)"))
            columns = [row[1] for row in result.fetchall()]
            if columns:  # tabela existe
                if 'git_repo_id' not in columns:
                    logger.info("Applying migration: adding git_repo_id to gitleaks_findings")
                    await conn.execute(text(
                        "ALTER TABLE gitleaks_findings ADD COLUMN git_repo_id INTEGER"
                    ))
                if 'git_repo_guid' not in columns:
                    logger.info("Applying migration: adding git_repo_guid to gitleaks_findings")
                    await conn.execute(text(
                        "ALTER TABLE gitleaks_findings ADD COLUMN git_repo_guid VARCHAR"
                    ))

            # SQLite: Módulo GIT - pushed_at em git_repos (prioridade do clone)
            result = await conn.execute(text("PRAGMA table_info(git_repos)"))
            columns = [row[1] for row in result.fetchall()]
            if columns and 'pushed_at' not in columns:  # tabela existe
                logger.info("Applying migration: adding pushed_at to git_repos")
                await conn.execute(text("ALTER TABLE git_repos ADD COLUMN pushed_at TIMESTAMP"))
                logger.info("Migration applied: pushed_at added to git_repos")
            # Obs.: as migrações de indexação de histórico do módulo GIT são
            # aplicadas somente em PostgreSQL (stack de produção).


async def init_db():
    """Initialize database using Alembic migrations and create default records"""
    from alembic.config import Config
    from alembic import command
    import os
    
    # Criar tabelas que não existem
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Aplicar migrações pendentes (adicionar colunas faltantes em tabelas existentes)
    await apply_pending_migrations()

    # Tentar manter Alembic version tracking atualizado
    try:
        alembic_cfg = Config(os.path.join(os.path.dirname(__file__), "alembic.ini"))
        alembic_cfg.set_main_option("script_location", os.path.join(os.path.dirname(__file__), "alembic"))

        if POSTGRES_URL:
            sync_url = POSTGRES_URL
            if sync_url.startswith('postgres://'):
                sync_url = sync_url.replace('postgres://', 'postgresql://', 1)
            alembic_cfg.set_main_option("sqlalchemy.url", sync_url)
        elif DATABASE_PATH:
            alembic_cfg.set_main_option("sqlalchemy.url", f"sqlite:///{DATABASE_PATH}")

        command.upgrade(alembic_cfg, "head")
        logger.info("Alembic migrations applied successfully")
    except Exception as e:
        logger.warning(f"Alembic version tracking failed (migrations applied manually): {e}")
    
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
        
        # Create default app settings
        for key, (default_value, description) in DEFAULT_SETTINGS.items():
            result = await session.execute(select(AppSettings).where(AppSettings.key == key))
            if not result.scalar_one_or_none():
                setting = AppSettings(key=key, value=default_value, description=description)
                session.add(setting)
        
        # Create default scan pool if none exist
        result = await session.execute(select(ScanPool))
        if not result.scalars().first():
            default_pool = ScanPool(
                name="Default Scan Pool",
                simultaneous_scanners=1,
                request_delay_min=1000,
                request_delay_max=15000,
            )
            session.add(default_pool)
            logger.info("Created default scan pool")

        # Check if default SOAP API exists
        result = await session.execute(select(SoapApiUrl).where(SoapApiUrl.name == "Default SOAP API"))
        if not result.scalar_one_or_none():
            default_soap = SoapApiUrl(
                name="Default SOAP API",
                uri="https://meudominio.local/api_tst.asmx"
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
    """Sessão de banco para operações de escrita"""
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()

async def get_db_readonly():
    """Sessão de banco somente leitura para consultas pesadas (dashboard, listagens)"""
    async with AsyncSessionReadonly() as session:
        try:
            yield session
        finally:
            await session.close()