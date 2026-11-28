"""
Async GitHub Search API client for the GIT module.

Replicates the search behavior of the `gh-search-clone` tool
(https://github.com/helviojunior/gh-search-clone):
  - repository search (/search/repositories) with sort/order
  - code search (/search/code)
  - --exact => phrase-quote the keyword, plus a client-side literal filter for
    repository search
  - total_count capped at GitHub's 1000-result hard limit
  - primary/secondary rate-limit handling (HTTP 403/429)

A GitHub token is REQUIRED for the Search API.
"""
import asyncio
import time
import logging
from typing import List, Dict, Any, Optional

import httpx

logger = logging.getLogger(__name__)

API_URL = "https://api.github.com"
PER_PAGE = 100
MAX_RESULTS = 1000  # GitHub Search API hard limit


class GithubSearchError(Exception):
    """Raised for non-retryable GitHub Search API errors (bad token, bad query)."""
    def __init__(self, message: str, status: Optional[int] = None):
        super().__init__(message)
        self.message = message
        self.status = status


async def resolve_proxy_url(db, proxy_id) -> Optional[str]:
    """Resolve o proxy_id para uma URL completa (com credenciais, se houver).
    Retorna None quando não há proxy. Reaproveita o builder dos plugins."""
    if not proxy_id:
        return None
    try:
        from plugins.factory import get_proxy_config_by_id
        cfg = await get_proxy_config_by_id(db, int(proxy_id))
    except Exception:  # noqa: BLE001
        return None
    if not cfg or not cfg.get("proxy_url"):
        return None
    base = cfg["proxy_url"]  # http://ip:port ou socks5://ip:port
    user = cfg.get("proxy_user")
    pw = cfg.get("proxy_pass")
    if user:
        try:
            from urllib.parse import quote
            scheme, rest = base.split("://", 1)
            auth = quote(str(user), safe="")
            if pw:
                auth += ":" + quote(str(pw), safe="")
            return f"{scheme}://{auth}@{rest}"
        except Exception:  # noqa: BLE001
            return base
    return base


