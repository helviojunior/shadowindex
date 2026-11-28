"""
Coleta de CI/CD das plataformas Git: SECRETS (variáveis) e PIPELINES (logs/outputs).

Cada função retorna um dicionário com:
  - supported: bool              -> a plataforma/endpoint é suportado aqui
  - exposes_values: bool         -> (secrets) a API retorna o valor das variáveis
  - note: str|None               -> mensagem para exibir ao usuário (ex.: não expõe valores)
  - items: list                  -> os dados coletados

Chamadas de LISTAGEM (variáveis/pipelines/jobs) são auditadas; o conteúdo bruto
dos logs (volumoso) usa audit=False, como os objetos do git-dump.
"""
import logging
from typing import Optional, Dict, Any, List
from urllib.parse import quote

import external_http
from git_platforms import auth_headers, _azure_org

logger = logging.getLogger(__name__)

TIMEOUT = 60
MAX_LOG_BYTES = 2_000_000   # teto por log de job (2 MB)
PAGE = 100


def _client(proxy: Optional[str], provider: str, context: str):
    return external_http.ExternalClient(provider, proxy=proxy, verify=False,
                                        timeout=TIMEOUT, context=context)


def _gl_pid(full_name: str) -> str:
    """GitLab aceita o caminho URL-encoded como id do projeto."""
    return quote((full_name or "").strip("/"), safe="")


def _trim(text: Optional[str]) -> str:
    t = text or ""
    if len(t) > MAX_LOG_BYTES:
        t = t[:MAX_LOG_BYTES] + "\n...[truncado]..."
    return t


