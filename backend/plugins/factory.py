"""
Plugin Factory

Factory for creating and managing plugin instances.
"""

import logging
from typing import Dict, List, Type, Optional, Any
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


def _parse_dns_servers(dns_servers: Optional[str]) -> List[str]:
    """Split the proxy's comma-separated DNS server list into a list of IPs."""
    if not dns_servers:
        return []
    return [ip.strip() for ip in dns_servers.split(',') if ip.strip()]


def apply_direct_interaction_proxy_config(plugin_config: Dict[str, Any],
                                          proxy_config: Optional[Dict[str, Any]],
                                          instance_name: str) -> Dict[str, Any]:
    """
    Merge a proxy's settings into a direct_interaction plugin config.

    Validates the proxy type, forwards the proxy credentials, and adopts the
    proxy's DNS servers. Those servers live on the proxy because they are only
    reachable through that tunnel; an instance that configures its own servers
    still wins, since that is the more specific setting.

    Raises:
        ValueError: If the proxy is not a SOCKS proxy.
    """
    if not proxy_config:
        return plugin_config

    proxy_type = proxy_config.get("proxy_type", "http")
    proxy_name = proxy_config.get("proxy_name", "Unknown")

    # direct_interaction tunnels raw TCP (SMB, DNS), which HTTP proxies cannot carry
    if proxy_type not in ("socks5", "socks4"):
        raise ValueError(
            f"Proxy selecionado '{proxy_name}' não suportado para '{instance_name}'. "
            f"O plugin de Interação Direta requer um proxy do tipo SOCKS (SOCKS4 ou SOCKS5). "
            f"Tipo atual: {proxy_type}"
        )

    plugin_config["proxy_user"] = proxy_config.get("proxy_user")
    plugin_config["proxy_pass"] = proxy_config.get("proxy_pass")

    proxy_dns = proxy_config.get("dns_servers") or []
    if proxy_dns:
        if plugin_config.get("dns_mode") == "custom" and plugin_config.get("dns_servers"):
            logger.info(
                f"Instance '{instance_name}' defines its own DNS servers "
                f"({plugin_config['dns_servers']}); ignoring the ones from proxy '{proxy_name}'"
            )
        else:
            plugin_config["dns_mode"] = "custom"
            plugin_config["dns_servers"] = proxy_dns
            logger.info(
                f"Instance '{instance_name}' using DNS servers from proxy "
                f"'{proxy_name}': {proxy_dns}"
            )

    return plugin_config


async def get_proxy_config_for_instance(db: AsyncSession, instance) -> Optional[Dict[str, Any]]:
    """Get proxy configuration for a specific plugin instance based on its proxy_id"""
    from database import ProxyServer, Credential

    proxy_id = getattr(instance, 'proxy_id', None)
    if not proxy_id:
        return None

    try:
        result = await db.execute(
            select(ProxyServer).where(ProxyServer.id == proxy_id)
        )
        proxy = result.scalar_one_or_none()

        if not proxy:
            logger.warning(f"Proxy ID {proxy_id} not found for instance '{instance.name}'")
            return None

        proxy_type = getattr(proxy, 'proxy_type', 'http') or 'http'
        proxy_name = getattr(proxy, 'name', f'{proxy.ip}:{proxy.port}')
        username = None
        password = None

        credential_id = getattr(proxy, 'credential_id', None)
        if credential_id:
            cred_result = await db.execute(
                select(Credential).where(Credential.id == credential_id)
            )
            credential = cred_result.scalar_one_or_none()
            if credential and credential.credential_type == "user_password":
                username = credential.username
                password = credential.password

        if proxy_type in ('socks5', 'socks4'):
            proxy_url = f"{proxy_type}://{proxy.ip}:{proxy.port}"
        else:
            proxy_url = f"http://{proxy.ip}:{proxy.port}"

        return {
            "proxy_url": proxy_url,
            "proxy_user": username,
            "proxy_pass": password,
            "proxy_type": proxy_type,
            "proxy_host": proxy.ip,
            "proxy_port": proxy.port,
            "proxy_name": proxy_name,
            "proxy_id": proxy.id,
            "credential_id": credential_id,
            "dns_servers": _parse_dns_servers(getattr(proxy, 'dns_servers', None))
        }
    except Exception as e:
        logger.warning(f"Error loading proxy config for instance '{instance.name}': {e}")

    return None


