"""
API das "Git Instances" (Git -> Instances): cadastro de instâncias de plataformas
Git, teste de acesso (fingerprint + whoami), listagem e clone de projetos.
"""
import os
import logging
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func, update, or_

from database import (
    get_db, get_db_readonly, Credential, GitInstance, GitInstanceProject,
    GitRepo, GitCloneJob,
)
from github_api import resolve_proxy_url
import git_platforms as gp

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/git/instances")


# --------------------------------------------------------------------------
class InstanceTestRequest(BaseModel):
    base_url: str
    clone_auth: str = "authenticated"      # anonymous | authenticated
    credential_id: Optional[int] = None
    proxy_id: Optional[int] = None
    platform: Optional[str] = None         # força a plataforma (opcional)


class InstanceCreateRequest(InstanceTestRequest):
    name: Optional[str] = None


class InstanceDetectRequest(BaseModel):
    base_url: str
    proxy_id: Optional[int] = None
    credential_id: Optional[int] = None   # opcional (ajuda alguns fingerprints)


class InstanceUpdateRequest(BaseModel):
    name: Optional[str] = None
    clone_auth: Optional[str] = None       # anonymous | authenticated
    credential_id: Optional[int] = None
    proxy_id: Optional[int] = None


class CloneReposRequest(BaseModel):
    repos: Optional[List[Dict[str, Any]]] = None   # projetos específicos (seleção)
    full_names: Optional[List[str]] = None         # ou por full_name (seleção)
    all: bool = False                              # ou TODOS os projetos listados da instância
    q: Optional[str] = None                        # filtro (quando all=true)
    task: str = "clone"                            # clone | pipelines | secrets
    limit: Optional[int] = None                    # pipelines: lote desta rodada
    offset: Optional[int] = None                   # pipelines: quantos já foram pegos


async def _get_token(db, credential_id: Optional[int]) -> Optional[str]:
    if not credential_id:
        return None
    cred = (await db.execute(select(Credential).where(Credential.id == credential_id))).scalar_one_or_none()
    if not cred or not (cred.token or ""):
        raise HTTPException(status_code=400, detail="Credencial de token inválida")
    return cred.token


def _instance_dict(i: GitInstance) -> Dict[str, Any]:
    return {
        "id": i.id, "guid": i.guid, "name": i.name,
        "platform": i.platform, "platform_label": gp.PLATFORM_LABELS.get(i.platform, i.platform),
        "base_url": i.base_url, "api_url": i.api_url, "web_url": i.web_url,
        "variant": i.variant, "org": i.org,
        "clone_auth": i.clone_auth, "credential_id": i.credential_id, "proxy_id": i.proxy_id,
        "whoami": i.whoami, "status": i.status, "error": i.error,
        "last_tested_at": i.last_tested_at.isoformat() if i.last_tested_at else None,
        "created_at": i.created_at.isoformat() if i.created_at else None,
    }


async def _run_test(db, base_url: str, clone_auth: str, credential_id, proxy_id, platform=None) -> Dict[str, Any]:
    base = gp.normalize_base(base_url)
    if not base:
        raise HTTPException(status_code=400, detail="URL é obrigatória")
    token = None
    if clone_auth == "authenticated":
        token = await _get_token(db, credential_id)
    proxy = await resolve_proxy_url(db, proxy_id)

    det = await gp.detect_platform(base, token, proxy)
    if platform and platform not in (None, "auto") and det.get("platform") != platform:
        # Usuário forçou a plataforma: mantém a detecção de api_url quando possível.
        det["platform"] = platform
    plat = det.get("platform")
    api_url = det.get("api_url")
    variant = det.get("variant")
    org = det.get("org")

    wa = None
    if plat and plat != "unknown":
        wa = await gp.whoami(plat, api_url, token, proxy, variant, org)

    ok = True
    error = None
    if not plat or plat == "unknown":
        ok = False
        error = "Não foi possível identificar a plataforma Git nesta URL"
    elif token is not None and wa is None:
        ok = False
        error = "Token inválido ou sem permissão (whoami falhou)"

    return {
        "ok": ok, "error": error,
        "platform": plat, "platform_label": gp.PLATFORM_LABELS.get(plat, plat),
        "api_url": api_url, "web_url": det.get("web_url", base), "variant": variant, "org": org,
        "whoami": wa,
    }