# ===========================================================================
# SECRETS (variáveis de CI)
# ===========================================================================
async def list_secrets(platform: str, api_url: Optional[str], token: Optional[str],
                       full_name: str, proxy: Optional[str] = None,
                       variant: Optional[str] = None, org: Optional[str] = None,
                       web_url: Optional[str] = None) -> Dict[str, Any]:
    api = (api_url or "").rstrip("/")
    h = auth_headers(platform, token)
    out: List[Dict[str, Any]] = []
    try:
        async with _client(proxy, platform, "secrets") as c:
            if platform == "gitlab":
                pid = _gl_pid(full_name)
                r = await c.get(f"{api}/projects/{pid}/variables",
                                params={"per_page": PAGE}, headers=h, context="secrets")
                if r.status_code != 200:
                    return _sec_err(r, "GitLab")
                for v in (r.json() or []):
                    out.append({"name": v.get("key"), "value": v.get("value"),
                                "protected": v.get("protected"), "masked": v.get("masked"),
                                "scope": v.get("environment_scope") or "project"})
                return {"supported": True, "exposes_values": True, "note": None, "items": out}

            if platform in ("github", "github_enterprise"):
                # GitHub NÃO expõe valores de secrets via API — apenas nomes.
                r = await c.get(f"{api}/repos/{full_name}/actions/secrets",
                                params={"per_page": PAGE}, headers=h, context="secrets")
                if r.status_code != 200:
                    return _sec_err(r, "GitHub")
                for v in ((r.json() or {}).get("secrets") or []):
                    out.append({"name": v.get("name"), "value": None, "scope": "repo"})
                return {"supported": True, "exposes_values": False,
                        "note": "O GitHub não expõe os valores dos secrets via API — apenas os nomes.",
                        "items": out}

            if platform == "gitea":
                r = await c.get(f"{api}/repos/{full_name}/actions/secrets",
                                params={"limit": PAGE}, headers=h, context="secrets")
                if r.status_code != 200:
                    return _sec_err(r, "Gitea")
                data = r.json()
                seq = data if isinstance(data, list) else (data or {}).get("data") or []
                for v in seq:
                    out.append({"name": v.get("name"), "value": None, "scope": "repo"})
                return {"supported": True, "exposes_values": False,
                        "note": "O Gitea não expõe os valores dos secrets via API — apenas os nomes.",
                        "items": out}

            if platform == "bitbucket" and variant != "server":
                ws, _, repo = (full_name or "").partition("/")
                url = f"https://api.bitbucket.org/2.0/repositories/{ws}/{repo}/pipelines-config/variables/"
                any_secured = False
                while url:
                    r = await c.get(url, params={"pagelen": PAGE}, headers=h, context="secrets")
                    if r.status_code != 200:
                        if out:
                            break
                        return _sec_err(r, "Bitbucket")
                    body = r.json() or {}
                    for v in (body.get("values") or []):
                        secured = bool(v.get("secured"))
                        any_secured = any_secured or secured
                        out.append({"name": v.get("key"),
                                    "value": None if secured else v.get("value"),
                                    "protected": secured, "scope": "repo"})
                    url = body.get("next")
                note = ("Variáveis 'secured' do Bitbucket não têm o valor exposto pela API."
                        if any_secured else None)
                return {"supported": True, "exposes_values": True, "note": note, "items": out}

            if platform == "azure_devops":
                azorg = org or _azure_org(web_url or "")
                project = (full_name or "").split("/", 1)[0]
                if not azorg or not project:
                    return {"supported": False, "exposes_values": False,
                            "note": "Azure DevOps: organização/projeto não identificados.", "items": []}
                url = f"https://dev.azure.com/{azorg}/{project}/_apis/distributedtask/variablegroups"
                r = await c.get(url, params={"api-version": "7.0"}, headers=h, context="secrets")
                if r.status_code != 200:
                    return _sec_err(r, "Azure DevOps")
                any_secret = False
                for grp in ((r.json() or {}).get("value") or []):
                    gname = grp.get("name")
                    for k, meta in (grp.get("variables") or {}).items():
                        is_secret = bool(meta.get("isSecret"))
                        any_secret = any_secret or is_secret
                        out.append({"name": k, "value": None if is_secret else meta.get("value"),
                                    "protected": is_secret, "scope": f"group:{gname}"})
                note = ("Variáveis secretas do Azure DevOps não têm o valor exposto pela API."
                        if any_secret else None)
                return {"supported": True, "exposes_values": True, "note": note, "items": out}

        return {"supported": False, "exposes_values": False,
                "note": f"Coleta de secrets não suportada para '{platform}'.", "items": []}
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[git_ci] list_secrets {platform} {full_name}: {e}")
        return {"supported": False, "exposes_values": False,
                "note": f"Falha ao coletar secrets: {str(e)[:200]}", "items": []}


def _sec_err(r, label: str) -> Dict[str, Any]:
    if r.status_code in (401, 403):
        return {"supported": True, "exposes_values": False,
                "note": f"{label}: acesso negado ({r.status_code}) — o token não tem permissão para ler os secrets.",
                "items": []}
    if r.status_code == 404:
        return {"supported": True, "exposes_values": False,
                "note": f"{label}: recurso de secrets não encontrado (CI desabilitado ou sem permissão).",
                "items": []}
    return {"supported": True, "exposes_values": False,
            "note": f"{label}: HTTP {r.status_code} ao listar secrets.", "items": []}


