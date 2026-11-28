"""
GIT module API - /api/git

- GitHub search (count + enqueue clone jobs), replicating gh-search-clone
- Repository listing / detail / file browsing
- Content search (OpenSearch with ILIKE fallback)
- Clone job queue management
"""
import os
import logging
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any

from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from pydantic import BaseModel, Field
from sqlalchemy import select, func, or_, desc, asc, case, nullslast, update
from sqlalchemy.orm import aliased

from database import (
    get_db, get_db_readonly, AsyncSessionLocal,
    Credential, GitRepo, GitRepoFile, GitCloneJob, GitleaksFinding,
    GitProjectSecret, GitInstance,
)
from github_api import AsyncGithubSearcher, GithubSearchError, resolve_proxy_url


def _parse_gh_datetime(s):
    """Converte um timestamp ISO 8601 do GitHub (ex.: '2024-05-01T12:34:56Z') em datetime."""
    if not s:
        return None
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except Exception:  # noqa: BLE001
        return None

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
    proxy_id: Optional[int] = None


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
    proxy_id: Optional[int] = None


class GitManualLeakRequest(BaseModel):
    secret_type: str = "other"
    match_text: Optional[str] = None
    line_number: Optional[int] = None
    description: Optional[str] = None


class CloneUrlRequest(BaseModel):
    repo_url: str
    clone_auth: str = "anonymous"           # anonymous | authenticated
    credential_id: Optional[int] = None     # token (quando autenticado)
    proxy_id: Optional[int] = None          # ProxyServer (None = sem proxy)


class CloneEnqueueUrlRequest(CloneUrlRequest):
    depth: Optional[int] = None             # opcional: força clone raso nessa profundidade
    clone_mode: Optional[str] = "clone"     # clone | dump (.git exposto na web)


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
        "history_indexed": bool(getattr(r, "history_indexed", False)),
        "commits_count": getattr(r, "commits_count", None),
        "branches_count": getattr(r, "branches_count", None),
        "secrets_count": getattr(r, "secrets_count", None),
        "pipelines_count": getattr(r, "pipelines_count", None),
        "pipeline_files_count": getattr(r, "pipeline_files_count", None),
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
    proxy = await resolve_proxy_url(db, req.proxy_id)
    searcher = AsyncGithubSearcher(token, proxy=proxy)

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
    proxy = await resolve_proxy_url(db, req.proxy_id)
    searcher = AsyncGithubSearcher(token, proxy=proxy)

    # Estratégia: inserir os jobs no DB em LOTES, commitando conforme são criados.
    # Assim os workers já começam a pegar do DB enquanto o restante é inserido, e
    # um reboot/timeout no meio preserva o que já foi commitado (resiliente).
    BATCH_SIZE = 25
    seen_full_names = set()
    queued = 0
    repos_found = 0
    batch = 0
    errors: List[Dict[str, str]] = []

    for term, stype in conditions:
        try:
            repos = await searcher.resolve(term, search_type=stype, exact=req.exact)
        except GithubSearchError as e:
            # Persiste o que já foi inserido e segue para a próxima condição.
            if batch:
                await db.commit()
                batch = 0
            errors.append({"term": term, "type": stype, "error": e.message})
            continue

        for r in repos:
            fn = r.get("full_name")
            if not fn or fn in seen_full_names:
                continue
            seen_full_names.add(fn)
            repos_found += 1

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
            repo.pushed_at = _parse_gh_datetime(r.get("pushed_at"))
            repo.is_private = bool(r.get("private"))
            repo.discovered_via = term
            repo.search_type = stype
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

            db.add(GitCloneJob(
                repo_id=repo.id,
                repo_url=repo.clone_url,
                repo_full_name=fn,
                clone_auth=req.clone_auth,
                credential_id=req.clone_credential_id if req.clone_auth == "authenticated" else None,
                depth=req.depth,
                proxy_id=req.proxy_id,
                status="pending",
            ))
            queued += 1
            batch += 1

            # Commit do lote: persiste e libera os workers para começarem a pegar.
            if batch >= BATCH_SIZE:
                await db.commit()
                batch = 0

        # Fim de cada condição: garante durabilidade do que foi inserido.
        if batch:
            await db.commit()
            batch = 0

    if batch:
        await db.commit()

    # Se nenhuma condição resolveu e houve erros, sinaliza falha explícita.
    if queued == 0 and repos_found == 0 and errors:
        raise HTTPException(status_code=400, detail="; ".join(f"{e['term']} ({e['type']}): {e['error']}" for e in errors))

    return {"queued": queued, "repos_found": repos_found, "errors": errors}


# --------------------------------------------------------------------------
# Backfill: preenche GitRepo.pushed_at (e size_kb) de repos antigos a partir do
# GitHub, para que a ordem de prioridade do clone (atualização/tamanho) valha
# também para a fila já enfileirada antes da feature.
# --------------------------------------------------------------------------
class BackfillRequest(BaseModel):
    api_credential_id: int
    limit: Optional[int] = None  # opcional: processa no máx. N repos nesta chamada


async def _run_backfill(token: str, limit: Optional[int]):
    searcher = AsyncGithubSearcher(token)
    updated = 0
    async with AsyncSessionLocal() as db:
        q = select(GitRepo).where(GitRepo.pushed_at.is_(None))
        if limit:
            q = q.limit(int(limit))
        repos = (await db.execute(q)).scalars().all()
        batch = 0
        for repo in repos:
            try:
                data = await searcher.get_repo(repo.full_name)
            except GithubSearchError as e:
                if e.status == 401:
                    logger.error("[git backfill] token inválido (401); abortando")
                    break
                continue
            except Exception as e:  # noqa: BLE001
                logger.warning(f"[git backfill] falha em {repo.full_name}: {e}")
                continue
            if not data:
                continue
            repo.pushed_at = _parse_gh_datetime(data.get("pushed_at"))
            if repo.size_kb is None and data.get("size_kb") is not None:
                repo.size_kb = data.get("size_kb")
            updated += 1
            batch += 1
            if batch >= 50:
                await db.commit()
                batch = 0
        await db.commit()
    logger.info(f"[git backfill] concluído: {updated} repositório(s) atualizados")


