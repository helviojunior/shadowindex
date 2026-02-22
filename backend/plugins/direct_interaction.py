"""
Direct Interaction Plugin

Plugin for direct server interaction without SOAP intermediary.
Supports:
- DNS resolution with custom DNS servers and SOCKS proxy support
- SMB share listing and file operations using impacket

Configuration:
    - credential_id: ID of the credential to use (must be user_password type)
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
    AuthenticationFailureException,
    NotImplementedException,
    AccessDeniedException,
    CredentialNotSetException
)
from .cache import get_cache

logger = logging.getLogger(__name__)


class DirectInteractionPlugin(BasePlugin):
    """
    Plugin for direct server interaction without SOAP intermediary.
    
    Implements:
    - DNS resolution (with custom DNS servers and SOCKS proxy support)
    - SMB share listing and directory browsing using impacket
    
    Configuration:
        - credential_id: ID of the global credential to use (must be user_password type)
        - dns_mode: 'system' or 'custom'
        - dns_servers: List of DNS server IPs when dns_mode is 'custom'
    """
    
    PLUGIN_TYPE = "direct_interaction"
    PLUGIN_NAME = "Interação Direta"
    PLUGIN_VERSION = "1.1.0"
    PLUGIN_DESCRIPTION = "Interação direta com servidores via SMB/DNS sem intermediário SOAP"
    REQUIRED_CONFIG = ["credential_id"]
    
    def __init__(self, config: PluginConfig, proxy_url: Optional[str] = None):
        super().__init__(config, proxy_url)
        
        # Credential configuration - MUST be user_password type
        self.credential_id = config.get("credential_id")
        self._credential = None  # Will be loaded lazily
        
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
                    "description": "ID da credencial global (tipo user_password) a ser utilizada"
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
            "required": ["credential_id"]
        }
    
    def set_credential(self, credential: Dict[str, Any]):
        """
        Set the credential to use for SMB operations.
        Must be called before SMB operations.
        
        Args:
            credential: Credential dict with domain, username, password/ntlm_hash
        """
        if credential.get("credential_type") != "user_password":
            raise PluginException(
                "Credencial inválida: apenas credenciais do tipo 'user_password' são suportadas",
                {"credential_type": credential.get("credential_type")}
            )
        self._credential = credential
    
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
                    "proxy_configured": self.proxy_url is not None,
                    "credential_configured": self.credential_id is not None
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
        cache_params = {
            "hostname": hostname,
            "dns_mode": self.dns_mode,
            "dns_servers": self.dns_servers
        }
        
        # Check cache first
        if not ignore_cache:
            cached = await self.cache.get("direct_resolve", cache_params)
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
            await self.cache.set("direct_resolve", cache_params, ip, ttl_hours=24)
            
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
        """Resolve DNS through SOCKS proxy."""
        try:
            import socks
        except ImportError:
            logger.warning("PySocks not installed, falling back to direct DNS")
            loop = asyncio.get_event_loop()
            return await loop.run_in_executor(None, socket.gethostbyname, hostname)
        
        # Parse proxy URL and resolve
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
        
        if "@" in proxy_url:
            auth, host_part = proxy_url.rsplit("@", 1)
            if ":" in auth:
                proxy_user, proxy_pass = auth.split(":", 1)
        else:
            host_part = proxy_url
        
        if ":" in host_part:
            proxy_host, port_str = host_part.rsplit(":", 1)
            proxy_port = int(port_str)
        else:
            proxy_host = host_part
        
        try:
            loop = asyncio.get_event_loop()
            
            def resolve_via_socks():
                s = socks.socksocket()
                s.set_proxy(proxy_type, proxy_host, proxy_port, rdns=True,
                           username=proxy_user, password=proxy_pass)
                s.settimeout(30)
                try:
                    s.connect((hostname, 80))
                    peer = s.getpeername()
                    s.close()
                    return peer[0]
                except Exception:
                    s.close()
                    return socket.gethostbyname(hostname)
            
            return await loop.run_in_executor(None, resolve_via_socks)
        except Exception as e:
            logger.error(f"SOCKS DNS resolution failed: {e}")
            loop = asyncio.get_event_loop()
            return await loop.run_in_executor(None, socket.gethostbyname, hostname)
    
    def _get_smb_connection(self, server_ip: str):
        """
        Create an SMB connection using impacket.
        
        Returns:
            SMBConnection object
            
        Raises:
            AuthenticationFailureException: If authentication fails
            ConnectionException: If connection fails
        """
        if not self._credential:
            raise CredentialNotSetException(
                operation="SMB",
                plugin_name=self.PLUGIN_NAME,
                message="Credencial não configurada. Selecione uma credencial válida nas configurações do servidor."
            )
        
        try:
            from impacket.smbconnection import SMBConnection
            from impacket.nmb import NetBIOSError
        except ImportError:
            raise PluginException("impacket não está instalado. Execute: pip install impacket")
        
        domain = self._credential.get("domain", "")
        username = self._credential.get("username", "")
        password = self._credential.get("password", "")
        ntlm_hash = self._credential.get("ntlm_hash", "")
        
        # Parse NTLM hash (LM:NT or just NT)
        lmhash = ""
        nthash = ""
        if ntlm_hash:
            if ":" in ntlm_hash:
                lmhash, nthash = ntlm_hash.split(":", 1)
            else:
                nthash = ntlm_hash
        
        try:
            logger.info(f"Connecting to SMB server: {server_ip}")
            
            # Create SMB connection
            smb_conn = SMBConnection(server_ip, server_ip, timeout=30)
            
            # Authenticate
            if nthash:
                # Use NTLM hash authentication
                smb_conn.login(username, "", domain, lmhash, nthash)
            else:
                # Use password authentication
                smb_conn.login(username, password, domain)
            
            logger.info(f"SMB authentication successful for {domain}\\{username}")
            return smb_conn
            
        except Exception as e:
            error_msg = str(e).lower()
            if "status_logon_failure" in error_msg or "logon failure" in error_msg:
                raise AuthenticationFailureException(
                    username=username,
                    domain=domain,
                    reason="Falha de login - usuário/senha inválidos"
                )
            elif "status_account_disabled" in error_msg:
                raise AuthenticationFailureException(
                    username=username,
                    domain=domain,
                    reason="Conta desabilitada"
                )
            elif "status_password_expired" in error_msg:
                raise AuthenticationFailureException(
                    username=username,
                    domain=domain,
                    reason="Senha expirada"
                )
            elif "status_account_locked_out" in error_msg:
                raise AuthenticationFailureException(
                    username=username,
                    domain=domain,
                    reason="Conta bloqueada"
                )
            else:
                raise ConnectionException(
                    server=server_ip,
                    message=f"Falha na conexão SMB: {str(e)}",
                    original_error=e
                )
    
    async def list_shares(self, server_ip: str, ignore_cache: bool = False) -> List[ShareInfo]:
        """
        List all shares available on a server using SMB.
        
        Args:
            server_ip: IP address or hostname of the server
            ignore_cache: Skip cache lookup if True
            
        Returns:
            List of ShareInfo objects
            
        Raises:
            AuthenticationFailureException: If authentication fails
            ConnectionException: If connection fails
        """
        cache_params = {"server_ip": server_ip, "credential_id": self.credential_id}
        
        if not ignore_cache:
            cached = await self.cache.get("direct_shares", cache_params)
            if cached:
                logger.debug(f"Shares cache hit for {server_ip}")
                return [ShareInfo(**s) for s in cached]
        
        loop = asyncio.get_event_loop()
        
        def do_list_shares():
            smb_conn = None
            try:
                smb_conn = self._get_smb_connection(server_ip)
                
                shares = []
                for share in smb_conn.listShares():
                    share_name = share['shi1_netname'][:-1]  # Remove null terminator
                    share_type = share['shi1_type']
                    remark = share.get('shi1_remark', '') or ''
                    if remark and remark.endswith('\x00'):
                        remark = remark[:-1]
                    
                    # Determine share type
                    type_str = "disk"
                    if share_type & 0x80000000:
                        type_str = "hidden"
                    elif share_type == 1:
                        type_str = "printer"
                    elif share_type == 2:
                        type_str = "device"
                    elif share_type == 3:
                        type_str = "ipc"
                    
                    shares.append(ShareInfo(
                        name=share_name,
                        type=type_str,
                        remark=remark
                    ))
                
                return shares
                
            finally:
                if smb_conn:
                    try:
                        smb_conn.close()
                    except Exception:
                        pass
        
        try:
            shares = await loop.run_in_executor(None, do_list_shares)
            
            # Cache the result
            await self.cache.set("direct_shares", cache_params, [s.__dict__ for s in shares], ttl_hours=24)
            
            logger.info(f"Listed {len(shares)} shares on {server_ip}")
            return shares
            
        except (AuthenticationFailureException, ConnectionException):
            raise
        except Exception as e:
            logger.error(f"Failed to list shares on {server_ip}: {e}")
            raise ConnectionException(
                server=server_ip,
                message=f"Erro ao listar compartilhamentos: {str(e)}",
                original_error=e
            )
    
    async def list_directory(self, path: str, ignore_cache: bool = False) -> List[DirectoryItem]:
        """
        List contents of a directory using SMB.
        
        Args:
            path: Full path (format: \\\\server\\share\\folder or server/share/folder)
            ignore_cache: Skip cache lookup if True
            
        Returns:
            List of DirectoryItem objects
        """
        # Parse path to extract server, share, and directory
        server_ip, share_name, dir_path = self._parse_smb_path(path)
        
        cache_params = {
            "server_ip": server_ip,
            "share_name": share_name,
            "dir_path": dir_path,
            "credential_id": self.credential_id
        }
        
        if not ignore_cache:
            cached = await self.cache.get("direct_dir", cache_params)
            if cached:
                logger.debug(f"Directory cache hit for {path}")
                return [DirectoryItem(**d) for d in cached]
        
        loop = asyncio.get_event_loop()
        
        def do_list_directory():
            smb_conn = None
            try:
                smb_conn = self._get_smb_connection(server_ip)
                
                # Connect to share
                tree_id = smb_conn.connectTree(share_name)
                
                # List directory
                search_path = dir_path + "\\*" if dir_path else "*"
                items = []
                
                for item in smb_conn.listPath(share_name, search_path):
                    name = item.get_longname()
                    if name in (".", ".."):
                        continue
                    
                    is_dir = item.is_directory()
                    size = item.get_filesize() if not is_dir else 0
                    
                    # Format timestamps
                    created = None
                    modified = None
                    try:
                        if item.get_ctime_epoch():
                            created = datetime.fromtimestamp(item.get_ctime_epoch()).isoformat()
                        if item.get_mtime_epoch():
                            modified = datetime.fromtimestamp(item.get_mtime_epoch()).isoformat()
                    except Exception:
                        pass
                    
                    items.append(DirectoryItem(
                        name=name,
                        is_directory=is_dir,
                        size=size,
                        modified=modified,
                        created=created
                    ))
                
                smb_conn.disconnectTree(tree_id)
                return items
                
            finally:
                if smb_conn:
                    try:
                        smb_conn.close()
                    except Exception:
                        pass
        
        try:
            items = await loop.run_in_executor(None, do_list_directory)
            
            # Cache the result
            await self.cache.set("direct_dir", cache_params, [d.__dict__ for d in items], ttl_hours=24)
            
            logger.info(f"Listed {len(items)} items in {path}")
            return items
            
        except (AuthenticationFailureException, ConnectionException, AccessDeniedException):
            raise
        except Exception as e:
            error_msg = str(e).lower()
            if "access_denied" in error_msg or "status_access_denied" in error_msg:
                raise AccessDeniedException(path=path)
            logger.error(f"Failed to list directory {path}: {e}")
            raise ConnectionException(
                server=server_ip,
                message=f"Erro ao listar diretório: {str(e)}",
                original_error=e
            )
    
    def _parse_smb_path(self, path: str) -> tuple:
        """
        Parse SMB path into server, share, and directory components.
        
        Formats supported:
        - \\\\server\\share\\folder
        - //server/share/folder
        - server/share/folder
        
        Returns:
            Tuple of (server_ip, share_name, directory_path)
        """
        # Normalize path
        path = path.replace("\\", "/").strip("/")
        
        parts = path.split("/")
        if len(parts) < 2:
            raise PluginException(f"Caminho inválido: {path}. Use formato: server/share/folder")
        
        server = parts[0]
        share = parts[1]
        dir_path = "\\".join(parts[2:]) if len(parts) > 2 else ""
        
        return server, share, dir_path
    
    async def download_file(
        self, 
        path: str, 
        offset: int = 0, 
        length: Optional[int] = None,
        ignore_cache: bool = False
    ) -> FileContent:
        """
        Download file content using SMB.
        
        Args:
            path: Full path to the file
            offset: Starting byte position (default: 0)
            length: Number of bytes to read (default: entire file)
            ignore_cache: Skip cache lookup if True
            
        Returns:
            FileContent with the file data
        """
        server_ip, share_name, file_path = self._parse_smb_path(path)
        
        loop = asyncio.get_event_loop()
        
        def do_download():
            smb_conn = None
            try:
                smb_conn = self._get_smb_connection(server_ip)
                
                # Connect to share
                tree_id = smb_conn.connectTree(share_name)
                
                # Open file
                from impacket.smb3structs import FILE_READ_DATA, FILE_SHARE_READ
                
                file_id = smb_conn.openFile(
                    tree_id, 
                    file_path,
                    FILE_READ_DATA,
                    FILE_SHARE_READ
                )
                
                # Get file size
                file_info = smb_conn.queryInfo(tree_id, file_id)
                total_size = file_info['EndOfFile']
                
                # Calculate read parameters
                read_offset = offset
                read_length = length if length is not None else (total_size - offset)
                
                # Read file content
                data = smb_conn.readFile(tree_id, file_id, read_offset, read_length)
                
                smb_conn.closeFile(tree_id, file_id)
                smb_conn.disconnectTree(tree_id)
                
                return FileContent(
                    data=data,
                    size=len(data),
                    total_size=total_size,
                    offset=offset
                )
                
            finally:
                if smb_conn:
                    try:
                        smb_conn.close()
                    except Exception:
                        pass
        
        try:
            content = await loop.run_in_executor(None, do_download)
            logger.info(f"Downloaded {len(content.data)} bytes from {path}")
            return content
            
        except (AuthenticationFailureException, ConnectionException, AccessDeniedException):
            raise
        except Exception as e:
            error_msg = str(e).lower()
            if "access_denied" in error_msg or "status_access_denied" in error_msg:
                raise AccessDeniedException(path=path)
            logger.error(f"Failed to download file {path}: {e}")
            raise ConnectionException(
                server=server_ip,
                message=f"Erro ao baixar arquivo: {str(e)}",
                original_error=e
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
        
        NOT IMPLEMENTED - Use SOAP API Plugin or direct database connection.
        """
        raise NotImplementedException(
            "sql_request",
            "Direct Interaction Plugin",
            "Execução SQL direta não implementada. Use SOAP API Plugin."
        )