# ===========================================================================
# PIPELINES (logs / outputs)
# ===========================================================================
async def list_pipeline_logs(platform: str, api_url: Optional[str], token: Optional[str],
                             full_name: str, proxy: Optional[str] = None,
                             variant: Optional[str] = None, org: Optional[str] = None,
                             web_url: Optional[str] = None,
                             limit: int = 20, offset: int = 0) -> Dict[str, Any]:
    """Retorna os logs dos jobs dos `limit` pipelines mais recentes, pulando `offset`
    pipelines (para 'baixar mais'). items: [{ref, name, text}]."""
    api = (api_url or "").rstrip("/")
    h = auth_headers(platform, token)
    out: List[Dict[str, Any]] = []
    try:
        async with _client(proxy, platform, "pipelines") as c:
            if platform == "gitlab":
                return await _gitlab_pipelines(c, api, h, full_name, limit, offset)
            if platform in ("github", "github_enterprise"):
                return await _github_pipelines(c, api, h, full_name, limit, offset)
            if platform == "bitbucket" and variant != "server":
                return await _bitbucket_pipelines(c, h, full_name, limit, offset)
            if platform == "gitea":
                return await _gitea_pipelines(c, api, h, full_name, limit, offset)
            if platform == "azure_devops":
                return await _azure_pipelines(c, h, full_name, org, web_url, limit, offset)
        return {"supported": False, "note": f"Pipelines não suportados para '{platform}'.",
                "items": out, "total_available": None}
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[git_ci] list_pipeline_logs {platform} {full_name}: {e}")
        return {"supported": False, "note": f"Falha ao coletar pipelines: {str(e)[:200]}",
                "items": out, "total_available": None}


