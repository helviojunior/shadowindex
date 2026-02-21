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
    from database import AppConfig, ProxyServer
    
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
                username = getattr(proxy, 'username', None)
                password = getattr(proxy, 'password', None)
                
                # Build proxy URL based on type
                if proxy_type == 'socks5':
                    if username and password:
                        return f"socks5://{username}:{password}@{proxy.ip}:{proxy.port}"
                    else:
                        return f"socks5://{proxy.ip}:{proxy.port}"
                else:
                    # HTTP proxy
                    return f"http://{proxy.ip}:{proxy.port}"
        except (ValueError, TypeError) as e:
            logger.warning(f"Invalid proxy_id in config: {e}")
    
    return None


async def get_plugin_for_server(db: AsyncSession, server) -> BasePlugin:
    """
    Get the appropriate plugin for a server.
    
    Args:
        db: Database session
        server: Server model instance
        
    Returns:
        Configured plugin instance
    """
    from database import SoapApiUrl
    
    # Get proxy URL
    proxy_url = await get_active_proxy_url(db)
    
    # Get plugin type from server (default to soap_api)
    plugin_type = getattr(server, 'plugin_type', 'soap_api') or 'soap_api'
    
    # Get plugin config from server
    plugin_config = {}
    server_plugin_config = getattr(server, 'plugin_config', None)
    if server_plugin_config:
        if isinstance(server_plugin_config, dict):
            plugin_config = server_plugin_config
        elif isinstance(server_plugin_config, str):
            import json
            try:
                plugin_config = json.loads(server_plugin_config)
            except json.JSONDecodeError:
                pass
    
    # For SOAP API plugin, get URL from SoapApiUrl table if not in config
    if plugin_type == "soap_api" and "soap_url" not in plugin_config:
        result = await db.execute(select(SoapApiUrl).limit(1))
        soap_api = result.scalar_one_or_none()
        
        if soap_api:
            plugin_config["soap_url"] = soap_api.uri
        else:
            raise ValueError("No SOAP API URL configured")
    
    return PluginFactory.create_plugin(plugin_type, plugin_config, proxy_url)


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
