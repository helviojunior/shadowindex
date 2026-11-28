"""
Clientes de plataformas Git (inspirado no epyon): detecção/fingerprint da
plataforma, whoami e listagem de projetos — para GitHub(.com/Enterprise),
GitLab, Gitea, Bitbucket (cloud/server) e Azure DevOps.

Objetivo: identificar a instância (inclusive on-premises), validar o token e
listar os repositórios para posterior clone. Ignora falhas de TLS (on-prem).
"""
import base64
import logging
from typing import Optional, Dict, Any, List, Tuple
from urllib.parse import urlparse

import httpx
import external_http

logger = logging.getLogger(__name__)

TIMEOUT = 25
PAGE_SIZE = 100
MAX_PROJECTS = 50000

PLATFORMS = ["github", "github_enterprise", "gitlab", "gitea", "bitbucket", "azure_devops"]
PLATFORM_LABELS = {
    "github": "GitHub",
    "github_enterprise": "GitHub Enterprise",
    "gitlab": "GitLab",
    "gitea": "Gitea",
    "bitbucket": "Bitbucket",
    "azure_devops": "Azure DevOps",
    "unknown": "Desconhecida",
}


def normalize_base(url: str) -> str:
    url = (url or "").strip()
    if not url:
        return ""
    if not url.startswith("http://") and not url.startswith("https://"):
        url = "https://" + url
    return url.rstrip("/")


def _client(proxy: Optional[str] = None, provider: str = "git", context: str = ""):
    """Cliente externo instrumentado (auditado) para as chamadas de plataforma."""
    return external_http.ExternalClient(provider, proxy=proxy, verify=False,
                                        timeout=TIMEOUT, context=context)


