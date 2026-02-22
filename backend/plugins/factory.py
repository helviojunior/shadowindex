"""
Plugin Factory

Factory for creating and managing plugin instances.
"""

import logging
from typing import Dict, Type, Optional, Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from .base import BasePlugin, PluginConfig
from .soap_api import SoapApiPlugin
from .direct_interaction import DirectInteractionPlugin

logger = logging.getLogger(__name__)


# Registry of available plugins
PLUGIN_REGISTRY: Dict[str, Type[BasePlugin]] = {
    "soap_api": SoapApiPlugin,
    "direct_interaction": DirectInteractionPlugin,
}


class PluginFactory:
    """
    Factory for creating plugin instances.
    
    Manages plugin registration and instantiation.
    """
    
    @staticmethod
    def get_available_plugins() -> Dict[str, Dict[str, str]]:
        """
        Get list of available plugins with their info.
        
        Returns:
            Dictionary of plugin_type -> plugin info
        """
        return {
            plugin_type: plugin_class.get_plugin_info()
            for plugin_type, plugin_class in PLUGIN_REGISTRY.items()
        }
    
    @staticmethod
    def create_plugin(
        plugin_type: str,
        config: Dict[str, Any],
        proxy_url: Optional[str] = None
    ) -> BasePlugin:
        """
        Create a plugin instance.
        
        Args:
            plugin_type: Type of plugin to create
            config: Plugin configuration dictionary
            proxy_url: Optional proxy URL
            
        Returns:
            Plugin instance
            
        Raises:
            ValueError: If plugin type is not registered
        """
        if plugin_type not in PLUGIN_REGISTRY:
            available = list(PLUGIN_REGISTRY.keys())
            raise ValueError(
                f"Unknown plugin type: {plugin_type}. "
                f"Available types: {available}"
            )
        
        plugin_class = PLUGIN_REGISTRY[plugin_type]
        plugin_config = PluginConfig(
            plugin_type=plugin_type,
            extra=config
        )
        
        return plugin_class(plugin_config, proxy_url)
    
    @staticmethod
    def register_plugin(plugin_type: str, plugin_class: Type[BasePlugin]):
        """
        Register a new plugin type.
        
        Args:
            plugin_type: Unique identifier for the plugin
            plugin_class: Plugin class (must extend BasePlugin)
        """
        if not issubclass(plugin_class, BasePlugin):
            raise TypeError(f"{plugin_class} must extend BasePlugin")
        
        PLUGIN_REGISTRY[plugin_type] = plugin_class
        logger.info(f"Registered plugin: {plugin_type}")


async def get_active_proxy_url(db: AsyncSession) -> Optional[str]:
    """Get the currently active proxy URL from database"""
    from database import AppConfig, ProxyServer, Credential
    
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
                proxy_type = getattr(proxy, 'proxy_type', 'http') or 'http'
                
                # Build proxy URL without credentials (credentials passed separately to plugin)
                if proxy_type == 'socks5':
                    return f"socks5://{proxy.ip}:{proxy.port}"
                else:
                    return f"http://{proxy.ip}:{proxy.port}"
        except Exception as e:
            logger.warning(f"Error loading proxy config: {e}")
    
    return None