@router.post("/backfill-pushed-at")
async def backfill_pushed_at(req: BackfillRequest, background_tasks: BackgroundTasks, db=Depends(get_db)):
    """Dispara, em background, o preenchimento de pushed_at/size dos repos antigos."""
    token = await _get_token(db, req.api_credential_id)  # valida a credencial
    pending = (await db.execute(
        select(func.count(GitRepo.id)).where(GitRepo.pushed_at.is_(None))
    )).scalar() or 0
    background_tasks.add_task(_run_backfill, token, req.limit)
    return {"started": True, "to_process": int(pending)}


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
            "file_id": gf.id, "commit_hash": gf.commit_hash, "commit_short": gf.commit_short,
            "branch": gf.branch, "change_type": gf.change_type, "is_head": bool(gf.is_head),
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
    # Tamanho total dos arquivos clonados (soma de GitRepoFile.size) + contagem.
    stats["total_size_bytes"] = int(
        (await db.execute(select(func.coalesce(func.sum(GitRepoFile.size), 0)))).scalar() or 0
    )
    stats["files"] = (await db.execute(select(func.count(GitRepoFile.id)))).scalar() or 0
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
    include_history: bool = False,
    limit: int = Query(500, le=5000),
    offset: int = 0,
    db=Depends(get_db_readonly),
):
    """Lista os arquivos do repo.

    Por padrão retorna UMA entrada por caminho = a versão atual (HEAD). Com
    include_history=true, retorna uma entrada por caminho que já existiu em
    qualquer commit (inclui arquivos removidos), preferindo a versão HEAD e, na
    falta dela, a mais recente. Cada entrada traz versions_count (nº de versões
    no histórico daquele caminho).
    """
    repo = (await db.execute(select(GitRepo).where(GitRepo.guid == guid))).scalar_one_or_none()
    if not repo:
        raise HTTPException(status_code=404, detail="Repositório não encontrado")

    # Repos possuem rows marcadas com is_head? (dados novos vs. legado)
    has_head = (await db.execute(
        select(func.count()).select_from(GitRepoFile).where(
            GitRepoFile.repo_id == repo.id, GitRepoFile.is_head.is_(True)
        )
    )).scalar() or 0

    if include_history or not has_head:
        # Uma linha por rel_path: a melhor versão (HEAD primeiro, depois mais recente).
        gf2 = aliased(GitRepoFile)
        best_id = (
            select(gf2.id)
            .where(gf2.repo_id == GitRepoFile.repo_id, gf2.rel_path == GitRepoFile.rel_path)
            .order_by(gf2.is_head.desc(), nullslast(gf2.commit_date.desc()), gf2.id.desc())
            .limit(1)
            .correlate(GitRepoFile)
            .scalar_subquery()
        )
        stmt = select(GitRepoFile).where(
            GitRepoFile.repo_id == repo.id, GitRepoFile.id == best_id
        )
    else:
        stmt = select(GitRepoFile).where(
            GitRepoFile.repo_id == repo.id, GitRepoFile.is_head.is_(True)
        )

    # Exclui os logs de pipeline (source='pipeline') da árvore de arquivos do repo —
    # eles têm aba própria (Pipeline).
    stmt = stmt.where(or_(GitRepoFile.source.is_(None), GitRepoFile.source != "pipeline"))

    if q:
        stmt = stmt.where(GitRepoFile.rel_path.ilike(f"%{q}%"))
    stmt = stmt.order_by(asc(GitRepoFile.rel_path)).limit(limit).offset(offset)
    files = (await db.execute(stmt)).scalars().all()

    # Contagem de versões por caminho (uma query agregada).
    paths = [f.rel_path for f in files]
    vcount: Dict[str, int] = {}
    if paths:
        rows = (await db.execute(
            select(GitRepoFile.rel_path, func.count())
            .where(GitRepoFile.repo_id == repo.id, GitRepoFile.rel_path.in_(paths))
            .group_by(GitRepoFile.rel_path)
        )).all()
        vcount = {r[0]: r[1] for r in rows}

    return {
        "repo": _repo_dict(repo),
        "files": [{
            "id": f.id, "rel_path": f.rel_path, "name": f.name, "extension": f.extension,
            "size": f.size, "mimetype": f.mimetype, "is_binary": f.is_binary,
            "content_extracted": f.content_extracted, "indexed": f.indexed,
            "is_head": bool(f.is_head), "commit_short": f.commit_short,
            "commit_hash": f.commit_hash, "change_type": f.change_type,
            "versions_count": vcount.get(f.rel_path, 1),
        } for f in files],
    }


@router.get("/repos/{guid}/files/by-path")
async def list_file_versions(guid: str, path: str, db=Depends(get_db_readonly)):
    """Todas as versões (commits) de um caminho, da mais recente para a mais antiga."""
    repo = (await db.execute(select(GitRepo).where(GitRepo.guid == guid))).scalar_one_or_none()
    if not repo:
        raise HTTPException(status_code=404, detail="Repositório não encontrado")
    rows = (await db.execute(
        select(GitRepoFile)
        .where(GitRepoFile.repo_id == repo.id, GitRepoFile.rel_path == path)
        .order_by(GitRepoFile.is_head.desc(), nullslast(GitRepoFile.commit_date.desc()), GitRepoFile.id.desc())
    )).scalars().all()
    return {
        "repo_guid": guid,
        "rel_path": path,
        "versions": [{
            "id": f.id, "is_head": bool(f.is_head),
            "commit_hash": f.commit_hash, "commit_short": f.commit_short,
            "branch": f.branch, "author": f.author, "author_email": f.author_email,
            "commit_date": f.commit_date.isoformat() if f.commit_date else None,
            "change_type": f.change_type, "size": f.size, "blob_sha": f.blob_sha,
            "indexed": f.indexed, "is_binary": f.is_binary,
            "content_extracted": f.content_extracted,
        } for f in rows],
    }


# --------------------------------------------------------------------------
# Navegação por commit (estilo GitHub): lista de commits + árvore em um commit
# --------------------------------------------------------------------------
_GIT_SHA_RE = None


def _valid_sha(s: str) -> bool:
    """Aceita apenas hexsha (curto ou completo) para evitar injeção em argumentos git."""
    import re as _re
    global _GIT_SHA_RE
    if _GIT_SHA_RE is None:
        _GIT_SHA_RE = _re.compile(r"^[0-9a-fA-F]{4,40}$")
    return bool(s) and bool(_GIT_SHA_RE.match(s))


