"""
Git Clone Worker - clones queued GitHub repositories in background and runs the
post-download pipeline on each: GitLeaks -> content extraction (plain/OCR) ->
indexing into OpenSearch.

Follows the same DB-polled asyncio singleton pattern as share_scan_worker.py.
"""
import os
import re
import json
import shutil
import hashlib
import asyncio
import logging
import mimetypes
import traceback
from datetime import datetime, timezone
from typing import Optional, Dict, List, Tuple

from sqlalchemy import select, func, update

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

_git_clone_worker: Optional["GitCloneWorker"] = None


class GitCloneWorker:
    def __init__(self):
        self.running = False
        self._task: Optional[asyncio.Task] = None

    async def start(self):
        if self.running:
            return
        self.running = True
        self._task = asyncio.create_task(self._run_loop())
        logger.info("Git clone worker started")

    async def stop(self):
        self.running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("Git clone worker stopped")

    async def _run_loop(self):
        from database import AsyncSessionLocal
        from sqlalchemy.exc import OperationalError

        # Reset de jobs 'running' presos ao reiniciar
        try:
            async with AsyncSessionLocal() as db:
                from database import GitCloneJob
                result = await db.execute(
                    update(GitCloneJob)
                    .where(GitCloneJob.status == "running")
                    .values(status="pending", started_at=None, current_step=None)
                )
                if result.rowcount > 0:
                    await db.commit()
                    logger.info(f"Reset {result.rowcount} stale running git clone jobs to pending")
        except Exception as e:  # noqa: BLE001
            logger.error(f"Error resetting stale git clone jobs on startup: {e}")

        while self.running:
            try:
                async with AsyncSessionLocal() as db:
                    await self._process_pending_jobs(db)
            except OperationalError as e:
                if "database is locked" in str(e):
                    await asyncio.sleep(5)
                else:
                    logger.error(f"Database error in git clone worker: {e}")
            except Exception as e:  # noqa: BLE001
                logger.error(f"Error in git clone worker loop: {e}")
            await asyncio.sleep(3)

    async def _get_max_concurrency(self, db) -> int:
        from database import AppSettings
        try:
            result = await db.execute(
                select(AppSettings.value).where(AppSettings.key == "max_simultaneous_git_clones")
            )
            val = result.scalar()
            return max(1, int(val)) if val else 2
        except Exception:  # noqa: BLE001
            return 2

    async def _process_pending_jobs(self, db):
        from database import GitCloneJob

        max_conc = await self._get_max_concurrency(db)

        running_result = await db.execute(
            select(func.count(GitCloneJob.id)).where(GitCloneJob.status == "running")
        )
        running = running_result.scalar() or 0
        slots = max_conc - running
        if slots <= 0:
            return

        result = await db.execute(
            select(GitCloneJob)
            .where(GitCloneJob.status == "pending")
            .order_by(GitCloneJob.priority.desc(), GitCloneJob.created_at.asc())
            .limit(slots)
        )
        pending = result.scalars().all()
        for job in pending:
            asyncio.create_task(self._execute_job(job.id))

    # ------------------------------------------------------------------
    async def _execute_job(self, job_id: int):
        from database import AsyncSessionLocal, GitCloneJob, GitRepo

        try:
            async with AsyncSessionLocal() as db:
                job = (await db.execute(
                    select(GitCloneJob).where(GitCloneJob.id == job_id)
                )).scalar_one_or_none()
                if not job or job.status != "pending":
                    return

                job.status = "running"
                job.started_at = datetime.now(timezone.utc)
                job.current_step = "clone"
                await db.commit()

                # Resolver/garantir GitRepo
                repo = await self._ensure_repo(db, job)
                if repo is None:
                    job.status = "failed"
                    job.error_message = "Repositório associado não encontrado"
                    job.completed_at = datetime.now(timezone.utc)
                    await db.commit()
                    return

                clone_dir = os.path.join(GITCLONES_BASE, repo.guid)

                # 1) CLONE
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

                # 2) GITLEAKS
                job.current_step = "gitleaks"
                await db.commit()
                try:
                    leaks = await self._run_gitleaks(db, repo, clone_dir)
                    job.leaks_found = leaks
                    repo.leaks_count = leaks
                    repo.scan_status = "completed"
                except Exception as e:  # noqa: BLE001
                    logger.error(f"[git {repo.full_name}] gitleaks error: {e}")
                    repo.scan_status = "failed"
                await db.commit()

                if await self._is_cancelled(db, job_id):
                    return

                # 3) EXTRAÇÃO + 4) INDEX
                job.current_step = "ocr"
                repo.ocr_status = "running"
                await db.commit()
                try:
                    total, indexed = await self._extract_and_index(db, job, repo, clone_dir)
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
                repo.clone_status = "cloned"
                repo.cloned_at = datetime.now(timezone.utc)
                await db.commit()
                logger.info(f"[git] job {job_id} completed for {repo.full_name}")

        except Exception as e:  # noqa: BLE001
            logger.error(f"Fatal error in git clone job {job_id}: {e}\n{traceback.format_exc()}")
            try:
                async with AsyncSessionLocal() as db2:
                    job = (await db2.execute(
                        select(GitCloneJob).where(GitCloneJob.id == job_id)
                    )).scalar_one_or_none()
                    if job and job.status == "running":
                        job.status = "failed"
                        job.error_message = str(e)[:1000]
                        job.completed_at = datetime.now(timezone.utc)
                        await db2.commit()
            except Exception:  # noqa: BLE001
                pass

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
        url = f"https://github.com/{full_name}.git"
        if job.clone_auth == "authenticated" and job.credential_id:
            cred = (await db.execute(
                select(Credential).where(Credential.id == job.credential_id)
            )).scalar_one_or_none()
            token = (cred.token if cred else None) or ""
            if token:
                url = f"https://x-access-token:{token}@github.com/{full_name}.git"

        # Estratégia: clone COMPLETO por padrão; raso (--depth) só para repositórios
        # grandes (pelo size_kb da API do GitHub) ou se o completo estourar o timeout.
        shallow_depth, is_large = await self._resolve_shallow_depth(db, job, repo)
        env = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "GIT_ASKPASS": "/bin/true"}

        # 1ª tentativa: completa (a menos que o repo já seja sabidamente grande,
        # ou que o job force uma profundidade explícita).
        attempt_shallow = is_large
        ok, err, timed_out = await self._run_clone(
            url, clone_dir, full_name, env, shallow_depth if attempt_shallow else None,
        )
        if ok:
            repo.local_path = repo.guid
            repo.default_branch = repo.default_branch or await self._detect_branch(clone_dir)
            return True, None

        # Fallback: se a tentativa COMPLETA estourou o timeout, repete em modo raso.
        if timed_out and not attempt_shallow and shallow_depth and shallow_depth > 0:
            logger.warning(
                f"[git {full_name}] clone completo excedeu o timeout; refazendo raso (depth={shallow_depth})"
            )
            if os.path.isdir(clone_dir):
                shutil.rmtree(clone_dir, ignore_errors=True)
            ok, err, _ = await self._run_clone(
                url, clone_dir, full_name, env, shallow_depth,
            )
            if ok:
                repo.local_path = repo.guid
                repo.default_branch = repo.default_branch or await self._detect_branch(clone_dir)
                return True, None

        return False, err

    async def _run_clone(self, url, clone_dir, full_name, env, depth) -> Tuple[bool, Optional[str], bool]:
        """Executa `git clone`. depth>0 => clone raso. Retorna (ok, err, timed_out)."""
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
                msg = msg.replace(url, f"https://github.com/{full_name}.git")
                return False, msg or f"git exited {proc.returncode}", False
            return True, None, False
        except asyncio.TimeoutError:
            return False, "clone timed out (1800s)", True
        except Exception as e:  # noqa: BLE001
            return False, str(e), False

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
    async def _run_gitleaks(self, db, repo, clone_dir) -> int:
        from database import GitleaksFinding

        gitleaks_bin = shutil.which("gitleaks") or "/usr/sbin/gitleaks"
        report_path = os.path.join(
            GITLEAKS_OUTPUT_DIR, f"git_{repo.guid}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        )
        cmd = [
            gitleaks_bin, "dir", clone_dir,
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
            raw_fp = fd.get("Fingerprint") or f"{rel}:{fd.get('RuleID')}:{fd.get('StartLine')}"
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

    async def _extract_and_index(self, db, job, repo, clone_dir) -> Tuple[int, int]:
        from database import GitRepoFile
        import opensearch_client

        max_text_bytes = await self._get_index_max_bytes(db)
        total = 0
        index_batch: List[dict] = []
        indexed_total = 0

        async def flush_index():
            nonlocal index_batch, indexed_total
            if index_batch:
                n = await asyncio.to_thread(opensearch_client.bulk_index, list(index_batch))
                indexed_total += n
                index_batch = []

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
                )
                db.add(gf)
                await db.flush()  # obtém gf.id
                total += 1

                if content:
                    gf.indexed = True
                    gf.indexed_at = datetime.now(timezone.utc)
                    index_batch.append({
                        "_id": f"{repo.guid}:{gf.id}",
                        "repo_id": repo.id,
                        "repo_guid": repo.guid,
                        "repo_full_name": repo.full_name,
                        "file_id": gf.id,
                        "rel_path": rel,
                        "name": fname,
                        "extension": ext or None,
                        "mimetype": mimetype,
                        "size": size,
                        "content": content,
                    })

                if total % 200 == 0:
                    await db.commit()
                    await flush_index()

        await db.commit()
        await flush_index()
        return total, indexed_total

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


def get_git_clone_worker() -> GitCloneWorker:
    global _git_clone_worker
    if _git_clone_worker is None:
        _git_clone_worker = GitCloneWorker()
    return _git_clone_worker


async def start_git_clone_worker():
    await get_git_clone_worker().start()


async def stop_git_clone_worker():
    await get_git_clone_worker().stop()