async def get_active_proxy_config(db: AsyncSession) -> Optional[Dict[str, Any]]:
    """Get the currently active proxy configuration with credentials separated"""
    from database import AppConfig, ProxyServer, Credential
    
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
                proxy_type = getattr(proxy, 'proxy_type', 'http') or 'http'
                username = None
                password = None
                
                # Try to get credentials from credential_id first
                credential_id = getattr(proxy, 'credential_id', None)
                if credential_id:
                    cred_result = await db.execute(
                        select(Credential).where(Credential.id == credential_id)
                    )
                    credential = cred_result.scalar_one_or_none()
                    if credential:
                        username = credential.username
                        password = credential.password
                
                # Fallback to deprecated fields if no credential found
                if not username:
                    username = getattr(proxy, 'username', None)
                if not password:
                    password = getattr(proxy, 'password', None)
                
                # Build proxy URL without auth
                if proxy_type == 'socks5':
                    proxy_url = f"socks5://{proxy.ip}:{proxy.port}"
                else:
                    proxy_url = f"http://{proxy.ip}:{proxy.port}"
                
                return {
                    "proxy_url": proxy_url,
                    "proxy_user": username,
                    "proxy_pass": password,
                    "proxy_type": proxy_type,
                    "proxy_host": proxy.ip,
                    "proxy_port": proxy.port
                }
        except Exception as e:
            logger.warning(f"Error loading proxy config: {e}")
    
    return None
                    else:
                        return f"http://{proxy.ip}:{proxy.port}"
        except (ValueError, TypeError) as e:
            logger.warning(f"Invalid proxy_id in config: {e}")
    
    return None


async def get_plugin_for_server(db: AsyncSession, server_or_id) -> BasePlugin:
    """
    Get the appropriate plugin for a server.
    
    Args:
        db: Database session
        server_or_id: Server model instance or server ID
        
    Returns:
        Configured plugin instance
        
    Raises:
        CredentialNotSetException: If plugin requires credential but none configured
        ValueError: If server has no plugin_instance_id configured
    """
    from database import Credential, PluginInstance, Server
    from .exceptions import CredentialNotSetException
    
    # Se for um ID, buscar o servidor
    if isinstance(server_or_id, int):
        result = await db.execute(select(Server).where(Server.id == server_or_id))
        server = result.scalar_one_or_none()
        if not server:
            raise ValueError(f"Servidor ID {server_or_id} não encontrado")
    else:
        server = server_or_id
        # Garantir que os atributos estão carregados
        try:
            await db.refresh(server)
        except Exception:
            pass  # Pode falhar se já estiver atualizado
    
    # Acessar atributos diretamente
    plugin_instance_id = server.plugin_instance_id
    server_name = server.name or 'Unknown'
    server_ip = server.ip or 'Unknown'
    
    if not plugin_instance_id:
        raise ValueError(
            f"Servidor '{server_name}' ({server_ip}) não possui instância de plugin configurada. "
            f"Configure uma instância de plugin na página de Servidores."
        )
    
    # Get proxy URL
    proxy_url = await get_active_proxy_url(db)
    
    plugin_type = None
    plugin_config = {}
    
    # Load plugin instance from database
    result = await db.execute(
        select(PluginInstance).where(PluginInstance.id == plugin_instance_id)
    )
    instance = result.scalar_one_or_none()
    
    if not instance:
        raise ValueError(f"Instância de plugin ID {plugin_instance_id} não encontrada")
    
    if not instance.is_active:
        raise ValueError(f"Instância de plugin '{instance.name}' está desativada")
    
    plugin_type = instance.plugin_type
    plugin_config = instance.config or {}
    
    # For SOAP API plugin, validate URL is configured in instance
    if plugin_type == "soap_api" and "soap_url" not in plugin_config:
        # Don't fallback to global SoapApiUrl - require URL in instance config
        raise ValueError(
            "URL do SOAP não configurada na instância do plugin. "
            "Acesse Plugins > SOAP API > Instâncias e configure a URL do WebService."
        )
    
    # Create the plugin instance
    plugin = PluginFactory.create_plugin(plugin_type, plugin_config, proxy_url)
    
    # For direct_interaction plugin, load and set the credential
    if plugin_type == "direct_interaction":
        credential_id = plugin_config.get("credential_id")
        
        if not credential_id:
            raise CredentialNotSetException(
                operation="SMB",
                plugin_name="Interação Direta",
                message="Credencial não configurada. Configure uma credencial na instância do plugin."
            )
        
        # Load credential from database
        result = await db.execute(
            select(Credential).where(Credential.id == credential_id)
        )
        credential = result.scalar_one_or_none()
        
        if not credential:
            raise CredentialNotSetException(
                operation="SMB",
                plugin_name="Interação Direta",
                message=f"Credencial ID {credential_id} não encontrada. Configure uma credencial válida."
            )
        
        # Check credential type
        if credential.credential_type != "user_password":
            raise CredentialNotSetException(
                operation="SMB",
                plugin_name="Interação Direta",
                message="Apenas credenciais do tipo 'Usuário/Senha' são suportadas para SMB."
            )
        
        # Set credential on plugin with ID for verification tracking
        plugin.set_credential({
            "credential_type": credential.credential_type,
            "domain": credential.domain,
            "username": credential.username,
            "password": credential.password,
            "ntlm_hash": credential.ntlm_hash,
            "id": credential.id
        }, credential_id=credential.id)
        
        # Set callback for credential verification
        from credential_verification import mark_credential_verified
        
        async def on_auth_success(cred_id):
            # Create new session for async callback
            from database import AsyncSessionLocal
            async with AsyncSessionLocal() as session:
                await mark_credential_verified(session, cred_id, context="SMB/Direct Interaction")
        
        plugin.set_on_auth_success_callback(on_auth_success)
    
    return plugin


