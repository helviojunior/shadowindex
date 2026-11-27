"""
Git history walker — percorre TODO o histórico de commits/branches de um clone e
produz as versões de conteúdo de cada arquivo (estilo filecrawler).

Unidade: uma VERSÃO = um par (rel_path, blob_sha). Dedup global por esse par, de
modo que conteúdo idêntico não é reindexado. Como os commits são percorridos do
mais novo para o mais antigo, a primeira ocorrência de um (path, blob) é o commit
mais recente que introduziu aquele conteúdo — é ele quem representa a versão.

Uso típico (a partir do git_clone_worker, via asyncio.to_thread):

    reader = GitHistoryReader(clone_dir)
    versions, meta = reader.collect(max_commits=5000, max_versions_per_file=100)
    for v in versions:
        data = reader.read_blob(v.blob_sha)   # bytes do blob, sob demanda
        ...
    reader.close()

`collect()` NÃO lê o conteúdo dos blobs (apenas metadados), para manter o uso de
memória baixo; o conteúdo é lido sob demanda com `read_blob()`.
"""
import os
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, List, Optional, Set, Tuple

logger = logging.getLogger(__name__)

# SHA da árvore vazia do git — usada para diff do commit raiz (sem pais).
_EMPTY_TREE_SHA = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"


@dataclass
class FileVersion:
    rel_path: str
    name: str
    extension: Optional[str]
    blob_sha: str
    size: int
    commit_hash: str
    commit_short: str
    branch: Optional[str]
    author: Optional[str]
    author_email: Optional[str]
    commit_date: Optional[datetime]
    change_type: str  # A / M / D / R
    is_head: bool


class GitHistoryError(Exception):
    pass