async def _clone_dir_or_404(repo) -> str:
    from git_clone_worker import GITCLONES_BASE
    clone_dir = os.path.join(GITCLONES_BASE, repo.guid)
    if not os.path.isdir(os.path.join(clone_dir, ".git")):
        raise HTTPException(status_code=409, detail="Clone não disponível em disco (reindexe o repositório)")
    return clone_dir


async def _git_output(clone_dir: str, args: list, timeout: int = 60) -> bytes:
    import asyncio as _asyncio
    proc = await _asyncio.create_subprocess_exec(
        "git", "-C", clone_dir, *args,
        stdout=_asyncio.subprocess.PIPE, stderr=_asyncio.subprocess.PIPE,
    )
    try:
        out, err = await _asyncio.wait_for(proc.communicate(), timeout=timeout)
    except _asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="git demorou demais")
    if proc.returncode != 0:
        msg = (err.decode("utf-8", "replace") if err else "").strip()
        raise HTTPException(status_code=400, detail=msg or f"git falhou ({proc.returncode})")
    return out


async def _commit_meta(clone_dir: str, sha: str) -> Optional[Dict[str, Any]]:
    try:
        out = await _git_output(clone_dir, [
            "show", "-s", "--format=%H%x00%h%x00%an%x00%ae%x00%aI%x00%s", sha,
        ])
    except HTTPException:
        return None
    parts = out.decode("utf-8", "replace").strip().split("\x00")
    if len(parts) < 6:
        return None
    return {"hash": parts[0], "short": parts[1], "author": parts[2],
            "author_email": parts[3], "date": parts[4], "subject": parts[5]}


@router.get("/repos/{guid}/commits")
async def list_repo_commits(
    guid: str,
    q: Optional[str] = None,
    limit: int = Query(100, le=500),
    offset: int = 0,
    db=Depends(get_db_readonly),
):
    """Lista os commits do repositório (como a tela Commits do GitHub)."""
    repo = (await db.execute(select(GitRepo).where(GitRepo.guid == guid))).scalar_one_or_none()
    if not repo:
        raise HTTPException(status_code=404, detail="Repositório não encontrado")
    clone_dir = await _clone_dir_or_404(repo)

    args = ["log", "--all", "--date-order",
            f"--max-count={int(limit)}", f"--skip={int(offset)}",
            "--format=%H%x00%h%x00%an%x00%ae%x00%aI%x00%s"]
    if q and q.strip():
        args += ["--grep", q.strip(), "-i"]
    out = await _git_output(clone_dir, args)
    commits = []
    for line in out.decode("utf-8", "replace").splitlines():
        p = line.split("\x00")
        if len(p) < 6:
            continue
        commits.append({
            "hash": p[0], "short": p[1], "author": p[2], "author_email": p[3],
            "date": p[4], "subject": p[5],
        })
    html_url = repo.html_url
    return {
        "repo": _repo_dict(repo),
        "commits": commits,
        "limit": limit, "offset": offset,
        "html_url_tpl": (f"{html_url}/commit/" if html_url else None),
    }


@router.get("/repos/{guid}/tree")
async def get_repo_tree_at_commit(guid: str, commit: str, db=Depends(get_db_readonly)):
    """Lista a árvore COMPLETA de arquivos como estava em um commit (git ls-tree),
    igual ao /tree/<sha> do GitHub. Cada arquivo traz o file_id (quando aquele blob
    foi indexado) para abrir o conteúdo já extraído."""
    if not _valid_sha(commit):
        raise HTTPException(status_code=400, detail="commit inválido")
    repo = (await db.execute(select(GitRepo).where(GitRepo.guid == guid))).scalar_one_or_none()
    if not repo:
        raise HTTPException(status_code=404, detail="Repositório não encontrado")
    clone_dir = await _clone_dir_or_404(repo)

    out = await _git_output(clone_dir, ["ls-tree", "-r", "--long", commit])
    entries = []
    blob_shas = []
    for line in out.decode("utf-8", "replace").splitlines():
        meta, _, path = line.partition("\t")
        cols = meta.split()
        if len(cols) < 4 or cols[1] != "blob":
            continue
        sha = cols[2]
        size = int(cols[3]) if cols[3].isdigit() else None
        ext = os.path.splitext(path)[1].lower() or None
        entries.append({
            "rel_path": path, "name": os.path.basename(path), "extension": ext,
            "blob_sha": sha, "size": size,
        })
        blob_shas.append(sha)

    # Mapeia blob_sha -> GitRepoFile (para reusar o conteúdo já extraído/indexado).
    info_by_blob: Dict[str, dict] = {}
    if blob_shas:
        # Deduplica os shas p/ o IN.
        uniq = list(dict.fromkeys(blob_shas))
        rows = (await db.execute(
            select(GitRepoFile.blob_sha, GitRepoFile.id, GitRepoFile.indexed, GitRepoFile.is_binary)
            .where(GitRepoFile.repo_id == repo.id, GitRepoFile.blob_sha.in_(uniq))
        )).all()
        for bsha, fid, indexed, is_binary in rows:
            prev = info_by_blob.get(bsha)
            if prev is None or (indexed and not prev.get("indexed")):
                info_by_blob[bsha] = {"id": fid, "indexed": bool(indexed), "is_binary": bool(is_binary)}

    for e in entries:
        info = info_by_blob.get(e["blob_sha"]) or {}
        e["id"] = info.get("id")
        e["indexed"] = info.get("indexed", False)
        e["is_binary"] = info.get("is_binary", False)

    commit_meta = await _commit_meta(clone_dir, commit)
    commit_url = f"{repo.html_url}/tree/{commit}" if repo.html_url else None
    return {
        "repo": _repo_dict(repo),
        "commit": commit_meta,
        "commit_url": commit_url,
        "files": entries,
    }