async def _gitlab_pipelines(c, api, h, full_name, limit, offset):
    pid = _gl_pid(full_name)
    page = (offset // max(1, limit)) + 1
    r = await c.get(f"{api}/projects/{pid}/pipelines",
                    params={"per_page": limit, "page": page, "order_by": "id", "sort": "desc"},
                    headers=h, context="pipelines")
    if r.status_code != 200:
        return _pipe_err(r, "GitLab")
    total = _int(r.headers.get("X-Total"))
    out = []
    for pl in (r.json() or []):
        plid = pl.get("id")
        jr = await c.get(f"{api}/projects/{pid}/pipelines/{plid}/jobs",
                         params={"per_page": PAGE}, headers=h, context="pipelines")
        if jr.status_code != 200:
            continue
        for job in (jr.json() or []):
            jid = job.get("id")
            tr = await c.get(f"{api}/projects/{pid}/jobs/{jid}/trace", headers=h,
                             audit=False, context="pipelines")
            if tr.status_code == 200 and tr.text:
                out.append({"ref": f"pipeline-{plid}", "name": f"{plid}/{job.get('name') or jid}",
                            "status": job.get("status"), "text": _trim(tr.text)})
    return {"supported": True, "note": None, "items": out, "total_available": total}


async def _github_pipelines(c, api, h, full_name, limit, offset):
    page = (offset // max(1, limit)) + 1
    r = await c.get(f"{api}/repos/{full_name}/actions/runs",
                    params={"per_page": limit, "page": page}, headers=h, context="pipelines")
    if r.status_code != 200:
        return _pipe_err(r, "GitHub")
    body = r.json() or {}
    total = body.get("total_count")
    out = []
    for run in (body.get("workflow_runs") or []):
        run_id = run.get("id")
        jr = await c.get(f"{api}/repos/{full_name}/actions/runs/{run_id}/jobs",
                         params={"per_page": PAGE}, headers=h, context="pipelines")
        if jr.status_code != 200:
            continue
        for job in ((jr.json() or {}).get("jobs") or []):
            jid = job.get("id")
            lr = await c.get(f"{api}/repos/{full_name}/actions/jobs/{jid}/logs",
                             headers=h, audit=False, context="pipelines")
            if lr.status_code == 200 and lr.text:
                out.append({"ref": f"run-{run_id}", "name": f"{run_id}/{job.get('name') or jid}",
                            "status": job.get("conclusion") or job.get("status"), "text": _trim(lr.text)})
    return {"supported": True, "note": None, "items": out, "total_available": total}


async def _bitbucket_pipelines(c, h, full_name, limit, offset):
    ws, _, repo = (full_name or "").partition("/")
    page = (offset // max(1, limit)) + 1
    base = f"https://api.bitbucket.org/2.0/repositories/{ws}/{repo}"
    r = await c.get(f"{base}/pipelines", params={"pagelen": limit, "page": page, "sort": "-created_on"},
                    headers=h, context="pipelines")
    if r.status_code != 200:
        return _pipe_err(r, "Bitbucket")
    body = r.json() or {}
    total = body.get("size")
    out = []
    for pl in (body.get("values") or []):
        uuid = pl.get("uuid")
        sr = await c.get(f"{base}/pipelines/{uuid}/steps/", params={"pagelen": PAGE},
                         headers=h, context="pipelines")
        if sr.status_code != 200:
            continue
        for step in ((sr.json() or {}).get("values") or []):
            suuid = step.get("uuid")
            lr = await c.get(f"{base}/pipelines/{uuid}/steps/{suuid}/log",
                             headers=h, audit=False, context="pipelines")
            if lr.status_code == 200 and lr.text:
                out.append({"ref": f"pipeline-{uuid}", "name": f"{(pl.get('build_number') or uuid)}/{step.get('name') or suuid}",
                            "status": (step.get("state") or {}).get("name"), "text": _trim(lr.text)})
    return {"supported": True, "note": None, "items": out, "total_available": total}


async def _gitea_pipelines(c, api, h, full_name, limit, offset):
    # Gitea Actions: a API de logs é limitada/variável entre versões. Tenta tarefas.
    r = await c.get(f"{api}/repos/{full_name}/actions/tasks",
                    params={"limit": limit, "page": (offset // max(1, limit)) + 1},
                    headers=h, context="pipelines")
    if r.status_code != 200:
        return {"supported": False,
                "note": "Gitea: coleta de logs de Actions não disponível nesta instância/versão.",
                "items": [], "total_available": None}
    body = r.json() or {}
    tasks = body.get("workflow_runs") or body.get("data") or []
    # Sem endpoint estável de trace por job entre versões do Gitea: informa limitação.
    return {"supported": True,
            "note": "Gitea: os metadados das execuções foram lidos, mas esta versão não expõe o log bruto dos jobs via API.",
            "items": [], "total_available": len(tasks) or None}


async def _azure_pipelines(c, h, full_name, org, web_url, limit, offset):
    azorg = org or _azure_org(web_url or "")
    project = (full_name or "").split("/", 1)[0]
    if not azorg or not project:
        return {"supported": False, "note": "Azure DevOps: organização/projeto não identificados.",
                "items": [], "total_available": None}
    base = f"https://dev.azure.com/{azorg}/{project}/_apis/build"
    r = await c.get(f"{base}/builds", params={"api-version": "7.0", "$top": limit,
                                              "queryOrder": "finishTimeDescending"},
                    headers=h, context="pipelines")
    if r.status_code != 200:
        return _pipe_err(r, "Azure DevOps")
    builds = (r.json() or {}).get("value") or []
    out = []
    for b in builds[offset:offset + limit] if offset else builds:
        bid = b.get("id")
        lr = await c.get(f"{base}/builds/{bid}/logs", params={"api-version": "7.0"},
                         headers=h, context="pipelines")
        if lr.status_code != 200:
            continue
        for log in ((lr.json() or {}).get("value") or []):
            logid = log.get("id")
            cr = await c.get(f"{base}/builds/{bid}/logs/{logid}", params={"api-version": "7.0"},
                             headers=h, audit=False, context="pipelines")
            if cr.status_code == 200 and cr.text:
                out.append({"ref": f"build-{bid}", "name": f"{bid}/log-{logid}",
                            "status": b.get("result"), "text": _trim(cr.text)})
    return {"supported": True, "note": None, "items": out, "total_available": len(builds) or None}


def _pipe_err(r, label: str) -> Dict[str, Any]:
    if r.status_code in (401, 403):
        note = f"{label}: acesso negado ({r.status_code}) — o token não tem permissão para ler os pipelines."
    elif r.status_code == 404:
        note = f"{label}: pipelines/CI não encontrados (recurso desabilitado ou sem permissão)."
    else:
        note = f"{label}: HTTP {r.status_code} ao listar pipelines."
    return {"supported": True, "note": note, "items": [], "total_available": None}


def _int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None
