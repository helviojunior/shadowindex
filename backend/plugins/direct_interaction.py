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
import struct
import ipaddress
import logging
import threading
from contextlib import contextmanager
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
    CredentialNotSetException,
    ServerUnreachableException
)
from .cache import get_cache

logger = logging.getLogger(__name__)

# Serializes the process-wide impacket socket patch used to tunnel SMB over SOCKS
_SMB_SOCKS_LOCK = threading.Lock()


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
        self._credential_id_used = None  # Track which credential ID was used
        self._on_auth_success_callback = None  # Callback for successful authentication
        
        # DNS configuration
        self.dns_mode = config.get("dns_mode", "system")  # 'system' or 'custom'
        self.dns_servers = config.get("dns_servers", [])  # List of DNS server IPs
        
        # Proxy authentication (from plugin config, not URL)
        self.proxy_user = config.get("proxy_user")
        self.proxy_pass = config.get("proxy_pass")
        
        self.cache = get_cache()
        
        if proxy_url:
            logger.info(f"DirectInteractionPlugin initialized with proxy: {proxy_url}")
            if self.proxy_user:
                logger.info(f"Proxy authentication configured for user: {self.proxy_user}")
        
        logger.info(f"DirectInteractionPlugin initialized: dns_mode={self.dns_mode}, "
                   f"dns_servers={self.dns_servers}, credential_id={self.credential_id}")
    
    def set_on_auth_success_callback(self, callback):
        """
        Set a callback to be called when authentication is successful.
        
        Args:
            callback: Async function that takes credential_id as argument
        """
        self._on_auth_success_callback = callback
    
    async def _notify_auth_success(self):
        """Notify that authentication was successful"""
        if self._on_auth_success_callback and self._credential_id_used:
            try:
                await self._on_auth_success_callback(self._credential_id_used)
            except Exception as e:
                logger.warning(f"Error in auth success callback: {e}")
    
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
    
    def set_credential(self, credential: Dict[str, Any], credential_id: int = None):
        """
        Set the credential to use for SMB operations.
        Must be called before SMB operations.
        
        Args:
            credential: Credential dict with domain, username, password/ntlm_hash
            credential_id: Optional ID of the credential for verification tracking
        """
        if credential.get("credential_type") != "user_password":
            raise PluginException(
                "Credencial inválida: apenas credenciais do tipo 'user_password' são suportadas",
                {"credential_type": credential.get("credential_type")}
            )
        self._credential = credential
        self._credential_id_used = credential_id or credential.get("id")
    
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
            import traceback
            error_traceback = traceback.format_exc()
            logger.error(f"DNS resolution failed for {hostname}: {e}\n{error_traceback}")
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

        # Custom DNS servers are usually only reachable from the proxy side,
        # so the query must be tunneled instead of sent directly.
        if self.proxy_url and self.proxy_url.startswith("socks"):
            return await self._resolve_custom_dns_through_socks(hostname)

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
    
    async def _resolve_custom_dns_through_socks(self, hostname: str) -> str:
        """
        Query the configured DNS servers through the SOCKS proxy.

        Each server is tried over UDP first (SOCKS5 UDP ASSOCIATE) and, if that
        fails for any reason — the proxy does not relay UDP, the packet is lost,
        or the answer comes back truncated — the same query is retried over TCP
        (RFC 7766), which every recursive resolver supports.
        """
        try:
            import dns.message
            import dns.query
            import dns.rdatatype
        except ImportError:
            logger.warning("dnspython not installed, falling back to SOCKS remote resolution")
            return await self._resolve_through_socks(hostname)

        try:
            import socks
        except ImportError:
            raise PluginException("PySocks não está instalado. Execute: pip install pysocks")

        proxy_config = self._parse_proxy_url(self.proxy_url)
        is_socks5 = proxy_config["type"] == "socks5"
        proxy_type = socks.SOCKS5 if is_socks5 else socks.SOCKS4
        query = dns.message.make_query(hostname, dns.rdatatype.A)

        def make_socket(sock_type):
            s = socks.socksocket(socket.AF_INET, sock_type)
            s.set_proxy(
                proxy_type,
                proxy_config["host"],
                proxy_config["port"],
                rdns=True,
                username=proxy_config.get("user"),
                password=proxy_config.get("password")
            )
            s.settimeout(15)
            return s

        def extract_a_record(response, dns_server: str) -> str:
            for rrset in response.answer:
                for rdata in rrset:
                    if rdata.rdtype == dns.rdatatype.A:
                        return str(rdata)
            raise ConnectionException(f"No A records found for {hostname} on {dns_server}")

        def query_udp(dns_server: str) -> str:
            s = make_socket(socket.SOCK_DGRAM)
            try:
                # bind() performs the blocking SOCKS5 UDP ASSOCIATE handshake;
                # dns.query.udp then requires a non-blocking datagram socket.
                s.bind(("", 0))
                s.setblocking(False)
                # Shorter than the TCP timeout: a silently dropped datagram must
                # not stall the whole resolution before the TCP retry.
                response = dns.query.udp(
                    query, dns_server, timeout=5, sock=s,
                    ignore_unexpected=True,
                    raise_on_truncation=True
                )
            finally:
                try:
                    s.close()
                except Exception:
                    pass
            return extract_a_record(response, dns_server)

        def query_tcp(dns_server: str) -> str:
            s = make_socket(socket.SOCK_STREAM)
            try:
                # The SOCKS handshake needs a blocking socket; dns.query.tcp
                # requires a non-blocking one once it is connected.
                s.connect((dns_server, 53))
                s.setblocking(False)
                response = dns.query.tcp(query, dns_server, timeout=15, sock=s)
            finally:
                try:
                    s.close()
                except Exception:
                    pass
            return extract_a_record(response, dns_server)

        def query_dns_server(dns_server: str) -> str:
            # SOCKS4 has no UDP ASSOCIATE at all, so go straight to TCP there.
            if is_socks5:
                try:
                    result = query_udp(dns_server)
                    logger.info(f"SOCKS/DNS-UDP resolved {hostname} -> {result} via {dns_server}")
                    return result
                except Exception as e:
                    # dns.message.Truncated carries an empty str(), so log the type too.
                    logger.warning(
                        f"DNS/UDP query to {dns_server} via SOCKS failed for {hostname}: "
                        f"{type(e).__name__}: {e}. Retrying over TCP."
                    )

            result = query_tcp(dns_server)
            logger.info(f"SOCKS/DNS-TCP resolved {hostname} -> {result} via {dns_server}")
            return result

        loop = asyncio.get_event_loop()
        errors = []
        for dns_server in self.dns_servers:
            try:
                return await loop.run_in_executor(None, query_dns_server, dns_server)
            except Exception as e:
                logger.warning(
                    f"DNS query to {dns_server} via SOCKS failed for {hostname}: "
                    f"{type(e).__name__}: {e}"
                )
                errors.append(f"{dns_server}: {type(e).__name__}: {e}")

        raise ConnectionException(
            f"Falha ao resolver {hostname} via SOCKS nos servidores DNS configurados "
            f"({'; '.join(errors)})"
        )

    # Ports probed, in order, to confirm the proxy can reach a host whose name
    # it resolved. SMB/RDP first: these targets are file servers, not web servers.
    _REACHABILITY_PROBE_PORTS = (445, 139, 3389, 443, 80, 22)

    def _socks5_request(self, hostname: str, port: int, cmd: bytes, timeout: int = 15):
        """
        Send a single SOCKS5 request for ``hostname`` and return the reply's
        BND.ADDR/BND.PORT.

        Implemented directly instead of through PySocks because PySocks only
        exposes CONNECT/BIND/UDP-ASSOCIATE, and it reports ``getpeername()`` as
        the name that was *requested* rather than anything the proxy resolved.

        Args:
            cmd: SOCKS5 command byte — b"\\x01" (CONNECT) or b"\\xf0" (RESOLVE).

        Returns:
            Tuple of (bnd_host, bnd_port).

        Raises:
            PluginException: on any proxy-level failure, with the SOCKS status.
        """
        proxy_config = self._parse_proxy_url(self.proxy_url)
        proxy_host = proxy_config["host"]
        proxy_port = proxy_config["port"]
        user = proxy_config.get("user")
        password = proxy_config.get("password")

        SOCKS5_ERRORS = {
            0x01: "Falha geral no servidor SOCKS",
            0x02: "Conexão não permitida pelo ruleset",
            0x03: "Rede inacessível",
            0x04: "Host inacessível",
            0x05: "Conexão recusada",
            0x06: "TTL expirado",
            0x07: "Comando não suportado pelo proxy",
            0x08: "Tipo de endereço não suportado",
        }

        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(timeout)
        try:
            s.connect((proxy_host, proxy_port))

            def read_exactly(n: int) -> bytes:
                buf = b""
                while len(buf) < n:
                    chunk = s.recv(n - len(buf))
                    if not chunk:
                        raise PluginException(
                            f"Proxy SOCKS {proxy_host}:{proxy_port} fechou a conexão"
                        )
                    buf += chunk
                return buf

            # Greeting: offer user/password only when credentials are configured
            if user and password:
                s.sendall(b"\x05\x02\x00\x02")
            else:
                s.sendall(b"\x05\x01\x00")

            ver, method = read_exactly(2)
            if ver != 0x05:
                raise PluginException(
                    f"Proxy {proxy_host}:{proxy_port} não respondeu como SOCKS5"
                )
            if method == 0xFF:
                raise PluginException(
                    "Proxy SOCKS rejeitou todos os métodos de autenticação oferecidos"
                )
            if method == 0x02:
                if not (user and password):
                    raise PluginException(
                        "Proxy SOCKS exige usuário/senha, mas nenhuma credencial "
                        "está configurada no proxy"
                    )
                u = user.encode()
                p = password.encode()
                s.sendall(b"\x01" + bytes([len(u)]) + u + bytes([len(p)]) + p)
                auth_ver, auth_status = read_exactly(2)
                if auth_status != 0x00:
                    raise AuthenticationFailureException(
                        username=user,
                        domain="",
                        reason=f"Autenticação SOCKS5 rejeitada pelo proxy {proxy_host}:{proxy_port}"
                    )
            elif method != 0x00:
                raise PluginException(
                    f"Proxy SOCKS selecionou método de autenticação não suportado ({method:#04x})"
                )

            # Request, always with ATYP=3 so the proxy does the name resolution
            target = hostname.encode()
            s.sendall(
                b"\x05" + cmd + b"\x00\x03"
                + bytes([len(target)]) + target
                + struct.pack("!H", port)
            )

            ver, status, _rsv, atyp = read_exactly(4)
            if status != 0x00:
                raise PluginException(
                    f"Proxy SOCKS retornou erro {status:#04x}: "
                    f"{SOCKS5_ERRORS.get(status, 'Erro desconhecido')}"
                )

            if atyp == 0x01:
                bnd_host = socket.inet_ntoa(read_exactly(4))
            elif atyp == 0x03:
                bnd_host = read_exactly(read_exactly(1)[0]).decode(errors="replace")
            elif atyp == 0x04:
                bnd_host = socket.inet_ntop(socket.AF_INET6, read_exactly(16))
            else:
                raise PluginException(
                    f"Proxy SOCKS retornou tipo de endereço desconhecido ({atyp:#04x})"
                )
            (bnd_port,) = struct.unpack("!H", read_exactly(2))
            return bnd_host, bnd_port
        finally:
            try:
                s.close()
            except Exception:
                pass

    @staticmethod
    def _usable_resolved_ip(candidate: str, proxy_host: str) -> Optional[str]:
        """
        Accept a SOCKS reply address only if it is a real target IP.

        Proxies routinely answer with a placeholder (0.0.0.0), with their own
        bound address, or by echoing the requested name back. None of those
        identify the target, and returning one would silently store a wrong
        address on the server record.
        """
        if not candidate:
            return None
        try:
            ip = ipaddress.ip_address(candidate)
        except ValueError:
            return None  # a hostname echoed back, not an address
        if ip.is_unspecified or ip.is_loopback or ip.is_multicast or ip.is_reserved:
            return None
        if candidate == proxy_host:
            return None
        return candidate

    async def _resolve_through_socks(self, hostname: str) -> str:
        """
        Resolve a hostname to an IP when only a SOCKS proxy is available.

        Two strategies, both of which must yield an actual address — the caller
        stores this on the server record as its IP, so a hostname is not an
        acceptable answer:

        1. The SOCKS5 RESOLVE extension (command 0xF0), which returns the real
           IP in BND.ADDR. Tor and several pentest relays implement it.
        2. A CONNECT probe, reading BND.ADDR from the reply. RFC 1928 leaves
           this field implementation-defined and many proxies fill it with the
           address they connected to, so it is worth reading — but it is just
           as often a placeholder, hence the validation above.

        When neither yields an address the resolution fails with instructions,
        because DNS through the tunnel is the only reliable way to get one.
        """
        if not self.proxy_url.startswith("socks5://"):
            raise ConnectionException(
                f"Não é possível resolver {hostname}: proxies SOCKS4 não suportam "
                f"resolução de nomes. Configure servidores DNS na instância do plugin "
                f"(Modo DNS: personalizado) ou use um proxy SOCKS5."
            )

        proxy_config = self._parse_proxy_url(self.proxy_url)
        proxy_host = proxy_config["host"]
        proxy_label = f"{proxy_host}:{proxy_config['port']}"
        logger.info(f"Resolving {hostname} through SOCKS proxy {proxy_label}")

        loop = asyncio.get_event_loop()

        # 1. SOCKS5 RESOLVE extension - the purpose-built way to get an IP back
        SOCKS5_RESOLVE = b"\xf0"
        try:
            bnd_host, _ = await loop.run_in_executor(
                None, self._socks5_request, hostname, 0, SOCKS5_RESOLVE
            )
            resolved = self._usable_resolved_ip(bnd_host, proxy_host)
            if resolved:
                logger.info(f"SOCKS RESOLVE resolved {hostname} -> {resolved}")
                return resolved
            logger.warning(
                f"Proxy SOCKS {proxy_label} aceitou RESOLVE mas devolveu "
                f"{bnd_host!r}, que não é um IP de destino utilizável."
            )
        except AuthenticationFailureException:
            raise
        except Exception as e:
            logger.warning(
                f"SOCKS RESOLVE não disponível em {proxy_label} para {hostname}: "
                f"{type(e).__name__}: {e}."
            )

        # 2. CONNECT probe - some proxies report the target IP in BND.ADDR
        SOCKS5_CONNECT = b"\x01"
        reachable_on = None
        errors = []
        for port in self._REACHABILITY_PROBE_PORTS:
            try:
                bnd_host, _ = await loop.run_in_executor(
                    None, self._socks5_request, hostname, port, SOCKS5_CONNECT
                )
            except AuthenticationFailureException:
                raise
            except Exception as e:
                errors.append(f"{port}: {e}")
                continue

            reachable_on = port
            resolved = self._usable_resolved_ip(bnd_host, proxy_host)
            if resolved:
                logger.info(f"SOCKS CONNECT resolved {hostname} -> {resolved} (porta {port})")
                return resolved
            logger.warning(
                f"{hostname} alcançável via SOCKS na porta {port}, mas o proxy "
                f"devolveu {bnd_host!r} em BND.ADDR em vez do IP do destino."
            )
            break

        if reachable_on:
            raise ConnectionException(
                f"{hostname} está acessível através do proxy SOCKS {proxy_label} "
                f"(porta {reachable_on}), mas o proxy não informa o IP do destino: "
                f"não suporta o comando RESOLVE e não preenche BND.ADDR. "
                f"Para obter o endereço, configure os servidores DNS da rede alvo "
                f"na instância do plugin (Modo DNS: personalizado) — a consulta será "
                f"feita através do túnel."
            )

        raise ConnectionException(
            f"Não foi possível resolver {hostname} via proxy SOCKS {proxy_label}. "
            f"O proxy não suporta o comando RESOLVE e o host não respondeu em nenhuma "
            f"das portas sondadas ({', '.join(str(p) for p in self._REACHABILITY_PROBE_PORTS)}). "
            f"Configure servidores DNS na instância do plugin (Modo DNS: personalizado) "
            f"para resolver nomes internos através do túnel. Detalhes: {'; '.join(errors)}"
        )

    @contextmanager
    def _smb_socket_factory(self):
        """
        Route impacket's SMB/NetBIOS socket through the configured SOCKS proxy.

        impacket builds its own socket in ``nmb.NetBIOSTCPSession._setup_connection``,
        so the only hook point is that method. It is patched for the duration of the
        connection setup and restored afterwards; ``_SMB_SOCKS_LOCK`` serializes the
        patch so concurrent SMB connections never inherit another instance's proxy.
        """
        if not self.proxy_url or not self.proxy_url.startswith("socks"):
            yield
            return

        try:
            import socks
        except ImportError:
            raise PluginException("PySocks não está instalado. Execute: pip install pysocks")

        from impacket import nmb

        proxy_config = self._parse_proxy_url(self.proxy_url)
        proxy_type = socks.SOCKS5 if proxy_config["type"] == "socks5" else socks.SOCKS4
        proxy_host = proxy_config["host"]
        proxy_port = proxy_config["port"]
        proxy_user = proxy_config.get("user")
        proxy_pass = proxy_config.get("password")

        def _setup_connection_via_socks(_self, peer, timeout=None):
            s = socks.socksocket(socket.AF_INET, socket.SOCK_STREAM)
            s.set_proxy(
                proxy_type,
                proxy_host,
                proxy_port,
                rdns=True,
                username=proxy_user,
                password=proxy_pass
            )
            s.settimeout(timeout)
            try:
                s.connect((peer[0], peer[1]))
            except Exception as e:
                s.close()
                raise socket.error(
                    f"Connection error via SOCKS {proxy_host}:{proxy_port} "
                    f"({peer[0]}:{peer[1]})", e
                )
            return s

        original = nmb.NetBIOSTCPSession._setup_connection
        with _SMB_SOCKS_LOCK:
            nmb.NetBIOSTCPSession._setup_connection = _setup_connection_via_socks
            logger.info(f"SMB tunneled through SOCKS proxy {proxy_host}:{proxy_port}")
            try:
                yield
            finally:
                nmb.NetBIOSTCPSession._setup_connection = original

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
        
        # Validate credential has required fields
        username = self._credential.get("username")
        password = self._credential.get("password")
        ntlm_hash = self._credential.get("ntlm_hash")
        
        if not username:
            raise CredentialNotSetException(
                operation="SMB",
                plugin_name=self.PLUGIN_NAME,
                message="Credencial inválida: username não configurado."
            )
        
        # At least one auth method required (password or NTLM hash)
        if not password and not ntlm_hash:
            raise CredentialNotSetException(
                operation="SMB",
                plugin_name=self.PLUGIN_NAME,
                message="Credencial inválida: senha ou hash NTLM não configurado."
            )
        
        try:
            from impacket.smbconnection import SMBConnection
            from impacket.nmb import NetBIOSError
        except ImportError:
            raise PluginException("impacket não está instalado. Execute: pip install impacket")
        
        domain = self._credential.get("domain") or ""
        username = username or ""
        password = password or ""
        ntlm_hash = ntlm_hash or ""
        
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

            # Create SMB connection (tunneled through SOCKS when a proxy is configured)
            with self._smb_socket_factory():
                smb_conn = SMBConnection(server_ip, server_ip, timeout=30)

            # Authenticate - priority: password > NTLM hash
            if password:
                # Use password authentication (priority)
                logger.info(f"Using password authentication for {domain}\\{username}")
                smb_conn.login(username, password, domain)
            elif nthash:
                # Fallback to NTLM hash authentication
                logger.info(f"Using NTLM hash authentication for {domain}\\{username}")
                smb_conn.login(username, "", domain, lmhash, nthash)
            else:
                raise CredentialNotSetException(
                    operation="SMB",
                    plugin_name=self.PLUGIN_NAME,
                    message="Credencial inválida: senha ou hash NTLM não configurado."
                )
            
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
            elif any(keyword in error_msg for keyword in [
                "timed out", "timeout", "connection refused",
                "host unreachable", "network unreachable",
                "no route to host", "connection error",
                "errno 10061", "errno 10060", "errno 110", "errno 111",
                "errno 113", "netbioserror", "netbiostimeout",
                "connection aborted", "network is unreachable"
            ]):
                raise ServerUnreachableException(
                    server=server_ip,
                    message=f"Servidor inacessível: {str(e)}",
                    original_error=e
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
                    # Handle both dict-like and object-like access
                    # impacket can return SHARE_INFO_1 objects or dicts depending on version
                    try:
                        if hasattr(share, '__getitem__'):
                            # Dict-like access
                            share_name = share['shi1_netname']
                            share_type = share['shi1_type']
                            remark = share.get('shi1_remark', '') if hasattr(share, 'get') else ''
                        else:
                            # Object attribute access (SHARE_INFO_1)
                            share_name = getattr(share, 'shi1_netname', '') or ''
                            share_type = getattr(share, 'shi1_type', 0) or 0
                            remark = getattr(share, 'shi1_remark', '') or ''
                        
                        # Convert bytes to string if necessary
                        if isinstance(share_name, bytes):
                            share_name = share_name.decode('utf-8', errors='replace')
                        if isinstance(remark, bytes):
                            remark = remark.decode('utf-8', errors='replace')
                        
                        # Ensure string type
                        share_name = str(share_name) if share_name else ''
                        remark = str(remark) if remark else ''
                        
                        # Clean up share name (remove null terminator if present)
                        if share_name and '\x00' in share_name:
                            share_name = share_name.split('\x00')[0]
                        
                        # Clean up remark
                        if remark and '\x00' in remark:
                            remark = remark.split('\x00')[0]
                        
                        # Determine share type string
                        type_str = "disk"
                        if isinstance(share_type, int):
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
                            share_type=type_str,
                            remark=remark
                        ))
                    except Exception as share_err:
                        import traceback
                        error_traceback = traceback.format_exc()
                        logger.warning(f"Error parsing share info: {share_err}\n{error_traceback}\nShare data type: {type(share)}")
                        continue
                
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
            
            # Notify successful authentication
            await self._notify_auth_success()
            
            logger.info(f"Listed {len(shares)} shares on {server_ip}")
            return shares
            
        except (AuthenticationFailureException, ConnectionException, ServerUnreachableException):
            raise
        except Exception as e:
            import traceback
            error_traceback = traceback.format_exc()
            logger.error(f"Failed to list shares on {server_ip}: {e}\n{error_traceback}")
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
                    
                    # Build full path
                    if dir_path:
                        item_full_path = f"\\\\{server_ip}\\{share_name}\\{dir_path}\\{name}"
                    else:
                        item_full_path = f"\\\\{server_ip}\\{share_name}\\{name}"
                    
                    # Format timestamps
                    created = None
                    modified_at = None
                    try:
                        if item.get_ctime_epoch():
                            created = datetime.fromtimestamp(item.get_ctime_epoch())
                        if item.get_mtime_epoch():
                            modified_at = datetime.fromtimestamp(item.get_mtime_epoch())
                    except Exception:
                        pass
                    
                    # Get extension for files
                    extension = ""
                    if not is_dir and "." in name:
                        extension = name.rsplit(".", 1)[-1].lower()
                    
                    items.append(DirectoryItem(
                        name=name,
                        item_type="Directory" if is_dir else "File",
                        full_path=item_full_path,
                        size=size,
                        modified_at=modified_at,
                        created=created,
                        extension=extension
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
            
            # Notify successful authentication
            await self._notify_auth_success()
            
            logger.info(f"Listed {len(items)} items in {path}")
            return items
            
        except (AuthenticationFailureException, ConnectionException, AccessDeniedException, ServerUnreachableException):
            raise
        except Exception as e:
            import traceback
            error_traceback = traceback.format_exc()
            error_msg = str(e).lower()
            if "access_denied" in error_msg or "status_access_denied" in error_msg:
                raise AccessDeniedException(path=path)
            logger.error(f"Failed to list directory {path}: {e}\n{error_traceback}")
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
        ignore_cache: bool = False,
        expected_size: Optional[int] = None
    ) -> FileContent:
        """
        Download file content using SMB.
        
        Args:
            path: Full path to the file
            offset: Starting byte position (default: 0)
            length: Number of bytes to read (default: entire file)
            ignore_cache: Skip cache lookup if True
            expected_size: Expected file size in bytes (used to validate empty responses)
            
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
            
        except (AuthenticationFailureException, ConnectionException, AccessDeniedException, ServerUnreachableException):
            raise
        except Exception as e:
            import traceback
            error_traceback = traceback.format_exc()
            error_msg = str(e).lower()
            if "access_denied" in error_msg or "status_access_denied" in error_msg:
                raise AccessDeniedException(path=path)
            logger.error(f"Failed to download file {path}: {e}\n{error_traceback}")
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
        Execute a SQL query on a database with SOCKS proxy support.
        
        Args:
            connection_string: Database connection string or JSON config:
                - For simple: "db_type://user:pass@host:port/database"
                - For JSON: '{"db_type": "mssql", "host": "...", "port": 1433, "database": "...", "user": "...", "password": "..."}'
            query: SQL query to execute
            timeout: Query timeout in seconds
            ignore_cache: Skip cache lookup if True
            
        Returns:
            SqlResult with columns and rows
            
        Supported database types:
        - mssql: Microsoft SQL Server (pymssql)
        - mysql/mariadb: MySQL/MariaDB (pymysql)
        - postgres: PostgreSQL (psycopg2)
        - oracle: Oracle Database (oracledb)
        - sqlite: SQLite (sqlite3)
        - mongodb: MongoDB (pymongo) - for find queries only
        """
        import json
        
        # Parse connection config
        config = self._parse_connection_config(connection_string)
        db_type = config.get("db_type", "").lower()
        
        if not db_type:
            raise PluginException("Tipo de banco de dados não especificado")
        
        # Check cache
        cache_params = {
            "db_type": db_type,
            "host": config.get("host"),
            "database": config.get("database"),
            "query": query
        }
        
        if not ignore_cache:
            cached = await self.cache.get("direct_sql", cache_params)
            if cached:
                logger.debug(f"SQL cache hit for query on {db_type}")
                return SqlResult(**cached)
        
        loop = asyncio.get_event_loop()
        
        # Setup SOCKS proxy if configured
        proxy_config = None
        if self.proxy_url and self.proxy_url.startswith("socks"):
            proxy_config = self._parse_proxy_url(self.proxy_url)
        
        # Execute query based on database type
        try:
            if db_type == "mssql":
                result = await loop.run_in_executor(
                    None, 
                    lambda: self._execute_mssql(config, query, timeout, proxy_config)
                )
            elif db_type in ("mysql", "mariadb"):
                result = await loop.run_in_executor(
                    None, 
                    lambda: self._execute_mysql(config, query, timeout, proxy_config)
                )
            elif db_type == "postgres":
                result = await loop.run_in_executor(
                    None, 
                    lambda: self._execute_postgres(config, query, timeout, proxy_config)
                )
            elif db_type == "oracle":
                result = await loop.run_in_executor(
                    None, 
                    lambda: self._execute_oracle(config, query, timeout, proxy_config)
                )
            elif db_type == "sqlite":
                result = await loop.run_in_executor(
                    None, 
                    lambda: self._execute_sqlite(config, query, timeout)
                )
            elif db_type == "mongodb":
                result = await loop.run_in_executor(
                    None, 
                    lambda: self._execute_mongodb(config, query, timeout, proxy_config)
                )
            else:
                raise PluginException(f"Tipo de banco de dados não suportado: {db_type}")
            
            # Cache result
            await self.cache.set("direct_sql", cache_params, result.__dict__, ttl_hours=1)
            
            logger.info(f"SQL query executed on {db_type}: {len(result.rows)} rows returned")
            return result
            
        except Exception as e:
            import traceback
            error_traceback = traceback.format_exc()
            logger.error(f"SQL execution failed on {db_type}: {e}\n{error_traceback}")
            raise PluginException(f"Erro ao executar SQL: {str(e)}")
    
    def _parse_connection_config(self, connection_string: str) -> Dict[str, Any]:
        """Parse connection string or JSON config into a dict."""
        import json
        import re
        
        # Try JSON first
        try:
            if connection_string.strip().startswith("{"):
                return json.loads(connection_string)
        except json.JSONDecodeError:
            pass
        
        # Parse URL format: db_type://user:pass@host:port/database
        pattern = r'^(\w+)://(?:([^:]+):([^@]+)@)?([^:/]+)(?::(\d+))?(?:/(.+))?$'
        match = re.match(pattern, connection_string)
        
        if match:
            return {
                "db_type": match.group(1),
                "user": match.group(2) or "",
                "password": match.group(3) or "",
                "host": match.group(4),
                "port": int(match.group(5)) if match.group(5) else None,
                "database": match.group(6) or ""
            }
        
        raise PluginException(f"Formato de connection string inválido: {connection_string}")
    
    def _parse_proxy_url(self, proxy_url: str) -> Dict[str, Any]:
        """Parse SOCKS proxy URL into config dict, using plugin config for credentials."""
        config = {
            "type": "socks5",
            "host": None,
            "port": 1080,
            "user": self.proxy_user,  # From plugin config
            "password": self.proxy_pass  # From plugin config
        }
        
        url = proxy_url
        if url.startswith("socks5://"):
            config["type"] = "socks5"
            url = url[9:]
        elif url.startswith("socks4://"):
            config["type"] = "socks4"
            url = url[9:]
        
        # Strip any auth from URL (we use config credentials)
        if "@" in url:
            _, url = url.rsplit("@", 1)
        
        if ":" in url:
            config["host"], port_str = url.rsplit(":", 1)
            config["port"] = int(port_str)
        else:
            config["host"] = url
        
        return config
    
    def _setup_socks_proxy(self, proxy_config: Dict[str, Any]):
        """Setup SOCKS proxy for socket connections."""
        if not proxy_config:
            return
        
        try:
            import socks
            import socket
            
            proxy_type = socks.SOCKS5 if proxy_config["type"] == "socks5" else socks.SOCKS4
            
            socks.set_default_proxy(
                proxy_type,
                proxy_config["host"],
                proxy_config["port"],
                rdns=True,
                username=proxy_config.get("user"),
                password=proxy_config.get("password")
            )
            socket.socket = socks.socksocket
            logger.info(f"SOCKS proxy configured: {proxy_config['host']}:{proxy_config['port']}")
        except ImportError:
            logger.warning("PySocks not installed, proxy not configured")
    
    def _reset_socket(self):
        """Reset socket to default after proxy use."""
        try:
            import socks
            import socket
            socks.set_default_proxy()
            socket.socket = socks.socksocket.__bases__[0]
        except Exception:
            pass
    
    def _execute_mssql(self, config: Dict, query: str, timeout: int, proxy_config: Dict = None) -> SqlResult:
        """Execute SQL on Microsoft SQL Server using pymssql."""
        try:
            import pymssql
        except ImportError:
            raise PluginException("pymssql não está instalado. Execute: pip install pymssql")
        
        try:
            if proxy_config:
                self._setup_socks_proxy(proxy_config)
            
            conn = pymssql.connect(
                server=config.get("host"),
                port=config.get("port", 1433),
                user=config.get("user"),
                password=config.get("password"),
                database=config.get("database"),
                timeout=timeout,
                login_timeout=timeout
            )
            
            cursor = conn.cursor()
            cursor.execute(query)
            
            # Get column names
            columns = [desc[0] for desc in cursor.description] if cursor.description else []
            
            # Get rows as dicts
            rows = []
            for row in cursor.fetchall():
                row_dict = {}
                for i, col in enumerate(columns):
                    row_dict[col] = self._serialize_value(row[i])
                rows.append(row_dict)
            
            cursor.close()
            conn.close()
            
            return SqlResult(columns=columns, rows=rows, row_count=len(rows))
            
        finally:
            if proxy_config:
                self._reset_socket()
    
    def _execute_mysql(self, config: Dict, query: str, timeout: int, proxy_config: Dict = None) -> SqlResult:
        """Execute SQL on MySQL/MariaDB using pymysql."""
        try:
            import pymysql
        except ImportError:
            raise PluginException("pymysql não está instalado. Execute: pip install pymysql")
        
        try:
            if proxy_config:
                self._setup_socks_proxy(proxy_config)
            
            conn = pymysql.connect(
                host=config.get("host"),
                port=config.get("port", 3306),
                user=config.get("user"),
                password=config.get("password"),
                database=config.get("database"),
                connect_timeout=timeout,
                read_timeout=timeout
            )
            
            cursor = conn.cursor()
            cursor.execute(query)
            
            columns = [desc[0] for desc in cursor.description] if cursor.description else []
            rows = []
            for row in cursor.fetchall():
                row_dict = {}
                for i, col in enumerate(columns):
                    row_dict[col] = self._serialize_value(row[i])
                rows.append(row_dict)
            
            cursor.close()
            conn.close()
            
            return SqlResult(columns=columns, rows=rows, row_count=len(rows))
            
        finally:
            if proxy_config:
                self._reset_socket()
    
    def _execute_postgres(self, config: Dict, query: str, timeout: int, proxy_config: Dict = None) -> SqlResult:
        """Execute SQL on PostgreSQL using psycopg2."""
        try:
            import psycopg2
        except ImportError:
            raise PluginException("psycopg2 não está instalado. Execute: pip install psycopg2-binary")
        
        try:
            if proxy_config:
                self._setup_socks_proxy(proxy_config)
            
            conn = psycopg2.connect(
                host=config.get("host"),
                port=config.get("port", 5432),
                user=config.get("user"),
                password=config.get("password"),
                database=config.get("database"),
                connect_timeout=timeout
            )
            
            cursor = conn.cursor()
            cursor.execute(query)
            
            columns = [desc[0] for desc in cursor.description] if cursor.description else []
            rows = []
            for row in cursor.fetchall():
                row_dict = {}
                for i, col in enumerate(columns):
                    row_dict[col] = self._serialize_value(row[i])
                rows.append(row_dict)
            
            cursor.close()
            conn.close()
            
            return SqlResult(columns=columns, rows=rows, row_count=len(rows))
            
        finally:
            if proxy_config:
                self._reset_socket()
    
    def _execute_oracle(self, config: Dict, query: str, timeout: int, proxy_config: Dict = None) -> SqlResult:
        """Execute SQL on Oracle using oracledb."""
        try:
            import oracledb
        except ImportError:
            try:
                import cx_Oracle as oracledb
            except ImportError:
                raise PluginException("oracledb não está instalado. Execute: pip install oracledb")
        
        try:
            if proxy_config:
                self._setup_socks_proxy(proxy_config)
            
            # Build DSN
            host = config.get("host")
            port = config.get("port", 1521)
            service = config.get("database") or config.get("service_name")
            
            dsn = f"{host}:{port}/{service}"
            
            conn = oracledb.connect(
                user=config.get("user"),
                password=config.get("password"),
                dsn=dsn
            )
            
            cursor = conn.cursor()
            cursor.execute(query)
            
            columns = [desc[0] for desc in cursor.description] if cursor.description else []
            rows = []
            for row in cursor.fetchall():
                row_dict = {}
                for i, col in enumerate(columns):
                    row_dict[col] = self._serialize_value(row[i])
                rows.append(row_dict)
            
            cursor.close()
            conn.close()
            
            return SqlResult(columns=columns, rows=rows, row_count=len(rows))
            
        finally:
            if proxy_config:
                self._reset_socket()
    
    def _execute_sqlite(self, config: Dict, query: str, timeout: int) -> SqlResult:
        """Execute SQL on SQLite."""
        import sqlite3
        
        db_path = config.get("database") or config.get("path") or ":memory:"
        
        conn = sqlite3.connect(db_path, timeout=timeout)
        cursor = conn.cursor()
        cursor.execute(query)
        
        columns = [desc[0] for desc in cursor.description] if cursor.description else []
        rows = []
        for row in cursor.fetchall():
            row_dict = {}
            for i, col in enumerate(columns):
                row_dict[col] = self._serialize_value(row[i])
            rows.append(row_dict)
        
        cursor.close()
        conn.close()
        
        return SqlResult(columns=columns, rows=rows, row_count=len(rows))
    
    def _execute_mongodb(self, config: Dict, query: str, timeout: int, proxy_config: Dict = None) -> SqlResult:
        """Execute query on MongoDB using pymongo."""
        try:
            from pymongo import MongoClient
        except ImportError:
            raise PluginException("pymongo não está instalado. Execute: pip install pymongo")
        
        import json
        
        try:
            if proxy_config:
                self._setup_socks_proxy(proxy_config)
            
            # Build connection URI
            host = config.get("host", "localhost")
            port = config.get("port", 27017)
            user = config.get("user")
            password = config.get("password")
            database = config.get("database", "test")
            
            if user and password:
                uri = f"mongodb://{user}:{password}@{host}:{port}/{database}"
            else:
                uri = f"mongodb://{host}:{port}/{database}"
            
            client = MongoClient(uri, serverSelectionTimeoutMS=timeout * 1000)
            db = client[database]
            
            # Parse query - expects JSON format: {"collection": "...", "operation": "find", "filter": {...}}
            try:
                query_config = json.loads(query)
            except json.JSONDecodeError:
                raise PluginException("Query MongoDB deve ser JSON: {\"collection\": \"...\", \"operation\": \"find\", \"filter\": {}}")
            
            collection_name = query_config.get("collection")
            operation = query_config.get("operation", "find")
            filter_doc = query_config.get("filter", {})
            projection = query_config.get("projection")
            limit = query_config.get("limit", 100)
            
            if not collection_name:
                raise PluginException("Nome da collection não especificado")
            
            collection = db[collection_name]
            
            if operation == "find":
                cursor = collection.find(filter_doc, projection).limit(limit)
                docs = list(cursor)
                
                if docs:
                    columns = list(docs[0].keys())
                    rows = []
                    for doc in docs:
                        row_dict = {}
                        for col in columns:
                            row_dict[col] = self._serialize_value(doc.get(col))
                        rows.append(row_dict)
                else:
                    columns = []
                    rows = []
                
            elif operation == "count":
                count = collection.count_documents(filter_doc)
                columns = ["count"]
                rows = [{"count": count}]
                
            elif operation == "aggregate":
                pipeline = query_config.get("pipeline", [])
                cursor = collection.aggregate(pipeline)
                docs = list(cursor)
                
                if docs:
                    columns = list(docs[0].keys())
                    rows = []
                    for doc in docs:
                        row_dict = {}
                        for col in columns:
                            row_dict[col] = self._serialize_value(doc.get(col))
                        rows.append(row_dict)
                else:
                    columns = []
                    rows = []
            else:
                raise PluginException(f"Operação MongoDB não suportada: {operation}")
            
            client.close()
            
            return SqlResult(columns=columns, rows=rows, row_count=len(rows))
            
        finally:
            if proxy_config:
                self._reset_socket()
    
    def _serialize_value(self, value) -> Any:
        """Serialize a database value to JSON-safe format."""
        if value is None:
            return None
        if isinstance(value, (int, float, str, bool)):
            return value
        if isinstance(value, bytes):
            try:
                return value.decode('utf-8')
            except UnicodeDecodeError:
                return value.hex()
        if isinstance(value, datetime):
            return value.isoformat()
        if hasattr(value, '__dict__'):
            return str(value)
        # ObjectId, Decimal, etc.
        return str(value)