@router.get("/repos/{guid}/blob")
async def get_repo_blob(
    guid: str,
    blob: Optional[str] = None,
    commit: Optional[str] = None,
    path: Optional[str] = None,
    db=Depends(get_db_readonly),
):
    """Conteúdo de um blob (por sha, ou por commit+path). Reaproveita o GitRepoFile
    quando o blob foi indexado; senão lê do clone via `git cat-file` (texto)."""
    repo = (await db.execute(select(GitRepo).where(GitRepo.guid == guid))).scalar_one_or_none()
    if not repo:
        raise HTTPException(status_code=404, detail="Repositório não encontrado")
    clone_dir = await _clone_dir_or_404(repo)

    blob_sha = blob
    if not blob_sha:
        if not (commit and path):
            raise HTTPException(status_code=400, detail="informe blob, ou commit+path")
        if not _valid_sha(commit):
            raise HTTPException(status_code=400, detail="commit inválido")
        out = await _git_output(clone_dir, ["ls-tree", commit, "--", path])
        line = out.decode("utf-8", "replace").strip()
        cols = line.split()
        if len(cols) < 3 or cols[1] != "blob":
            raise HTTPException(status_code=404, detail="arquivo não existe nesse commit")
        blob_sha = cols[2]
    if not _valid_sha(blob_sha):
        raise HTTPException(status_code=400, detail="blob inválido")

    # 1) Reusar GitRepoFile (conteúdo extraído/OCR) se existir.
    gf = (await db.execute(
        select(GitRepoFile).where(GitRepoFile.repo_id == repo.id, GitRepoFile.blob_sha == blob_sha).limit(1)
    )).scalar_one_or_none()
    if gf is not None:
        return await get_repo_file(guid, gf.id, db)

    # 2) Fallback: ler o blob do clone (texto).
    name = os.path.basename(path) if path else blob_sha[:12]
    ext = os.path.splitext(name)[1].lower() or None
    try:
        raw = await _git_output(clone_dir, ["cat-file", "blob", blob_sha])
    except HTTPException:
        raw = b""
    is_binary = b"\x00" in raw[:8192]
    content = None
    if not is_binary and raw:
        content = raw.decode("utf-8", "replace")
    commit_url = f"{repo.html_url}/commit/{commit}" if (repo.html_url and commit and _valid_sha(commit)) else None
    return {
        "id": None, "rel_path": path or name, "name": name, "extension": ext,
        "size": len(raw), "mimetype": None, "is_binary": is_binary,
        "sha1": None, "indexed": False, "content_extracted": bool(content),
        "content_error": None, "content": content,
        "is_head": False, "blob_sha": blob_sha,
        "commit_hash": commit, "commit_short": (commit[:7] if commit else None),
        "branch": None, "author": None, "author_email": None,
        "commit_date": None, "change_type": None, "versions_count": 1,
        "commit_url": commit_url,
    }


@router.get("/repos/{guid}/files/{file_id}")
async def get_repo_file(guid: str, file_id: int, db=Depends(get_db_readonly)):
    f = (await db.execute(
        select(GitRepoFile).where(GitRepoFile.id == file_id, GitRepoFile.repo_guid == guid)
    )).scalar_one_or_none()
    if not f:
        raise HTTPException(status_code=404, detail="Arquivo não encontrado")
    repo = (await db.execute(select(GitRepo).where(GitRepo.guid == guid))).scalar_one_or_none()
    # Nº de versões do mesmo caminho (para a UI oferecer o seletor de versões).
    versions_count = (await db.execute(
        select(func.count()).select_from(GitRepoFile).where(
            GitRepoFile.repo_id == f.repo_id, GitRepoFile.rel_path == f.rel_path
        )
    )).scalar() or 1
    html_url = repo.html_url if repo else None
    commit_url = f"{html_url}/commit/{f.commit_hash}" if (html_url and f.commit_hash) else None

    # Para arquivos REMOVIDOS (change_type 'D'), o arquivo não existe na árvore
    # deste commit — ele existia no commit ANTERIOR (pai). Resolvemos o pai para
    # a UI poder abrir a árvore onde o arquivo ainda estava presente.
    parent_commit = None
    parent_short = None
    if f.change_type == "D" and f.commit_hash and repo:
        try:
            from git_clone_worker import GITCLONES_BASE
            clone_dir = os.path.join(GITCLONES_BASE, repo.guid)
            if os.path.isdir(os.path.join(clone_dir, ".git")):
                out = await _git_output(clone_dir, ["rev-parse", "--verify", "-q", f"{f.commit_hash}^"])
                parent_commit = out.decode("utf-8", "replace").strip() or None
                parent_short = parent_commit[:7] if parent_commit else None
        except Exception:  # noqa: BLE001
            parent_commit = None

    return {
        "id": f.id, "rel_path": f.rel_path, "name": f.name, "extension": f.extension,
        "size": f.size, "mimetype": f.mimetype, "is_binary": f.is_binary,
        "sha1": f.sha1, "indexed": f.indexed,
        "content_extracted": f.content_extracted, "content_error": f.content_error,
        "content": f.content,
        # Versionamento por commit
        "is_head": bool(f.is_head), "blob_sha": f.blob_sha,
        "commit_hash": f.commit_hash, "commit_short": f.commit_short,
        "branch": f.branch, "author": f.author, "author_email": f.author_email,
        "commit_date": f.commit_date.isoformat() if f.commit_date else None,
        "change_type": f.change_type, "versions_count": versions_count,
        "commit_url": commit_url,
        "parent_commit": parent_commit, "parent_short": parent_short,
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
# Request Clone: clonar uma URL arbitrária (qualquer host) sob demanda
# --------------------------------------------------------------------------
def _normalize_repo_url(raw: str) -> Dict[str, Optional[str]]:
    """Normaliza uma URL de git (https ou scp-like git@host:owner/repo) e extrai
    host / full_name (owner/.../repo) / owner / name."""
    import re as _re
    url = (raw or "").strip()
    if not url:
        raise HTTPException(status_code=400, detail="URL é obrigatória")

    host = None
    path = None
    # scp-like: git@github.com:owner/repo.git
    m = _re.match(r"^[\w.-]+@([\w.-]+):(.+)$", url)
    if m:
        host = m.group(1)
        path = m.group(2)
        url = f"https://{host}/{path}"
    else:
        from urllib.parse import urlparse
        p = urlparse(url)
        if not p.scheme:
            url = "https://" + url
            p = urlparse(url)
        if p.scheme not in ("https", "http"):
            raise HTTPException(status_code=400, detail="Apenas URLs http(s) ou git@host:path são suportadas")
        host = p.hostname
        path = (p.path or "").lstrip("/")

    if not host or not path:
        raise HTTPException(status_code=400, detail="URL de repositório inválida")
    path = path[:-4] if path.endswith(".git") else path
    path = path.strip("/")
    full_name = path
    segs = [s for s in path.split("/") if s]
    owner = segs[0] if segs else None
    name = segs[-1] if segs else None
    clone_url = url if url.endswith(".git") else f"{url.rstrip('/')}.git"
    return {"host": host, "full_name": full_name, "owner": owner, "name": name,
            "clone_url": clone_url, "html_url": f"https://{host}/{full_name}"}


def _derive_full_name(url: str) -> Dict[str, Optional[str]]:
    """Deriva host/full_name de uma URL QUALQUER (mesmo que não seja um repo git),
    para uso no modo dump (.git exposto). Nunca levanta exceção."""
    from urllib.parse import urlparse
    u = (url or "").strip()
    if not u.startswith("http://") and not u.startswith("https://"):
        u = "https://" + u
    p = urlparse(u)
    host = p.hostname or "site"
    path = (p.path or "").strip("/")
    if path.endswith(".git"):
        path = path[:-4]
    path = path.strip("/")
    full_name = f"{host}/{path}" if path else host
    segs = [s for s in path.split("/") if s]
    return {"host": host, "full_name": full_name,
            "owner": host, "name": segs[-1] if segs else host,
            "clone_url": u.rstrip("/"), "html_url": u.rstrip("/")}


async def _git_ls_remote(clone_url: str, token: Optional[str], proxy_url: Optional[str] = None) -> Dict[str, Any]:
    """Testa acesso via `git ls-remote --symref`. Retorna {ok, default_branch, ref_count, error}."""
    import asyncio as _asyncio
    from git_clone_worker import _inject_token

    url = _inject_token(clone_url, token) if token else clone_url
    # Ignora falhas de certificado (mesmo critério do clone).
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "GIT_ASKPASS": "/bin/true",
           "GIT_SSL_NO_VERIFY": "true"}
    if proxy_url:
        env["HTTP_PROXY"] = proxy_url
        env["HTTPS_PROXY"] = proxy_url
        env["ALL_PROXY"] = proxy_url
    try:
        proc = await _asyncio.create_subprocess_exec(
            "git", "ls-remote", "--symref", url, "HEAD",
            stdout=_asyncio.subprocess.PIPE, stderr=_asyncio.subprocess.PIPE, env=env,
        )
        out, err = await _asyncio.wait_for(proc.communicate(), timeout=30)
    except _asyncio.TimeoutError:
        return {"ok": False, "error": "timeout ao contactar o repositório (30s)"}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)[:300]}

    if proc.returncode != 0:
        msg = (err.decode("utf-8", "replace") if err else "").strip()
        if token:
            msg = msg.replace(url, clone_url)  # mascara o token
        return {"ok": False, "error": msg or f"git ls-remote falhou ({proc.returncode})"}

    text = out.decode("utf-8", "replace")
    default_branch = None
    ref_count = 0
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("ref:"):
            # ex.: "ref: refs/heads/main\tHEAD"
            try:
                ref = line.split()[1]
                default_branch = ref.rsplit("/", 1)[-1]
            except Exception:  # noqa: BLE001
                pass
        elif line:
            ref_count += 1
    return {"ok": True, "default_branch": default_branch, "ref_count": ref_count, "error": None}