def auth_headers(platform: str, token: Optional[str]) -> Dict[str, str]:
    if not token:
        return {}
    if platform in ("github", "github_enterprise"):
        return {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28"}
    if platform == "gitlab":
        return {"PRIVATE-TOKEN": token}
    if platform == "gitea":
        return {"Authorization": f"token {token}"}
    if platform == "bitbucket":
        return {"Authorization": f"Bearer {token}"}
    if platform == "azure_devops":
        b = base64.b64encode(f":{token}".encode()).decode()
        return {"Authorization": f"Basic {b}"}
    return {"Authorization": f"Bearer {token}"}


def _azure_org(base_url: str) -> Optional[str]:
    """Extrai a organização de uma URL do Azure DevOps."""
    p = urlparse(base_url)
    host = (p.hostname or "").lower()
    if host.endswith("visualstudio.com"):
        return host.split(".")[0]  # {org}.visualstudio.com
    if host == "dev.azure.com":
        parts = [x for x in (p.path or "").split("/") if x]
        return parts[0] if parts else None
    return None


# ---------------------------------------------------------------------------
# Detecção / fingerprint
# ---------------------------------------------------------------------------
async def detect_platform(base_url: str, token: Optional[str] = None,
                          proxy: Optional[str] = None) -> Dict[str, Any]:
    """Identifica a plataforma a partir da URL (hosts públicos conhecidos) e, se
    for on-prem, faz probing das APIs conhecidas. Retorna dict com platform,
    api_url, web_url e variant."""
    base = normalize_base(base_url)
    host = (urlparse(base).hostname or "").lower()

    # Hosts públicos conhecidos -> direto para as APIs padrão.
    if host in ("github.com", "www.github.com"):
        return {"platform": "github", "api_url": "https://api.github.com", "web_url": "https://github.com"}
    if host == "gitlab.com":
        return {"platform": "gitlab", "api_url": "https://gitlab.com/api/v4", "web_url": "https://gitlab.com"}
    if host == "bitbucket.org":
        return {"platform": "bitbucket", "api_url": "https://api.bitbucket.org/2.0",
                "web_url": "https://bitbucket.org", "variant": "cloud"}
    if host == "dev.azure.com" or host.endswith(".visualstudio.com"):
        org = _azure_org(base)
        return {"platform": "azure_devops", "api_url": "https://dev.azure.com", "web_url": base, "org": org}
    if host == "gitea.com":
        return {"platform": "gitea", "api_url": base + "/api/v1", "web_url": base}

    # On-prem: probing.
    async with _client(proxy, 'git-detect', 'detect') as c:
        # GitLab
        try:
            r = await c.get(base + "/api/v4/version", headers=auth_headers("gitlab", token))
            if r.status_code in (200, 401):
                return {"platform": "gitlab", "api_url": base + "/api/v4", "web_url": base}
        except Exception:  # noqa: BLE001
            pass
        # Gitea
        try:
            r = await c.get(base + "/api/v1/version")
            server = (r.headers.get("Server", "") or "").lower()
            if r.status_code == 200 and ("gitea" in server or '"version"' in (r.text or "")):
                return {"platform": "gitea", "api_url": base + "/api/v1", "web_url": base}
        except Exception:  # noqa: BLE001
            pass
        # GitHub Enterprise
        try:
            r = await c.get(base + "/api/v3", headers=auth_headers("github", token))
            server = (r.headers.get("Server", "") or "").lower()
            if r.status_code in (200, 401) and (
                "github" in server or "X-GitHub-Enterprise-Version" in r.headers
                or "current_user_url" in (r.text or "")
            ):
                return {"platform": "github_enterprise", "api_url": base + "/api/v3", "web_url": base}
        except Exception:  # noqa: BLE001
            pass
        # Bitbucket Server / Data Center
        try:
            r = await c.get(base + "/rest/api/1.0/application-properties")
            if r.status_code in (200, 401) and ("version" in (r.text or "").lower() or r.status_code == 401):
                return {"platform": "bitbucket", "api_url": base + "/rest/api/1.0",
                        "web_url": base, "variant": "server"}
        except Exception:  # noqa: BLE001
            pass

    return {"platform": "unknown", "api_url": None, "web_url": base}


# ---------------------------------------------------------------------------
# whoami
# ---------------------------------------------------------------------------
async def whoami(platform: str, api_url: Optional[str], token: Optional[str],
                 proxy: Optional[str] = None, variant: Optional[str] = None,
                 org: Optional[str] = None) -> Optional[Dict[str, Any]]:
    if not token or not api_url:
        return None
    api = api_url.rstrip("/")
    h = auth_headers(platform, token)
    async with _client(proxy, platform, 'whoami') as c:
        try:
            if platform in ("github", "github_enterprise"):
                r = await c.get(api + "/user", headers=h)
                if r.status_code == 200:
                    d = r.json()
                    return {"login": d.get("login"), "name": d.get("name"), "id": d.get("id"),
                            "email": d.get("email"), "type": d.get("type"),
                            "site_admin": d.get("site_admin")}
            elif platform == "gitlab":
                r = await c.get(api + "/user", headers=h)
                if r.status_code == 200:
                    d = r.json()
                    return {"login": d.get("username"), "name": d.get("name"), "id": d.get("id"),
                            "email": d.get("email"), "is_admin": d.get("is_admin")}
            elif platform == "gitea":
                r = await c.get(api + "/user", headers=h)
                if r.status_code == 200:
                    d = r.json()
                    return {"login": d.get("login"), "name": d.get("full_name"), "id": d.get("id"),
                            "email": d.get("email"), "is_admin": d.get("is_admin")}
            elif platform == "bitbucket":
                if variant == "server":
                    r = await c.get(api + "/application-properties", headers=h)
                    # Server não expõe /user de forma simples; retorna versão como info.
                    if r.status_code == 200:
                        return {"server": True, "version": (r.json() or {}).get("version")}
                    return None
                r = await c.get("https://api.bitbucket.org/2.0/user", headers=h)
                if r.status_code == 200:
                    d = r.json()
                    return {"login": d.get("username"), "name": d.get("display_name"),
                            "uuid": d.get("uuid"), "account_id": d.get("account_id")}
            elif platform == "azure_devops":
                r = await c.get("https://app.vssps.visualstudio.com/_apis/profile/profiles/me?api-version=6.0",
                                headers=h)
                if r.status_code == 200:
                    d = r.json()
                    return {"login": d.get("emailAddress"), "name": d.get("displayName"),
                            "id": d.get("id")}
        except Exception as e:  # noqa: BLE001
            logger.debug(f"[git_platforms] whoami {platform} falhou: {e}")
    return None


# ---------------------------------------------------------------------------
# Listagem de projetos
# ---------------------------------------------------------------------------
def _repo(full_name, clone_url, html_url=None, description=None, default_branch=None,
          private=None, size_kb=None, name=None) -> Dict[str, Any]:
    return {
        "full_name": full_name, "name": name or (full_name.split("/")[-1] if full_name else None),
        "clone_url": clone_url, "html_url": html_url, "description": description,
        "default_branch": default_branch, "private": private, "size_kb": size_kb,
    }


async def list_projects(platform: str, api_url: Optional[str], token: Optional[str],
                        proxy: Optional[str] = None, variant: Optional[str] = None,
                        org: Optional[str] = None, web_url: Optional[str] = None) -> List[Dict[str, Any]]:
    api = (api_url or "").rstrip("/")
    h = auth_headers(platform, token)
    out: List[Dict[str, Any]] = []
    async with _client(proxy, platform, 'projects') as c:
        if platform in ("github", "github_enterprise"):
            page = 1
            while len(out) < MAX_PROJECTS:
                r = await c.get(api + "/user/repos",
                                params={"per_page": PAGE_SIZE, "page": page, "affiliation": "owner,collaborator,organization_member"},
                                headers=h)
                if r.status_code != 200:
                    break
                data = r.json() or []
                if not data:
                    break
                for d in data:
                    out.append(_repo(d.get("full_name"), d.get("clone_url"), d.get("html_url"),
                                     d.get("description"), d.get("default_branch"), d.get("private"),
                                     d.get("size")))
                if len(data) < PAGE_SIZE:
                    break
                page += 1

        elif platform == "gitlab":
            page = 1
            while len(out) < MAX_PROJECTS:
                # Sem membership=true: lista TODOS os projetos visíveis ao token
                # (grupos/subgrupos, públicos/internos). Admin vê tudo.
                r = await c.get(api + "/projects",
                                params={"per_page": PAGE_SIZE, "page": page,
                                        "order_by": "id", "sort": "asc", "simple": "true"},
                                headers=h)
                if r.status_code != 200:
                    break
                data = r.json() or []
                if not data:
                    break
                for d in data:
                    out.append(_repo(d.get("path_with_namespace"), d.get("http_url_to_repo"),
                                     d.get("web_url"), d.get("description"), d.get("default_branch"),
                                     d.get("visibility") != "public", None, d.get("name")))
                if len(data) < PAGE_SIZE:
                    break
                page += 1

        elif platform == "gitea":
            page = 1
            while len(out) < MAX_PROJECTS:
                r = await c.get(api + "/repos/search",
                                params={"limit": PAGE_SIZE, "page": page},
                                headers=h)
                if r.status_code != 200:
                    break
                body = r.json() or {}
                data = body.get("data") or []
                if not data:
                    break
                for d in data:
                    out.append(_repo(d.get("full_name"), d.get("clone_url"), d.get("html_url"),
                                     d.get("description"), d.get("default_branch"), d.get("private"),
                                     int((d.get("size") or 0))))
                if len(data) < PAGE_SIZE:
                    break
                page += 1

        elif platform == "bitbucket" and variant != "server":
            url = "https://api.bitbucket.org/2.0/repositories"
            params = {"role": "member", "pagelen": PAGE_SIZE}
            while url and len(out) < MAX_PROJECTS:
                r = await c.get(url, params=params, headers=h)
                if r.status_code != 200:
                    break
                body = r.json() or {}
                for d in (body.get("values") or []):
                    clone = None
                    for link in (d.get("links", {}).get("clone") or []):
                        if link.get("name") == "https":
                            clone = link.get("href")
                    out.append(_repo(d.get("full_name"), clone,
                                     (d.get("links", {}).get("html") or {}).get("href"),
                                     d.get("description"), d.get("mainbranch", {}).get("name"),
                                     d.get("is_private"), int((d.get("size") or 0) / 1024) or None,
                                     d.get("name")))
                url = body.get("next")
                params = None

        elif platform == "bitbucket" and variant == "server":
            start = 0
            while len(out) < MAX_PROJECTS:
                r = await c.get(api + "/repos", params={"limit": PAGE_SIZE, "start": start}, headers=h)
                if r.status_code != 200:
                    break
                body = r.json() or {}
                for d in (body.get("values") or []):
                    clone = None
                    for link in (d.get("links", {}).get("clone") or []):
                        if link.get("name") == "http":
                            clone = link.get("href")
                    proj = (d.get("project") or {}).get("key") or ""
                    out.append(_repo(f"{proj}/{d.get('slug')}", clone,
                                     (d.get("links", {}).get("self") or [{}])[0].get("href"),
                                     d.get("description"), None, not d.get("public"), None, d.get("name")))
                if body.get("isLastPage", True):
                    break
                start = body.get("nextPageStart", start + PAGE_SIZE)

        elif platform == "azure_devops":
            if not org:
                return out
            projs_url = f"https://dev.azure.com/{org}/_apis/projects"
            r = await c.get(projs_url, params={"api-version": "7.0"}, headers=h)
            if r.status_code == 200:
                for proj in ((r.json() or {}).get("value") or []):
                    pname = proj.get("name")
                    rr = await c.get(f"https://dev.azure.com/{org}/{pname}/_apis/git/repositories",
                                     params={"api-version": "7.0"}, headers=h)
                    if rr.status_code != 200:
                        continue
                    for d in ((rr.json() or {}).get("value") or []):
                        out.append(_repo(f"{pname}/{d.get('name')}", d.get("remoteUrl"),
                                         d.get("webUrl"), None, (d.get("defaultBranch") or "").replace("refs/heads/", ""),
                                         True, int((d.get("size") or 0) / 1024) or None, d.get("name")))
                    if len(out) >= MAX_PROJECTS:
                        break

    return out
