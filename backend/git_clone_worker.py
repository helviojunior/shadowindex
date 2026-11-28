"""
Git Clone Worker - clones queued GitHub repositories in background and runs the
post-download pipeline on each: GitLeaks -> content extraction (plain/OCR) ->
indexing into OpenSearch.

Follows the same DB-polled asyncio singleton pattern as share_scan_worker.py.
"""
import os
import re
import time
import json
import shutil
import hashlib
import asyncio
import logging
import tempfile
import mimetypes
import traceback
from datetime import datetime, timezone
from typing import Optional, Dict, List, Tuple

from sqlalchemy import select, update, delete, func, nullslast

logger = logging.getLogger(__name__)

# Base de armazenamento dos clones (dentro do bind-mount /app/data)
GITCLONES_BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "gitclones")
os.makedirs(GITCLONES_BASE, exist_ok=True)

# Config do GitLeaks (reaproveita os caminhos do serviço existente)
from leaks_service import GITLEAKS_CONFIG_PATH, GITLEAKS_OUTPUT_DIR  # noqa: E402

OCR_DOC_EXTS = {
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
    ".rtf", ".odt", ".ods", ".odp",
}
# Extensões claramente binárias que nunca indexamos como texto
SKIP_BINARY_EXTS = {
    ".png", ".jpg", ".jpeg", ".gif", ".ico", ".webp", ".bmp", ".tiff", ".svg",
    ".mp4", ".avi", ".mkv", ".mov", ".mp3", ".wav", ".flac", ".ogg",
    ".zip", ".rar", ".7z", ".tar", ".gz", ".tgz", ".bz2", ".xz", ".jar", ".war",
    ".exe", ".dll", ".so", ".dylib", ".a", ".o", ".obj", ".bin", ".class", ".pyc",
    ".woff", ".woff2", ".ttf", ".otf", ".eot", ".psd", ".iso",
}
OCR_MAX_BYTES = 25 * 1024 * 1024  # 25MB cap p/ docs enviados ao Tika

# Watchdog: periodicamente reconcilia os jobs marcados 'running' no DB com as
# tasks realmente vivas no worker. Jobs 'running' sem task viva (reboot/crash) ou
# presos além do tempo máximo são reenfileirados ('pending') para não travar a fila.
WATCHDOG_INTERVAL = 30          # segundos entre verificações (NÃO é um timeout)
MAX_JOB_SECONDS_DEFAULT = 7200  # backstop absoluto (2h) — setting: git_clone_job_timeout_min (0 desativa)
STALL_SECONDS_DEFAULT = 600     # sem progresso (bytes/arquivos) por este tempo => travado (setting: git_clone_stall_min)


def _inject_token(url: str, token: str) -> str:
    """Injeta um token numa URL https de clone, de forma host-aware.
    GitHub usa x-access-token, GitLab usa oauth2, demais hosts usam o token como
    usuário. URLs não-https são retornadas inalteradas."""
    if not token:
        return url
    try:
        from urllib.parse import urlparse, urlunparse
        p = urlparse(url)
        if p.scheme != "https" or not p.hostname:
            return url
        host = p.hostname.lower()
        if "github" in host:
            userinfo = f"x-access-token:{token}"
        elif "gitlab" in host:
            userinfo = f"oauth2:{token}"
        else:
            userinfo = token
        netloc = f"{userinfo}@{p.hostname}" + (f":{p.port}" if p.port else "")
        return urlunparse((p.scheme, netloc, p.path, p.params, p.query, p.fragment))
    except Exception:  # noqa: BLE001
        return url


def _parse_leak_date(s) -> Optional[datetime]:
    """Converte a data ISO8601 do gitleaks (ex.: '2021-01-01T00:00:00Z') em datetime."""
    if not s:
        return None
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except Exception:  # noqa: BLE001
        return None


def _dir_size(path: str) -> int:
    """Soma o tamanho dos arquivos sob `path` (bytes). Usado p/ medir progresso do clone."""
    total = 0
    try:
        for root, _dirs, files in os.walk(path):
            for f in files:
                try:
                    total += os.path.getsize(os.path.join(root, f))
                except OSError:
                    pass
    except Exception:  # noqa: BLE001
        pass
    return total

_git_clone_worker: Optional["GitCloneWorker"] = None