@router.post("/clone/test-access")
async def clone_test_access(req: CloneUrlRequest, db=Depends(get_db_readonly)):
    """Valida se a URL informada é acessível. Se não for um remote git normal (ou a
    URL nem for um repo válido), tenta detectar um .git EXPOSTO na web (probe de
    /.git/HEAD) para reconstruir via dump."""
    token = None
    if req.clone_auth == "authenticated":
        if not req.credential_id:
            raise HTTPException(status_code=400, detail="Token é obrigatório para clone autenticado")
        token = await _get_token(db, req.credential_id)
    proxy_url = await resolve_proxy_url(db, req.proxy_id)

    # A URL pode nem ser um repo git válido (ex.: site inteiro) — não falhar aqui.
    info = None
    try:
        info = _normalize_repo_url(req.repo_url)
    except HTTPException:
        info = None

    result = None
    if info:
        result = await _git_ls_remote(info["clone_url"], token, proxy_url)

    mode = "clone"
    if not info or not (result and result.get("ok")):
        # Probe de .git exposto na URL ORIGINAL.
        try:
            import git_dumper
            probe = await git_dumper.probe_exposed_git(req.repo_url, proxy_url)
        except Exception as e:  # noqa: BLE001
            logger.warning(f"[git] probe .git falhou: {e}")
            probe = {"exposed": False}
        if probe.get("exposed"):
            mode = "dump"
            result = {
                "ok": True, "mode": "dump",
                "git_url": probe.get("git_url"), "head": probe.get("head"),
                "default_branch": None, "ref_count": None, "error": None,
            }
        elif not info:
            # Nem repo válido nem .git exposto.
            result = {"ok": False, "error": "URL de repositório inválida e nenhum .git exposto encontrado"}

    repo_info = info or _derive_full_name(req.repo_url)
    return {**result, "mode": mode,
            "repo": {"full_name": repo_info["full_name"], "host": repo_info["host"],
                     "clone_url": repo_info["clone_url"]}}