async def get_plugin_for_instance(db: AsyncSession, plugin_instance_id: int) -> BasePlugin:
    """
    Get a plugin configured from a specific plugin instance.
    
    Args:
        db: Database session
        plugin_instance_id: ID of the plugin instance to load
        
    Returns:
        Configured plugin instance
        
    Raises:
        ValueError: If plugin instance not found or not properly configured
    """
    from database import PluginInstance, Credential
    from .exceptions import CredentialNotSetException
    
    # Load plugin instance from database
    result = await db.execute(
        select(PluginInstance).where(PluginInstance.id == plugin_instance_id)
    )
    instance = result.scalar_one_or_none()
    
    if not instance:
        raise ValueError(f"Instância de plugin {plugin_instance_id} não encontrada")
    
    if not instance.is_active:
        raise ValueError(f"Instância de plugin '{instance.name}' está desativada")
    
    plugin_type = instance.plugin_type
    plugin_config = instance.config or {}
    
    # Get proxy URL
    proxy_url = await get_active_proxy_url(db)
    
    # Validate SOAP URL for SOAP plugins
    if plugin_type == "soap_api" and "soap_url" not in plugin_config:
        raise ValueError(
            f"URL do SOAP não configurada na instância '{instance.name}'. "
            "Edite a instância e configure a URL do WebService."
        )
    
    # Create the plugin instance
    plugin = PluginFactory.create_plugin(plugin_type, plugin_config, proxy_url)
    
    # For direct_interaction plugin, load and set the credential
    if plugin_type == "direct_interaction":
        credential_id = plugin_config.get("credential_id")
        
        if credential_id:
            cred_result = await db.execute(
                select(Credential).where(Credential.id == credential_id)
            )
            credential = cred_result.scalar_one_or_none()
            
            if credential:
                plugin.set_credential({
                    "id": credential.id,
                    "username": credential.username,
                    "password": credential.get_password() if hasattr(credential, 'get_password') else credential.password,
                    "domain": credential.domain,
                    "ntlm_hash": credential.ntlm_hash if hasattr(credential, 'ntlm_hash') else None
                })
    
    return plugin


async def get_default_soap_plugin(db: AsyncSession) -> SoapApiPlugin:
    """
    Get the default SOAP plugin (for backwards compatibility).
    
    Args:
        db: Database session
        
    Returns:
        SoapApiPlugin instance
    """
    from database import SoapApiUrl
    
    # Get SOAP URL
    result = await db.execute(select(SoapApiUrl).limit(1))
    soap_api = result.scalar_one_or_none()
    
    if not soap_api:
        raise ValueError("No SOAP API URL configured")
    
    # Get proxy URL
    proxy_url = await get_active_proxy_url(db)
    
    return PluginFactory.create_plugin(
        "soap_api",
        {"soap_url": soap_api.uri},
        proxy_url
    )
