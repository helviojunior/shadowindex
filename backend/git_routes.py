"""
GIT module API - /api/git

- GitHub search (count + enqueue clone jobs), replicating gh-search-clone
- Repository listing / detail / file browsing
- Content search (OpenSearch with ILIKE fallback)
- Clone job queue management
"""
import logging
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, func, or_, desc, asc

from database import (
    get_db, get_db_readonly,
    Credential, GitRepo, GitRepoFile, GitCloneJob, GitleaksFinding,
)
from github_api import AsyncGithubSearcher, GithubSearchError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/git")

VALID_TYPES = {"code", "repositories"}


# --------------------------------------------------------------------------
# Pydantic models
# --------------------------------------------------------------------------
class SearchCountRequest(BaseModel):
    terms: List[str] = Field(..., min_length=1)
    types: List[str] = Field(default_factory=lambda: ["repositories"])
    exact: bool = False
    api_credential_id: int


class SearchCondition(BaseModel):
    term: str
    type: str


class SearchEnqueueRequest(BaseModel):
    conditions: List[SearchCondition] = Field(..., min_length=1)
    exact: bool = False
    api_credential_id: int
    clone_auth: str = "anonymous"  # anonymous | authenticated
    clone_credential_id: Optional[int] = None
    depth: Optional[int] = None


class GitManualLeakRequest(BaseModel):
    secret_type: str = "other"
    match_text: Optional[str] = None
    line_number: Optional[int] = None
    description: Optional[str] = None


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------
async def _get_token(db, credential_id: int) -> str:
    cred = (await db.execute(
        select(Credential).where(Credential.id == credential_id)
    )).scalar_one_or_none()
    if not cred:
        raise HTTPException(status_code=404, detail=f"Credencial {credential_id} não encontrada")
    if cred.credential_type != "token" or not cred.token:
        raise HTTPException(status_code=400, detail="A credencial selecionada não é um Token válido")
    return cred.token