@router.post("/clone/enqueue-url")
async def clone_enqueue_url(req: CloneEnqueueUrlRequest, db=Depends(get_db)):
    """Enfileira o clone de uma URL arbitrária com PRIORIDADE ALTA (fura a fila)."""
    is_dump = (req.clone_mode or "clone") == "dump"
    try:
        info = _normalize_repo_url(req.repo_url)
    except HTTPException:
        if not is_dump:
            raise
        info = _derive_full_name(req.repo_url)  # modo dump: aceita qualquer URL
    if req.clone_auth == "authenticated":
        if not req.credential_id:
            raise HTTPException(status_code=400, detail="Token é obrigatório para clone autenticado")
        await _get_token(db, req.credential_id)  # valida

    # Prioridade: acima do maior valor pendente/em execução atual.
    max_prio = (await db.execute(
        select(func.max(GitCloneJob.priority)).where(
            GitCloneJob.status.in_(["pending", "cloning", "cloned", "processing"])
        )
    )).scalar()
    priority = (max_prio or 0) + 1

    # Modo dump: usa a URL ORIGINAL do site (o dumper acrescenta o /.git/).
    effective_url = req.repo_url.strip() if is_dump else info["clone_url"]

    # Repo (cria/atualiza por full_name)
    repo = (await db.execute(
        select(GitRepo).where(GitRepo.full_name == info["full_name"])
    )).scalar_one_or_none()
    if not repo:
        repo = GitRepo(full_name=info["full_name"])
        db.add(repo)
    repo.owner = info["owner"]
    repo.name = info["name"]
    repo.clone_url = effective_url
    repo.html_url = info["html_url"]
    repo.source = ("git-dump" if is_dump else
                  ("github" if "github" in (info["host"] or "") else (info["host"] or "git")))
    repo.discovered_via = "request-clone"
    if repo.clone_status not in ("cloning",):
        repo.clone_status = "pending"
    await db.flush()

    # Evita job ativo duplicado para o mesmo repo
    active = (await db.execute(
        select(GitCloneJob.id).where(
            GitCloneJob.repo_id == repo.id,
            GitCloneJob.status.in_(["pending", "cloning", "cloned", "processing"]),
        )
    )).scalar()
    if active:
        # Reprioriza o job existente em vez de duplicar.
        await db.execute(
            update(GitCloneJob).where(GitCloneJob.id == active).values(priority=priority)
        )
        await db.commit()
        return {"queued": False, "reprioritized": True, "job_id": active,
                "priority": priority, "repo_guid": repo.guid}

    job = GitCloneJob(
        repo_id=repo.id,
        repo_url=effective_url,
        repo_full_name=info["full_name"],
        clone_auth=req.clone_auth,
        credential_id=req.credential_id if req.clone_auth == "authenticated" else None,
        depth=req.depth,
        proxy_id=req.proxy_id,
        clone_mode="dump" if is_dump else "clone",
        status="pending",
        priority=priority,
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)
    return {"queued": True, "job_id": job.id, "priority": priority,
            "repo_guid": repo.guid, "mode": job.clone_mode}


@router.post("/repos/{guid}/reindex")
async def reindex_repo(guid: str, db=Depends(get_db)):
    """Reprocessa um repositório já clonado para (re)indexar o histórico de commits.

    Se o clone completo ainda existe em disco, reenfileira apenas o pós-processamento
    (status 'cloned'); caso contrário, reenfileira o clone completo (status 'pending').
    Em ambos os casos com prioridade alta.
    """
    repo = (await db.execute(select(GitRepo).where(GitRepo.guid == guid))).scalar_one_or_none()
    if not repo:
        raise HTTPException(status_code=404, detail="Repositório não encontrado")

    from git_clone_worker import GITCLONES_BASE
    clone_dir = os.path.join(GITCLONES_BASE, repo.guid)
    has_full_clone = os.path.isdir(os.path.join(clone_dir, ".git")) and not os.path.exists(
        os.path.join(clone_dir, ".git", "shallow")
    )

    max_prio = (await db.execute(
        select(func.max(GitCloneJob.priority)).where(
            GitCloneJob.status.in_(["pending", "cloning", "cloned", "processing"])
        )
    )).scalar()
    priority = (max_prio or 0) + 1

    # Cancela jobs ativos antigos deste repo para não concorrer.
    await db.execute(
        update(GitCloneJob)
        .where(GitCloneJob.repo_id == repo.id, GitCloneJob.status.in_(["pending", "cloned"]))
        .values(status="cancelled")
    )

    status = "cloned" if has_full_clone else "pending"
    job = GitCloneJob(
        repo_id=repo.id,
        repo_url=repo.clone_url or f"https://github.com/{repo.full_name}.git",
        repo_full_name=repo.full_name,
        clone_auth="anonymous",
        status=status,
        priority=priority,
        current_step="queued" if has_full_clone else None,
    )
    db.add(job)
    if not has_full_clone:
        repo.clone_status = "pending"
    await db.commit()
    await db.refresh(job)
    return {"job_id": job.id, "mode": "postprocess" if has_full_clone else "reclone",
            "priority": priority}


# --------------------------------------------------------------------------
# CI/CD por repositório: Secrets e Pipelines
# --------------------------------------------------------------------------
def _secret_dict(s: GitProjectSecret) -> Dict[str, Any]:
    return {
        "guid": s.guid, "name": s.name, "value": s.value, "value_exposed": s.value_exposed,
        "scope": s.scope, "protected": s.is_protected, "masked": s.is_masked,
        "is_jwt": s.is_jwt, "decoded_claims": s.decoded_claims,
        "obtained_with": s.obtained_with, "platform": s.platform,
        "created_at": s.created_at.isoformat() if s.created_at else None,
    }


@router.get("/repos/{guid}/secrets")
async def list_repo_secrets(guid: str, db=Depends(get_db_readonly)):
    """Secrets/variáveis de CI coletados do repositório + nota da última coleta."""
    repo = (await db.execute(select(GitRepo).where(GitRepo.guid == guid))).scalar_one_or_none()
    if not repo:
        raise HTTPException(status_code=404, detail="Repositório não encontrado")
    rows = (await db.execute(
        select(GitProjectSecret).where(GitProjectSecret.repo_id == repo.id)
        .order_by(GitProjectSecret.name)
    )).scalars().all()
    exposes = any(bool(r.value_exposed) for r in rows)
    return {
        "total": len(rows),
        "note": repo.ci_secrets_note,
        "exposes_values": exposes,
        "last_job": await _last_ci_job(db, repo.id, "secrets"),
        "secrets": [_secret_dict(r) for r in rows],
    }


async def _last_ci_job(db, repo_id: int, task_type: str) -> Optional[Dict[str, Any]]:
    """Resumo do último job de CI (p/ a UI explicar o estado da coleta)."""
    j = (await db.execute(
        select(GitCloneJob).where(GitCloneJob.repo_id == repo_id,
                                  GitCloneJob.task_type == task_type)
        .order_by(GitCloneJob.created_at.desc()).limit(1)
    )).scalar_one_or_none()
    if not j:
        return None
    # Em andamento quando ainda na fila/execução.
    running = j.status in ("pending", "cloning", "processing")
    return {
        "status": j.status,
        "running": running,
        "error": j.error_message,
        "created_at": j.created_at.isoformat() if j.created_at else None,
        "completed_at": j.completed_at.isoformat() if j.completed_at else None,
    }