class GitHistoryReader:
    def __init__(self, clone_dir: str):
        try:
            import git  # GitPython
        except Exception as e:  # noqa: BLE001
            raise GitHistoryError(f"GitPython indisponível: {e}")
        self._git = git
        try:
            self.repo = git.Repo(clone_dir)
        except Exception as e:  # noqa: BLE001
            raise GitHistoryError(f"não é um repositório git válido: {e}")
        self.clone_dir = clone_dir

    # ------------------------------------------------------------------
    def _branch_refs(self) -> List[object]:
        """Refs de branch a percorrer: prefere as remotas (origin/*, todas as
        branches trazidas no clone); cai para heads locais; por fim 'HEAD'."""
        refs: List[object] = []
        try:
            origin = self.repo.remote("origin")
            refs = [r for r in origin.refs if getattr(r, "remote_head", "") != "HEAD"]
        except Exception:  # noqa: BLE001
            refs = []
        if not refs:
            try:
                refs = list(self.repo.heads)
            except Exception:  # noqa: BLE001
                refs = []
        if not refs:
            refs = ["HEAD"]  # string aceita por iter_commits
        return refs

    def _head_blob_map(self) -> Dict[str, str]:
        """Mapa {rel_path: blob_sha} da árvore do HEAD (working tree atual)."""
        head_map: Dict[str, str] = {}
        try:
            tree = self.repo.head.commit.tree
            for blob in tree.traverse():
                if getattr(blob, "type", None) == "blob":
                    head_map[blob.path] = blob.hexsha
        except Exception:  # noqa: BLE001
            pass
        return head_map

    @staticmethod
    def _ref_name(ref) -> Optional[str]:
        if isinstance(ref, str):
            return ref
        return getattr(ref, "remote_head", None) or getattr(ref, "name", None) or str(ref)

    @staticmethod
    def _commit_date(commit) -> Optional[datetime]:
        try:
            dt = commit.authored_datetime
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except Exception:  # noqa: BLE001
            return None

    # ------------------------------------------------------------------
    def collect(
        self,
        max_commits: int = 0,
        max_versions_per_file: int = 0,
    ) -> Tuple[List[FileVersion], Dict[str, int]]:
        """Percorre o histórico e devolve (versões, meta).

        max_commits=0 => ilimitado; max_versions_per_file=0 => ilimitado.
        """
        git = self._git
        refs = self._branch_refs()
        head_map = self._head_blob_map()

        versions: List[FileVersion] = []
        seen: Set[Tuple[str, str]] = set()      # (rel_path, blob_sha) já emitidos
        per_file: Dict[str, int] = {}           # rel_path -> nº de versões emitidas
        commits_seen: Set[str] = set()
        commits_count = 0

        def _emit(path: str, blob, ctype: str, commit):
            if blob is None or not path:
                return
            sha = blob.hexsha
            key = (path, sha)
            if key in seen:
                return
            if max_versions_per_file and per_file.get(path, 0) >= max_versions_per_file:
                return
            seen.add(key)
            per_file[path] = per_file.get(path, 0) + 1
            try:
                size = int(blob.size)
            except Exception:  # noqa: BLE001
                size = 0
            name = os.path.basename(path)
            ext = os.path.splitext(name)[1].lower() or None
            versions.append(FileVersion(
                rel_path=path,
                name=name,
                extension=ext,
                blob_sha=sha,
                size=size,
                commit_hash=commit.hexsha,
                commit_short=commit.hexsha[:7],
                branch=self._cur_branch,
                author=(commit.author.name if commit.author else None),
                author_email=(commit.author.email if commit.author else None),
                commit_date=self._commit_date(commit),
                change_type=ctype,
                is_head=(head_map.get(path) == sha),
            ))

        for ref in refs:
            self._cur_branch = self._ref_name(ref)
            try:
                commit_iter = self.repo.iter_commits(ref)
            except Exception:  # noqa: BLE001
                continue
            for commit in commit_iter:
                if max_commits and commits_count >= max_commits:
                    break
                if commit.hexsha in commits_seen:
                    continue
                commits_seen.add(commit.hexsha)
                commits_count += 1

                # Commit raiz (sem pais): todo blob da árvore é um "A" (add).
                # Diff contra a árvore vazia pode falhar se o objeto não existir no ODB,
                # então percorremos a própria árvore do commit.
                if not commit.parents:
                    try:
                        for blob in commit.tree.traverse():
                            if getattr(blob, "type", None) == "blob":
                                _emit(blob.path, blob, "A", commit)
                    except Exception:  # noqa: BLE001
                        pass
                    continue

                try:
                    diffs = commit.parents[0].diff(commit)
                except Exception:  # noqa: BLE001
                    continue

                for d in diffs:
                    try:
                        if d.renamed_file:
                            _emit(d.b_path, d.b_blob, "R", commit)
                            _emit(d.a_path, d.a_blob, "R", commit)
                        elif d.new_file:
                            _emit(d.b_path, d.b_blob, "A", commit)
                        elif d.deleted_file:
                            _emit(d.a_path, d.a_blob, "D", commit)
                        else:  # modificado
                            _emit(d.b_path, d.b_blob, "M", commit)
                            _emit(d.a_path, d.a_blob, "M", commit)
                    except Exception:  # noqa: BLE001
                        continue
            if max_commits and commits_count >= max_commits:
                break

        self._cur_branch = None
        meta = {"commits_count": commits_count, "branches_count": len(refs)}
        return versions, meta

    _cur_branch: Optional[str] = None

    # ------------------------------------------------------------------
    def read_blob(self, blob_sha: str) -> Optional[bytes]:
        """Lê os bytes de um blob pelo seu sha. Chamado sob demanda pelo worker."""
        try:
            obj = self.repo.rev_parse(blob_sha)
            return obj.data_stream.read()
        except Exception as e:  # noqa: BLE001
            logger.debug(f"[git_history] read_blob {blob_sha[:8]} falhou: {e}")
            return None

    def close(self):
        try:
            self.repo.close()
        except Exception:  # noqa: BLE001
            pass
