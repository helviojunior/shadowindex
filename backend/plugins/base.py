"""
Base Plugin Interface

Abstract base class that all plugins must implement.
Provides standard interfaces for server communication plugins.

Architecture:
- All plugins must inherit from BasePlugin
- Plugins use PluginConfig for configuration
- Standard exceptions should be raised for error conditions
- All operations are async
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any
from datetime import datetime
import logging

logger = logging.getLogger(__name__)


@dataclass
class PluginConfig:
    """
    Base configuration for plugins.
    
    Attributes:
        plugin_type: Unique identifier for the plugin type (e.g., 'soap_api', 'smb')
        extra: Dictionary containing plugin-specific configuration values
    """
    plugin_type: str
    extra: Dict[str, Any] = field(default_factory=dict)
    
    def get(self, key: str, default: Any = None) -> Any:
        """Get a configuration value from extra"""
        return self.extra.get(key, default)
    
    def require(self, key: str) -> Any:
        """
        Get a required configuration value.
        
        Raises:
            ValueError: If the key is not present in config
        """
        if key not in self.extra:
            raise ValueError(f"Required configuration key '{key}' not found for plugin '{self.plugin_type}'")
        return self.extra[key]
    
    def validate(self, required_keys: List[str]) -> List[str]:
        """
        Validate that all required keys are present.
        
        Returns:
            List of missing keys (empty if all present)
        """
        return [key for key in required_keys if key not in self.extra]


@dataclass
class ShareInfo:
    """Information about a network share"""
    name: str
    share_type: str = "Disk"
    remark: str = ""
    path: str = ""  # Full UNC path


@dataclass
class DirectoryItem:
    """Information about a file or directory"""
    name: str
    item_type: str  # "File" or "Directory"
    full_path: str
    size: int = 0
    created: Optional[datetime] = None
    modified_at: Optional[datetime] = None
    is_hidden: bool = False
    extension: str = ""
    
    @property
    def is_directory(self) -> bool:
        return self.item_type == "Directory"
    
    @property
    def is_file(self) -> bool:
        return self.item_type == "File"


@dataclass
class FileContent:
    """Downloaded file content"""
    data: bytes
    size: int
    is_complete: bool = True
    offset: int = 0
    total_size: Optional[int] = None


@dataclass
class SqlResult:
    """Result of SQL query execution"""
    columns: List[str]
    rows: List[Dict[str, Any]]
    row_count: int
    execution_time_ms: float = 0
    error: Optional[str] = None


class BasePlugin(ABC):
    """
    Abstract base class for server integration plugins.
    
    All plugins must implement these methods to provide
    a consistent interface for server operations.
    
    Required Methods:
        - list_shares: List network shares on a server
        - list_directory: List contents of a directory
        - download_file: Download file content
        - resolve_address: Resolve hostname to IP
        - sql_request: Execute SQL queries
        - health_check: Verify plugin connectivity
        - validate_config: Validate plugin configuration
    """
    
    # Plugin metadata - MUST be overridden by subclasses
    PLUGIN_TYPE: str = "base"
    PLUGIN_NAME: str = "Base Plugin"
    PLUGIN_VERSION: str = "1.0.0"
    PLUGIN_DESCRIPTION: str = "Base plugin class"
    
    # Required configuration keys for this plugin
    REQUIRED_CONFIG: List[str] = []
    
    def __init__(self, config: PluginConfig, proxy_url: Optional[str] = None):
        """
        Initialize the plugin with configuration.
        
        Args:
            config: Plugin-specific configuration
            proxy_url: Optional proxy URL for connections
            
        Raises:
            ValueError: If required configuration is missing
        """
        self.config = config
        self.proxy_url = proxy_url
        self._initialized = False
        
        # Validate configuration
        missing = config.validate(self.REQUIRED_CONFIG)
        if missing:
            logger.warning(f"Plugin {self.PLUGIN_TYPE} missing config keys: {missing}")
    
    @abstractmethod
    async def list_shares(self, server_ip: str, ignore_cache: bool = False) -> List[ShareInfo]:
        """
        List all shares available on a server.
        
        Args:
            server_ip: IP address or hostname of the server
            ignore_cache: Skip cache lookup if True
            
        Returns:
            List of ShareInfo objects
            
        Raises:
            ConnectionException: If connection to server fails
            AccessDeniedException: If access is denied
        """
        pass
    
    @abstractmethod
    async def list_directory(self, path: str, ignore_cache: bool = False) -> List[DirectoryItem]:
        """
        List contents of a directory.
        
        Args:
            path: Full path to the directory (e.g., \\\\server\\share\\folder)
            ignore_cache: Skip cache lookup if True
            
        Returns:
            List of DirectoryItem objects
            
        Raises:
            ItemNotFoundException: If directory doesn't exist
            AccessDeniedException: If access is denied
            ConnectionException: If connection fails
        """
        pass
    
    @abstractmethod
    async def download_file(
        self, 
        path: str, 
        offset: int = 0, 
        length: Optional[int] = None,
        ignore_cache: bool = False
    ) -> FileContent:
        """
        Download file content, optionally in chunks.
        
        Args:
            path: Full path to the file
            offset: Starting byte position (default: 0)
            length: Number of bytes to read (default: entire file)
            ignore_cache: Skip cache lookup if True (usually True for downloads)
            
        Returns:
            FileContent with the file data
            
        Raises:
            ItemNotFoundException: If file doesn't exist
            AccessDeniedException: If access is denied
            ConnectionException: If connection fails
        """
        pass
    
    @abstractmethod
    async def resolve_address(self, hostname: str, ignore_cache: bool = False) -> str:
        """
        Resolve a hostname to an IP address.
        
        Args:
            hostname: Hostname to resolve
            ignore_cache: Skip cache lookup if True
            
        Returns:
            IP address as string
            
        Raises:
            ConnectionException: If resolution fails
        """
        pass
    
    @abstractmethod
    async def sql_request(
        self,
        connection_string: str,
        query: str,
        timeout: int = 30,
        ignore_cache: bool = False,
        db_type: Optional[str] = None
    ) -> SqlResult:
        """
        Execute a SQL query on a database.
        
        Args:
            connection_string: Database connection string
            query: SQL query to execute
            timeout: Query timeout in seconds
            ignore_cache: Skip cache lookup if True
            
        Returns:
            SqlResult with query results
            
        Raises:
            ConnectionException: If database connection fails
            PluginException: If query execution fails
        """
        pass
    
    async def health_check(self) -> Dict[str, Any]:
        """
        Verify plugin connectivity and configuration.
        
        Returns:
            Dictionary with health status:
            {
                "healthy": bool,
                "message": str,
                "details": dict (optional)
            }
        """
        return {
            "healthy": True,
            "message": "Plugin is available",
            "details": {}
        }
    
    def validate_config(self) -> Dict[str, Any]:
        """
        Validate plugin configuration.
        
        Returns:
            Dictionary with validation result:
            {
                "valid": bool,
                "missing_keys": List[str],
                "errors": List[str]
            }
        """
        missing = self.config.validate(self.REQUIRED_CONFIG)
        return {
            "valid": len(missing) == 0,
            "missing_keys": missing,
            "errors": [f"Missing required config: {key}" for key in missing]
        }
    
    def get_config_value(self, key: str, default: Any = None) -> Any:
        """Get a configuration value"""
        return self.config.get(key, default)
    
    def require_config_value(self, key: str) -> Any:
        """Get a required configuration value or raise error"""
        return self.config.require(key)
    
    @classmethod
    def get_plugin_info(cls) -> Dict[str, Any]:
        """Get plugin metadata"""
        return {
            "type": cls.PLUGIN_TYPE,
            "name": cls.PLUGIN_NAME,
            "version": cls.PLUGIN_VERSION,
            "description": cls.PLUGIN_DESCRIPTION,
            "required_config": cls.REQUIRED_CONFIG
        }
    
    @classmethod
    def get_config_schema(cls) -> Dict[str, Any]:
        """
        Get JSON schema for plugin configuration.
        Override in subclasses to provide detailed schema.
        
        Returns:
            JSON schema dictionary
        """
        return {
            "type": "object",
            "properties": {},
            "required": cls.REQUIRED_CONFIG
        }
