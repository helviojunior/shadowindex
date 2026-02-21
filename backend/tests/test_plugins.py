"""
Plugin System Tests

Tests for the plugin architecture, cache system, and SOAP API plugin.
"""

import pytest
import asyncio
import json
import tempfile
from pathlib import Path
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from plugins.base import (
    BasePlugin, 
    PluginConfig, 
    ShareInfo, 
    DirectoryItem,
    FileContent,
    SqlResult
)
from plugins.exceptions import (
    PluginException,
    ItemNotFoundException,
    AccessDeniedException,
    ConnectionException,
    TimeoutException
)
from plugins.cache import PluginCache, CacheEntry, cached_operation
from plugins.factory import PluginFactory, PLUGIN_REGISTRY
from plugins.soap_api import SoapApiPlugin


class TestPluginExceptions:
    """Tests for plugin exceptions"""
    
    def test_item_not_found_exception(self):
        """Test ItemNotFoundException"""
        exc = ItemNotFoundException("/path/to/file")
        assert exc.path == "/path/to/file"
        assert "not found" in str(exc).lower()
        assert exc.details["path"] == "/path/to/file"
    
    def test_access_denied_exception(self):
        """Test AccessDeniedException"""
        exc = AccessDeniedException("/secure/path")
        assert exc.path == "/secure/path"
        assert "denied" in str(exc).lower()
    
    def test_connection_exception(self):
        """Test ConnectionException"""
        original_error = Exception("Connection refused")
        exc = ConnectionException("192.168.1.1", "Failed to connect", original_error)
        assert exc.server == "192.168.1.1"
        assert exc.original_error == original_error
        assert "Failed to connect" in str(exc)
    
    def test_timeout_exception(self):
        """Test TimeoutException"""
        exc = TimeoutException("ListShares", 30)
        assert exc.operation == "ListShares"
        assert exc.timeout_seconds == 30
        assert "30" in str(exc)


class TestPluginConfig:
    """Tests for PluginConfig"""
    
    def test_config_creation(self):
        """Test creating a plugin config"""
        config = PluginConfig(
            plugin_type="soap_api",
            extra={"soap_url": "http://example.com/soap"}
        )
        assert config.plugin_type == "soap_api"
        assert config.get("soap_url") == "http://example.com/soap"
    
    def test_config_get_default(self):
        """Test getting config value with default"""
        config = PluginConfig(plugin_type="test")
        assert config.get("missing_key") is None
        assert config.get("missing_key", "default") == "default"


class TestPluginCache:
    """Tests for the plugin cache system"""
    
    @pytest.fixture
    def cache_dir(self):
        """Create temporary cache directory"""
        with tempfile.TemporaryDirectory() as tmpdir:
            yield Path(tmpdir)
    
    @pytest.fixture
    def cache(self, cache_dir):
        """Create cache instance"""
        return PluginCache(cache_dir=cache_dir, default_ttl_hours=24)
    
    @pytest.mark.asyncio
    async def test_cache_set_and_get(self, cache):
        """Test setting and getting cache values"""
        operation = "test_operation"
        params = {"param1": "value1", "param2": 123}
        response = {"result": "success", "data": [1, 2, 3]}
        
        # Set cache
        cache_key = await cache.set(operation, params, response)
        assert cache_key is not None
        
        # Get cache
        cached = await cache.get(operation, params)
        assert cached == response
    
    @pytest.mark.asyncio
    async def test_cache_miss(self, cache):
        """Test cache miss returns None"""
        result = await cache.get("nonexistent", {"key": "value"})
        assert result is None
    
    @pytest.mark.asyncio
    async def test_cache_invalidate(self, cache):
        """Test cache invalidation"""
        operation = "test_op"
        params = {"key": "value"}
        
        await cache.set(operation, params, {"data": "test"})
        assert await cache.get(operation, params) is not None
        
        # Invalidate
        result = await cache.invalidate(operation, params)
        assert result is True
        
        # Should be gone
        assert await cache.get(operation, params) is None
    
    @pytest.mark.asyncio
    async def test_cache_clear_all(self, cache):
        """Test clearing all cache entries"""
        # Add multiple entries
        for i in range(5):
            await cache.set(f"op_{i}", {"n": i}, {"result": i})
        
        # Clear all
        count = await cache.clear_all()
        assert count == 5
        
        # Verify all cleared
        for i in range(5):
            assert await cache.get(f"op_{i}", {"n": i}) is None
    
    @pytest.mark.asyncio
    async def test_cache_stats(self, cache):
        """Test getting cache statistics"""
        await cache.set("op1", {}, {"data": 1})
        await cache.set("op2", {}, {"data": 2})
        
        stats = await cache.get_stats()
        assert stats["total_entries"] == 2
        assert stats["valid_entries"] == 2
        assert stats["expired_entries"] == 0
    
    def test_cache_key_generation(self):
        """Test cache key generation is deterministic"""
        key1 = PluginCache._generate_cache_key("op", {"a": 1, "b": 2})
        key2 = PluginCache._generate_cache_key("op", {"b": 2, "a": 1})
        assert key1 == key2  # Should be same regardless of order


