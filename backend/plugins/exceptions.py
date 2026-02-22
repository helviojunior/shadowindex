"""
Plugin Exceptions

Standard exceptions that all plugins should raise for common error conditions.
"""


class PluginException(Exception):
    """Base exception for all plugin errors"""
    def __init__(self, message: str, details: dict = None):
        super().__init__(message)
        self.message = message
        self.details = details or {}


class ItemNotFoundException(PluginException):
    """Raised when a requested item (file, directory, share) is not found"""
    def __init__(self, path: str, message: str = None):
        super().__init__(
            message or f"Item not found: {path}",
            {"path": path}
        )
        self.path = path


class AccessDeniedException(PluginException):
    """Raised when access to an item is denied"""
    def __init__(self, path: str, message: str = None):
        super().__init__(
            message or f"Access denied: {path}",
            {"path": path}
        )
        self.path = path


class ConnectionException(PluginException):
    """Raised when connection to the server fails"""
    def __init__(self, server: str, message: str = None, original_error: Exception = None):
        super().__init__(
            message or f"Connection failed to: {server}",
            {"server": server, "original_error": str(original_error) if original_error else None}
        )
        self.server = server
        self.original_error = original_error


class AuthenticationException(PluginException):
    """Raised when authentication fails"""
    def __init__(self, message: str = None):
        super().__init__(message or "Authentication failed")


class AuthenticationFailureException(PluginException):
    """Raised when authentication fails with specific details about the failure"""
    def __init__(
        self, 
        username: str = None, 
        domain: str = None, 
        reason: str = None,
        message: str = None
    ):
        details = {}
        if username:
            details["username"] = username
        if domain:
            details["domain"] = domain
        if reason:
            details["reason"] = reason
        
        msg = message or "Authentication failed"
        if username:
            msg += f" for user '{domain}\\{username}'" if domain else f" for user '{username}'"
        if reason:
            msg += f": {reason}"
        
        super().__init__(msg, details)
        self.username = username
        self.domain = domain
        self.reason = reason


class TimeoutException(PluginException):
    """Raised when an operation times out"""
    def __init__(self, operation: str, timeout_seconds: int, message: str = None):
        super().__init__(
            message or f"Operation '{operation}' timed out after {timeout_seconds}s",
            {"operation": operation, "timeout_seconds": timeout_seconds}
        )
        self.operation = operation
        self.timeout_seconds = timeout_seconds


class NotImplementedException(PluginException):
    """Raised when a plugin method is not yet implemented"""
    def __init__(self, method: str, plugin_name: str, message: str = None):
        super().__init__(
            message or f"Method '{method}' is not implemented in plugin '{plugin_name}'",
            {"method": method, "plugin_name": plugin_name}
        )
        self.method = method
        self.plugin_name = plugin_name


class CredentialNotSetException(PluginException):
    """Raised when a required credential is not configured for an operation"""
    def __init__(self, operation: str = None, plugin_name: str = None, message: str = None):
        msg = message or "Credencial não configurada"
        if operation:
            msg = f"Credencial não configurada para operação '{operation}'"
        if plugin_name:
            msg += f" no plugin '{plugin_name}'"
        
        super().__init__(
            msg,
            {"operation": operation, "plugin_name": plugin_name}
        )
        self.operation = operation
        self.plugin_name = plugin_name