def _repo_dict(r: GitRepo) -> Dict[str, Any]:
    return {
        "id": r.id,
        "guid": r.guid,
        "full_name": r.full_name,
        "owner": r.owner,
        "name": r.name,
        "html_url": r.html_url,
        "description": r.description,
        "default_branch": r.default_branch,
        "stars": r.stars,
        "forks": r.forks,
        "language": r.language,
        "topics": r.topics or [],
        "size_kb": r.size_kb,
        "is_private": r.is_private,
        "discovered_via": r.discovered_via,
        "search_type": r.search_type,
        "clone_status": r.clone_status,
        "scan_status": r.scan_status,
        "ocr_status": r.ocr_status,
        "index_status": r.index_status,
        "leaks_count": r.leaks_count,
        "files_count": r.files_count,
        "cloned_at": r.cloned_at.isoformat() if r.cloned_at else None,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


def _job_dict(j: GitCloneJob, repo_full_name: Optional[str] = None) -> Dict[str, Any]:
    return {
        "id": j.id,
        "repo_id": j.repo_id,
        "repo_full_name": repo_full_name or j.repo_full_name,
        "repo_url": j.repo_url,
        "clone_auth": j.clone_auth,
        "status": j.status,
        "priority": j.priority,
        "current_step": j.current_step,
        "total_files": j.total_files,
        "processed_files": j.processed_files,
        "leaks_found": j.leaks_found,
        "error_message": j.error_message,
        "created_at": j.created_at.isoformat() if j.created_at else None,
        "started_at": j.started_at.isoformat() if j.started_at else None,
        "completed_at": j.completed_at.isoformat() if j.completed_at else None,
    }


# --------------------------------------------------------------------------
# Search
# --------------------------------------------------------------------------
@router.post("/search/count")
async def search_count(req: SearchCountRequest, db=Depends(get_db_readonly)):
    types = [t for t in req.types if t in VALID_TYPES]
    if not types:
        raise HTTPException(status_code=400, detail="Selecione ao menos um tipo de busca válido (code/repositories)")
    terms = [t.strip() for t in req.terms if t and t.strip()]
    if not terms:
        raise HTTPException(status_code=400, detail="Informe ao menos um termo de busca")

    token = await _get_token(db, req.api_credential_id)
    searcher = AsyncGithubSearcher(token)

    results = []
    for term in terms:
        for stype in types:
            row = {"term": term, "type": stype, "exact": req.exact}
            try:
                count = await searcher.count(term, search_type=stype, exact=req.exact)
                row["count"] = count
                row["status"] = "ok"
            except GithubSearchError as e:
                row["count"] = 0
                row["status"] = "error"
                row["error"] = e.message
            except Exception as e:  # noqa: BLE001
                row["count"] = 0
                row["status"] = "error"
                row["error"] = str(e)[:200]
            results.append(row)
    return {"results": results}


@router.post("/search/enqueue")
async def search_enqueue(req: SearchEnqueueRequest, db=Depends(get_db)):
    conditions = [(c.term.strip(), c.type) for c in req.conditions if c.term.strip() and c.type in VALID_TYPES]
    if not conditions:
        raise HTTPException(status_code=400, detail="Nenhuma condição válida para download")

    if req.clone_auth == "authenticated":
        if not req.clone_credential_id:
            raise HTTPException(status_code=400, detail="Token de clone é obrigatório para clone autenticado")
        # valida que é um token
        await _get_token(db, req.clone_credential_id)

    token = await _get_token(db, req.api_credential_id)
    searcher = AsyncGithubSearcher(token)

    seen_full_names = set()
    unique_repos: List[Dict[str, Any]] = []
    for term, stype in conditions:
        try:
            repos = await searcher.resolve(term, search_type=stype, exact=req.exact)
        except GithubSearchError as e:
            raise HTTPException(status_code=400, detail=f"Erro na busca '{term}' ({stype}): {e.message}")
        for r in repos:
            fn = r.get("full_name")
            if not fn or fn in seen_full_names:
                continue
            seen_full_names.add(fn)
            r["_discovered_via"] = term
            r["_search_type"] = stype
            unique_repos.append(r)

    queued = 0
    for r in unique_repos:
        fn = r["full_name"]
        repo = (await db.execute(select(GitRepo).where(GitRepo.full_name == fn))).scalar_one_or_none()
        if not repo:
            repo = GitRepo(full_name=fn)
            db.add(repo)
        repo.owner = r.get("owner")
        repo.name = r.get("name")
        repo.html_url = r.get("html_url")
        repo.clone_url = r.get("clone_url") or f"https://github.com/{fn}.git"
        repo.description = r.get("description")
        repo.default_branch = r.get("default_branch")
        repo.stars = r.get("stars") or 0
        repo.forks = r.get("forks") or 0
        repo.language = r.get("language")
        repo.topics = r.get("topics") or []
        repo.size_kb = r.get("size_kb")
        repo.is_private = bool(r.get("private"))
        repo.discovered_via = r.get("_discovered_via")
        repo.search_type = r.get("_search_type")
        if repo.clone_status not in ("cloning",):
            repo.clone_status = "pending"
        await db.flush()

        # Evitar jobs duplicados ativos para o mesmo repo
        active = (await db.execute(
            select(GitCloneJob.id).where(
                GitCloneJob.repo_id == repo.id,
                GitCloneJob.status.in_(["pending", "running"]),
            )
        )).scalar()
        if active:
            continue

        job = GitCloneJob(
            repo_id=repo.id,
            repo_url=repo.clone_url,
            repo_full_name=fn,
            clone_auth=req.clone_auth,
            credential_id=req.clone_credential_id if req.clone_auth == "authenticated" else None,
            depth=req.depth,
            status="pending",
        )
        db.add(job)
        queued += 1

    await db.commit()
    return {"queued": queued, "repos_found": len(unique_repos)}


@router.get("/search/content")
async def search_content(
    q: str = Query(..., min_length=1),
    repo_guid: Optional[str] = None,
    limit: int = Query(50, le=200),
    db=Depends(get_db_readonly),
):
    import opensearch_client
    res = await _search_content_os(q, repo_guid, limit)
    if res is not None:
        return res
    # Fallback ILIKE
    stmt = select(GitRepoFile, GitRepo.full_name).join(GitRepo, GitRepoFile.repo_id == GitRepo.id)
    stmt = stmt.where(GitRepoFile.content.isnot(None), GitRepoFile.content.ilike(f"%{q}%"))
    if repo_guid:
        stmt = stmt.where(GitRepoFile.repo_guid == repo_guid)
    stmt = stmt.limit(limit)
    rows = (await db.execute(stmt)).all()
    hits = []
    for gf, full_name in rows:
        snippet = _snippet(gf.content, q)
        hits.append({
            "repo_id": gf.repo_id, "repo_guid": gf.repo_guid, "repo_full_name": full_name,
            "rel_path": gf.rel_path, "name": gf.name, "extension": gf.extension,
            "score": None, "highlights": [snippet] if snippet else [],
        })
    return {"total": len(hits), "hits": hits, "backend": "ilike"}


async def _search_content_os(q, repo_guid, limit):
    import asyncio
    import opensearch_client
    if not opensearch_client.is_enabled():
        return None
    return await asyncio.to_thread(opensearch_client.search_content, q, repo_guid, limit, True)


def _snippet(content: str, q: str, width: int = 120) -> Optional[str]:
    if not content:
        return None
    idx = content.lower().find(q.lower())
    if idx < 0:
        return content[:width]
    start = max(0, idx - width // 2)
    end = min(len(content), idx + len(q) + width // 2)
    return ("…" if start > 0 else "") + content[start:end].replace("\n", " ") + ("…" if end < len(content) else "")


# --------------------------------------------------------------------------
# Repositories
# --------------------------------------------------------------------------
@router.get("/repos")
async def list_repos(
    q: Optional[str] = None,
    language: Optional[str] = None,
    tag: Optional[str] = None,
    clone_status: Optional[str] = None,
    sort: str = "updated",
    limit: int = Query(50, le=500),
    offset: int = 0,
    db=Depends(get_db_readonly),
):
    stmt = select(GitRepo)
    conds = []
    if q:
        like = f"%{q}%"
        conds.append(or_(GitRepo.full_name.ilike(like), GitRepo.description.ilike(like), GitRepo.name.ilike(like)))
    if language:
        conds.append(GitRepo.language == language)
    if clone_status:
        conds.append(GitRepo.clone_status == clone_status)
    if conds:
        stmt = stmt.where(*conds)

    count_stmt = select(func.count()).select_from(stmt.subquery())
    total = (await db.execute(count_stmt)).scalar() or 0

    if sort == "stars":
        stmt = stmt.order_by(desc(GitRepo.stars))
    elif sort == "name":
        stmt = stmt.order_by(asc(GitRepo.full_name))
    else:
        stmt = stmt.order_by(desc(GitRepo.updated_at))

    stmt = stmt.limit(limit).offset(offset)
    repos = (await db.execute(stmt)).scalars().all()

    items = [_repo_dict(r) for r in repos]
    if tag:
        tl = tag.lower()
        items = [it for it in items if any(tl == (t or "").lower() for t in (it.get("topics") or []))]
    return {"total": total, "repos": items}


@router.get("/repos/stats")
async def repos_stats(db=Depends(get_db_readonly)):
    stats = {}
    for st in ["pending", "cloning", "cloned", "failed"]:
        c = (await db.execute(
            select(func.count(GitRepo.id)).where(GitRepo.clone_status == st)
        )).scalar() or 0
        stats[st] = c
    stats["total"] = (await db.execute(select(func.count(GitRepo.id)))).scalar() or 0
    return stats


@router.get("/repos/{guid}")
async def get_repo(guid: str, db=Depends(get_db_readonly)):
    repo = (await db.execute(select(GitRepo).where(GitRepo.guid == guid))).scalar_one_or_none()
    if not repo:
        raise HTTPException(status_code=404, detail="Repositório não encontrado")
    data = _repo_dict(repo)
    data["leaks"] = (await db.execute(
        select(func.count(GitleaksFinding.id)).where(GitleaksFinding.git_repo_guid == guid)
    )).scalar() or 0
    return data


@router.get("/repos/{guid}/files")
async def list_repo_files(
    guid: str,
    q: Optional[str] = None,
    limit: int = Query(500, le=5000),
    offset: int = 0,
    db=Depends(get_db_readonly),
):
    repo = (await db.execute(select(GitRepo).where(GitRepo.guid == guid))).scalar_one_or_none()
    if not repo:
        raise HTTPException(status_code=404, detail="Repositório não encontrado")
    stmt = select(GitRepoFile).where(GitRepoFile.repo_id == repo.id)
    if q:
        stmt = stmt.where(GitRepoFile.rel_path.ilike(f"%{q}%"))
    stmt = stmt.order_by(asc(GitRepoFile.rel_path)).limit(limit).offset(offset)
    files = (await db.execute(stmt)).scalars().all()
    return {
        "repo": _repo_dict(repo),
        "files": [{
            "id": f.id, "rel_path": f.rel_path, "name": f.name, "extension": f.extension,
            "size": f.size, "mimetype": f.mimetype, "is_binary": f.is_binary,
            "content_extracted": f.content_extracted, "indexed": f.indexed,
        } for f in files],
    }


@router.get("/repos/{guid}/files/{file_id}")
async def get_repo_file(guid: str, file_id: int, db=Depends(get_db_readonly)):
    f = (await db.execute(
        select(GitRepoFile).where(GitRepoFile.id == file_id, GitRepoFile.repo_guid == guid)
    )).scalar_one_or_none()
    if not f:
        raise HTTPException(status_code=404, detail="Arquivo não encontrado")
    return {
        "id": f.id, "rel_path": f.rel_path, "name": f.name, "extension": f.extension,
        "size": f.size, "mimetype": f.mimetype, "is_binary": f.is_binary,
        "sha1": f.sha1, "indexed": f.indexed,
        "content_extracted": f.content_extracted, "content_error": f.content_error,
        "content": f.content,
    }


@router.post("/repos/{guid}/files/{file_id}/manual-leak")
async def register_git_manual_leak(
    guid: str, file_id: int, body: GitManualLeakRequest, db=Depends(get_db),
):
    """Registra manualmente uma credencial vazada em um arquivo de repositório Git,
    criando um GitleaksFinding ligado ao repo/arquivo (git_repo_id/git_repo_guid)."""
    import hashlib
    from routes_v2 import LEAK_TYPES

    if not (body.match_text and body.match_text.strip()):
        raise HTTPException(status_code=400, detail="match_text é obrigatório")

    f = (await db.execute(
        select(GitRepoFile).where(GitRepoFile.id == file_id, GitRepoFile.repo_guid == guid)
    )).scalar_one_or_none()
    if not f:
        raise HTTPException(status_code=404, detail="Arquivo não encontrado")
    repo = (await db.execute(select(GitRepo).where(GitRepo.guid == guid))).scalar_one_or_none()
    if not repo:
        raise HTTPException(status_code=404, detail="Repositório não encontrado")

    leak_info = LEAK_TYPES.get(body.secret_type, LEAK_TYPES["other"])

    fp_source = f"{guid}:{f.id}:{body.secret_type}:{body.line_number or 0}:{body.match_text or ''}"
    fingerprint = f"git-manual:{hashlib.sha256(fp_source.encode()).hexdigest()[:32]}"

    existing = (await db.execute(
        select(GitleaksFinding.id).where(GitleaksFinding.fingerprint == fingerprint)
    )).scalar()
    if existing:
        return {"success": False, "message": "Leak já registrado para este arquivo e localização"}

    match_text = body.match_text or "[identificado manualmente]"
    finding = GitleaksFinding(
        fingerprint=fingerprint,
        rule_id=leak_info["rule_id"],
        description=body.description or f"Credencial identificada manualmente: {leak_info['name']}",
        match=match_text,
        secret=(match_text[:50] + "...") if len(match_text) > 50 else match_text,
        start_line=body.line_number or 1,
        end_line=body.line_number or 1,
        tags=["manual", body.secret_type],
        file_path=f.rel_path,
        original_file=f.rel_path,
        file_name=f.name,
        server_name=repo.full_name,
        share_name=repo.full_name,
        server_path=f.rel_path,
        detection_source="manual",
        git_repo_id=repo.id,
        git_repo_guid=repo.guid,
        scanned_at=datetime.now(timezone.utc),
        raw_data={"manual": True, "secret_type": body.secret_type, "severity": leak_info["severity"]},
    )
    db.add(finding)
    # Atualiza o contador do repositório
    repo.leaks_count = (await db.execute(
        select(func.count(GitleaksFinding.id)).where(GitleaksFinding.git_repo_guid == guid)
    )).scalar() or 0
    repo.leaks_count += 1
    await db.commit()
    await db.refresh(finding)
    return {"success": True, "message": "Leak registrado com sucesso", "finding_id": finding.id}


# --------------------------------------------------------------------------
# Clone jobs
# --------------------------------------------------------------------------
@router.get("/jobs")
async def list_jobs(
    status: Optional[str] = None,
    limit: int = Query(100, le=500),
    offset: int = 0,
    db=Depends(get_db_readonly),
):
    stmt = select(GitCloneJob)
    if status:
        stmt = stmt.where(GitCloneJob.status == status)
    stmt = stmt.order_by(desc(GitCloneJob.created_at)).limit(limit).offset(offset)
    jobs = (await db.execute(stmt)).scalars().all()
    return {"jobs": [_job_dict(j) for j in jobs]}


@router.get("/jobs/stats")
async def jobs_stats(db=Depends(get_db_readonly)):
    stats = {}
    for st in ["pending", "running", "completed", "failed", "cancelled"]:
        c = (await db.execute(
            select(func.count(GitCloneJob.id)).where(GitCloneJob.status == st)
        )).scalar() or 0
        stats[st] = c
    stats["total"] = sum(stats.values())
    return stats


@router.post("/jobs/{job_id}/cancel")
async def cancel_job(job_id: int, db=Depends(get_db)):
    job = (await db.execute(select(GitCloneJob).where(GitCloneJob.id == job_id))).scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job não encontrado")
    if job.status in ("pending", "running"):
        job.status = "cancelled"
        job.completed_at = datetime.now(timezone.utc)
        await db.commit()
    return {"success": True, "status": job.status}


@router.post("/jobs/cancel-all")
async def cancel_all_jobs(db=Depends(get_db)):
    jobs = (await db.execute(
        select(GitCloneJob).where(GitCloneJob.status == "pending")
    )).scalars().all()
    for j in jobs:
        j.status = "cancelled"
        j.completed_at = datetime.now(timezone.utc)
    await db.commit()
    return {"success": True, "cancelled": len(jobs)}


@router.post("/jobs/{job_id}/retry")
async def retry_job(job_id: int, db=Depends(get_db)):
    job = (await db.execute(select(GitCloneJob).where(GitCloneJob.id == job_id))).scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job não encontrado")
    if job.status in ("failed", "cancelled"):
        job.status = "pending"
        job.error_message = None
        job.current_step = None
        job.started_at = None
        job.completed_at = None
        await db.commit()
    return {"success": True, "status": job.status}


@router.post("/jobs/retry-failed")
async def retry_failed_jobs(db=Depends(get_db)):
    jobs = (await db.execute(
        select(GitCloneJob).where(GitCloneJob.status == "failed")
    )).scalars().all()
    for j in jobs:
        j.status = "pending"
        j.error_message = None
        j.current_step = None
        j.started_at = None
        j.completed_at = None
    await db.commit()
    return {"success": True, "retried": len(jobs)}


@router.post("/jobs/{job_id}/prioritize")
async def prioritize_job(job_id: int, db=Depends(get_db)):
    job = (await db.execute(select(GitCloneJob).where(GitCloneJob.id == job_id))).scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job não encontrado")
    job.priority = (job.priority or 0) + 10
    await db.commit()
    return {"success": True, "priority": job.priority}


# --------------------------------------------------------------------------
# Status
# --------------------------------------------------------------------------
@router.get("/status")
async def git_status():
    import opensearch_client
    return {"opensearch": opensearch_client.health()}