@router.post("/detect")
async def detect_instance(req: InstanceDetectRequest, db=Depends(get_db_readonly)):
    """Detecta SOMENTE a plataforma a partir da URL (hosts públicos conhecidos ou
    fingerprint on-prem). Não exige token/auth. Retorna platform='unknown' quando
    não identificada (o front então exibe o seletor manual)."""
    if not (req.base_url or "").strip():
        raise HTTPException(status_code=400, detail="URL é obrigatória")
    token = await _get_token(db, req.credential_id) if req.credential_id else None
    proxy = await resolve_proxy_url(db, req.proxy_id)
    det = await gp.detect_platform(req.base_url, token, proxy)
    plat = det.get("platform") or "unknown"
    return {
        "detected": plat != "unknown",
        "platform": plat,
        "platform_label": gp.PLATFORM_LABELS.get(plat, plat),
        "api_url": det.get("api_url"),
        "web_url": det.get("web_url"),
        "variant": det.get("variant"),
        "org": det.get("org"),
    }


@router.post("/test")
async def test_instance(req: InstanceTestRequest, db=Depends(get_db_readonly)):
    return await _run_test(db, req.base_url, req.clone_auth, req.credential_id, req.proxy_id, req.platform)


@router.get("")
async def list_instances(db=Depends(get_db_readonly)):
    rows = (await db.execute(select(GitInstance).order_by(GitInstance.created_at.desc()))).scalars().all()
    return [_instance_dict(i) for i in rows]


@router.post("")
async def create_instance(req: InstanceCreateRequest, db=Depends(get_db)):
    res = await _run_test(db, req.base_url, req.clone_auth, req.credential_id, req.proxy_id, req.platform)
    base = gp.normalize_base(req.base_url)
    host = urlparse(res.get("web_url") or base).hostname or base
    inst = GitInstance(
        name=req.name or host,
        platform=res["platform"],
        base_url=base,
        api_url=res.get("api_url"),
        web_url=res.get("web_url"),
        variant=res.get("variant"),
        org=res.get("org"),
        clone_auth=req.clone_auth,
        credential_id=req.credential_id if req.clone_auth == "authenticated" else None,
        proxy_id=req.proxy_id,
        whoami=res.get("whoami"),
        status="ok" if res["ok"] else "failed",
        error=res.get("error"),
        last_tested_at=datetime.now(timezone.utc),
    )
    db.add(inst)
    await db.commit()
    await db.refresh(inst)
    return _instance_dict(inst)


@router.get("/{guid}")
async def get_instance(guid: str, db=Depends(get_db_readonly)):
    inst = (await db.execute(select(GitInstance).where(GitInstance.guid == guid))).scalar_one_or_none()
    if not inst:
        raise HTTPException(status_code=404, detail="Instância não encontrada")
    return _instance_dict(inst)


@router.put("/{guid}")
async def update_instance(guid: str, req: InstanceUpdateRequest, db=Depends(get_db)):
    """Edita a instância: Nome e/ou modo de autenticação (token/proxy). NÃO altera a
    URL nem a plataforma (para isso, recadastre). Reexecuta o teste de acesso quando
    auth/token/proxy mudam, atualizando whoami/status."""
    inst = (await db.execute(select(GitInstance).where(GitInstance.guid == guid))).scalar_one_or_none()
    if not inst:
        raise HTTPException(status_code=404, detail="Instância não encontrada")

    if req.name is not None:
        inst.name = req.name.strip() or None

    auth_changed = False
    if req.clone_auth is not None and req.clone_auth != inst.clone_auth:
        inst.clone_auth = req.clone_auth
        auth_changed = True
    # credential_id/proxy_id: só aplica quando o campo foi enviado (exclude_unset).
    fields_sent = req.model_dump(exclude_unset=True)
    if "credential_id" in fields_sent and req.credential_id != inst.credential_id:
        inst.credential_id = req.credential_id
        auth_changed = True
    if "proxy_id" in fields_sent and req.proxy_id != inst.proxy_id:
        inst.proxy_id = req.proxy_id
        auth_changed = True
    # Anônimo não usa credencial.
    if inst.clone_auth == "anonymous":
        inst.credential_id = None

    if auth_changed:
        res = await _run_test(db, inst.base_url, inst.clone_auth, inst.credential_id,
                              inst.proxy_id, inst.platform)
        inst.api_url = res.get("api_url") or inst.api_url
        inst.whoami = res.get("whoami")
        inst.status = "ok" if res["ok"] else "failed"
        inst.error = res.get("error")
        inst.last_tested_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(inst)
    return _instance_dict(inst)


