import aiohttp
import ssl
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta
import hashlib
import json
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from database import SoapCache, AppConfig, SoapApiUrl, ProxyServer
import logging
import certifi

logger = logging.getLogger(__name__)

class SoapService:
    def __init__(self, soap_url: str, proxy_url: str = None):
        # Remover ?WSDL se houver
        self.soap_url = soap_url.replace('?WSDL', '').replace('?wsdl', '')
        self.base_url = self.soap_url.split('/dna')[0] if '/dna' in self.soap_url else self.soap_url.rsplit('/', 1)[0]
        self.proxy_url = proxy_url  # Ex: "http://192.168.1.1:8080"
        
        # Log SSL info
        if proxy_url:
            logger.info(f"SoapService initialized with proxy: {proxy_url}")
            logger.info(f"Target URL: {self.soap_url}")
            # Se está usando proxy e a URL é HTTPS, pode ter problemas de SSL
            if self.soap_url.startswith('https://'):
                logger.warning("Using HTTPS through proxy - SSL issues may occur")
    
    @staticmethod
    def _generate_cache_key(operation: str, params: dict) -> str:
        """Generate a unique hash for the operation and parameters"""
        key_str = f"{operation}:{json.dumps(params, sort_keys=True)}"
        return hashlib.sha256(key_str.encode()).hexdigest()
    
    @staticmethod
    async def _get_cached_response(db: AsyncSession, cache_key: str, max_age_hours: int = 24) -> str | None:
        """Get cached response if it exists and is not expired"""
        result = await db.execute(
            select(SoapCache).where(SoapCache.query_hash == cache_key)
        )
        cache_entry = result.scalar_one_or_none()
        
        if cache_entry:
            age = datetime.now(timezone.utc) - cache_entry.timestamp.replace(tzinfo=timezone.utc)
            if age < timedelta(hours=max_age_hours):
                logger.info(f"Cache hit for key: {cache_key}")
                return cache_entry.response_data
        
        return None
    
    @staticmethod
    async def _save_to_cache(db: AsyncSession, cache_key: str, operation: str, request_data: str, response_data: str):
        """Save response to cache"""
        # Check if cache entry exists
        result = await db.execute(
            select(SoapCache).where(SoapCache.query_hash == cache_key)
        )
        cache_entry = result.scalar_one_or_none()
        
        if cache_entry:
            cache_entry.request_data = request_data
            cache_entry.response_data = response_data
            cache_entry.timestamp = datetime.now(timezone.utc)
        else:
            cache_entry = SoapCache(
                query_hash=cache_key,
                operation=operation,
                request_data=request_data,
                response_data=response_data
            )
            db.add(cache_entry)
        
        await db.commit()
        logger.info(f"Cached response for key: {cache_key}")
    
    @staticmethod
    async def is_offline_mode(db: AsyncSession) -> bool:
        """Check if offline mode is enabled"""
        result = await db.execute(
            select(AppConfig).where(AppConfig.key == "offline_mode")
        )
        config = result.scalar_one_or_none()
        return config and config.value.lower() == "true"
    
    def _build_soap_envelope(self, operation: str, params: dict) -> str:
        """Build SOAP envelope XML"""
        # Construir parâmetros
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
    
    async def call_soap_operation(
        self,
        db: AsyncSession,
        operation: str,
        params: dict,
        ignore_cache: bool = False
    ) -> str:
        """
        Call SOAP operation with caching support
        """
        cache_key = self._generate_cache_key(operation, params)
        offline_mode = await self.is_offline_mode(db)
        
        # Check cache first (unless ignore_cache is True)
        if not ignore_cache:
            cached_response = await self._get_cached_response(db, cache_key)
            if cached_response:
                return cached_response
        
        # If offline mode and no cache, return error
        if offline_mode:
            raise Exception("Sistema em modo offline e não há cache disponível para esta consulta")
        
        # Build SOAP envelope
        soap_envelope = self._build_soap_envelope(operation, params)
        
        # Make HTTP POST request
        headers = {
            'Content-Type': 'text/xml; charset=utf-8',
            'SOAPAction': f'"http://test/{operation}"'
        }
        
        try:
            # Configurar proxy se disponível
            if self.proxy_url:
                logger.info(f"Using proxy: {self.proxy_url}")
            
            # Criar contexto SSL que ignora todos os erros
            import ssl as ssl_module
            ssl_context = ssl_module.create_default_context()
            ssl_context.check_hostname = False
            ssl_context.verify_mode = ssl_module.CERT_NONE
            ssl_context.options |= ssl_module.OP_NO_SSLv2
            ssl_context.options |= ssl_module.OP_NO_SSLv3
            
            # Connector com SSL personalizado
            connector = aiohttp.TCPConnector(
                ssl=ssl_context,
                force_close=True,
                enable_cleanup_closed=True
            )
            
            async with aiohttp.ClientSession(
                connector=connector,
                trust_env=False  # Ignora variáveis de ambiente de proxy
            ) as session:
                request_kwargs = {
                    'data': soap_envelope,
                    'headers': headers,
                    'timeout': aiohttp.ClientTimeout(total=120, connect=30),
                    'ssl': ssl_context
                }
                
                # Adicionar proxy se configurado
                if self.proxy_url:
                    request_kwargs['proxy'] = self.proxy_url
                
                async with session.post(self.soap_url, **request_kwargs) as response:
                    
                    if response.status != 200:
                        error_text = await response.text()
                        logger.error(f"SOAP error: {response.status} - {error_text}")
                        raise Exception(f"SOAP request failed with status {response.status}")
                    
                    response_text = await response.text()
                    
                    # Extract result from SOAP response
                    root = ET.fromstring(response_text)
                    
                    # Namespace handling
                    namespaces = {
                        'soap': 'http://schemas.xmlsoap.org/soap/envelope/',
                        'test': 'http://test/'
                    }
                    
                    # Find the result element
                    result_elem = root.find(f'.//test:{operation}Response/test:{operation}Result', namespaces)
                    
                    if result_elem is None:
                        # Try without namespace
                        result_elem = root.find(f'.//{operation}Response/{operation}Result')
                    
                    if result_elem is None:
                        logger.error(f"Could not find result in SOAP response: {response_text[:500]}")
                        raise Exception("Invalid SOAP response format")
                    
                    # Get the inner XML or text
                    if len(result_elem) > 0:
                        # Has child elements, return full XML
                        result_str = ET.tostring(result_elem, encoding='unicode')
                    else:
                        # Just text content
                        result_str = result_elem.text or ""
                    
                    # Save to cache
                    await self._save_to_cache(db, cache_key, operation, soap_envelope, result_str)
                    
                    return result_str
        
        except aiohttp.ClientConnectorError as e:
            error_msg = str(e)
            if "ssl" in error_msg.lower() or "SSL" in error_msg or "EOF" in error_msg:
                logger.error(f"SSL/TLS connection failed (possibly proxy issue): {e}")
                raise Exception(f"Erro de SSL/TLS na conexão (verifique o proxy): {str(e)}")
            else:
                logger.error(f"Connection failed: {e}")
                raise Exception(f"Erro de conexão: {str(e)}")
        except aiohttp.ClientError as e:
            logger.error(f"HTTP request failed: {e}")
            raise Exception(f"Erro ao conectar ao WebService SOAP: {str(e)}")
        except ET.ParseError as e:
            logger.error(f"XML parsing failed: {e}")
            raise Exception(f"Erro ao processar resposta XML: {str(e)}")
        except ssl.SSLError as e:
            logger.error(f"SSL Error: {e}")
            raise Exception(f"Erro de SSL: {str(e)}")
        except Exception as e:
            error_str = str(e)
            if "EOF" in error_str or "ssl" in error_str.lower():
                logger.error(f"SSL/Connection error: {e}")
                raise Exception(f"Erro de SSL/conexão (verifique se o proxy suporta HTTPS): {str(e)}")
            logger.error(f"SOAP call failed: {e}")
            raise Exception(f"Erro ao chamar o WebService SOAP: {str(e)}")

