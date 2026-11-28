"""Cliente HTTP único para TODA chamada externa do ShadowIndex (OUTBOUND).

Qualquer requisição a uma API/URL de terceiro (GitHub, GitLab, Gitea, Bitbucket,
Azure DevOps, dump de .git, …) passa por aqui — um httpx async instrumentado que
registra cada chamada em `ExternalApiCall` (trilha "Chamadas externas"). Segredos
(Authorization, api_key, token) vão mascarados na URL, headers e corpo; a
auditoria NUNCA levanta (não quebra a chamada que audita). Aplica o User-Agent
global configurável. Sem retenção (registros ficam para sempre).

Uso:
    async with ExternalClient('github', proxy=px, verify=False,
                              default_headers={'Authorization': f'Bearer {t}'}) as c:
        r = await c.get(url, context='search')
"""
import re
import time
import logging
from typing import Optional, Dict, Any

import httpx

logger = logging.getLogger(__name__)

DEFAULT_TIMEOUT = 30
_MASK = "***"
_MAX_BODY = 16 * 1024

_SECRET_HEADER_KEYS = {
    "authorization", "x-api-key", "api-key", "apikey", "x-api-token",
    "private-token", "proxy-authorization", "cookie", "x-auth-token",
}
_SECRET_PARAM_KEYS = {
    "api_key", "apikey", "appid", "secret", "secret_key", "access_token",
    "token", "private_token",
}
_SECRET_BODY_KEYS = {
    "api_key", "apikey", "secret", "secret_key", "access_token", "refresh_token",
    "password", "senha", "client_secret", "token", "private_token",
}
_SECRET_URL_RE = re.compile(r"(?i)(api_key|apikey|appId|secret_key|access_token|token|private_token)=[^&]+")

# Cache do User-Agent (evita hit no banco a cada request).
_ua_cache = {"value": None, "ts": 0.0}
_UA_TTL = 300


def _mask_headers(headers) -> Dict[str, str]:
    out = {}
    for k, v in (headers or {}).items():
        if str(k).lower() in _SECRET_HEADER_KEYS:
            text = str(v or "")
            prefix = text.split(" ", 1)[0]
            out[str(k)] = (f"{prefix} {_MASK}"
                           if prefix.lower() in ("bearer", "basic", "token", "digest")
                           else _MASK)
        else:
            out[str(k)] = str(v)[:512]
    return out


def _mask_params(params) -> Any:
    if not isinstance(params, dict):
        return params or {}
    return {k: (_MASK if str(k).lower() in _SECRET_PARAM_KEYS else v) for k, v in params.items()}


def _mask_body(value):
    if isinstance(value, dict):
        return {k: (_MASK if str(k).lower() in _SECRET_BODY_KEYS else _mask_body(v)) for k, v in value.items()}
    if isinstance(value, list):
        return [_mask_body(v) for v in value]
    return value


def _mask_url(url: str) -> str:
    u = _SECRET_URL_RE.sub(lambda m: f"{m.group(1)}={_MASK}", url or "")
    # Mascara credenciais embutidas (user:pass@host).
    u = re.sub(r"://[^/@]+@", f"://{_MASK}@", u)
    return u[:1024]


async def get_user_agent() -> str:
    """User-Agent global (setting http_user_agent, {VERSION} substituído). Cacheado."""
    now = time.monotonic()
    if _ua_cache["value"] and (now - _ua_cache["ts"]) < _UA_TTL:
        return _ua_cache["value"]
    tpl = None
    try:
        from database import AsyncSessionLocal, AppSettings
        from sqlalchemy import select
        async with AsyncSessionLocal() as db:
            tpl = (await db.execute(
                select(AppSettings.value).where(AppSettings.key == "http_user_agent")
            )).scalar()
    except Exception:  # noqa: BLE001
        tpl = None
    if not tpl:
        tpl = "Mozilla/5.0 (ShadowIndex {VERSION} x64) AppleWebKit/537.36 (KHTML like Gecko) Chrome/146.0.0.0 Safari/537.36"
    try:
        from version import APP_VERSION
    except Exception:  # noqa: BLE001
        APP_VERSION = "0.0.0"
    ua = tpl.replace("{VERSION}", APP_VERSION)
    _ua_cache["value"] = ua
    _ua_cache["ts"] = now
    return ua