@router.post("/{guid}/retest")
async def retest_instance(guid: str, db=Depends(get_db)):
    inst = (await db.execute(select(GitInstance).where(GitInstance.guid == guid))).scalar_one_or_none()
    if not inst:
        raise HTTPException(status_code=404, detail="Instância não encontrada")
    res = await _run_test(db, inst.base_url, inst.clone_auth, inst.credential_id, inst.proxy_id, inst.platform)
    inst.api_url = res.get("api_url") or inst.api_url
    inst.whoami = res.get("whoami")
    inst.status = "ok" if res["ok"] else "failed"
    inst.error = res.get("error")
    inst.last_tested_at = datetime.now(timezone.utc)
    await db.commit()
    return _instance_dict(inst)


@router.post("/{guid}/duplicate")
async def duplicate_instance(guid: str, db=Depends(get_db)):
    """Duplica SOMENTE a configuração da instância (plataforma, URL, auth, proxy,
    credencial). NÃO copia a listagem de projetos nem as dependências (whoami,
    status de teste, contadores) — a cópia nasce 'limpa' para ser testada/listada."""
    inst = (await db.execute(select(GitInstance).where(GitInstance.guid == guid))).scalar_one_or_none()
    if not inst:
        raise HTTPException(status_code=404, detail="Instância não encontrada")

    clone = GitInstance(
        name=f"{inst.name or inst.base_url} (cópia)",
        platform=inst.platform,
        base_url=inst.base_url,
        api_url=inst.api_url,
        web_url=inst.web_url,
        variant=inst.variant,
        org=inst.org,
        clone_auth=inst.clone_auth,
        credential_id=inst.credential_id,
        proxy_id=inst.proxy_id,
        # NÃO copiados de propósito: whoami, status, error, last_tested_at,
        # projects_count, projects_refreshed_at e os GitInstanceProject.
        status="unknown",
    )
    db.add(clone)
    await db.commit()
    await db.refresh(clone)
    return _instance_dict(clone)


@router.delete("/{guid}")
async def delete_instance(guid: str, db=Depends(get_db)):
    inst = (await db.execute(select(GitInstance).where(GitInstance.guid == guid))).scalar_one_or_none()
    if not inst:
        raise HTTPException(status_code=404, detail="Instância não encontrada")
    await db.delete(inst)
    await db.commit()
    return {"success": True}


def _project_dict(p: GitInstanceProject) -> Dict[str, Any]:
    return {
        "full_name": p.full_name, "name": p.name, "clone_url": p.clone_url,
        "html_url": p.html_url, "description": p.description,
        "default_branch": p.default_branch, "private": p.is_private, "size_kb": p.size_kb,
    }


@router.post("/{guid}/projects/refresh")
async def refresh_instance_projects(guid: str, db=Depends(get_db)):
    """(Re)lista os projetos na plataforma (todos os grupos/subtenants acessíveis) e
    PERSISTE no banco (upsert). Use isto quando quiser atualizar a listagem."""
    inst = (await db.execute(select(GitInstance).where(GitInstance.guid == guid))).scalar_one_or_none()
    if not inst:
        raise HTTPException(status_code=404, detail="Instância não encontrada")
    token = await _get_token(db, inst.credential_id) if inst.clone_auth == "authenticated" else None
    proxy = await resolve_proxy_url(db, inst.proxy_id)
    try:
        repos = await gp.list_projects(inst.platform, inst.api_url, token, proxy,
                                       inst.variant, inst.org, inst.web_url)
    except gp.GitPlatformError as e:
        # Acesso negado / erro da plataforma: propaga status e mensagem claros
        # (NÃO persiste "0 projetos" como se fosse sucesso).
        code = 403 if e.status in (401, 403) else 502
        raise HTTPException(status_code=code, detail=e.message)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Falha ao listar projetos: {str(e)[:300]}")

    # Upsert por (instance_id, full_name). Substitui o conjunto anterior.
    existing = {
        p.full_name: p for p in (await db.execute(
            select(GitInstanceProject).where(GitInstanceProject.instance_id == inst.id)
        )).scalars().all()
    }
    seen = set()
    for r in repos:
        fn = (r.get("full_name") or "").strip()
        if not fn or fn in seen:
            continue
        seen.add(fn)
        p = existing.get(fn) or GitInstanceProject(instance_id=inst.id, full_name=fn)
        p.name = r.get("name")
        p.clone_url = r.get("clone_url")
        p.html_url = r.get("html_url")
        p.description = r.get("description")
        p.default_branch = r.get("default_branch")
        p.is_private = r.get("private")
        p.size_kb = r.get("size_kb")
        if fn not in existing:
            db.add(p)
    # Remove os que não existem mais.
    for fn, p in existing.items():
        if fn not in seen:
            await db.delete(p)

    inst.projects_count = len(seen)
    inst.projects_refreshed_at = datetime.now(timezone.utc)
    await db.commit()
    return {"count": len(seen), "refreshed_at": inst.projects_refreshed_at.isoformat()}