async def get_default_soap_service(db: AsyncSession) -> SoapService:
    """Get the default SOAP service with active proxy if configured"""
    # Buscar SOAP API URL
    result = await db.execute(
        select(SoapApiUrl).where(SoapApiUrl.name == "Default SOAP API")
    )
    soap_api = result.scalar_one_or_none()
    
    if not soap_api:
        raise Exception("Nenhuma API SOAP configurada")
    
    # Buscar proxy ativo
    proxy_url = None
    result = await db.execute(
        select(AppConfig).where(AppConfig.key == "active_proxy_id")
    )
    proxy_config = result.scalar_one_or_none()
    
    if proxy_config and proxy_config.value and proxy_config.value != "null":
        try:
            proxy_id = int(proxy_config.value)
            result = await db.execute(
                select(ProxyServer).where(ProxyServer.id == proxy_id)
            )
            proxy = result.scalar_one_or_none()
            
            if proxy:
                # Construir URL do proxy (formato: http://ip:port)
                proxy_url = f"http://{proxy.ip}:{proxy.port}"
                logger.info(f"Active proxy configured: {proxy.name} ({proxy_url})")
        except (ValueError, TypeError) as e:
            logger.warning(f"Invalid proxy_id in config: {e}")
    
    return SoapService(soap_api.uri, proxy_url)