def invalidate_ua_cache():
    _ua_cache["value"] = None
    _ua_cache["ts"] = 0.0


class ExternalClient:
    """httpx.AsyncClient instrumentado para um provedor externo."""

    def __init__(self, provider: str, *, base_url: str = "", default_headers=None,
                 timeout: int = DEFAULT_TIMEOUT, verify: bool = True,
                 proxy: Optional[str] = None, context: str = ""):
        self.provider = provider
        self.base_url = (base_url or "").rstrip("/")
        self.default_headers = dict(default_headers or {})
        self.timeout = timeout
        self.verify = verify
        self.proxy = proxy
        self.context = context
        self._client: Optional[httpx.AsyncClient] = None

    async def __aenter__(self):
        self._client = httpx.AsyncClient(proxy=self.proxy, verify=self.verify,
                                         timeout=self.timeout, follow_redirects=True)
        return self

    async def __aexit__(self, *exc):
        if self._client:
            await self._client.aclose()
            self._client = None

    async def request(self, method: str, url: str, *, context: str = None,
                      audit: bool = True, headers=None, **kwargs) -> httpx.Response:
        """Executa e (por padrão) AUDITA a chamada. audit=False p/ chamadas de alto
        volume (ex.: milhares de objetos num dump) — ainda aplica UA/proxy/verify."""
        full = url if "://" in url else f"{self.base_url}{url}"
        hdrs = dict(self.default_headers)
        hdrs.update(headers or {})
        hdrs.setdefault("User-Agent", await get_user_agent())
        if self._client is None:
            self._client = httpx.AsyncClient(proxy=self.proxy, verify=self.verify,
                                             timeout=self.timeout, follow_redirects=True)
        started = time.monotonic()
        resp = None
        error = ""
        try:
            resp = await self._client.request(method, full, headers=hdrs, **kwargs)
            return resp
        except Exception as exc:  # noqa: BLE001 — registra e re-lança
            error = f"{type(exc).__name__}: {exc}"
            raise
        finally:
            if audit:
                try:
                    await self._audit(method, full, hdrs, kwargs, resp, error,
                                      int((time.monotonic() - started) * 1000),
                                      context if context is not None else self.context)
                except Exception:  # noqa: BLE001 — auditoria nunca quebra a chamada
                    pass

    async def get(self, url, **kw):
        return await self.request("GET", url, **kw)

    async def post(self, url, **kw):
        return await self.request("POST", url, **kw)

    async def put(self, url, **kw):
        return await self.request("PUT", url, **kw)

    async def delete(self, url, **kw):
        return await self.request("DELETE", url, **kw)

    async def _audit(self, method, url, headers, kwargs, resp, error, duration_ms, context):
        from database import AsyncSessionLocal, ExternalApiCall

        req_payload = {}
        if kwargs.get("params"):
            req_payload["params"] = _mask_params(kwargs["params"])
        body = kwargs.get("json")
        if body is None and kwargs.get("data") is not None:
            body = kwargs["data"]
        if body is not None:
            try:
                req_payload["body"] = _mask_body(body)
            except Exception:  # noqa: BLE001
                req_payload["body"] = str(body)[:_MAX_BODY]

        resp_payload = {}
        status = None
        if resp is not None:
            status = resp.status_code
            ctype = (resp.headers.get("content-type", "") or "").lower()
            try:
                if "application/json" in ctype:
                    data = resp.json()
                    resp_payload = _mask_body(data) if isinstance(data, (dict, list)) else {"_": data}
                elif any(t in ctype for t in ("text/", "xml", "x-www-form-urlencoded")):
                    resp_payload = {"_text": resp.text[:_MAX_BODY]}
                else:
                    resp_payload = {"_binary": len(resp.content)}
            except Exception:  # noqa: BLE001
                resp_payload = {}

        try:
            async with AsyncSessionLocal() as db:
                db.add(ExternalApiCall(
                    provider=self.provider, context=context or None,
                    method=method, url=_mask_url(url),
                    status_code=status, duration_ms=duration_ms,
                    request_headers=_mask_headers(headers),
                    request_payload=req_payload or None,
                    response_payload=resp_payload or None,
                    error=error or None,
                ))
                await db.commit()
        except Exception as e:  # noqa: BLE001
            logger.debug(f"[external_http] falha ao auditar: {e}")