@router.get("/{guid}/projects")
async def list_instance_projects(guid: str, q: Optional[str] = None,
                                  limit: int = 200, offset: int = 0,
                                  db=Depends(get_db_readonly)):
    """Lista os projetos PERSISTIDOS da instância (sem bater na API). Paginado p/
    suportar milhares. Faça /projects/refresh para buscar/atualizar da plataforma."""
    inst = (await db.execute(select(GitInstance).where(GitInstance.guid == guid))).scalar_one_or_none()
    if not inst:
        raise HTTPException(status_code=404, detail="Instância não encontrada")
    base = select(GitInstanceProject).where(GitInstanceProject.instance_id == inst.id)
    cnt = select(func.count(GitInstanceProject.id)).where(GitInstanceProject.instance_id == inst.id)
    if q and q.strip():
        like = f"%{q.strip()}%"
        base = base.where(GitInstanceProject.full_name.ilike(like))
        cnt = cnt.where(GitInstanceProject.full_name.ilike(like))
    total = (await db.execute(cnt)).scalar() or 0
    rows = (await db.execute(
        base.order_by(GitInstanceProject.full_name).limit(min(limit, 2000)).offset(offset)
    )).scalars().all()
    return {
        "instance": _instance_dict(inst),
        "total": total, "count": len(rows), "offset": offset,
        "refreshed_at": inst.projects_refreshed_at.isoformat() if inst.projects_refreshed_at else None,
        "projects": [_project_dict(p) for p in rows],
    }


def _norm_clone_target(url: str) -> str:
    """Chave canônica do ALVO de clone (host+caminho), ignorando esquema, credenciais
    embutidas (user:pass@), porta, '.git' e barra final. Dois clone_urls que apontam
    para o MESMO repositório no MESMO servidor geram a mesma chave — mesmo que venham
    de instâncias/credenciais diferentes. Servidores distintos geram chaves distintas."""
    u = (url or "").strip()
    if not u:
        return ""
    # Esquema
    if "://" in u:
        u = u.split("://", 1)[1]
    # Credenciais embutidas no host: user[:pass]@host -> host
    if "@" in u.split("/", 1)[0]:
        u = u.split("@", 1)[1]
    # Trata porta (host:8080/...) e forma scp (host:grupo/projeto).
    first = u.split("/", 1)[0]
    rest_path = u.split("/", 1)[1] if "/" in u else ""
    if ":" in first:
        host, _, after_colon = first.partition(":")
        if after_colon.isdigit():
            # porta -> descarta, mantém o caminho
            u = host + (f"/{rest_path}" if rest_path else "")
        else:
            # scp 'host:grupo[/projeto...]' -> 'host/grupo[/projeto...]'
            tail = after_colon + (f"/{rest_path}" if rest_path else "")
            u = f"{host}/{tail}"
    u = u.rstrip("/")
    if u.endswith(".git"):
        u = u[:-4]
    return u.lower()


