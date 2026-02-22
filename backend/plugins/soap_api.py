"""
SOAP API Plugin

Plugin implementation for communicating with servers via SOAP Web Service.
"""

import asyncio
import logging
import xml.etree.ElementTree as ET
from datetime import datetime
from typing import List, Optional, Dict, Any

import requests
import urllib3

from .base import (
    BasePlugin, 
    PluginConfig, 
    ShareInfo, 
    DirectoryItem, 
    FileContent,
    SqlResult
)
from .exceptions import (
    ItemNotFoundException,
    AccessDeniedException,
    ConnectionException,
    TimeoutException,
    PluginException
)
from .cache import get_cache, cached_operation

# Disable SSL warnings
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

logger = logging.getLogger(__name__)


class SoapApiPlugin(BasePlugin):
    """
    Plugin for server communication via SOAP Web Service.
    
    Configuration:
        - soap_url: URL of the SOAP API endpoint (required)
        - timeout: Request timeout in seconds (optional, default: 120)
        - namespace: SOAP namespace (optional, default: http://test/)
    """
    
    PLUGIN_TYPE = "soap_api"
    PLUGIN_NAME = "SOAP API Plugin"
    PLUGIN_VERSION = "1.0.0"
    PLUGIN_DESCRIPTION = "Communicates with servers via SOAP Web Service"
    REQUIRED_CONFIG = ["soap_url"]
    
    def __init__(self, config: PluginConfig, proxy_url: Optional[str] = None):
        super().__init__(config, proxy_url)
        
        # Get SOAP URL from config
        self.soap_url = config.get("soap_url", "")
        if self.soap_url:
            # Remove WSDL suffix if present
            self.soap_url = self.soap_url.replace('?WSDL', '').replace('?wsdl', '')
        
        # Additional config
        self.timeout = config.get("timeout", 120)
        self.namespace = config.get("namespace", "http://test/")
        
        self.cache = get_cache()
        
        if proxy_url:
            logger.info(f"SoapApiPlugin initialized with proxy: {proxy_url}")
    
    @classmethod
    def get_config_schema(cls) -> Dict[str, Any]:
        """Get JSON schema for SOAP plugin configuration"""
        return {
            "type": "object",
            "properties": {
                "soap_url": {
                    "type": "string",
                    "title": "SOAP API URL",
                    "description": "URL do endpoint SOAP (sem ?WSDL)",
                    "format": "uri"
                },
                "timeout": {
                    "type": "integer",
                    "title": "Timeout",
                    "description": "Timeout em segundos para requisições",
                    "default": 120,
                    "minimum": 5,
                    "maximum": 600
                },
                "namespace": {
                    "type": "string",
                    "title": "Namespace",
                    "description": "Namespace SOAP",
                    "default": "http://test/"
                }
            },
            "required": ["soap_url"]
        }
    
    async def health_check(self) -> Dict[str, Any]:
        """Check SOAP service connectivity using configured proxy"""
        if not self.soap_url:
            return {
                "healthy": False,
                "message": "SOAP URL not configured",
                "details": {}
            }
        
        try:
            # Build proxy config if available
            proxies = None
            if self.proxy_url:
                proxies = {
                    'http': self.proxy_url,
                    'https': self.proxy_url
                }
                logger.info(f"Health check using proxy: {self.proxy_url}")
            
            # Try a simple request to check connectivity
            response = await asyncio.to_thread(
                requests.get,
                self.soap_url + "?WSDL",
                timeout=10,
                verify=False,
                proxies=proxies
            )
            
            if response.status_code == 200:
                return {
                    "healthy": True,
                    "message": "SOAP service is reachable",
                    "details": {
                        "url": self.soap_url,
                        "status_code": response.status_code,
                        "proxy_used": self.proxy_url or "none"
                    }
                }
            else:
                return {
                    "healthy": False,
                    "message": f"SOAP service returned status {response.status_code}",
                    "details": {
                        "url": self.soap_url,
                        "status_code": response.status_code,
                        "proxy_used": self.proxy_url or "none"
                    }
                }
        except Exception as e:
            return {
                "healthy": False,
                "message": f"Failed to connect: {str(e)}",
                "details": {
                    "url": self.soap_url,
                    "error": str(e),
                    "proxy_used": self.proxy_url or "none"
                }
            }
    
    def _build_soap_envelope(self, operation: str, params: Dict[str, Any]) -> str:
        """Build SOAP envelope XML"""
        param_xml = ""
        for key, value in params.items():
            param_xml += f"      <{key}>{value or ''}</{key}>\n"
        
        envelope = f'''<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" 
               xmlns:xsd="http://www.w3.org/2001/XMLSchema" 
               xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <{operation} xmlns="http://test/">
{param_xml.rstrip()}
    </{operation}>
  </soap:Body>
</soap:Envelope>'''
        
        return envelope
    
    def _make_request(self, soap_envelope: str, headers: Dict[str, str], timeout: int = 120) -> str:
        """Make synchronous HTTP request"""
        proxies = None
        if self.proxy_url:
            proxies = {
                'http': self.proxy_url,
                'https': self.proxy_url
            }
        
        response = requests.post(
            self.soap_url,
            data=soap_envelope.encode('utf-8'),
            headers=headers,
            proxies=proxies,
            verify=False,
            timeout=timeout
        )
        
        if response.status_code != 200:
            logger.error(f"SOAP error: {response.status_code} - {response.text}")
            raise ConnectionException(
                self.soap_url,
                f"SOAP request failed with status {response.status_code}"
            )
        
        return response.text
    
    async def _call_soap(
        self, 
        operation: str, 
        params: Dict[str, Any],
        ignore_cache: bool = False,
        timeout: int = 120
    ) -> str:
        """
        Call SOAP operation with caching.
        
        Args:
            operation: SOAP operation name
            params: Operation parameters
            ignore_cache: Skip cache lookup if True
            timeout: Request timeout in seconds
            
        Returns:
            SOAP response result as string
        """
        cache_params = {"operation": operation, "soap_url": self.soap_url, **params}
        
        async def execute():
            soap_envelope = self._build_soap_envelope(operation, params)
            headers = {
                'Content-Type': 'text/xml; charset=utf-8',
                'SOAPAction': f'"http://test/{operation}"'
            }
            
            try:
                response_text = await asyncio.to_thread(
                    self._make_request,
                    soap_envelope,
                    headers,
                    timeout
                )
                
                # Parse response
                root = ET.fromstring(response_text)
                namespaces = {
                    'soap': 'http://schemas.xmlsoap.org/soap/envelope/',
                    'test': 'http://test/'
                }
                
                result_elem = root.find(f'.//test:{operation}Response/test:{operation}Result', namespaces)
                if result_elem is None:
                    result_elem = root.find(f'.//{operation}Response/{operation}Result')
                
                if result_elem is None:
                    logger.error(f"Could not find result in SOAP response: {response_text[:500]}")
                    raise PluginException("Invalid SOAP response format")
                
                if len(result_elem) > 0:
                    return ET.tostring(result_elem, encoding='unicode')
                else:
                    return result_elem.text or ""
                    
            except requests.exceptions.Timeout:
                raise TimeoutException(operation, timeout)
            except requests.exceptions.ProxyError as e:
                raise ConnectionException(self.soap_url, f"Proxy error: {e}", e)
            except requests.exceptions.ConnectionError as e:
                raise ConnectionException(self.soap_url, f"Connection error: {e}", e)
            except ET.ParseError as e:
                raise PluginException(f"XML parsing error: {e}")
        
        return await cached_operation(
            f"soap_{operation}",
            cache_params,
            execute,
            ignore_cache=ignore_cache
        )
    
    async def list_shares(self, server_ip: str, ignore_cache: bool = False) -> List[ShareInfo]:
        """List all shares on a server via SOAP"""
        try:
            result = await self._call_soap(
                "ListShares",
                {"host": server_ip},  # Changed from "ip" to "host"
                ignore_cache=ignore_cache
            )
            
            shares = []
            
            # Parse the result - it contains XML with diffgram format
            if result and result.strip():
                try:
                    # Try to parse as XML - wrap in root if needed
                    xml_content = result.strip()
                    if not xml_content.startswith('<'):
                        logger.warning("ListShares response is not XML")
                        return shares
                    
                    # Parse the XML
                    root = ET.fromstring(f"<root>{xml_content}</root>")
                    
                    # Try diffgram format first (Microsoft DataSet format)
                    # Look for Result elements in diffgram
                    # Find all Result elements (diffgram format)
                    result_elements = root.findall('.//Result')
                    
                    if result_elements:
                        # First check for error messages
                        first_result = result_elements[0]
                        error_message = first_result.findtext('message', '')
                        stack_trace = first_result.findtext('stacktrace', '')
                        
                        if error_message:
                            error_lower = error_message.lower()
                            logger.warning(f"SOAP ListShares error: {error_message}")
                            
                            # Check for specific error codes
                            # Code 53 = Network path not found / Server unavailable
                            if "code: 53" in error_message or "code:53" in error_message:
                                raise ConnectionException(f"Servidor inacessível (erro de rede 53): {error_message}")
                            # Code 5 = Access denied
                            elif "code: 5" in error_message or "code:5" in error_message:
                                raise AccessDeniedException(f"Acesso negado ao servidor: {error_message}")
                            # Code 1326 = Logon failure
                            elif "code: 1326" in error_message or "code:1326" in error_message:
                                raise AccessDeniedException(f"Falha de autenticação: {error_message}")
                            # Generic "failed" with code
                            elif "failed" in error_lower and "code" in error_lower:
                                raise ConnectionException(f"Falha na operação: {error_message}")
                            # Access denied keywords
                            elif "access" in error_lower and "denied" in error_lower:
                                raise AccessDeniedException(f"Acesso negado: {error_message}")
                        
                        # No error, process shares
                        for share_elem in result_elements:
                            # diffgram format: host, name, type, remark
                            name = share_elem.findtext('name', '')
                            share_type = share_elem.findtext('type', 'Disk')
                            remark = share_elem.findtext('remark', '')
                            host = share_elem.findtext('host', server_ip)
                            
                            if name:
                                shares.append(ShareInfo(
                                    name=name,
                                    share_type=share_type,
                                    remark=remark or '',
                                    path=f"\\\\{host}\\{name}"
                                ))
                    else:
                        # Fallback: Try legacy Table format
                        for share_elem in root.findall('.//Table'):
                            name = share_elem.findtext('shi1_netname', '')
                            share_type = share_elem.findtext('shi1_type', 'Disk')
                            remark = share_elem.findtext('shi1_remark', '')
                            
                            if name:
                                shares.append(ShareInfo(
                                    name=name,
                                    share_type=share_type,
                                    remark=remark or '',
                                    path=f"\\\\{server_ip}\\{name}"
                                ))
                    
                    logger.info(f"Parsed {len(shares)} shares from SOAP response")
                    
                except ET.ParseError as e:
                    logger.warning(f"Could not parse shares response as XML: {e}")
            
            return shares
            
        except AccessDeniedException:
            raise
        except ConnectionException:
            raise
        except Exception as e:
            logger.error(f"Error listing shares: {e}")
            raise PluginException(f"Failed to list shares: {e}")
    
    async def list_directory(self, path: str, ignore_cache: bool = False) -> List[DirectoryItem]:
        """List directory contents via SOAP"""
        try:
            result = await self._call_soap(
                "ListDirectory",
                {"path": path},
                ignore_cache=ignore_cache
            )
            
            items = []
            
            if result and result.strip():
                try:
                    # Parse XML response
                    # The result may be the full SOAP envelope or just the inner content
                    xml_content = result.strip()
                    
                    # Handle full SOAP envelope
                    if '<soap:Envelope' in xml_content or '<Envelope' in xml_content:
                        # Parse full SOAP envelope
                        root = ET.fromstring(xml_content)
                        # Find ListDirectoryResult content
                        result_elem = root.find('.//{http://test/}ListDirectoryResult')
                        if result_elem is None:
                            # Try without namespace
                            result_elem = root.find('.//ListDirectoryResult')
                        if result_elem is not None and result_elem.text:
                            xml_content = result_elem.text
                    
                    # Wrap in root if needed for parsing
                    if not xml_content.startswith('<root>') and not xml_content.startswith('<?xml'):
                        xml_content = f"<root>{xml_content}</root>"
                    
                    root = ET.fromstring(xml_content)
                    
                    # Try diffgram format first (Microsoft DataSet format)
                    # Look for Result elements in diffgram/DocumentElement
                    result_elements = root.findall('.//Result')
                    
                    if result_elements:
                        # First check for error messages (access denied, etc)
                        first_result = result_elements[0]
                        error_message = first_result.findtext('message', '')
                        stack_trace = first_result.findtext('stacktrace', '')
                        
                        if error_message:
                            error_lower = error_message.lower()
                            if "access" in error_lower and "denied" in error_lower:
                                logger.warning(f"Access denied to path: {path}")
                                raise AccessDeniedException(path)
                            elif "not found" in error_lower or "cannot find" in error_lower:
                                raise ItemNotFoundException(path)
                            else:
                                # Other error
                                logger.error(f"SOAP error: {error_message}")
                                raise PluginException(f"Erro ao listar diretório: {error_message}")
                        
                        # diffgram format: type, name, length, s_length, lastwritetime, fullname
                        for item_elem in result_elements:
                            name = item_elem.findtext('name', '')
                            item_type = item_elem.findtext('type', 'File')  # "Directory" or "File"
                            
                            if name and name not in ('.', '..'):
                                # Parse size
                                size = 0
                                size_str = item_elem.findtext('length', '0')
                                try:
                                    size = int(size_str)
                                except ValueError:
                                    pass
                                
                                # Parse dates - format: "2025-06-27 10:26:30Z"
                                modified = None
                                lastwritetime = item_elem.findtext('lastwritetime', '')
                                if lastwritetime:
                                    try:
                                        # Handle format "2025-06-27 10:26:30Z"
                                        lastwritetime = lastwritetime.replace('Z', '').strip()
                                        modified = datetime.strptime(lastwritetime, '%Y-%m-%d %H:%M:%S')
                                    except ValueError:
                                        try:
                                            modified = datetime.fromisoformat(lastwritetime)
                                        except ValueError:
                                            pass
                                
                                # Get fullname from response or build it
                                full_path = item_elem.findtext('fullname', '')
                                if not full_path:
                                    full_path = f"{path}\\{name}" if not path.endswith('\\') else f"{path}{name}"
                                
                                # Get extension for files
                                extension = ""
                                if item_type == "File" and '.' in name:
                                    extension = name.rsplit('.', 1)[-1].lower()
                                
                                items.append(DirectoryItem(
                                    name=name,
                                    item_type=item_type,
                                    full_path=full_path,
                                    size=size,
                                    created=None,
                                    modified=modified,
                                    extension=extension
                                ))
                    else:
                        # Fallback: Try legacy Table format
                        for item_elem in root.findall('.//Table'):
                            name = item_elem.findtext('cFileName', '')
                            item_type = item_elem.findtext('type', 'File')
                            
                            if name and name not in ('.', '..'):
                                # Parse size
                                size = 0
                                size_str = item_elem.findtext('nFileSizeLow', '0')
                                try:
                                    size = int(size_str)
                                except ValueError:
                                    pass
                                
                                # Determine full path
                                full_path = f"{path}\\{name}" if not path.endswith('\\') else f"{path}{name}"
                                
                                # Get extension for files
                                extension = ""
                                if item_type == "File" and '.' in name:
                                    extension = name.rsplit('.', 1)[-1].lower()
                                
                                items.append(DirectoryItem(
                                    name=name,
                                    item_type=item_type,
                                    full_path=full_path,
                                    size=size,
                                    created=None,
                                    modified=None,
                                    extension=extension
                                ))
                            
                except ET.ParseError as e:
                    import traceback
                    error_traceback = traceback.format_exc()
                    logger.warning(f"Could not parse directory response as XML: {e}\n{error_traceback}")
                    
                    # Check for access denied in response
                    if "Access" in result and "denied" in result.lower():
                        raise AccessDeniedException(path)
            
            return items
            
        except AccessDeniedException:
            raise
        except ItemNotFoundException:
            raise
        except ConnectionException:
            raise
        except Exception as e:
            import traceback
            error_traceback = traceback.format_exc()
            error_msg = str(e).lower()
            if "access" in error_msg and "denied" in error_msg:
                raise AccessDeniedException(path)
            if "not found" in error_msg or "does not exist" in error_msg:
                raise ItemNotFoundException(path)
            logger.error(f"Error listing directory: {e}\n{error_traceback}")
            raise PluginException(f"Failed to list directory: {e}")
    
    async def download_file(
        self, 
        path: str, 
        offset: int = 0, 
        length: Optional[int] = None,
        ignore_cache: bool = False
    ) -> FileContent:
        """
        Download file content via SOAP.
        
        Fluxo:
        1. Tentar decode base64
           1.1 Se falhar, considera que o conteúdo não é base64 e continua
           1.2 Se sucesso, continua com o texto decodificado
        2. Validar erros de acesso negado para exceptions específicas
        """
        try:
            params = {"path": path}
            if offset > 0:
                params["offset"] = str(offset)
            if length is not None:
                params["length"] = str(length)
            
            result = await self._call_soap(
                "DownloadFile",
                params,
                ignore_cache=True  # Don't cache file downloads
            )
            
            if not result:
                raise ItemNotFoundException(path)
            
            # Step 1: Try base64 decode first
            import base64
            data = None
            is_base64 = False
            
            try:
                data = base64.b64decode(result)
                is_base64 = True
                logger.debug(f"Successfully decoded base64 content for {path}")
            except Exception as decode_error:
                # 1.1 - Not base64, use raw content
                logger.debug(f"Content is not base64, using raw text: {decode_error}")
                data = result.encode('utf-8') if isinstance(result, str) else result
            
            # Step 2: Validate for errors (works on both decoded and raw content)
            # Check the result string for error patterns
            content_to_check = result if isinstance(result, str) else data.decode('utf-8', errors='ignore')
            content_lower = content_to_check.lower()
            
            # Check for "not found" errors
            if "not found!" in content_lower or "cannot find" in content_lower:
                logger.warning(f"File not found: {path}")
                raise ItemNotFoundException(path)
            
            # Check for "access denied" errors
            if "access" in content_lower and "denied" in content_lower:
                logger.warning(f"Access denied to file: {path}")
                raise AccessDeniedException(path)
            
            # Check for stack traces (indicates an error from the server)
            if "at Test.Test." in content_to_check or "at System." in content_to_check:
                # This is a stack trace, extract error message
                error_lines = content_to_check.split('\n')
                error_msg = error_lines[0].strip() if error_lines else content_to_check
                
                # Re-check specific errors from the error message
                error_lower = error_msg.lower()
                if "not found" in error_lower:
                    raise ItemNotFoundException(path)
                if "access" in error_lower and "denied" in error_lower:
                    raise AccessDeniedException(path)
                
                # Generic error
                logger.error(f"Server error downloading file: {error_msg}")
                raise PluginException(f"Erro ao baixar arquivo: {error_msg}")
            
            return FileContent(
                data=data,
                size=len(data),
                is_complete=length is None or len(data) < length,
                offset=offset,
                total_size=len(data) if length is None else None
            )
            
        except AccessDeniedException:
            raise
        except ItemNotFoundException:
            raise
        except ConnectionException:
            raise
        except PluginException:
            raise
        except Exception as e:
            error_msg = str(e).lower()
            if "access" in error_msg and "denied" in error_msg:
                raise AccessDeniedException(path)
            if "not found" in error_msg:
                raise ItemNotFoundException(path)
            logger.error(f"Error downloading file: {e}")
            raise PluginException(f"Failed to download file: {e}")
    
    async def resolve_address(self, hostname: str, ignore_cache: bool = False) -> str:
        """Resolve hostname to IP via SOAP"""
        try:
            result = await self._call_soap(
                "ResolveAddress",
                {"hostname": hostname},
                ignore_cache=ignore_cache
            )
            
            if result and result.strip():
                return result.strip()
            
            raise ConnectionException(hostname, "Could not resolve address")
            
        except ConnectionException:
            raise
        except Exception as e:
            logger.error(f"Error resolving address: {e}")
            raise ConnectionException(hostname, f"Failed to resolve address: {e}", e)
    
    async def sql_request(
        self, 
        connection_string: str, 
        query: str,
        timeout: int = 30,
        ignore_cache: bool = False
    ) -> SqlResult:
        """Execute SQL query via SOAP using Exec operation"""
        import time
        start_time = time.time()
        
        try:
            result = await self._call_soap(
                "Exec",
                {
                    "connStr": connection_string,
                    "query": query
                },
                ignore_cache=ignore_cache,
                timeout=timeout
            )
            
            execution_time = (time.time() - start_time) * 1000
            
            columns = []
            rows = []
            
            if result and result.strip():
                try:
                    root = ET.fromstring(f"<root>{result}</root>")
                    
                    for row_elem in root.findall('.//Table'):
                        row = {}
                        for child in row_elem:
                            tag = child.tag
                            if tag not in columns:
                                columns.append(tag)
                            row[tag] = child.text
                        rows.append(row)
                        
                except ET.ParseError as e:
                    return SqlResult(
                        columns=[],
                        rows=[],
                        row_count=0,
                        execution_time_ms=execution_time,
                        error=f"Failed to parse result: {e}"
                    )
            
            return SqlResult(
                columns=columns,
                rows=rows,
                row_count=len(rows),
                execution_time_ms=execution_time
            )
            
        except TimeoutException:
            raise
        except ConnectionException:
            raise
        except Exception as e:
            execution_time = (time.time() - start_time) * 1000
            logger.error(f"Error executing SQL: {e}")
            return SqlResult(
                columns=[],
                rows=[],
                row_count=0,
                execution_time_ms=execution_time,
                error=str(e)
            )
