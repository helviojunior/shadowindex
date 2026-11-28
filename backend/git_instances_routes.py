"""
API das "Git Instances" (Git -> Instances): cadastro de instâncias de plataformas
Git, teste de acesso (fingerprint + whoami), listagem e clone de projetos.
"""
import logging
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func, update

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


class CloneReposRequest(BaseModel):
    repos: Optional[List[Dict[str, Any]]] = None   # projetos específicos (seleção)
    full_names: Optional[List[str]] = None         # ou por full_name (seleção)
    all: bool = False                              # ou TODOS os projetos listados da instância
    q: Optional[str] = None                        # filtro (quando all=true)


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


async def _enqueue_project(db, inst, full_name, clone_url, name=None, html_url=None,
                           description=None, default_branch=None, size_kb=None) -> bool:
    full_name = (full_name or "").strip()
    clone_url = (clone_url or "").strip()
    if not clone_url:
        return False
    if not full_name:
        full_name = clone_url.rsplit("/", 1)[-1].replace(".git", "")
    repo = (await db.execute(select(GitRepo).where(GitRepo.full_name == full_name))).scalar_one_or_none()
    if not repo:
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
    if repo.clone_status not in ("cloning",):
        repo.clone_status = "pending"
    await db.flush()
    active = (await db.execute(
        select(GitCloneJob.id).where(
            GitCloneJob.repo_id == repo.id,
            GitCloneJob.status.in_(["pending", "cloning", "cloned", "processing"]),
        )
    )).scalar()
    if active:
        return False
    db.add(GitCloneJob(
        repo_id=repo.id, repo_url=clone_url, repo_full_name=full_name,
        clone_auth=inst.clone_auth,
        credential_id=inst.credential_id if inst.clone_auth == "authenticated" else None,
        proxy_id=inst.proxy_id, status="pending",
    ))
    return True


@router.post("/{guid}/clone")
async def clone_instance_projects(guid: str, req: CloneReposRequest, db=Depends(get_db)):
    """Enfileira o clone. Modos: `repos` (objetos), `full_names` (ids) ou `all=true`
    (TODOS os projetos listados da instância — suporta milhares, direto do banco)."""
    inst = (await db.execute(select(GitInstance).where(GitInstance.guid == guid))).scalar_one_or_none()
    if not inst:
        raise HTTPException(status_code=404, detail="Instância não encontrada")

    queued = 0
    if req.all or req.full_names:
        base = select(GitInstanceProject).where(GitInstanceProject.instance_id == inst.id)
        if req.full_names:
            base = base.where(GitInstanceProject.full_name.in_(req.full_names))
        elif req.q and req.q.strip():
            base = base.where(GitInstanceProject.full_name.ilike(f"%{req.q.strip()}%"))
        rows = (await db.execute(base.order_by(GitInstanceProject.full_name))).scalars().all()
        if not rows:
            raise HTTPException(status_code=400, detail="Nenhum projeto para clonar (liste/atualize primeiro)")
        for i, p in enumerate(rows, 1):
            if await _enqueue_project(db, inst, p.full_name, p.clone_url, p.name, p.html_url,
                                      p.description, p.default_branch, p.size_kb):
                queued += 1
            if i % 200 == 0:
                await db.commit()  # commit em lotes p/ milhares
    elif req.repos:
        for r in req.repos:
            if await _enqueue_project(db, inst, r.get("full_name"), r.get("clone_url"),
                                      r.get("name"), r.get("html_url"), r.get("description"),
                                      r.get("default_branch"), r.get("size_kb")):
                queued += 1
    else:
        raise HTTPException(status_code=400, detail="Nenhum projeto selecionado")

    await db.commit()
    return {"queued": queued}