@router.get("/repos/{guid}/pipeline-files")
async def list_repo_pipeline_files(guid: str, db=Depends(get_db_readonly)):
    """Logs/outputs de pipelines coletados (armazenados como arquivos indexados)."""
    repo = (await db.execute(select(GitRepo).where(GitRepo.guid == guid))).scalar_one_or_none()
    if not repo:
        raise HTTPException(status_code=404, detail="Repositório não encontrado")
    rows = (await db.execute(
        select(GitRepoFile).where(GitRepoFile.repo_id == repo.id, GitRepoFile.source == "pipeline")
        .order_by(GitRepoFile.rel_path)
    )).scalars().all()
    return {
        "total": len(rows),
        "note": repo.ci_pipelines_note,
        "last_job": await _last_ci_job(db, repo.id, "pipelines"),
        "files": [{
            "id": f.id, "rel_path": f.rel_path, "name": f.name, "size": f.size,
            "pipeline_ref": f.pipeline_ref, "status": f.branch,
            "indexed": f.indexed, "created_at": f.created_at.isoformat() if f.created_at else None,
        } for f in rows],
    }


class _CollectRequest(BaseModel):
    task: str = "secrets"          # secrets | pipelines
    limit: Optional[int] = None    # pipelines: lote
    more: bool = False             # pipelines: "baixar mais" (offset = já coletados)


@router.post("/repos/{guid}/collect")
async def collect_repo_ci(guid: str, req: _CollectRequest, db=Depends(get_db)):
    """Enfileira a coleta de CI (secrets/pipelines) para ESTE repositório, usando a
    instância/credencial com que ele foi descoberto (via o último job)."""
    repo = (await db.execute(select(GitRepo).where(GitRepo.guid == guid))).scalar_one_or_none()
    if not repo:
        raise HTTPException(status_code=404, detail="Repositório não encontrado")
    task = req.task if req.task in ("secrets", "pipelines") else "secrets"

    # Instância de origem: pega do job mais recente com instance_id.
    last = (await db.execute(
        select(GitCloneJob).where(GitCloneJob.repo_id == repo.id,
                                  GitCloneJob.instance_id.isnot(None))
        .order_by(GitCloneJob.created_at.desc()).limit(1)
    )).scalar_one_or_none()
    inst = None
    if last and last.instance_id:
        inst = (await db.execute(
            select(GitInstance).where(GitInstance.id == last.instance_id))).scalar_one_or_none()
    if not inst:
        raise HTTPException(status_code=400,
                            detail="Sem instância de origem para este repo — colete pela tela da instância.")

    # Evita duplicar job ativo da mesma tarefa.
    active = (await db.execute(
        select(GitCloneJob.id).where(GitCloneJob.repo_id == repo.id,
                                     GitCloneJob.task_type == task,
                                     GitCloneJob.status.in_(["pending", "cloning", "processing"]))
    )).scalar()
    if active:
        return {"queued": False, "reason": "já há uma coleta em andamento"}

    # "baixar mais": pula os PIPELINES já coletados (não os arquivos/steps).
    offset = (repo.pipelines_count or 0) if (task == "pipelines" and req.more) else 0
    cred_id = inst.credential_id if inst.clone_auth == "authenticated" else None
    # Coleta acionada manualmente neste repo -> prioridade alta (fura a fila de
    # clones em massa, que costuma ter centenas pendentes).
    max_prio = (await db.execute(
        select(func.max(GitCloneJob.priority)).where(
            GitCloneJob.status.in_(["pending", "cloning", "cloned", "processing"]))
    )).scalar()
    priority = (max_prio or 0) + 1
    job = GitCloneJob(
        repo_id=repo.id, repo_url=repo.clone_url or repo.html_url or repo.full_name,
        repo_full_name=repo.full_name, clone_auth=inst.clone_auth,
        credential_id=cred_id, proxy_id=inst.proxy_id, status="pending",
        task_type=task, task_limit=req.limit, task_offset=offset, instance_id=inst.id,
        priority=priority,
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)
    return {"queued": True, "job_id": job.id, "task": task, "offset": offset}


@router.post("/repos/reindex-all")
async def reindex_all_repos(db=Depends(get_db)):
    """Reprocessa/reindexa TODOS os repositórios já clonados.

    - Repo com clone completo em disco -> reprocessa (gitleaks + extração + index),
      sem re-clonar (status 'cloned').
    - Repo sem clone em disco, mas que já foi clonado antes (cloned_at) -> re-clona
      (status 'pending').
    - Repo nunca clonado -> ignorado.
    Tudo com prioridade acima da fila atual.
    """
    from git_clone_worker import GITCLONES_BASE

    repos = (await db.execute(select(GitRepo))).scalars().all()
    max_prio = (await db.execute(
        select(func.max(GitCloneJob.priority)).where(
            GitCloneJob.status.in_(["pending", "cloning", "cloned", "processing"])
        )
    )).scalar()
    priority = (max_prio or 0) + 1

    # Cancela os jobs ativos ainda não iniciados (pending/cloned) para não concorrer.
    await db.execute(
        update(GitCloneJob)
        .where(GitCloneJob.status.in_(["pending", "cloned"]))
        .values(status="cancelled")
    )

    postprocess = 0
    reclone = 0
    skipped = 0
    for repo in repos:
        clone_dir = os.path.join(GITCLONES_BASE, repo.guid)
        has_full = os.path.isdir(os.path.join(clone_dir, ".git")) and not os.path.exists(
            os.path.join(clone_dir, ".git", "shallow")
        )
        if has_full:
            status, step = "cloned", "queued"
            postprocess += 1
        elif repo.cloned_at is not None:
            status, step = "pending", None
            repo.clone_status = "pending"
            reclone += 1
        else:
            skipped += 1
            continue
        db.add(GitCloneJob(
            repo_id=repo.id,
            repo_url=repo.clone_url or f"https://github.com/{repo.full_name}.git",
            repo_full_name=repo.full_name,
            clone_auth="anonymous",
            status=status,
            priority=priority,
            current_step=step,
        ))

    await db.commit()
    return {
        "total": len(repos),
        "postprocess": postprocess,
        "reclone": reclone,
        "skipped": skipped,
        "priority": priority,
    }