class GitCloneWorker:
    def __init__(self):
        self.running = False
        # Duas filas independentes: CLONE (rede) e PÓS-PROCESSAMENTO (gitleaks/
        # extração/indexação, CPU/disco). Cada uma com seu loop, concorrência,
        # conjunto de tasks vivas, boot-reset e watchdog de progresso.
        self._clone_task: Optional[asyncio.Task] = None
        self._post_task: Optional[asyncio.Task] = None
        self._supervisor_task: Optional[asyncio.Task] = None
        self._active_clone: Dict[int, dict] = {}   # jobs clonando
        self._active_post: Dict[int, dict] = {}    # jobs em pós-processamento
        self._last_watchdog_clone: float = 0.0
        self._last_watchdog_post: float = 0.0

    async def start(self):
        if self.running:
            return
        self.running = True
        self._active_clone.clear()
        self._active_post.clear()
        self._last_watchdog_clone = 0.0
        self._last_watchdog_post = 0.0
        self._clone_task = asyncio.create_task(self._run_loop("clone"))
        self._post_task = asyncio.create_task(self._run_loop("post"))
        self._supervisor_task = asyncio.create_task(self._supervise())
        logger.info("Git clone worker started (filas: clone + pos-processamento + supervisor)")

    async def stop(self):
        self.running = False
        for t in (self._clone_task, self._post_task, self._supervisor_task):
            if t:
                t.cancel()
                try:
                    await t
                except asyncio.CancelledError:
                    pass
        logger.info("Git clone worker stopped")

    async def _supervise(self):
        """Reinicia loops que morreram (ex.: exceção não tratada) enquanto o worker
        está ativo. Sem isso, se o loop de pós-processamento cair, jobs ficam presos
        em 'processing'/'cloned' para sempre."""
        while self.running:
            await asyncio.sleep(15)
            try:
                if self.running and self._clone_task and self._clone_task.done():
                    exc = self._clone_task.exception() if not self._clone_task.cancelled() else None
                    logger.error(f"[git supervisor] loop CLONE morreu ({exc}); reiniciando")
                    self._clone_task = asyncio.create_task(self._run_loop("clone"))
                if self.running and self._post_task and self._post_task.done():
                    exc = self._post_task.exception() if not self._post_task.cancelled() else None
                    logger.error(f"[git supervisor] loop POST morreu ({exc}); reiniciando")
                    self._post_task = asyncio.create_task(self._run_loop("post"))
            except Exception as e:  # noqa: BLE001
                logger.error(f"[git supervisor] erro: {e}")

    # ------------------------------------------------------------------
    # Configuração por fase (clone x pós-processamento)
    # ------------------------------------------------------------------
    def _phase_cfg(self, phase: str) -> dict:
        if phase == "clone":
            return {
                "pick_status": "pending",     # fila: aguardando clone
                "running_status": "cloning",  # em clone
                "requeue_status": "pending",  # volta p/ cá se travar/reiniciar
                "active": self._active_clone,
                "last_wd_attr": "_last_watchdog_clone",
                "concurrency": self._get_clone_concurrency,
                "executor": self._execute_clone,
            }
        return {
            "pick_status": "cloned",          # fila: clonado, aguardando pós
            "running_status": "processing",   # em pós-processamento
            "requeue_status": "cloned",       # volta p/ cá se travar/reiniciar
            "active": self._active_post,
            "last_wd_attr": "_last_watchdog_post",
            "concurrency": self._get_post_concurrency,
            "executor": self._execute_postprocess,
        }

    async def _run_loop(self, phase: str):
        from database import AsyncSessionLocal, GitCloneJob
        from sqlalchemy.exc import OperationalError

        cfg = self._phase_cfg(phase)

        # Reconciliação de boot (AMBAS as fases): jobs 'em execução' sem task viva
        # voltam p/ a fila. Respeita as tasks vivas (active sets), então é seguro
        # também quando o supervisor reinicia um loop com tasks ainda rodando.
        try:
            async with AsyncSessionLocal() as db:
                await self._reconcile_all_phases(db)
        except Exception as e:  # noqa: BLE001
            logger.error(f"[git {phase}] erro no reset de boot: {e}")

        while self.running:
            try:
                async with AsyncSessionLocal() as db:
                    now = time.monotonic()
                    last = getattr(self, cfg["last_wd_attr"])
                    if now - last >= WATCHDOG_INTERVAL:
                        await self._watchdog(db, phase)
                        setattr(self, cfg["last_wd_attr"], time.monotonic())
                    await self._process(db, phase)
            except OperationalError as e:
                if "database is locked" in str(e):
                    await asyncio.sleep(5)
                else:
                    logger.error(f"[git {phase}] erro de banco: {e}")
            except Exception as e:  # noqa: BLE001
                logger.error(f"[git {phase}] erro no loop: {e}")
            await asyncio.sleep(3)

    async def _watchdog(self, db, phase: str):
        """Reconcilia os jobs 'em andamento' desta fase com as tasks vivas.

        - Jobs no status de execução sem task viva (reboot/crash) voltam p/ a fila.
        - Jobs vivos SEM progresso (bytes do clone / nº de GitRepoFile sem crescer)
          por `git_clone_stall_min` são considerados travados: cancela e reenfileira.
        - Backstop absoluto `git_clone_job_timeout_min` como última rede.
        Cada fase só mexe no SEU status (nunca na outra fila).
        """
        from database import GitCloneJob, GitRepoFile

        cfg = self._phase_cfg(phase)
        active = cfg["active"]

        # Reconciliação CROSS-FASE: libera órfãos de clone E de pós-processamento,
        # independentemente de qual loop está rodando o watchdog. Assim, mesmo que o
        # loop de pós-processamento morra, o loop de clone (vivo) libera os
        # 'processing' presos (e o supervisor reinicia o loop morto p/ reprocessá-los).
        await self._reconcile_all_phases(db)

        max_seconds = await self._get_job_timeout_seconds(db)   # backstop (0 = off)
        stall_seconds = await self._get_stall_seconds(db)       # janela sem progresso (0 = off)
        now = time.monotonic()
        for jid, info in list(active.items()):
            clone_dir = info.get("clone_dir")
            repo_id = info.get("repo_id")
            reason = None

            if stall_seconds > 0 and clone_dir and repo_id is not None:
                fcount = (await db.execute(
                    select(func.count(GitRepoFile.id)).where(GitRepoFile.repo_id == repo_id)
                )).scalar() or 0
                prev = info.get("progress")  # (dir_bytes, file_count)
                progressed = False
                if prev is None:
                    dbytes = await asyncio.to_thread(_dir_size, clone_dir)
                    info["progress"] = (dbytes, fcount)
                    info["progress_ts"] = now
                    progressed = True
                elif fcount > prev[1]:
                    info["progress"] = (prev[0], fcount)
                    info["progress_ts"] = now
                    progressed = True
                else:
                    dbytes = await asyncio.to_thread(_dir_size, clone_dir)
                    if dbytes > prev[0]:
                        info["progress"] = (dbytes, fcount)
                        info["progress_ts"] = now
                        progressed = True
                if not progressed and (now - info.get("progress_ts", info["since"])) > stall_seconds:
                    reason = f"sem progresso há {stall_seconds // 60}min"

            if reason is None and max_seconds > 0 and (now - info["since"]) > max_seconds:
                reason = f"excedeu {max_seconds // 60}min (backstop)"

            if reason is None:
                continue

            task = info.get("task")
            if task and not task.done():
                task.cancel()
            active.pop(jid, None)
            try:
                await db.execute(
                    update(GitCloneJob)
                    .where(GitCloneJob.id == jid, GitCloneJob.status == cfg["running_status"])
                    .values(status=cfg["requeue_status"], started_at=None, current_step=None)
                )
                await db.commit()
            except Exception:  # noqa: BLE001
                pass
            logger.warning(
                f"[git {phase} watchdog] job {jid} travado ({reason}); "
                f"cancelado e reenfileirado p/ '{cfg['requeue_status']}'"
            )

    async def _reconcile_all_phases(self, db) -> int:
        """Reconcilia AMBAS as fases de uma vez: jobs em 'cloning'/'processing' que
        não têm uma task viva (reboot/crash, ou loop da fase morto) voltam p/ a fila
        ('pending'/'cloned'). Respeita as tasks vivas (active sets) para não mexer em
        jobs que estão realmente em execução."""
        from database import GitCloneJob

        total = 0
        for running_status, requeue_status, active in (
            ("cloning", "pending", self._active_clone),
            ("processing", "cloned", self._active_post),
        ):
            active_ids = set(active.keys())
            stmt = update(GitCloneJob).where(GitCloneJob.status == running_status)
            if active_ids:
                stmt = stmt.where(GitCloneJob.id.notin_(active_ids))
            stmt = stmt.values(status=requeue_status, started_at=None, current_step=None)
            result = await db.execute(stmt)
            if result.rowcount:
                total += result.rowcount
                logger.warning(
                    f"[git watchdog] {result.rowcount} job(s) em '{running_status}' "
                    f"sem task viva -> '{requeue_status}'"
                )
        if total:
            await db.commit()
        return total

    async def _get_setting_int(self, db, key: str, default: int) -> int:
        from database import AppSettings
        try:
            val = (await db.execute(
                select(AppSettings.value).where(AppSettings.key == key)
            )).scalar()
            return max(1, int(val)) if val not in (None, "") else default
        except Exception:  # noqa: BLE001
            return default

    async def _get_clone_concurrency(self, db) -> int:
        return await self._get_setting_int(db, "max_simultaneous_git_clones", 2)

    async def _get_post_concurrency(self, db) -> int:
        return await self._get_setting_int(db, "max_simultaneous_git_postprocess", 2)

    async def _get_job_timeout_seconds(self, db) -> int:
        """Limite (s) p/ o watchdog considerar um job travado. 0 = desativado."""
        from database import AppSettings
        try:
            val = (await db.execute(
                select(AppSettings.value).where(AppSettings.key == "git_clone_job_timeout_min")
            )).scalar()
            minutes = int(val) if val not in (None, "") else (MAX_JOB_SECONDS_DEFAULT // 60)
            return max(0, minutes) * 60
        except Exception:  # noqa: BLE001
            return MAX_JOB_SECONDS_DEFAULT

    async def _get_stall_seconds(self, db) -> int:
        """Janela (s) sem progresso para o watchdog considerar um job travado. 0 = desativado."""
        from database import AppSettings
        try:
            val = (await db.execute(
                select(AppSettings.value).where(AppSettings.key == "git_clone_stall_min")
            )).scalar()
            minutes = int(val) if val not in (None, "") else (STALL_SECONDS_DEFAULT // 60)
            return max(0, minutes) * 60
        except Exception:  # noqa: BLE001
            return STALL_SECONDS_DEFAULT

    async def _process(self, db, phase: str):
        from database import GitCloneJob, GitRepo

        cfg = self._phase_cfg(phase)
        active = cfg["active"]
        max_conc = await cfg["concurrency"](db)

        # Concorrência pelas tasks REALMENTE vivas (não pelo count do DB).
        slots = max_conc - len(active)
        if slots <= 0:
            return

        stmt = (
            select(GitCloneJob)
            .outerjoin(GitRepo, GitRepo.id == GitCloneJob.repo_id)
            .where(GitCloneJob.status == cfg["pick_status"])
        )
        if phase == "clone":
            # 1) priority, 2) pushed_at desc (mais novo), 3) size asc (menor), 4) created asc
            stmt = stmt.order_by(
                GitCloneJob.priority.desc(),
                nullslast(GitRepo.pushed_at.desc()),
                nullslast(GitRepo.size_kb.asc()),
                GitCloneJob.created_at.asc(),
            )
        else:
            # pós-processa na ordem em que ficaram prontos (mais antigo primeiro)
            stmt = stmt.order_by(
                GitCloneJob.priority.desc(),
                GitCloneJob.created_at.asc(),
            )
        stmt = stmt.limit(slots)

        jobs = (await db.execute(stmt)).scalars().all()
        for job in jobs:
            if job.id in active:
                continue
            task = asyncio.create_task(cfg["executor"](job.id))
            active[job.id] = {"task": task, "since": time.monotonic()}

    # ------------------------------------------------------------------
    # Fase 1: CLONE (rede) -> ao terminar, status 'cloned' (handoff)
    # ------------------------------------------------------------------
    async def _execute_clone(self, job_id: int):
        from database import AsyncSessionLocal, GitCloneJob

        try:
            async with AsyncSessionLocal() as db:
                job = (await db.execute(
                    select(GitCloneJob).where(GitCloneJob.id == job_id)
                )).scalar_one_or_none()
                if not job or job.status != "pending":
                    return

                job.status = "cloning"
                job.started_at = datetime.now(timezone.utc)
                job.current_step = "clone"
                await db.commit()

                repo = await self._ensure_repo(db, job)
                if repo is None:
                    job.status = "failed"
                    job.error_message = "Repositório associado não encontrado"
                    job.completed_at = datetime.now(timezone.utc)
                    await db.commit()
                    return

                clone_dir = os.path.join(GITCLONES_BASE, repo.guid)
                info = self._active_clone.get(job_id)
                if info is not None:
                    info["clone_dir"] = clone_dir
                    info["repo_id"] = repo.id

                ok, err = await self._do_clone(db, job, repo, clone_dir)
                if not ok:
                    job.status = "failed"
                    job.error_message = f"clone: {err}"[:1000]
                    job.current_step = "clone"
                    job.completed_at = datetime.now(timezone.utc)
                    repo.clone_status = "failed"
                    repo.clone_error = (err or "")[:1000]
                    await db.commit()
                    return

                if await self._is_cancelled(db, job_id):
                    return

                # HANDOFF -> fila de pós-processamento (gitleaks/extração/index)
                job.status = "cloned"
                job.current_step = "queued"
                repo.clone_status = "cloned"
                repo.cloned_at = datetime.now(timezone.utc)
                await db.commit()
                logger.info(f"[git clone] job {job_id} clonado -> pos-processamento ({repo.full_name})")

        except Exception as e:  # noqa: BLE001
            logger.error(f"Fatal error in git clone job {job_id}: {e}\n{traceback.format_exc()}")
            try:
                async with AsyncSessionLocal() as db2:
                    job = (await db2.execute(
                        select(GitCloneJob).where(GitCloneJob.id == job_id)
                    )).scalar_one_or_none()
                    if job and job.status == "cloning":
                        job.status = "failed"
                        job.error_message = str(e)[:1000]
                        job.completed_at = datetime.now(timezone.utc)
                        await db2.commit()
            except Exception:  # noqa: BLE001
                pass
        finally:
            self._active_clone.pop(job_id, None)

    # ------------------------------------------------------------------
    # Fase 2: PÓS-PROCESSAMENTO (gitleaks -> extração -> indexação)
    # ------------------------------------------------------------------
    async def _execute_postprocess(self, job_id: int):
        from database import AsyncSessionLocal, GitCloneJob

        try:
            async with AsyncSessionLocal() as db:
                job = (await db.execute(
                    select(GitCloneJob).where(GitCloneJob.id == job_id)
                )).scalar_one_or_none()
                if not job or job.status != "cloned":
                    return

                repo = await self._ensure_repo(db, job)
                if repo is None:
                    job.status = "failed"
                    job.error_message = "Repositório associado não encontrado"
                    job.completed_at = datetime.now(timezone.utc)
                    await db.commit()
                    return

                clone_dir = os.path.join(GITCLONES_BASE, repo.guid)
                info = self._active_post.get(job_id)
                if info is not None:
                    info["clone_dir"] = clone_dir
                    info["repo_id"] = repo.id

                job.status = "processing"
                job.started_at = datetime.now(timezone.utc)
                job.current_step = "gitleaks"

                # Histórico disponível? (indexação habilitada + clone completo com .git)
                history_enabled = await self._git_index_history_enabled(db)
                has_history = (
                    history_enabled
                    and os.path.isdir(os.path.join(clone_dir, ".git"))
                    and not await self._is_shallow(clone_dir)
                )
                repo.history_indexed = bool(has_history)
                await db.commit()

                if await self._is_cancelled(db, job_id):
                    return

                # 1) GITLEAKS (modo 'git' varre todo o histórico; 'dir' só o working tree)
                try:
                    leaks = await self._run_gitleaks(db, repo, clone_dir, has_history)
                    job.leaks_found = leaks
                    repo.leaks_count = leaks
                    repo.scan_status = "completed"
                except Exception as e:  # noqa: BLE001
                    logger.error(f"[git {repo.full_name}] gitleaks error: {e}")
                    repo.scan_status = "failed"
                await db.commit()

                if await self._is_cancelled(db, job_id):
                    return

                # 2) EXTRAÇÃO + 3) INDEX
                job.current_step = "ocr"
                repo.ocr_status = "running"
                await db.commit()
                try:
                    total, indexed = await self._extract_and_index(db, job, repo, clone_dir, has_history)
                    job.total_files = total
                    job.processed_files = total
                    repo.files_count = total
                    repo.ocr_status = "completed"
                    repo.index_status = "completed" if indexed >= 0 else "failed"
                except Exception as e:  # noqa: BLE001
                    logger.error(f"[git {repo.full_name}] extract/index error: {e}\n{traceback.format_exc()}")
                    repo.ocr_status = "failed"
                    repo.index_status = "failed"
                await db.commit()

                # Finalizar
                job.status = "completed"
                job.current_step = "done"
                job.completed_at = datetime.now(timezone.utc)
                await db.commit()
                logger.info(f"[git post] job {job_id} concluido ({repo.full_name})")

        except Exception as e:  # noqa: BLE001
            logger.error(f"Fatal error in git post-process job {job_id}: {e}\n{traceback.format_exc()}")
            try:
                async with AsyncSessionLocal() as db2:
                    job = (await db2.execute(
                        select(GitCloneJob).where(GitCloneJob.id == job_id)
                    )).scalar_one_or_none()
                    if job and job.status == "processing":
                        job.status = "failed"
                        job.error_message = str(e)[:1000]
                        job.completed_at = datetime.now(timezone.utc)
                        await db2.commit()
            except Exception:  # noqa: BLE001
                pass
        finally:
            self._active_post.pop(job_id, None)

    async def _ensure_repo(self, db, job):
        from database import GitRepo
        if job.repo_id:
            repo = (await db.execute(select(GitRepo).where(GitRepo.id == job.repo_id))).scalar_one_or_none()
            if repo:
                return repo
        # fallback: achar/crear por full_name
        full = job.repo_full_name
        if not full and job.repo_url:
            m = re.search(r"github\.com[:/](.+?)(?:\.git)?$", job.repo_url)
            full = m.group(1) if m else None
        if not full:
            return None
        repo = (await db.execute(select(GitRepo).where(GitRepo.full_name == full))).scalar_one_or_none()
        if not repo:
            owner, _, name = full.partition("/")
            repo = GitRepo(full_name=full, owner=owner, name=name,
                           clone_url=job.repo_url or f"https://github.com/{full}.git",
                           html_url=f"https://github.com/{full}")
            db.add(repo)
            await db.flush()
            job.repo_id = repo.id
            await db.commit()
        return repo

    async def _is_cancelled(self, db, job_id) -> bool:
        from database import GitCloneJob
        status = (await db.execute(
            select(GitCloneJob.status).where(GitCloneJob.id == job_id)
        )).scalar()
        return status == "cancelled"

    # ------------------------------------------------------------------
    async def _do_clone(self, db, job, repo, clone_dir) -> Tuple[bool, Optional[str]]:
        from database import Credential

        repo.clone_status = "cloning"
        await db.commit()

        # Limpar diretório anterior, se houver
        if os.path.isdir(clone_dir):
            shutil.rmtree(clone_dir, ignore_errors=True)
        os.makedirs(os.path.dirname(clone_dir), exist_ok=True)

        full_name = repo.full_name
        # URL base: funciona p/ QUALQUER host (github, gitlab, bitbucket, self-hosted),
        # não só github.com. Prioriza o clone_url do repo / a URL do job.
        base_url = repo.clone_url or job.repo_url or f"https://github.com/{full_name}.git"
        url = base_url
        if job.clone_auth == "authenticated" and job.credential_id:
            cred = (await db.execute(
                select(Credential).where(Credential.id == job.credential_id)
            )).scalar_one_or_none()
            token = (cred.token if cred else None) or ""
            if token:
                url = _inject_token(base_url, token)

        # Estratégia: clone COMPLETO por padrão; raso (--depth) só para repositórios
        # grandes (pelo size_kb da API do GitHub) ou se o completo estourar o timeout.
        # Com indexação de histórico habilitada, SEMPRE tenta completo primeiro
        # (o raso descartaria o histórico); o raso fica apenas como fallback de timeout.
        shallow_depth, is_large = await self._resolve_shallow_depth(db, job, repo)
        history_enabled = await self._git_index_history_enabled(db)
        env = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "GIT_ASKPASS": "/bin/true"}

        # Proxy (opcional) por job: git usa curl, que respeita estas variáveis
        # (socks5 via ALL_PROXY). None = sem proxy.
        if getattr(job, "proxy_id", None):
            try:
                from github_api import resolve_proxy_url
                proxy_url = await resolve_proxy_url(db, job.proxy_id)
                if proxy_url:
                    env["HTTP_PROXY"] = proxy_url
                    env["HTTPS_PROXY"] = proxy_url
                    env["ALL_PROXY"] = proxy_url
            except Exception as e:  # noqa: BLE001
                logger.warning(f"[git {full_name}] falha ao resolver proxy {job.proxy_id}: {e}")

        # 1ª tentativa: completa (a menos que o repo já seja sabidamente grande,
        # ou que o job force uma profundidade explícita).
        forced_depth = job.depth is not None and int(job.depth) > 0
        attempt_shallow = is_large and not (history_enabled and not forced_depth)
        ok, err, timed_out = await self._run_clone(
            url, clone_dir, env, shallow_depth if attempt_shallow else None, base_url,
        )
        if ok:
            repo.local_path = repo.guid
            repo.default_branch = repo.default_branch or await self._detect_branch(clone_dir)
            return True, None

        # Fallback: se a tentativa COMPLETA estourou o timeout, repete em modo raso.
        if timed_out and not attempt_shallow and shallow_depth and shallow_depth > 0:
            logger.warning(
                f"[git {full_name}] clone completo excedeu o timeout; refazendo raso (depth={shallow_depth}) — sem histórico"
            )
            if os.path.isdir(clone_dir):
                shutil.rmtree(clone_dir, ignore_errors=True)
            ok, err, _ = await self._run_clone(
                url, clone_dir, env, shallow_depth, base_url,
            )
            if ok:
                repo.local_path = repo.guid
                repo.default_branch = repo.default_branch or await self._detect_branch(clone_dir)
                return True, None

        return False, err

    async def _run_clone(self, url, clone_dir, env, depth, safe_url=None) -> Tuple[bool, Optional[str], bool]:
        """Executa `git clone`. depth>0 => clone raso. Retorna (ok, err, timed_out).
        `safe_url` (sem token) é usada para mascarar a URL em mensagens de erro."""
        cmd = ["git", "clone", "--quiet"]
        if depth and int(depth) > 0:
            cmd += ["--depth", str(int(depth)), "--single-branch", "--no-tags"]
        cmd += [url, clone_dir]
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, env=env,
            )
            _, stderr = await asyncio.wait_for(proc.communicate(), timeout=1800)
            if proc.returncode != 0:
                # Não logar a URL (pode conter token)
                msg = (stderr.decode("utf-8", "replace") if stderr else "").strip()
                if safe_url:
                    msg = msg.replace(url, safe_url)
                return False, msg or f"git exited {proc.returncode}", False
            return True, None, False
        except asyncio.TimeoutError:
            return False, "clone timed out (1800s)", True
        except Exception as e:  # noqa: BLE001
            return False, str(e), False

    async def _git_index_history_enabled(self, db) -> bool:
        from database import AppSettings
        try:
            val = (await db.execute(
                select(AppSettings.value).where(AppSettings.key == "git_index_history")
            )).scalar()
            if val is None:
                return True
            return str(val).strip().lower() in ("1", "true", "yes", "on")
        except Exception:  # noqa: BLE001
            return True

    async def _history_limits(self, db) -> Tuple[int, int]:
        """(max_commits, max_versions_per_file) — 0 = ilimitado."""
        mc = await self._get_setting_int_zero(db, "git_history_max_commits", 5000)
        mv = await self._get_setting_int_zero(db, "git_history_max_versions_per_file", 100)
        return mc, mv

    async def _get_setting_int_zero(self, db, key: str, default: int) -> int:
        """Lê um inteiro >= 0 (0 permitido, significa 'ilimitado')."""
        from database import AppSettings
        try:
            val = (await db.execute(
                select(AppSettings.value).where(AppSettings.key == key)
            )).scalar()
            return max(0, int(val)) if val not in (None, "") else default
        except Exception:  # noqa: BLE001
            return default

    async def _is_shallow(self, clone_dir) -> bool:
        """True se o clone é raso (sem histórico completo)."""
        if os.path.exists(os.path.join(clone_dir, ".git", "shallow")):
            return True
        try:
            proc = await asyncio.create_subprocess_exec(
                "git", "-C", clone_dir, "rev-parse", "--is-shallow-repository",
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            )
            out, _ = await proc.communicate()
            return out.decode().strip() == "true"
        except Exception:  # noqa: BLE001
            return False

    async def _resolve_shallow_depth(self, db, job, repo) -> Tuple[int, bool]:
        """Retorna (depth_para_raso, repo_eh_grande).

        - `depth_para_raso`: profundidade a usar quando o clone for raso (setting git_clone_depth, default 1).
        - `repo_eh_grande`: True se o repo deve ser clonado raso já de cara, decidido pelo
          tamanho informado pela API do GitHub (repo.size_kb) contra git_clone_large_repo_mb.
        Um `job.depth` explícito (>0) força raso nessa profundidade.
        """
        from database import AppSettings

        async def _setting(key, default):
            try:
                val = (await db.execute(
                    select(AppSettings.value).where(AppSettings.key == key)
                )).scalar()
                return int(val) if val not in (None, "") else default
            except Exception:  # noqa: BLE001
                return default

        depth = await _setting("git_clone_depth", 1)
        if depth <= 0:
            depth = 1

        # Override explícito por job.
        if job.depth is not None and int(job.depth) > 0:
            return int(job.depth), True

        threshold_mb = await _setting("git_clone_large_repo_mb", 100)
        size_kb = repo.size_kb or 0
        is_large = threshold_mb > 0 and size_kb > 0 and (size_kb / 1024.0) > threshold_mb
        return depth, is_large

    async def _detect_branch(self, clone_dir) -> Optional[str]:
        try:
            proc = await asyncio.create_subprocess_exec(
                "git", "-C", clone_dir, "rev-parse", "--abbrev-ref", "HEAD",
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            )
            out, _ = await proc.communicate()
            return out.decode().strip() or None
        except Exception:  # noqa: BLE001
            return None

    # ------------------------------------------------------------------
    async def _run_gitleaks(self, db, repo, clone_dir, has_history: bool = False) -> int:
        from database import GitleaksFinding

        gitleaks_bin = shutil.which("gitleaks") or "/usr/sbin/gitleaks"
        report_path = os.path.join(
            GITLEAKS_OUTPUT_DIR, f"git_{repo.guid}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        )
        # 'git' varre TODO o histórico de commits (segredos em commits antigos/removidos);
        # 'dir' varre apenas a árvore de trabalho (fallback p/ clone raso).
        mode = "git" if has_history else "dir"
        cmd = [
            gitleaks_bin, mode, clone_dir,
            "--report-format", "json", "--report-path", report_path,
            "--config", GITLEAKS_CONFIG_PATH,
        ]
        proc = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            env={**os.environ, "GITLEAKS_CONFIG": GITLEAKS_CONFIG_PATH},
        )
        await proc.communicate()
        if proc.returncode not in (0, 1):
            raise RuntimeError(f"gitleaks exited {proc.returncode}")

        if not os.path.exists(report_path):
            return 0
        try:
            with open(report_path, "r") as f:
                findings = json.load(f) or []
        except Exception:  # noqa: BLE001
            return 0

        saved = 0
        for fd in findings:
            abs_file = fd.get("File", "") or ""
            rel = os.path.relpath(abs_file, clone_dir) if abs_file.startswith(clone_dir) else abs_file
            import jwt_utils
            secret_val = fd.get("Secret") or fd.get("Match") or ""
            decoded_claims = jwt_utils.jwt_search_text(secret_val) or None
            commit_hash = (fd.get("Commit") or "") or None
            # No modo 'git' o Fingerprint já inclui o commit; no 'dir' não.
            raw_fp = fd.get("Fingerprint") or f"{commit_hash or ''}:{rel}:{fd.get('RuleID')}:{fd.get('StartLine')}"
            fingerprint = f"git:{repo.guid}:{raw_fp}"
            exists = (await db.execute(
                select(GitleaksFinding.id).where(GitleaksFinding.fingerprint == fingerprint)
            )).scalar()
            if exists:
                continue
            finding = GitleaksFinding(
                fingerprint=fingerprint,
                rule_id=fd.get("RuleID", "unknown"),
                description=fd.get("Description"),
                match=fd.get("Match"),
                secret=fd.get("Secret"),
                start_line=fd.get("StartLine"),
                end_line=fd.get("EndLine"),
                start_column=fd.get("StartColumn"),
                end_column=fd.get("EndColumn"),
                entropy=fd.get("Entropy"),
                tags=fd.get("Tags"),
                file_path=rel,
                original_file=rel,
                file_name=os.path.basename(rel),
                server_name=repo.full_name,
                share_name=repo.full_name,
                server_path=rel,
                git_repo_id=repo.id,
                git_repo_guid=repo.guid,
                commit_hash=commit_hash,
                commit_author=(fd.get("Author") or fd.get("Email") or None),
                commit_date=_parse_leak_date(fd.get("Date")),
                decoded_claims=decoded_claims,
                scanned_at=datetime.now(timezone.utc),
                raw_data=fd,
            )
            db.add(finding)
            saved += 1
        if saved:
            await db.commit()
        return saved

    # ------------------------------------------------------------------
    async def _get_index_max_bytes(self, db) -> int:
        from database import AppSettings
        try:
            val = (await db.execute(
                select(AppSettings.value).where(AppSettings.key == "git_index_max_size_mb")
            )).scalar()
            return int(float(val)) * 1024 * 1024 if val else 2 * 1024 * 1024
        except Exception:  # noqa: BLE001
            return 2 * 1024 * 1024

    async def _extract_and_index(self, db, job, repo, clone_dir, has_history: bool = False) -> Tuple[int, int]:
        from database import GitRepoFile
        import opensearch_client

        max_text_bytes = await self._get_index_max_bytes(db)

        # Re-processamento idempotente: remove arquivos/índice de uma execução
        # anterior deste repo (ex.: job reenfileirado pelo watchdog/reboot) para
        # não acumular linhas duplicadas no DB nem docs duplicados no OpenSearch.
        await db.execute(delete(GitRepoFile).where(GitRepoFile.repo_id == repo.id))
        await db.commit()
        try:
            await asyncio.to_thread(opensearch_client.delete_repo, repo.guid)
        except Exception:  # noqa: BLE001
            pass

        if has_history:
            try:
                return await self._index_history(db, job, repo, clone_dir, max_text_bytes)
            except Exception as e:  # noqa: BLE001
                logger.error(
                    f"[git {repo.full_name}] falha ao indexar histórico ({e}); "
                    f"caindo para indexação do HEAD\n{traceback.format_exc()}"
                )
                # Limpa parcial e cai para o HEAD snapshot
                await db.execute(delete(GitRepoFile).where(GitRepoFile.repo_id == repo.id))
                await db.commit()
                try:
                    await asyncio.to_thread(opensearch_client.delete_repo, repo.guid)
                except Exception:  # noqa: BLE001
                    pass
                repo.history_indexed = False

        return await self._index_head_snapshot(db, job, repo, clone_dir, max_text_bytes)

    @staticmethod
    def _new_idx_ctx() -> dict:
        """Estado de indexação POR JOB (o worker é singleton e roda vários jobs
        em paralelo, então este estado NÃO pode viver em self)."""
        return {"total": 0, "batch": [], "indexed": 0}

    async def _flush_index(self, ctx):
        import opensearch_client
        if ctx["batch"]:
            n = await asyncio.to_thread(opensearch_client.bulk_index, list(ctx["batch"]))
            ctx["indexed"] += n
            ctx["batch"] = []

    def _queue_index_doc(self, ctx, repo, gf, rel, name, ext, mimetype, size, content, extra=None):
        # Se o conteúdo tiver JWTs, anexa os claims decodificados ao texto INDEXADO
        # (não ao conteúdo salvo no DB), para permitir busca pelo conteúdo dos claims.
        index_content = content
        try:
            import jwt_utils
            claims = jwt_utils.extract_and_decode_claims_text(content)
            if claims:
                index_content = f"{content}\n\n[JWT CLAIMS]\n{claims}"
        except Exception:  # noqa: BLE001
            pass
        doc = {
            "_id": f"{repo.guid}:{gf.id}",
            "repo_id": repo.id,
            "repo_guid": repo.guid,
            "repo_full_name": repo.full_name,
            "file_id": gf.id,
            "rel_path": rel,
            "name": name,
            "extension": ext or None,
            "mimetype": mimetype,
            "size": size,
            "content": index_content,
        }
        if extra:
            doc.update(extra)
        ctx["batch"].append(doc)

    # ------------------------------------------------------------------
    # Indexação do HEAD (working tree) — usada no modo raso/fallback.
    # ------------------------------------------------------------------
    async def _index_head_snapshot(self, db, job, repo, clone_dir, max_text_bytes) -> Tuple[int, int]:
        from database import GitRepoFile
        head_commit = await self._head_commit_info(clone_dir)
        ctx = self._new_idx_ctx()

        for root, dirs, files in os.walk(clone_dir):
            if ".git" in dirs:
                dirs.remove(".git")
            for fname in files:
                fpath = os.path.join(root, fname)
                try:
                    if os.path.islink(fpath):
                        continue
                    size = os.path.getsize(fpath)
                except OSError:
                    continue
                rel = os.path.relpath(fpath, clone_dir)
                ext = os.path.splitext(fname)[1].lower()
                mimetype = mimetypes.guess_type(fname)[0]
                sha1 = self._sha1(fpath)

                content, is_binary, cerr = await self._extract_text(fpath, ext, size, max_text_bytes)

                gf = GitRepoFile(
                    repo_id=repo.id, repo_guid=repo.guid, rel_path=rel, name=fname,
                    extension=ext or None, size=size, sha1=sha1, mimetype=mimetype,
                    is_binary=is_binary, content=content,
                    content_extracted=bool(content), content_error=cerr,
                    is_head=True,
                    commit_hash=(head_commit or {}).get("hash"),
                    commit_short=(head_commit or {}).get("short"),
                    branch=repo.default_branch,
                    author=(head_commit or {}).get("author"),
                    author_email=(head_commit or {}).get("email"),
                    commit_date=(head_commit or {}).get("date"),
                    change_type="M",
                )
                db.add(gf)
                await db.flush()
                ctx["total"] += 1

                if content:
                    gf.indexed = True
                    gf.indexed_at = datetime.now(timezone.utc)
                    self._queue_index_doc(
                        ctx, repo, gf, rel, fname, ext, mimetype, size, content,
                        extra={
                            "is_head": True,
                            "commit_hash": (head_commit or {}).get("hash"),
                            "branch": repo.default_branch,
                            "change_type": "M",
                        },
                    )

                if ctx["total"] % 200 == 0:
                    job.processed_files = ctx["total"]
                    job.total_files = ctx["total"]
                    await db.commit()
                    await self._flush_index(ctx)

        job.processed_files = ctx["total"]
        job.total_files = ctx["total"]
        await db.commit()
        await self._flush_index(ctx)
        return ctx["total"], ctx["indexed"]

    # ------------------------------------------------------------------
    # Indexação do HISTÓRICO completo (todas as branches/commits) — filecrawler-style.
    # ------------------------------------------------------------------
    async def _index_history(self, db, job, repo, clone_dir, max_text_bytes) -> Tuple[int, int]:
        from database import GitRepoFile
        from git_history import GitHistoryReader

        max_commits, max_versions = await self._history_limits(db)
        ctx = self._new_idx_ctx()

        reader = await asyncio.to_thread(GitHistoryReader, clone_dir)
        try:
            versions, meta = await asyncio.to_thread(
                reader.collect, max_commits, max_versions,
            )
            repo.commits_count = meta.get("commits_count")
            repo.branches_count = meta.get("branches_count")
            logger.info(
                f"[git {repo.full_name}] histórico: {len(versions)} versões de arquivo em "
                f"{meta.get('commits_count')} commits / {meta.get('branches_count')} branches"
            )

            for v in versions:
                mimetype = mimetypes.guess_type(v.name)[0]
                data = None
                content = None
                is_binary = False
                cerr = None
                sha1 = None

                if v.extension in SKIP_BINARY_EXTS:
                    is_binary = True
                else:
                    data = await asyncio.to_thread(reader.read_blob, v.blob_sha)
                    if data is None:
                        cerr = "blob_unreadable"
                    else:
                        sha1 = hashlib.sha1(data).hexdigest()
                        content, is_binary, cerr = await self._extract_text_bytes(
                            v.name, v.extension, data, max_text_bytes,
                        )

                gf = GitRepoFile(
                    repo_id=repo.id, repo_guid=repo.guid, rel_path=v.rel_path, name=v.name,
                    extension=v.extension, size=v.size, sha1=sha1, mimetype=mimetype,
                    is_binary=is_binary, content=content,
                    content_extracted=bool(content), content_error=cerr,
                    blob_sha=v.blob_sha,
                    commit_hash=v.commit_hash, commit_short=v.commit_short,
                    branch=v.branch, author=v.author, author_email=v.author_email,
                    commit_date=v.commit_date, change_type=v.change_type, is_head=v.is_head,
                )
                db.add(gf)
                await db.flush()
                ctx["total"] += 1

                if content:
                    gf.indexed = True
                    gf.indexed_at = datetime.now(timezone.utc)
                    self._queue_index_doc(
                        ctx, repo, gf, v.rel_path, v.name, v.extension, mimetype, v.size, content,
                        extra={
                            "is_head": v.is_head,
                            "commit_hash": v.commit_hash,
                            "branch": v.branch,
                            "author": v.author,
                            "commit_date": v.commit_date.isoformat() if v.commit_date else None,
                            "change_type": v.change_type,
                            "blob_sha": v.blob_sha,
                        },
                    )

                if ctx["total"] % 200 == 0:
                    job.processed_files = ctx["total"]
                    job.total_files = ctx["total"]
                    await db.commit()
                    await self._flush_index(ctx)
        finally:
            await asyncio.to_thread(reader.close)

        job.processed_files = ctx["total"]
        job.total_files = ctx["total"]
        await db.commit()
        await self._flush_index(ctx)
        return ctx["total"], ctx["indexed"]

    async def _head_commit_info(self, clone_dir) -> Optional[dict]:
        """Metadados do commit HEAD (hash/autor/data), para o snapshot sem histórico."""
        try:
            fmt = "%H%x00%h%x00%an%x00%ae%x00%aI"
            proc = await asyncio.create_subprocess_exec(
                "git", "-C", clone_dir, "log", "-1", f"--format={fmt}",
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            )
            out, _ = await proc.communicate()
            parts = out.decode("utf-8", "replace").strip().split("\x00")
            if len(parts) >= 5:
                return {
                    "hash": parts[0] or None,
                    "short": parts[1] or None,
                    "author": parts[2] or None,
                    "email": parts[3] or None,
                    "date": _parse_leak_date(parts[4]),
                }
        except Exception:  # noqa: BLE001
            pass
        return None

    @staticmethod
    def _sha1(path) -> Optional[str]:
        try:
            h = hashlib.sha1()
            with open(path, "rb") as f:
                for chunk in iter(lambda: f.read(65536), b""):
                    h.update(chunk)
            return h.hexdigest()
        except Exception:  # noqa: BLE001
            return None

    async def _extract_text(self, fpath, ext, size, max_text_bytes) -> Tuple[Optional[str], bool, Optional[str]]:
        """Returns (content, is_binary, error)."""
        if ext in SKIP_BINARY_EXTS:
            return None, True, None

        # Documentos -> Tika/OCR
        if ext in OCR_DOC_EXTS:
            if size > OCR_MAX_BYTES:
                return None, True, "too_large_for_ocr"
            try:
                from ocr_service import process_file_ocr
                content, _meta, err = await process_file_ocr(fpath)
                if content:
                    return content.strip() or None, False, None
                return None, True, err
            except Exception as e:  # noqa: BLE001
                return None, True, str(e)[:200]

        # Tentar como texto
        try:
            with open(fpath, "rb") as f:
                head = f.read(8192)
            if b"\x00" in head:
                return None, True, None
            if size > max_text_bytes:
                return None, False, "too_large"
            with open(fpath, "rb") as f:
                raw = f.read()
            try:
                text = raw.decode("utf-8")
            except UnicodeDecodeError:
                text = raw.decode("utf-8", "replace")
            return (text if text.strip() else None), False, None
        except Exception as e:  # noqa: BLE001
            return None, True, str(e)[:200]

    async def _extract_text_bytes(self, name, ext, data: bytes, max_text_bytes) -> Tuple[Optional[str], bool, Optional[str]]:
        """Versão de _extract_text para um blob de histórico (bytes em memória).
        Retorna (content, is_binary, error)."""
        if ext in SKIP_BINARY_EXTS:
            return None, True, None
        size = len(data)

        # Documentos -> Tika/OCR (precisa de um arquivo em disco)
        if ext in OCR_DOC_EXTS:
            if size > OCR_MAX_BYTES:
                return None, True, "too_large_for_ocr"
            tmp_path = None
            try:
                from ocr_service import process_file_ocr
                with tempfile.NamedTemporaryFile(delete=False, suffix=(ext or "")) as tf:
                    tf.write(data)
                    tmp_path = tf.name
                content, _meta, err = await process_file_ocr(tmp_path)
                if content:
                    return content.strip() or None, False, None
                return None, True, err
            except Exception as e:  # noqa: BLE001
                return None, True, str(e)[:200]
            finally:
                if tmp_path:
                    try:
                        os.unlink(tmp_path)
                    except OSError:
                        pass

        # Tratar como texto
        if b"\x00" in data[:8192]:
            return None, True, None
        if size > max_text_bytes:
            return None, False, "too_large"
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError:
            text = data.decode("utf-8", "replace")
        return (text if text.strip() else None), False, None


def get_git_clone_worker() -> GitCloneWorker:
    global _git_clone_worker
    if _git_clone_worker is None:
        _git_clone_worker = GitCloneWorker()
    return _git_clone_worker


async def start_git_clone_worker():
    await get_git_clone_worker().start()


async def stop_git_clone_worker():
    await get_git_clone_worker().stop()
