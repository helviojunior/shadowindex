"""
Base Plugin Interface

Abstract base class that all plugins must implement.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any
from datetime import datetime


@dataclass
class PluginConfig:
    """Base configuration for plugins"""
    plugin_type: str
    extra: Dict[str, Any] = field(default_factory=dict)
    
    def get(self, key: str, default: Any = None) -> Any:
        """Get a configuration value from extra"""
        return self.extra.get(key, default)


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
    modified: Optional[datetime] = None
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
    """
    
    # Plugin metadata
    PLUGIN_TYPE: str = "base"
    PLUGIN_NAME: str = "Base Plugin"
    PLUGIN_VERSION: str = "1.0.0"
    
    def __init__(self, config: PluginConfig, proxy_url: Optional[str] = None):
        """
        Initialize the plugin with configuration.
        
        Args:
            config: Plugin-specific configuration
            proxy_url: Optional proxy URL for connections
        """
        self.config = config
        self.proxy_url = proxy_url
    
    @abstractmethod
    async def list_shares(self, server_ip: str) -> List[ShareInfo]:
        """
        List all shares available on a server.
        
        Args:
            server_ip: IP address or hostname of the server
            
        Returns:
            List of ShareInfo objects
            
        Raises:
            ConnectionException: If connection to server fails
            AccessDeniedException: If access is denied
        """
        pass
    
    @abstractmethod
    async def list_directory(self, path: str) -> List[DirectoryItem]:
        """
        List contents of a directory.
        
        Args:
            path: Full path to the directory (e.g., \\\\server\\share\\folder)
            
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
        length: Optional[int] = None
    ) -> FileContent:
        """
        Download file content, optionally in chunks.
        
        Args:
            path: Full path to the file
            offset: Starting byte position (default: 0)
            length: Number of bytes to read (default: entire file)
            
        Returns:
            FileContent with the file data
            
        Raises:
            ItemNotFoundException: If file doesn't exist
            AccessDeniedException: If access is denied
            ConnectionException: If connection fails
        """
        pass
    
    @abstractmethod
    async def resolve_address(self, hostname: str) -> str:
        """
        Resolve a hostname to an IP address.
        
        Args:
            hostname: Hostname to resolve
            
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
        timeout: int = 30
    ) -> SqlResult:
        """
        Execute a SQL query on a database.
        
        Args:
            connection_string: Database connection string
            query: SQL query to execute
            timeout: Query timeout in seconds
            
        Returns:
            SqlResult with query results
            
        Raises:
            ConnectionException: If database connection fails
            PluginException: If query execution fails
        """
        pass
    
    def get_config_value(self, key: str, default: Any = None) -> Any:
        """Get a configuration value"""
        return self.config.get(key, default)
    
    @classmethod
    def get_plugin_info(cls) -> Dict[str, str]:
        """Get plugin metadata"""
        return {
            "type": cls.PLUGIN_TYPE,
            "name": cls.PLUGIN_NAME,
            "version": cls.PLUGIN_VERSION
        }