async def _next_queue_priority(db) -> int:
    """Prioridade acima de toda a fila ativa."""
    max_prio = (await db.execute(
        select(func.max(GitCloneJob.priority)).where(
            GitCloneJob.status.in_(["pending", "cloning", "cloned", "processing"])
        )
    )).scalar()
    return (max_prio or 0) + 1


async def _enqueue_repo_retry(db, repo, priority: int):
    """Reenfileira o clone de um repositório (p/ 'tentar novamente' após falha),
    PRESERVANDO o modo de clone (clone/dump), o proxy e o auth do último job — caso
    contrário um repo de Git Dump seria re-tentado como clone normal e falharia."""
    last = (await db.execute(
        select(GitCloneJob)
        .where(GitCloneJob.repo_id == repo.id)
        .order_by(GitCloneJob.created_at.desc())
        .limit(1)
    )).scalar_one_or_none()
    clone_mode = (last.clone_mode if last and last.clone_mode else "clone")
    proxy_id = last.proxy_id if last else None
    clone_auth = (last.clone_auth if last and last.clone_auth else "anonymous")

    # Cancela jobs ativos ainda não iniciados deste repo para não concorrer.
    await db.execute(
        update(GitCloneJob)
        .where(GitCloneJob.repo_id == repo.id, GitCloneJob.status.in_(["pending", "cloned"]))
        .values(status="cancelled")
    )

    repo_url = repo.clone_url or (last.repo_url if last else None) \
        or f"https://github.com/{repo.full_name}.git"
    job = GitCloneJob(
        repo_id=repo.id,
        repo_url=repo_url,
        repo_full_name=repo.full_name,
        clone_auth=clone_auth,
        proxy_id=proxy_id,
        clone_mode=clone_mode,
        status="pending",
        priority=priority,
    )
    db.add(job)
    repo.clone_status = "pending"
    return job


@router.post("/repos/{guid}/retry")
async def retry_repo(guid: str, db=Depends(get_db)):
    """Tenta clonar novamente um repositório (tipicamente após falha). Reenfileira
    o clone com prioridade alta, preservando modo (clone/dump), proxy e auth."""
    repo = (await db.execute(select(GitRepo).where(GitRepo.guid == guid))).scalar_one_or_none()
    if not repo:
        raise HTTPException(status_code=404, detail="Repositório não encontrado")
    priority = await _next_queue_priority(db)
    job = await _enqueue_repo_retry(db, repo, priority)
    await db.commit()
    await db.refresh(job)
    return {"job_id": job.id, "clone_mode": job.clone_mode, "priority": priority}


@router.post("/repos/retry-failed")
async def retry_failed_repos(db=Depends(get_db)):
    """Reenfileira o clone de TODOS os repositórios com status de falha."""
    repos = (await db.execute(
        select(GitRepo).where(GitRepo.clone_status == "failed")
    )).scalars().all()
    if not repos:
        return {"retried": 0}
    priority = await _next_queue_priority(db)
    for repo in repos:
        await _enqueue_repo_retry(db, repo, priority)
    await db.commit()
    return {"retried": len(repos), "priority": priority}


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
    # Ordena EXATAMENTE na ordem de processamento das duas filas:
    #   rank de status (cloning -> pending -> cloned -> processing -> terminais),
    #   depois priority desc, pushed_at desc (mais novo), size_kb asc (menor), created asc.
    status_rank = case(
        (GitCloneJob.status == "cloning", 0),
        (GitCloneJob.status == "pending", 1),
        (GitCloneJob.status == "cloned", 2),
        (GitCloneJob.status == "processing", 3),
        else_=4,
    )
    stmt = select(GitCloneJob).outerjoin(GitRepo, GitRepo.id == GitCloneJob.repo_id)
    if status:
        stmt = stmt.where(GitCloneJob.status == status)
    stmt = stmt.order_by(
        status_rank.asc(),
        GitCloneJob.priority.desc(),
        nullslast(GitRepo.pushed_at.desc()),
        nullslast(GitRepo.size_kb.asc()),
        GitCloneJob.created_at.asc(),
    ).limit(limit).offset(offset)
    jobs = (await db.execute(stmt)).scalars().all()
    return {"jobs": [_job_dict(j) for j in jobs]}


@router.get("/jobs/stats")
async def jobs_stats(db=Depends(get_db_readonly)):
    stats = {}
    for st in ["pending", "cloning", "cloned", "processing", "completed", "failed", "cancelled"]:
        c = (await db.execute(
            select(func.count(GitCloneJob.id)).where(GitCloneJob.status == st)
        )).scalar() or 0
        stats[st] = c
    stats["total"] = sum(stats.values())
    # "cloned" = TODOS os repositórios clonados com sucesso, independente de já
    # terem sido processados (inclui os que estão em pós-processamento e os
    # concluídos). O card CLONADO mostra o acumulado da fase de clone.
    stats["cloned"] = stats["cloned"] + stats["processing"] + stats["completed"]
    return stats


@router.post("/jobs/{job_id}/cancel")
async def cancel_job(job_id: int, db=Depends(get_db)):
    job = (await db.execute(select(GitCloneJob).where(GitCloneJob.id == job_id))).scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job não encontrado")
    # Não-terminais (inclui as duas filas e seus estados de execução). O worker
    # checa _is_cancelled e aborta o que estiver rodando.
    if job.status in ("pending", "cloning", "cloned", "processing"):
        job.status = "cancelled"
        job.completed_at = datetime.now(timezone.utc)
        await db.commit()
    return {"success": True, "status": job.status}


@router.post("/jobs/cancel-all")
async def cancel_all_jobs(db=Depends(get_db)):
    # Cancela os que ainda não estão rodando: aguardando clone (pending) e
    # aguardando pós-processamento (cloned).
    jobs = (await db.execute(
        select(GitCloneJob).where(GitCloneJob.status.in_(["pending", "cloned"]))
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