class AsyncGithubSearcher:
    def __init__(self, token: str, max_results: int = MAX_RESULTS, proxy: Optional[str] = None):
        if not token:
            raise GithubSearchError("GitHub token is required for the Search API")
        self.token = token
        self.proxy = proxy
        self.max_results = max(1, min(max_results, MAX_RESULTS))
        self.headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "shadowindex-git",
        }

    # -- low level ---------------------------------------------------------
    async def _request(self, client: httpx.AsyncClient, url: str, params: dict) -> dict:
        """GET with primary/secondary rate-limit handling."""
        attempts = 0
        while True:
            attempts += 1
            resp = await client.get(url, params=params, headers=self.headers, timeout=30)
            if resp.status_code in (403, 429):
                remaining = resp.headers.get("X-RateLimit-Remaining")
                reset = resp.headers.get("X-RateLimit-Reset")
                retry_after = resp.headers.get("Retry-After")
                if retry_after is not None:
                    wait = int(retry_after)
                elif remaining == "0" and reset is not None:
                    wait = max(0, int(reset) - int(time.time())) + 1
                else:
                    # Not a rate-limit (e.g. bad credentials) -> surface it
                    raise GithubSearchError(
                        f"GitHub API forbidden: {self._err_msg(resp)}", status=resp.status_code
                    )
                # Guard against unbounded waits in a request context
                wait = min(wait, 60)
                logger.info(f"[github] rate limited, waiting {wait}s (attempt {attempts})")
                if attempts > 6:
                    raise GithubSearchError("GitHub API rate limit exceeded", status=resp.status_code)
                await asyncio.sleep(wait)
                continue
            if resp.status_code == 401:
                raise GithubSearchError("Invalid GitHub token (401)", status=401)
            if resp.status_code == 422:
                raise GithubSearchError(
                    f"Invalid GitHub search query: {self._err_msg(resp)}", status=422
                )
            resp.raise_for_status()
            return resp.json()

    @staticmethod
    def _err_msg(resp: httpx.Response) -> str:
        try:
            data = resp.json()
            return data.get("message", resp.text[:200])
        except Exception:  # noqa: BLE001
            return resp.text[:200]

    # -- query helpers -----------------------------------------------------
    @staticmethod
    def _exact_query(keyword: str) -> str:
        k = (keyword or "").strip()
        if k.startswith('"') and k.endswith('"'):
            return k
        return '"%s"' % k

    @staticmethod
    def _matches_exact(repo: dict, keyword: str) -> bool:
        needle = (keyword or "").strip().strip('"').lower()
        haystack = " ".join(filter(None, [
            repo.get("full_name"), repo.get("name"), repo.get("description"),
        ])).lower()
        return needle in haystack

    @staticmethod
    def _normalize(repo: dict) -> Dict[str, Any]:
        full_name = repo.get("full_name")
        return {
            "full_name": full_name,
            "name": repo.get("name"),
            "owner": (repo.get("owner") or {}).get("login"),
            "description": repo.get("description"),
            "html_url": repo.get("html_url"),
            "clone_url": repo.get("clone_url") or (f"https://github.com/{full_name}.git" if full_name else None),
            "default_branch": repo.get("default_branch"),
            "stars": repo.get("stargazers_count") or 0,
            "forks": repo.get("forks_count") or 0,
            "language": repo.get("language"),
            "topics": repo.get("topics") or [],
            "size_kb": repo.get("size"),
            "private": bool(repo.get("private")),
            # Data do último push (atualização do código) — usada para priorizar o clone.
            "pushed_at": repo.get("pushed_at") or repo.get("updated_at"),
        }

    # -- public API --------------------------------------------------------
    async def count(self, keyword: str, search_type: str = "repositories", exact: bool = False) -> int:
        """Return the (capped) total_count for a single term, via a page-1 fetch."""
        endpoint = "code" if search_type == "code" else "repositories"
        url = f"{API_URL}/search/{endpoint}"
        query = self._exact_query(keyword) if exact else keyword
        params = {"q": query, "per_page": 1, "page": 1}
        if endpoint == "repositories":
            params["order"] = "desc"
            params["sort"] = "updated"
        async with httpx.AsyncClient(proxy=self.proxy, verify=False) as client:
            data = await self._request(client, url, params)
        return min(int(data.get("total_count", 0) or 0), self.max_results)

    async def get_repo(self, full_name: str) -> Optional[Dict[str, Any]]:
        """Metadados de um repositório (GET /repos/{full_name}); None se não encontrado."""
        url = f"{API_URL}/repos/{full_name}"
        async with httpx.AsyncClient(proxy=self.proxy, verify=False) as client:
            try:
                data = await self._request(client, url, {})
            except httpx.HTTPStatusError as e:  # 404, etc.
                if e.response is not None and e.response.status_code == 404:
                    return None
                raise
        return self._normalize(data)

    async def resolve(self, keyword: str, search_type: str = "repositories",
                      exact: bool = False, sort: str = "updated", order: str = "desc") -> List[Dict[str, Any]]:
        """Fully paginate a term and return unique normalized repos (deduped by full_name)."""
        if search_type == "code":
            repos = await self._search_code(keyword, exact=exact)
        else:
            repos = await self._search_repositories(keyword, sort=sort, order=order, exact=exact)
            if exact:
                repos = [r for r in repos if self._matches_exact(r, keyword)]
        return repos

    async def _search_repositories(self, keyword, sort="updated", order="desc", exact=False):
        found: Dict[str, Any] = {}
        url = f"{API_URL}/search/repositories"
        page = 1
        total_count = None
        query = self._exact_query(keyword) if exact else keyword
        base_params = {"per_page": PER_PAGE, "order": order}
        if sort and sort != "best-match":
            base_params["sort"] = sort
        async with httpx.AsyncClient(proxy=self.proxy, verify=False) as client:
            while True:
                data = await self._request(client, url, dict(base_params, q=query, page=page))
                if total_count is None:
                    total_count = min(int(data.get("total_count", 0) or 0), self.max_results)
                items = data.get("items", [])
                if not items:
                    break
                for repo in items:
                    if repo.get("full_name"):
                        found[repo["full_name"]] = self._normalize(repo)
                if len(found) >= total_count or page * PER_PAGE >= self.max_results:
                    break
                page += 1
        return list(found.values())

    async def _search_code(self, keyword, exact=False):
        found: Dict[str, Any] = {}
        url = f"{API_URL}/search/code"
        page = 1
        total_count = None
        query = self._exact_query(keyword) if exact else keyword
        async with httpx.AsyncClient(proxy=self.proxy, verify=False) as client:
            while True:
                data = await self._request(client, url, {"q": query, "per_page": PER_PAGE, "page": page})
                if total_count is None:
                    total_count = min(int(data.get("total_count", 0) or 0), self.max_results)
                items = data.get("items", [])
                if not items:
                    break
                for item in items:
                    repo = item.get("repository", {})
                    full_name = repo.get("full_name")
                    if full_name and full_name not in found:
                        found[full_name] = self._normalize(repo)
                if page * PER_PAGE >= total_count or page * PER_PAGE >= self.max_results:
                    break
                page += 1
        return list(found.values())
