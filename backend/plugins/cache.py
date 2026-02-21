"""
Plugin Cache System

Global caching layer between Core and Plugin interfaces.
Caches request parameters and responses in JSON format on disk.
"""

import hashlib
import json
import logging
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Optional, Dict, Callable
from dataclasses import dataclass, asdict
import asyncio

logger = logging.getLogger(__name__)

# Default cache directory
DEFAULT_CACHE_DIR = Path(__file__).parent.parent / "data" / "cache" / "plugins"


@dataclass
class CacheEntry:
    """Represents a cached response"""
    operation: str
    params_hash: str
    params: Dict[str, Any]
    response: Any
    timestamp: str
    ttl_hours: int
    
    def is_expired(self) -> bool:
        """Check if cache entry is expired"""
        try:
            ts = datetime.fromisoformat(self.timestamp)
            age = datetime.now(timezone.utc) - ts
            return age > timedelta(hours=self.ttl_hours)
        except Exception:
            return True
    
    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'CacheEntry':
        return cls(**data)


class PluginCache:
    """
    Global cache manager for plugin operations.
    
    Stores request/response pairs as JSON files on disk.
    Uses SHA256 hash of operation + params as cache key.
    """
    
    def __init__(self, cache_dir: Path = None, default_ttl_hours: int = 24):
        """
        Initialize cache manager.
        
        Args:
            cache_dir: Directory to store cache files
            default_ttl_hours: Default time-to-live for cache entries
        """
        self.cache_dir = cache_dir or DEFAULT_CACHE_DIR
        self.default_ttl_hours = default_ttl_hours
        self._ensure_cache_dir()
    
    def _ensure_cache_dir(self):
        """Create cache directory if it doesn't exist"""
        self.cache_dir.mkdir(parents=True, exist_ok=True)
    
    @staticmethod
    def _generate_cache_key(operation: str, params: Dict[str, Any]) -> str:
        """
        Generate unique cache key from operation and parameters.
        
        Args:
            operation: Name of the operation
            params: Operation parameters
            
        Returns:
            SHA256 hash as hex string
        """
        # Sort keys for consistent hashing
        key_str = f"{operation}:{json.dumps(params, sort_keys=True, default=str)}"
        return hashlib.sha256(key_str.encode()).hexdigest()
    
    def _get_cache_file_path(self, cache_key: str) -> Path:
        """Get file path for a cache key"""
        return self.cache_dir / f"{cache_key}.json"
    
    async def get(
        self, 
        operation: str, 
        params: Dict[str, Any],
        ttl_hours: int = None
    ) -> Optional[Any]:
        """
        Get cached response for an operation.
        
        Args:
            operation: Name of the operation
            params: Operation parameters
            ttl_hours: Override default TTL for this check
            
        Returns:
            Cached response or None if not found/expired
        """
        cache_key = self._generate_cache_key(operation, params)
        cache_file = self._get_cache_file_path(cache_key)
        
        if not cache_file.exists():
            return None
        
        try:
            # Read cache file in thread to avoid blocking
            def read_cache():
                with open(cache_file, 'r', encoding='utf-8') as f:
                    return json.load(f)
            
            cache_data = await asyncio.to_thread(read_cache)
            entry = CacheEntry.from_dict(cache_data)
            
            # Check TTL (note: effective_ttl could be used for future TTL override logic)
            _ = ttl_hours or entry.ttl_hours  # Reserved for future use
            if entry.is_expired():
                logger.debug(f"Cache expired for {operation}: {cache_key[:16]}...")
                return None
            
            logger.info(f"Cache hit for {operation}: {cache_key[:16]}...")
            return entry.response
            
        except Exception as e:
            logger.warning(f"Error reading cache file {cache_file}: {e}")
            return None
    
    async def set(
        self, 
        operation: str, 
        params: Dict[str, Any],
        response: Any,
        ttl_hours: int = None
    ) -> str:
        """
        Store response in cache.
        
        Args:
            operation: Name of the operation
            params: Operation parameters
            response: Response to cache
            ttl_hours: Time-to-live in hours
            
        Returns:
            Cache key
        """
        cache_key = self._generate_cache_key(operation, params)
        cache_file = self._get_cache_file_path(cache_key)
        
        entry = CacheEntry(
            operation=operation,
            params_hash=cache_key,
            params=params,
            response=response,
            timestamp=datetime.now(timezone.utc).isoformat(),
            ttl_hours=ttl_hours or self.default_ttl_hours
        )
        
        try:
            def write_cache():
                self._ensure_cache_dir()
                with open(cache_file, 'w', encoding='utf-8') as f:
                    json.dump(entry.to_dict(), f, ensure_ascii=False, indent=2, default=str)
            
            await asyncio.to_thread(write_cache)
            logger.info(f"Cached response for {operation}: {cache_key[:16]}...")
            return cache_key
            
        except Exception as e:
            logger.error(f"Error writing cache file {cache_file}: {e}")
            return cache_key
    
    async def invalidate(self, operation: str, params: Dict[str, Any]) -> bool:
        """
        Invalidate a specific cache entry.
        
        Args:
            operation: Name of the operation
            params: Operation parameters
            
        Returns:
            True if entry was deleted, False otherwise
        """
        cache_key = self._generate_cache_key(operation, params)
        cache_file = self._get_cache_file_path(cache_key)
        
        try:
            if cache_file.exists():
                cache_file.unlink()
                logger.info(f"Invalidated cache for {operation}: {cache_key[:16]}...")
                return True
            return False
        except Exception as e:
            logger.error(f"Error deleting cache file {cache_file}: {e}")
            return False
    
    async def clear_all(self) -> int:
        """
        Clear all cache entries.
        
        Returns:
            Number of entries cleared
        """
        count = 0
        try:
            for cache_file in self.cache_dir.glob("*.json"):
                try:
                    cache_file.unlink()
                    count += 1
                except Exception as e:
                    logger.warning(f"Error deleting {cache_file}: {e}")
            logger.info(f"Cleared {count} cache entries")
        except Exception as e:
            logger.error(f"Error clearing cache: {e}")
        return count
    
    async def get_stats(self) -> Dict[str, Any]:
        """
        Get cache statistics.
        
        Returns:
            Dictionary with cache stats
        """
        total_entries = 0
        expired_entries = 0
        total_size = 0
        
        try:
            for cache_file in self.cache_dir.glob("*.json"):
                total_entries += 1
                total_size += cache_file.stat().st_size
                
                try:
                    with open(cache_file, 'r') as f:
                        data = json.load(f)
                        entry = CacheEntry.from_dict(data)
                        if entry.is_expired():
                            expired_entries += 1
                except Exception:
                    expired_entries += 1
                    
        except Exception as e:
            logger.error(f"Error getting cache stats: {e}")
        
        return {
            "total_entries": total_entries,
            "expired_entries": expired_entries,
            "valid_entries": total_entries - expired_entries,
            "total_size_bytes": total_size,
            "cache_dir": str(self.cache_dir)
        }
    
    async def cleanup_expired(self) -> int:
        """
        Remove expired cache entries.
        
        Returns:
            Number of entries removed
        """
        removed = 0
        try:
            for cache_file in self.cache_dir.glob("*.json"):
                try:
                    with open(cache_file, 'r') as f:
                        data = json.load(f)
                        entry = CacheEntry.from_dict(data)
                        if entry.is_expired():
                            cache_file.unlink()
                            removed += 1
                except Exception:
                    # If we can't read it, delete it
                    try:
                        cache_file.unlink()
                        removed += 1
                    except Exception:
                        pass
            logger.info(f"Cleaned up {removed} expired cache entries")
        except Exception as e:
            logger.error(f"Error cleaning up cache: {e}")
        return removed


# Global cache instance
_global_cache: Optional[PluginCache] = None


def get_cache() -> PluginCache:
    """Get global cache instance"""
    global _global_cache
    if _global_cache is None:
        _global_cache = PluginCache()
    return _global_cache


async def cached_operation(
    operation: str,
    params: Dict[str, Any],
    func: Callable,
    ignore_cache: bool = False,
    ttl_hours: int = 24
) -> Any:
    """
    Execute an operation with caching.
    
    Args:
        operation: Name of the operation (for cache key)
        params: Operation parameters (for cache key)
        func: Async function to execute if not cached
        ignore_cache: If True, skip cache lookup
        ttl_hours: Cache TTL in hours
        
    Returns:
        Result from cache or from function execution
    """
    cache = get_cache()
    
    # Check cache first
    if not ignore_cache:
        cached = await cache.get(operation, params, ttl_hours)
        if cached is not None:
            return cached
    
    # Execute function
    result = await func()
    
    # Store in cache
    await cache.set(operation, params, result, ttl_hours)
    
    return result
