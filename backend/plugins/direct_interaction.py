"""
Direct Interaction Plugin

Plugin for direct server interaction without SOAP intermediary.
Supports:
- DNS resolution with custom DNS servers and SOCKS proxy support
- Future: SMB access, direct database connections

Configuration:
    - credential_id: ID of the credential to use (from global credentials)
    - dns_mode: 'system' (use OS DNS) or 'custom' (use specified servers)
    - dns_servers: List of DNS server IPs (when dns_mode is 'custom')
"""

import asyncio
import socket
import logging
from typing import List, Optional, Dict, Any
from datetime import datetime

from .base import (
    BasePlugin, 
    PluginConfig, 
    ShareInfo, 
    DirectoryItem, 
    FileContent, 
    SqlResult
)
from .exceptions import (
    PluginException,
    ConnectionException,
    NotImplementedException
)
from .cache import get_cache

logger = logging.getLogger(__name__)


class DirectInteractionPlugin(BasePlugin):
    """
    Plugin for direct server interaction without SOAP intermediary.
    
    Currently implements:
    - DNS resolution (with custom DNS servers and SOCKS proxy support)
    
    Future:
    - SMB share access
    - Direct database connections
    
    Configuration:
        - credential_id: ID of the global credential to use
        - dns_mode: 'system' or 'custom'
        - dns_servers: List of DNS server IPs when dns_mode is 'custom'
    """
    
    PLUGIN_TYPE = "direct_interaction"
    PLUGIN_NAME = "Interação Direta"
    PLUGIN_VERSION = "1.0.0"
    PLUGIN_DESCRIPTION = "Interação direta com servidores sem intermediário SOAP"
    REQUIRED_CONFIG = []  # credential_id is optional
    
    def __init__(self, config: PluginConfig, proxy_url: Optional[str] = None):
        super().__init__(config, proxy_url)
        
        # Credential configuration
        self.credential_id = config.get("credential_id")
        
        # DNS configuration
        self.dns_mode = config.get("dns_mode", "system")  # 'system' or 'custom'
        self.dns_servers = config.get("dns_servers", [])  # List of DNS server IPs
        
        self.cache = get_cache()
        
        if proxy_url:
            logger.info(f"DirectInteractionPlugin initialized with proxy: {proxy_url}")
        
        logger.info(f"DirectInteractionPlugin initialized: dns_mode={self.dns_mode}, "
                   f"dns_servers={self.dns_servers}, credential_id={self.credential_id}")
    
    @classmethod
    def get_config_schema(cls) -> Dict[str, Any]:
        """Get JSON schema for Direct Interaction plugin configuration"""
        return {
            "type": "object",
            "properties": {
                "credential_id": {
                    "type": "integer",
                    "title": "Credencial",
                    "description": "ID da credencial global a ser utilizada"
                },
                "dns_mode": {
                    "type": "string",
                    "title": "Modo DNS",
                    "description": "Usar DNS do sistema ou servidores personalizados",
                    "enum": ["system", "custom"],
                    "default": "system"
                },
                "dns_servers": {
                    "type": "array",
                    "title": "Servidores DNS",
                    "description": "Lista de IPs de servidores DNS (quando dns_mode é 'custom')",
                    "items": {
                        "type": "string",
                        "format": "ipv4"
                    },
                    "default": []
                }
            },
            "required": []
        }
    
    async def health_check(self) -> Dict[str, Any]:
        """Check plugin connectivity by testing DNS resolution"""
        try:
            # Try to resolve a known domain
            test_domain = "google.com"
            result = await self.resolve_address(test_domain, ignore_cache=True)
            
            return {
                "healthy": True,
                "message": f"DNS resolution working ({test_domain} -> {result})",
                "details": {
                    "dns_mode": self.dns_mode,
                    "dns_servers": self.dns_servers,
                    "proxy_configured": self.proxy_url is not None
                }
            }
        except Exception as e:
            return {
                "healthy": False,
                "message": f"DNS resolution failed: {str(e)}",
                "details": {
                    "dns_mode": self.dns_mode,
                    "dns_servers": self.dns_servers,
                    "error": str(e)
                }
            }
    
    async def resolve_address(self, hostname: str, ignore_cache: bool = False) -> str:
        """
        Resolve a hostname to an IP address.
        
        Supports:
        - System DNS (default)
        - Custom DNS servers
        - SOCKS proxy for DNS queries
        
        Args:
            hostname: Hostname to resolve
            ignore_cache: Skip cache lookup if True
            
        Returns:
            IP address as string
            
        Raises:
            ConnectionException: If resolution fails
        """
        cache_key = f"direct_resolve:{hostname}:{self.dns_mode}:{','.join(self.dns_servers)}"
        
        # Check cache first
        if not ignore_cache:
            cached = self.cache.get(cache_key)
            if cached:
                logger.debug(f"DNS cache hit for {hostname}: {cached}")
                return cached
        
        try:
            if self.dns_mode == "custom" and self.dns_servers:
                # Use custom DNS servers
                ip = await self._resolve_with_custom_dns(hostname)
            else:
                # Use system DNS
                ip = await self._resolve_with_system_dns(hostname)
            
            # Cache the result
            self.cache.set(cache_key, ip, ttl_hours=24)
            
            logger.info(f"Resolved {hostname} -> {ip}")
            return ip
            
        except Exception as e:
            logger.error(f"DNS resolution failed for {hostname}: {e}")
            raise ConnectionException(f"Failed to resolve {hostname}: {str(e)}")
    
    async def _resolve_with_system_dns(self, hostname: str) -> str:
        """Resolve using system DNS"""
        try:
            # If we have a SOCKS proxy, we need to handle this differently
            if self.proxy_url and self.proxy_url.startswith("socks"):
                return await self._resolve_through_socks(hostname)
            
            # Normal system DNS resolution
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(
                None, 
                socket.gethostbyname, 
                hostname
            )
            return result
        except socket.gaierror as e:
            raise ConnectionException(f"System DNS failed for {hostname}: {e}")
    
    async def _resolve_with_custom_dns(self, hostname: str) -> str:
        """Resolve using custom DNS servers"""
        try:
            import dns.resolver
        except ImportError:
            # Fallback if dnspython is not installed
            logger.warning("dnspython not installed, falling back to system DNS")
            return await self._resolve_with_system_dns(hostname)
        
        resolver = dns.resolver.Resolver()
        resolver.nameservers = self.dns_servers
        resolver.timeout = 10
        resolver.lifetime = 30
        
        try:
            loop = asyncio.get_event_loop()
            
            def do_resolve():
                answers = resolver.resolve(hostname, 'A')
                for rdata in answers:
                    return str(rdata)
                raise ConnectionException(f"No A records found for {hostname}")
            
            result = await loop.run_in_executor(None, do_resolve)
            return result
            
        except Exception as e:
            raise ConnectionException(f"Custom DNS resolution failed for {hostname}: {e}")
    
    async def _resolve_through_socks(self, hostname: str) -> str:
        """
        Resolve DNS through SOCKS proxy.
        
        SOCKS5 supports remote DNS resolution via the CONNECT command.
        """
        try:
            import socks
        except ImportError:
            logger.warning("PySocks not installed, falling back to direct DNS")
            loop = asyncio.get_event_loop()
            return await loop.run_in_executor(None, socket.gethostbyname, hostname)
        
        # Parse proxy URL
        # Format: socks5://user:pass@host:port or socks5://host:port
        proxy_url = self.proxy_url
        
        proxy_type = socks.SOCKS5
        proxy_host = None
        proxy_port = 1080
        proxy_user = None
        proxy_pass = None
        
        if proxy_url.startswith("socks5://"):
            proxy_url = proxy_url[9:]
        elif proxy_url.startswith("socks4://"):
            proxy_type = socks.SOCKS4
            proxy_url = proxy_url[9:]
        
        # Parse auth
        if "@" in proxy_url:
            auth, host_part = proxy_url.rsplit("@", 1)
            if ":" in auth:
                proxy_user, proxy_pass = auth.split(":", 1)
        else:
            host_part = proxy_url
        
        # Parse host:port
        if ":" in host_part:
            proxy_host, port_str = host_part.rsplit(":", 1)
            proxy_port = int(port_str)
        else:
            proxy_host = host_part
        
        try:
            loop = asyncio.get_event_loop()
            
            def resolve_via_socks():
                # Create a SOCKS socket
                s = socks.socksocket()
                s.set_proxy(
                    proxy_type, 
                    proxy_host, 
                    proxy_port,
                    rdns=True,  # Remote DNS resolution
                    username=proxy_user,
                    password=proxy_pass
                )
                s.settimeout(30)
                
                # For SOCKS5 with remote DNS, we can use the proxy's DNS
                # by connecting to port 53 or using the built-in resolution
                try:
                    # Try to connect - SOCKS5 will resolve the hostname
                    s.connect((hostname, 80))
                    peer = s.getpeername()
                    s.close()
                    return peer[0]
                except Exception:
                    s.close()
                    # Fallback: use regular DNS
                    return socket.gethostbyname(hostname)
            
            result = await loop.run_in_executor(None, resolve_via_socks)
            return result
            
        except Exception as e:
            logger.error(f"SOCKS DNS resolution failed: {e}")
            # Fallback to regular DNS
            loop = asyncio.get_event_loop()
            return await loop.run_in_executor(None, socket.gethostbyname, hostname)
    
    async def list_shares(self, server_ip: str, ignore_cache: bool = False) -> List[ShareInfo]:
        """
        List all shares available on a server.
        
        NOT IMPLEMENTED - Requires SMB library.
        """
        raise NotImplementedException(
            "list_shares",
            "Direct Interaction Plugin",
            "SMB share listing not yet implemented. Use SOAP API Plugin."
        )
    
    async def list_directory(self, path: str, ignore_cache: bool = False) -> List[DirectoryItem]:
        """
        List contents of a directory.
        
        NOT IMPLEMENTED - Requires SMB library.
        """
        raise NotImplementedException(
            "list_directory",
            "Direct Interaction Plugin",
            "SMB directory listing not yet implemented. Use SOAP API Plugin."
        )
    
    async def download_file(
        self, 
        path: str, 
        offset: int = 0, 
        length: Optional[int] = None,
        ignore_cache: bool = False
    ) -> FileContent:
        """
        Download file content.
        
        NOT IMPLEMENTED - Requires SMB library.
        """
        raise NotImplementedException(
            "download_file",
            "Direct Interaction Plugin",
            "SMB file download not yet implemented. Use SOAP API Plugin."
        )
    
    async def sql_request(
        self, 
        connection_string: str, 
        query: str,
        timeout: int = 30,
        ignore_cache: bool = False
    ) -> SqlResult:
        """
        Execute a SQL query on a database.
        
        NOT IMPLEMENTED - Requires direct database connection.
        """
        raise NotImplementedException(
            "sql_request",
            "Direct Interaction Plugin",
            "Direct SQL execution not yet implemented. Use SOAP API Plugin."
        )
