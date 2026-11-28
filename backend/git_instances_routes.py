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

from database import get_db, get_db_readonly, Credential, GitInstance, GitRepo, GitCloneJob
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
    repos: List[Dict[str, Any]]            # [{full_name, clone_url, html_url?, description?, default_branch?, size_kb?}]


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


@router.get("/{guid}/projects")
async def list_instance_projects(guid: str, db=Depends(get_db_readonly)):
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
    return {"instance": _instance_dict(inst), "count": len(repos), "projects": repos}


@router.post("/{guid}/clone")
async def clone_instance_projects(guid: str, req: CloneReposRequest, db=Depends(get_db)):
    inst = (await db.execute(select(GitInstance).where(GitInstance.guid == guid))).scalar_one_or_none()
    if not inst:
        raise HTTPException(status_code=404, detail="Instância não encontrada")
    if not req.repos:
        raise HTTPException(status_code=400, detail="Nenhum projeto selecionado")

    queued = 0
    for r in req.repos:
        full_name = (r.get("full_name") or "").strip()
        clone_url = (r.get("clone_url") or "").strip()
        if not clone_url:
            continue
        if not full_name:
            full_name = clone_url.rsplit("/", 1)[-1].replace(".git", "")

        repo = (await db.execute(select(GitRepo).where(GitRepo.full_name == full_name))).scalar_one_or_none()
        if not repo:
            repo = GitRepo(full_name=full_name)
            db.add(repo)
        owner, _, name = full_name.partition("/")
        repo.owner = owner or None
        repo.name = r.get("name") or (name or full_name)
        repo.clone_url = clone_url
        repo.html_url = r.get("html_url")
        repo.description = r.get("description")
        repo.default_branch = r.get("default_branch")
        repo.size_kb = r.get("size_kb")
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
            continue

        db.add(GitCloneJob(
            repo_id=repo.id,
            repo_url=clone_url,
            repo_full_name=full_name,
            clone_auth=inst.clone_auth,
            credential_id=inst.credential_id if inst.clone_auth == "authenticated" else None,
            proxy_id=inst.proxy_id,
            status="pending",
        ))
        queued += 1

    await db.commit()
    return {"queued": queued}
