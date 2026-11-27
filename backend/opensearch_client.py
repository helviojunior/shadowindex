"""
OpenSearch client for the GIT module.

Indexes the textual content of cloned repository files so they can be searched
quickly (with highlighting). Degrades gracefully: if OpenSearch is unreachable
the worker keeps going and the ILIKE fallback in git_routes still works.
"""
import os
import logging
from typing import Optional, List, Dict, Any

logger = logging.getLogger(__name__)

OPENSEARCH_URL = os.environ.get("OPENSEARCH_URL", "").strip()
GIT_INDEX = "shadowindex-git"

_client = None
_index_ready = False

INDEX_MAPPING = {
    "settings": {
        "index": {
            "number_of_shards": 1,
            "number_of_replicas": 0,
        }
    },
    "mappings": {
        "properties": {
            "repo_id": {"type": "integer"},
            "repo_guid": {"type": "keyword"},
            "repo_full_name": {"type": "keyword"},
            "file_id": {"type": "integer"},
            "rel_path": {"type": "text", "fields": {"raw": {"type": "keyword", "ignore_above": 1024}}},
            "name": {"type": "text", "fields": {"raw": {"type": "keyword", "ignore_above": 512}}},
            "extension": {"type": "keyword"},
            "mimetype": {"type": "keyword"},
            "size": {"type": "long"},
            "content": {"type": "text"},
        }
    },
}


def is_enabled() -> bool:
    return bool(OPENSEARCH_URL)


def get_client():
    """Lazily build the OpenSearch client. Returns None if disabled/unavailable."""
    global _client
    if not OPENSEARCH_URL:
        return None
    if _client is not None:
        return _client
    try:
        from opensearchpy import OpenSearch
        _client = OpenSearch(
            hosts=[OPENSEARCH_URL],
            http_compress=True,
            use_ssl=OPENSEARCH_URL.startswith("https"),
            verify_certs=False,
            ssl_show_warn=False,
            timeout=30,
            max_retries=2,
            retry_on_timeout=True,
        )
        return _client
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[opensearch] could not create client: {e}")
        return None


def ensure_index() -> bool:
    """Create the git index with mapping if it does not exist. Best-effort."""
    global _index_ready
    if _index_ready:
        return True
    client = get_client()
    if client is None:
        return False
    try:
        if not client.indices.exists(index=GIT_INDEX):
            client.indices.create(index=GIT_INDEX, body=INDEX_MAPPING)
            logger.info(f"[opensearch] created index {GIT_INDEX}")
        _index_ready = True
        return True
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[opensearch] ensure_index failed: {e}")
        return False


def health() -> Dict[str, Any]:
    """Return a small health dict for status endpoints."""
    if not OPENSEARCH_URL:
        return {"enabled": False, "available": False, "status": "disabled"}
    client = get_client()
    if client is None:
        return {"enabled": True, "available": False, "status": "unavailable"}
    try:
        h = client.cluster.health()
        return {
            "enabled": True,
            "available": True,
            "status": h.get("status", "unknown"),
            "url": OPENSEARCH_URL,
        }
    except Exception as e:  # noqa: BLE001
        return {"enabled": True, "available": False, "status": "error", "error": str(e)}


def bulk_index(docs: List[Dict[str, Any]]) -> int:
    """Index a list of file documents. Each doc must carry a unique '_id'.
    Returns the number of successfully indexed docs (0 on failure)."""
    if not docs:
        return 0
    if not ensure_index():
        return 0
    client = get_client()
    if client is None:
        return 0
    try:
        from opensearchpy import helpers
        actions = []
        for d in docs:
            doc_id = d.pop("_id", None)
            action = {"_op_type": "index", "_index": GIT_INDEX, "_source": d}
            if doc_id is not None:
                action["_id"] = doc_id
            actions.append(action)
        success, errors = helpers.bulk(client, actions, stats_only=False, raise_on_error=False)
        if errors:
            logger.warning(f"[opensearch] bulk had {len(errors)} errors (indexed {success})")
        return success
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[opensearch] bulk_index failed: {e}")
        return 0


def delete_repo(repo_guid: str) -> bool:
    """Remove all documents of a repo from the index."""
    client = get_client()
    if client is None:
        return False
    try:
        client.delete_by_query(
            index=GIT_INDEX,
            body={"query": {"term": {"repo_guid": repo_guid}}},
            ignore=[404],
            refresh=True,
        )
        return True
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[opensearch] delete_repo failed: {e}")
        return False


def search_content(
    query: str,
    repo_guid: Optional[str] = None,
    size: int = 50,
    highlight: bool = True,
) -> Optional[Dict[str, Any]]:
    """Full-text search over indexed file content.
    Returns a dict {total, hits:[{repo_guid, repo_full_name, rel_path, name, score, highlights:[...]}]}
    or None if OpenSearch is unavailable (caller should fall back to ILIKE)."""
    client = get_client()
    if client is None:
        return None
    must = [{
        "multi_match": {
            "query": query,
            "fields": ["content", "name^2", "rel_path"],
            "type": "best_fields",
        }
    }]
    filt = []
    if repo_guid:
        filt.append({"term": {"repo_guid": repo_guid}})
    body: Dict[str, Any] = {
        "size": size,
        "query": {"bool": {"must": must, "filter": filt}},
        "_source": ["repo_id", "repo_guid", "repo_full_name", "rel_path", "name", "extension"],
    }
    if highlight:
        body["highlight"] = {
            "fields": {"content": {"fragment_size": 160, "number_of_fragments": 3}},
            "pre_tags": ["<mark>"],
            "post_tags": ["</mark>"],
        }
    try:
        res = client.search(index=GIT_INDEX, body=body)
        hits = []
        for h in res.get("hits", {}).get("hits", []):
            src = h.get("_source", {})
            hits.append({
                "repo_id": src.get("repo_id"),
                "repo_guid": src.get("repo_guid"),
                "repo_full_name": src.get("repo_full_name"),
                "rel_path": src.get("rel_path"),
                "name": src.get("name"),
                "extension": src.get("extension"),
                "score": h.get("_score"),
                "highlights": h.get("highlight", {}).get("content", []),
            })
        total = res.get("hits", {}).get("total", {})
        total_val = total.get("value") if isinstance(total, dict) else total
        return {"total": total_val or 0, "hits": hits, "backend": "opensearch"}
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[opensearch] search_content failed: {e}")
        return None