class TestCacheEntry:
    """Tests for CacheEntry dataclass"""
    
    def test_cache_entry_not_expired(self):
        """Test fresh cache entry is not expired"""
        entry = CacheEntry(
            operation="test",
            params_hash="abc123",
            params={},
            response={"data": "test"},
            timestamp=datetime.now(timezone.utc).isoformat(),
            ttl_hours=24
        )
        assert not entry.is_expired()
    
    def test_cache_entry_expired(self):
        """Test old cache entry is expired"""
        old_time = datetime.now(timezone.utc) - timedelta(hours=25)
        entry = CacheEntry(
            operation="test",
            params_hash="abc123",
            params={},
            response={"data": "test"},
            timestamp=old_time.isoformat(),
            ttl_hours=24
        )
        assert entry.is_expired()
    
    def test_cache_entry_serialization(self):
        """Test cache entry to/from dict"""
        entry = CacheEntry(
            operation="test",
            params_hash="abc123",
            params={"key": "value"},
            response={"result": 42},
            timestamp="2024-01-01T00:00:00+00:00",
            ttl_hours=12
        )
        
        data = entry.to_dict()
        restored = CacheEntry.from_dict(data)
        
        assert restored.operation == entry.operation
        assert restored.params == entry.params
        assert restored.response == entry.response


class TestPluginFactory:
    """Tests for the plugin factory"""
    
    def test_get_available_plugins(self):
        """Test listing available plugins"""
        plugins = PluginFactory.get_available_plugins()
        assert "soap_api" in plugins
        assert plugins["soap_api"]["type"] == "soap_api"
    
    def test_create_soap_plugin(self):
        """Test creating SOAP API plugin"""
        plugin = PluginFactory.create_plugin(
            "soap_api",
            {"soap_url": "http://example.com/soap"},
            proxy_url="http://proxy:8080"
        )
        
        assert isinstance(plugin, SoapApiPlugin)
        assert plugin.soap_url == "http://example.com/soap"
        assert plugin.proxy_url == "http://proxy:8080"
    
    def test_create_unknown_plugin_raises(self):
        """Test creating unknown plugin raises error"""
        with pytest.raises(ValueError) as exc_info:
            PluginFactory.create_plugin("unknown_plugin", {})
        
        assert "Unknown plugin type" in str(exc_info.value)
    
    def test_register_custom_plugin(self):
        """Test registering a custom plugin"""
        class CustomPlugin(BasePlugin):
            PLUGIN_TYPE = "custom"
            PLUGIN_NAME = "Custom Plugin"
            
            async def list_shares(self, server_ip): return []
            async def list_directory(self, path): return []
            async def download_file(self, path, offset=0, length=None): 
                return FileContent(data=b"", size=0)
            async def resolve_address(self, hostname): return ""
            async def sql_request(self, conn, query, timeout=30):
                return SqlResult(columns=[], rows=[], row_count=0)
        
        PluginFactory.register_plugin("custom", CustomPlugin)
        
        assert "custom" in PLUGIN_REGISTRY
        plugin = PluginFactory.create_plugin("custom", {})
        assert isinstance(plugin, CustomPlugin)
        
        # Cleanup
        del PLUGIN_REGISTRY["custom"]