async def _enqueue_project(db, inst, full_name, clone_url, name=None, html_url=None,
                           description=None, default_branch=None, size_kb=None,
                           task="clone", task_limit=None, task_offset=None) -> bool:
    full_name = (full_name or "").strip()
    clone_url = (clone_url or "").strip()
    if not clone_url and task == "clone":
        return False
    if not full_name:
        full_name = (clone_url or "").rsplit("/", 1)[-1].replace(".git", "") or "projeto"

    # Dedup por ALVO de clone: o mesmo repositório (host+caminho) acessível por duas
    # instâncias (credenciais diferentes) deve mapear para UM único GitRepo, para não
    # baixar duas vezes. Busca candidatos por clone_url OU full_name e escolhe o que
    # tem o mesmo alvo canônico; só então cai no full_name (compat. com o legado).
    target = _norm_clone_target(clone_url)
    cands = (await db.execute(
        select(GitRepo).where(or_(GitRepo.clone_url == clone_url,
                                  GitRepo.full_name == full_name))
    )).scalars().all()
    repo = next((c for c in cands if _norm_clone_target(c.clone_url) == target), None)
    if repo is None:
        repo = next((c for c in cands if c.full_name == full_name), None)

    is_new = repo is None
    if is_new:
        repo = GitRepo(full_name=full_name)
        db.add(repo)
    owner, _, nm = full_name.partition("/")
    repo.owner = owner or None
    repo.name = name or (nm or full_name)
    repo.clone_url = clone_url
    repo.html_url = html_url
    repo.description = description
    repo.default_branch = default_branch
    repo.size_kb = size_kb
    repo.source = inst.platform
    repo.discovered_via = f"instance:{inst.name or inst.base_url}"
    await db.flush()

    cred_id = inst.credential_id if inst.clone_auth == "authenticated" else None

    # Tarefas de CI (secrets/pipelines): não envolvem clone/working-tree. Só dedup
    # contra um job ATIVO da MESMA tarefa (evita enfileirar duplicado); re-coleta é
    # permitida (idempotente). Não mexe no clone_status do repo.
    if task in ("secrets", "pipelines"):
        active_task = (await db.execute(
            select(GitCloneJob.id).where(
                GitCloneJob.repo_id == repo.id,
                GitCloneJob.task_type == task,
                GitCloneJob.status.in_(["pending", "cloning", "processing"]),
            )
        )).scalar()
        if active_task:
            return False
        db.add(GitCloneJob(
            repo_id=repo.id, repo_url=clone_url or repo.html_url or full_name,
            repo_full_name=full_name, clone_auth=inst.clone_auth,
            credential_id=cred_id, proxy_id=inst.proxy_id,
            status="pending", task_type=task, task_limit=task_limit,
            task_offset=task_offset, instance_id=inst.id,
        ))
        return True

    # Dedup de DOWNLOAD (clone): não reenfileira se o repo já está baixado, em
    # andamento ou com job ativo (independe de qual instância/credencial o descobriu).
    active = (await db.execute(
        select(GitCloneJob.id).where(
            GitCloneJob.repo_id == repo.id,
            GitCloneJob.task_type == "clone",
            GitCloneJob.status.in_(["pending", "cloning", "cloned", "processing"]),
        )
    )).scalar()
    try:
        from git_clone_worker import GITCLONES_BASE
        has_full_clone = os.path.isdir(os.path.join(GITCLONES_BASE, repo.guid, ".git"))
    except Exception:  # noqa: BLE001
        has_full_clone = False
    if active or has_full_clone or (repo.clone_status in ("cloned", "cloning", "processing")):
        return False

    # Só agora marca como pendente (não mexe no status de um repo já clonado).
    repo.clone_status = "pending"
    db.add(GitCloneJob(
        repo_id=repo.id, repo_url=clone_url, repo_full_name=full_name,
        clone_auth=inst.clone_auth, credential_id=cred_id,
        proxy_id=inst.proxy_id, status="pending", task_type="clone",
        instance_id=inst.id,
    ))
    return True


@router.post("/{guid}/clone")
async def clone_instance_projects(guid: str, req: CloneReposRequest, db=Depends(get_db)):
    """Enfileira uma tarefa por projeto. `task`: clone (git clone), pipelines (logs de
    CI) ou secrets (variáveis/secrets). Seleção: `repos`, `full_names` ou `all=true`."""
    inst = (await db.execute(select(GitInstance).where(GitInstance.guid == guid))).scalar_one_or_none()
    if not inst:
        raise HTTPException(status_code=404, detail="Instância não encontrada")

    task = req.task if req.task in ("clone", "pipelines", "secrets") else "clone"

    queued = 0
    total = 0
    if req.all or req.full_names:
        base = select(GitInstanceProject).where(GitInstanceProject.instance_id == inst.id)
        if req.full_names:
            base = base.where(GitInstanceProject.full_name.in_(req.full_names))
        elif req.q and req.q.strip():
            base = base.where(GitInstanceProject.full_name.ilike(f"%{req.q.strip()}%"))
        rows = (await db.execute(base.order_by(GitInstanceProject.full_name))).scalars().all()
        if not rows:
            raise HTTPException(status_code=400, detail="Nenhum projeto (liste/atualize primeiro)")
        total = len(rows)
        for i, p in enumerate(rows, 1):
            if await _enqueue_project(db, inst, p.full_name, p.clone_url, p.name, p.html_url,
                                      p.description, p.default_branch, p.size_kb,
                                      task=task, task_limit=req.limit, task_offset=req.offset):
                queued += 1
            if i % 200 == 0:
                await db.commit()  # commit em lotes p/ milhares
    elif req.repos:
        total = len(req.repos)
        for r in req.repos:
            if await _enqueue_project(db, inst, r.get("full_name"), r.get("clone_url"),
                                      r.get("name"), r.get("html_url"), r.get("description"),
                                      r.get("default_branch"), r.get("size_kb"),
                                      task=task, task_limit=req.limit, task_offset=req.offset):
                queued += 1
    else:
        raise HTTPException(status_code=400, detail="Nenhum projeto selecionado")

    await db.commit()
    # skipped = já baixados / em andamento / duplicados (dedup).
    return {"queued": queued, "skipped": max(0, total - queued), "total": total, "task": task}