async def get_proxy_config_by_id(db: AsyncSession, proxy_id: int) -> Optional[Dict[str, Any]]:
    """Get proxy configuration by proxy ID (for health checks without a saved instance)"""
    from database import ProxyServer, Credential

    if not proxy_id:
        return None

    try:
        result = await db.execute(
            select(ProxyServer).where(ProxyServer.id == proxy_id)
        )
        proxy = result.scalar_one_or_none()

        if not proxy:
            return None

        proxy_type = getattr(proxy, 'proxy_type', 'http') or 'http'
        proxy_name = getattr(proxy, 'name', f'{proxy.ip}:{proxy.port}')
        username = None
        password = None

        credential_id = getattr(proxy, 'credential_id', None)
        if credential_id:
            cred_result = await db.execute(
                select(Credential).where(Credential.id == credential_id)
            )
            credential = cred_result.scalar_one_or_none()
            if credential and credential.credential_type == "user_password":
                username = credential.username
                password = credential.password

        if proxy_type in ('socks5', 'socks4'):
            proxy_url = f"{proxy_type}://{proxy.ip}:{proxy.port}"
        else:
            proxy_url = f"http://{proxy.ip}:{proxy.port}"

        return {
            "proxy_url": proxy_url,
            "proxy_user": username,
            "proxy_pass": password,
            "proxy_type": proxy_type,
            "proxy_host": proxy.ip,
            "proxy_port": proxy.port,
            "proxy_name": proxy_name,
            "proxy_id": proxy.id,
            "credential_id": credential_id,
            "dns_servers": _parse_dns_servers(getattr(proxy, 'dns_servers', None))
        }
    except Exception as e:
        logger.warning(f"Error loading proxy config for proxy_id {proxy_id}: {e}")

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

    # Get proxy config from instance's proxy_id
    proxy_config = await get_proxy_config_for_instance(db, instance)
    proxy_url = proxy_config.get("proxy_url") if proxy_config else None

    # For SOAP API plugin, validate URL is configured in instance
    if plugin_type == "soap_api" and "soap_url" not in plugin_config:
        raise ValueError(
            "URL do SOAP não configurada na instância do plugin. "
            "Acesse Plugins > SOAP API > Instâncias e configure a URL do WebService."
        )

    # Apply proxy credentials and DNS servers to plugin config for direct_interaction
    if plugin_type == "direct_interaction":
        plugin_config = apply_direct_interaction_proxy_config(
            plugin_config, proxy_config,
            instance.name if instance else "Interação Direta"
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

    # Get proxy config from instance's proxy_id
    proxy_config = await get_proxy_config_for_instance(db, instance)
    proxy_url = proxy_config.get("proxy_url") if proxy_config else None

    # Validate SOAP URL for SOAP plugins
    if plugin_type == "soap_api" and "soap_url" not in plugin_config:
        raise ValueError(
            f"URL do SOAP não configurada na instância '{instance.name}'. "
            "Edite a instância e configure a URL do WebService."
        )

    # Apply proxy credentials and DNS servers to plugin config for direct_interaction
    if plugin_type == "direct_interaction":
        plugin_config = apply_direct_interaction_proxy_config(
            plugin_config, proxy_config, instance.name
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
                if credential.credential_type != "user_password":
                    raise CredentialNotSetException(
                        operation="SMB",
                        plugin_name=instance.name,
                        message="Apenas credenciais do tipo 'Usuário/Senha' são suportadas para SMB."
                    )

                plugin.set_credential({
                    "id": credential.id,
                    "credential_type": credential.credential_type,
                    "username": credential.username,
                    "password": credential.get_password() if hasattr(credential, 'get_password') else credential.password,
                    "domain": credential.domain,
                    "ntlm_hash": credential.ntlm_hash if hasattr(credential, 'ntlm_hash') else None
                }, credential_id=credential.id)

                # Set callback for credential verification
                from credential_verification import mark_credential_verified

                async def on_auth_success(cred_id):
                    from database import AsyncSessionLocal
                    async with AsyncSessionLocal() as session:
                        await mark_credential_verified(session, cred_id, context="SMB/Direct Interaction")

                plugin.set_on_auth_success_callback(on_auth_success)

    return plugin


async def get_default_soap_plugin(db: AsyncSession) -> SoapApiPlugin:
    """
    Get the default SOAP plugin (for backwards compatibility).
    Uses the default SOAP plugin instance's proxy if available, otherwise no proxy.

    Args:
        db: Database session

    Returns:
        SoapApiPlugin instance
    """
    from database import SoapApiUrl, PluginInstance

    # Try to find default SOAP instance to get its proxy
    result = await db.execute(
        select(PluginInstance).where(
            PluginInstance.plugin_type == "soap_api",
            PluginInstance.is_default == True,
            PluginInstance.is_active == True
        ).limit(1)
    )
    default_instance = result.scalar_one_or_none()

    proxy_url = None
    if default_instance:
        proxy_config = await get_proxy_config_for_instance(db, default_instance)
        proxy_url = proxy_config.get("proxy_url") if proxy_config else None

        # If instance has soap_url, use it
        instance_config = default_instance.config or {}
        if "soap_url" in instance_config:
            return PluginFactory.create_plugin(
                "soap_api",
                instance_config,
                proxy_url
            )

    # Fallback to legacy SoapApiUrl table
    result = await db.execute(select(SoapApiUrl).limit(1))
    soap_api = result.scalar_one_or_none()

    if not soap_api:
        raise ValueError("No SOAP API URL configured")

    return PluginFactory.create_plugin(
        "soap_api",
        {"soap_url": soap_api.uri},
        proxy_url
    )