class TestSoapApiPlugin:
    """Tests for the SOAP API plugin"""
    
    @pytest.fixture
    def plugin(self):
        """Create SOAP plugin instance"""
        return PluginFactory.create_plugin(
            "soap_api",
            {"soap_url": "http://test.example.com/soap"}
        )
    
    def test_plugin_initialization(self, plugin):
        """Test plugin initializes correctly"""
        assert plugin.PLUGIN_TYPE == "soap_api"
        assert plugin.soap_url == "http://test.example.com/soap"
    
    def test_soap_url_removes_wsdl(self):
        """Test SOAP URL removes WSDL suffix"""
        plugin = PluginFactory.create_plugin(
            "soap_api",
            {"soap_url": "http://test.example.com/soap?WSDL"}
        )
        assert "WSDL" not in plugin.soap_url
    
    def test_build_soap_envelope(self, plugin):
        """Test SOAP envelope building"""
        envelope = plugin._build_soap_envelope(
            "TestOperation",
            {"param1": "value1", "param2": "value2"}
        )
        
        assert "TestOperation" in envelope
        assert "<param1>value1</param1>" in envelope
        assert "<param2>value2</param2>" in envelope
        assert "soap:Envelope" in envelope
    
    def test_plugin_info(self, plugin):
        """Test plugin info retrieval"""
        info = plugin.get_plugin_info()
        assert info["type"] == "soap_api"
        assert info["name"] == "SOAP API Plugin"
        assert "version" in info


class TestDataClasses:
    """Tests for data classes"""
    
    def test_share_info(self):
        """Test ShareInfo dataclass"""
        share = ShareInfo(
            name="Data",
            share_type="Disk",
            remark="Data share",
            path="\\\\server\\Data"
        )
        assert share.name == "Data"
        assert share.path == "\\\\server\\Data"
    
    def test_directory_item_file(self):
        """Test DirectoryItem for a file"""
        item = DirectoryItem(
            name="test.txt",
            item_type="File",
            full_path="\\\\server\\share\\test.txt",
            size=1024,
            extension="txt"
        )
        assert item.is_file
        assert not item.is_directory
        assert item.extension == "txt"
    
    def test_directory_item_directory(self):
        """Test DirectoryItem for a directory"""
        item = DirectoryItem(
            name="folder",
            item_type="Directory",
            full_path="\\\\server\\share\\folder"
        )
        assert item.is_directory
        assert not item.is_file
    
    def test_file_content(self):
        """Test FileContent dataclass"""
        content = FileContent(
            data=b"Hello, World!",
            size=13,
            is_complete=True
        )
        assert content.size == 13
        assert content.is_complete
    
    def test_sql_result(self):
        """Test SqlResult dataclass"""
        result = SqlResult(
            columns=["id", "name"],
            rows=[{"id": 1, "name": "Test"}],
            row_count=1,
            execution_time_ms=50.5
        )
        assert len(result.columns) == 2
        assert result.row_count == 1


class TestCachedOperation:
    """Tests for cached_operation helper"""
    
    @pytest.mark.asyncio
    async def test_cached_operation_caches_result(self):
        """Test that cached_operation caches results"""
        call_count = 0
        
        async def expensive_operation():
            nonlocal call_count
            call_count += 1
            return {"result": "expensive"}
        
        with tempfile.TemporaryDirectory() as tmpdir:
            cache = PluginCache(cache_dir=Path(tmpdir))
            
            # Patch global cache
            with patch('plugins.cache._global_cache', cache):
                # First call - should execute
                result1 = await cached_operation(
                    "test_op",
                    {"key": "value"},
                    expensive_operation
                )
                
                # Second call - should use cache
                result2 = await cached_operation(
                    "test_op",
                    {"key": "value"},
                    expensive_operation
                )
                
                assert call_count == 1  # Only called once
                assert result1 == result2
    
    @pytest.mark.asyncio
    async def test_cached_operation_ignore_cache(self):
        """Test that ignore_cache bypasses cache"""
        call_count = 0
        
        async def operation():
            nonlocal call_count
            call_count += 1
            return {"call": call_count}
        
        with tempfile.TemporaryDirectory() as tmpdir:
            cache = PluginCache(cache_dir=Path(tmpdir))
            
            with patch('plugins.cache._global_cache', cache):
                await cached_operation("op", {}, operation)
                await cached_operation("op", {}, operation, ignore_cache=True)
                
                assert call_count == 2


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
