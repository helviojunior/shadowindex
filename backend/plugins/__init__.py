"""
Plugin System for Server Integration

This module provides a plugin architecture for different server communication methods.
Each plugin must implement the BasePlugin interface.
"""

from .base import BasePlugin, PluginConfig
from .exceptions import (
    PluginException,
    ItemNotFoundException,
    AccessDeniedException,
    ConnectionException,
    AuthenticationException,
    TimeoutException,
    CredentialNotSetException
)
from .cache import PluginCache
from .factory import PluginFactory, get_plugin_for_server

__all__ = [
    'BasePlugin',
    'PluginConfig',
    'PluginException',
    'ItemNotFoundException',
    'AccessDeniedException',
    'ConnectionException',
    'AuthenticationException',
    'TimeoutException',
    'CredentialNotSetException',
    'PluginCache',
    'PluginFactory',
    'get_plugin_for_server'
]
