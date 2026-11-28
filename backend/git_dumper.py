"""
Git dumper: detecta um diretório .git EXPOSTO num servidor web e reconstrói o
repositório (baixando objetos/refs/packs) para posterior git checkout. Útil quando
a URL não é um remote git normal, mas o /.git/ está acessível via HTTP.

Método universal (independente de directory listing): baixa os arquivos conhecidos
(HEAD, refs, packed-refs, logs, config, packs) e faz BFS sobre os objetos soltos,
seguindo as referências (commit->tree/parents, tree->entries, tag->object).
"""
import os
import re
import zlib
import asyncio
import logging
from typing import Optional, Dict, Any, Set, Tuple
from urllib.parse import urlparse

import external_http

logger = logging.getLogger(__name__)

_SHA_RE = re.compile(rb"[0-9a-f]{40}")
TIMEOUT = 30
CONCURRENCY = 12
MAX_OBJECTS = 100000

KNOWN_FILES = [
    "HEAD", "ORIG_HEAD", "FETCH_HEAD", "config", "packed-refs", "description",
    "COMMIT_EDITMSG", "info/refs", "info/exclude", "logs/HEAD",
    "refs/heads/master", "refs/heads/main", "refs/heads/develop",
    "refs/remotes/origin/HEAD", "refs/remotes/origin/master", "refs/remotes/origin/main",
    "objects/info/packs", "objects/info/alternates",
]


def git_base(url: str) -> str:
    """Normaliza para a base do /.git/ (termina com '/.git/')."""
    u = (url or "").strip()
    if not u:
        return ""
    if not u.startswith("http://") and not u.startswith("https://"):
        u = "https://" + u
    u = u.rstrip("/")
    if u.endswith("/.git"):
        return u + "/"
    if "/.git/" in u + "/":
        # já aponta para dentro do .git
        idx = u.find("/.git/")
        if idx != -1:
            return u[: idx + len("/.git/")]
    return u + "/.git/"


def _client(proxy: Optional[str] = None):
    """Cliente externo instrumentado (auditado) p/ o dump. As milhares de chamadas
    de objeto usam audit=False; só o probe/known-files são auditados."""
    return external_http.ExternalClient("git-dump", proxy=proxy, verify=False,
                                        timeout=TIMEOUT, context="dump")


async def probe_exposed_git(url: str, proxy: Optional[str] = None) -> Dict[str, Any]:
    """Verifica se há um .git exposto. Retorna {exposed, git_url, head, error}."""
    gurl = git_base(url)
    if not gurl:
        return {"exposed": False, "error": "URL inválida"}
    async with _client(proxy) as c:
        try:
            r = await c.get(gurl + "HEAD", context="probe")
        except Exception as e:  # noqa: BLE001
            return {"exposed": False, "git_url": gurl, "error": str(e)[:200]}
        if r.status_code != 200:
            return {"exposed": False, "git_url": gurl, "error": f"HEAD retornou {r.status_code}"}
        text = (r.text or "").strip()
        # HEAD válido: "ref: refs/heads/..." ou um sha de 40 hex.
        looks = text.startswith("ref:") or bool(re.fullmatch(r"[0-9a-f]{40}", text))
        if not looks:
            return {"exposed": False, "git_url": gurl, "error": "conteúdo de HEAD inesperado"}
        return {"exposed": True, "git_url": gurl, "head": text[:120]}


async def dump_git(url: str, dest_dir: str, proxy: Optional[str] = None,
                   max_objects: int = MAX_OBJECTS) -> Tuple[bool, Optional[str]]:
    """Baixa o .git exposto em `url` para dest_dir/.git e restaura a árvore via git
    checkout. Retorna (ok, erro)."""
    gurl = git_base(url)
    if not gurl:
        return False, "URL inválida"
    git_dir = os.path.join(dest_dir, ".git")
    os.makedirs(git_dir, exist_ok=True)

    fetched: Set[str] = set()
    objects: Set[str] = set()
    sem = asyncio.Semaphore(CONCURRENCY)

    async with _client(proxy) as c:
        async def fetch(rel: str, audit: bool = False) -> Optional[bytes]:
            # audit=True nos arquivos de descoberta (HEAD/refs/packs — poucos);
            # os milhares de objetos usam audit=False p/ não inundar a trilha.
            if rel in fetched:
                return None
            fetched.add(rel)
            async with sem:
                try:
                    r = await c.get(gurl + rel, audit=audit, context="dump")
                except Exception:  # noqa: BLE001
                    return None
            if r.status_code != 200 or not r.content:
                return None
            # Rejeita páginas HTML (404 custom com 200 / index de diretório). Objetos
            # git começam com 0x78 (zlib), refs com hex, packs com 'PACK' — nunca '<'.
            # NÃO confiar no Content-Type (muitos servers servem arquivos sem extensão
            # como text/html, o que faria o dump descartar objetos/refs válidos).
            if r.content.lstrip()[:1] == b"<":
                return None
            path = os.path.join(git_dir, rel.replace("/", os.sep))
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "wb") as f:
                f.write(r.content)
            return r.content

        def collect_shas(data: bytes):
            for m in _SHA_RE.finditer(data or b""):
                objects.add(m.group(0).decode())

        # 1) Arquivos conhecidos -> coleta SHAs. (auditados — são a descoberta)
        for k in KNOWN_FILES:
            d = await fetch(k, audit=True)
            if d:
                collect_shas(d)

        # 1a) Descobre as refs reais: a branch do HEAD simbólico + refs em
        # packed-refs/info/refs. Baixa cada ref (loose) e seu log.
        ref_paths: Set[str] = set()
        for src in ("HEAD", "packed-refs", "info/refs", "FETCH_HEAD"):
            fp = os.path.join(git_dir, src.replace("/", os.sep))
            if not os.path.exists(fp):
                continue
            try:
                data = open(fp, "rb").read()
            except Exception:  # noqa: BLE001
                continue
            for m in re.finditer(rb"refs/[\w./*-]+", data):
                rp = m.group(0).decode()
                if "*" not in rp:
                    ref_paths.add(rp)
        for rp in list(ref_paths):
            d = await fetch(rp, audit=True)
            if d:
                collect_shas(d)
            dl = await fetch("logs/" + rp, audit=True)
            if dl:
                collect_shas(dl)

        # 1b) Packs: via objects/info/packs e, como fallback, via listing do
        # diretório objects/pack/ (repos com gc/empacotados costumam não ter os
        # objetos soltos).
        pack_names: Set[str] = set()
        pth = os.path.join(git_dir, "objects", "info", "packs")
        if os.path.exists(pth):
            try:
                for m in re.finditer(rb"pack-([0-9a-f]{40})\.pack", open(pth, "rb").read()):
                    pack_names.add(m.group(1).decode())
            except Exception:  # noqa: BLE001
                pass
        try:
            rlist = await c.get(gurl + "objects/pack/")
            if rlist.status_code == 200:
                for m in re.finditer(rb"pack-([0-9a-f]{40})\.pack", rlist.content):
                    pack_names.add(m.group(1).decode())
        except Exception:  # noqa: BLE001
            pass
        for name in pack_names:
            await fetch(f"objects/pack/pack-{name}.pack", audit=True)
            await fetch(f"objects/pack/pack-{name}.idx", audit=True)

        if not objects and not pack_names:
            return False, "nenhum objeto/ref encontrado no .git exposto (talvez bloqueado ou vazio)"

        # 2) BFS sobre objetos soltos.
        async def fetch_object(sha: str) -> Optional[bytes]:
            rel = f"objects/{sha[:2]}/{sha[2:]}"
            return await fetch(rel)

        def parse_object(sha: str) -> None:
            path = os.path.join(git_dir, "objects", sha[:2], sha[2:])
            if not os.path.exists(path):
                return
            try:
                raw = zlib.decompress(open(path, "rb").read())
            except Exception:  # noqa: BLE001
                return
            nul = raw.find(b"\x00")
            if nul < 0:
                return
            header = raw[:nul]
            body = raw[nul + 1:]
            typ = header.split(b" ", 1)[0]
            if typ == b"commit":
                for m in re.finditer(rb"(?:tree|parent) ([0-9a-f]{40})", body):
                    objects.add(m.group(1).decode())
            elif typ == b"tag":
                m = re.search(rb"object ([0-9a-f]{40})", body)
                if m:
                    objects.add(m.group(1).decode())
            elif typ == b"tree":
                # entradas: "<mode> <name>\0<20 bytes sha>"
                i = 0
                n = len(body)
                while i < n:
                    sp = body.find(b" ", i)
                    if sp < 0:
                        break
                    z = body.find(b"\x00", sp)
                    if z < 0 or z + 21 > n:
                        break
                    raw_sha = body[z + 1:z + 21]
                    objects.add(raw_sha.hex())
                    i = z + 21

        processed: Set[str] = set()
        count = 0
        while True:
            pending = [s for s in list(objects) if s not in processed]
            if not pending or count >= max_objects:
                break
            # Baixa em lote (bounded pela semaphore).
            await asyncio.gather(*[fetch_object(s) for s in pending[:500]])
            for s in pending[:500]:
                processed.add(s)
                parse_object(s)  # pode adicionar novos SHAs a `objects`
                count += 1

        logger.info(f"[git_dumper] {len(processed)} objeto(s) processados, "
                    f"{len(pack_names)} pack(s), {len(ref_paths)} ref(s) de {gurl}")

        # 3) Restaura a árvore de trabalho a partir do HEAD.
        ok_checkout = await _git_restore(dest_dir)
        if not ok_checkout:
            logger.warning(f"[git_dumper] checkout parcial em {dest_dir} (histórico ainda indexável)")

        # Valida: HEAD deve resolver para um commit (senão o repo não tem conteúdo).
        rc, _ = await _run_git(["-C", dest_dir, "rev-parse", "--verify", "-q", "HEAD"])
        if rc != 0 and not pack_names:
            return False, ("dump incompleto: não foi possível reconstruir o HEAD "
                           "(objetos ausentes/empacotados sem listagem)")
        return True, None


async def _run_git(args, cwd=None) -> Tuple[int, str]:
    try:
        proc = await asyncio.create_subprocess_exec(
            "git", *args, cwd=cwd,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        out, err = await proc.communicate()
        return proc.returncode, (err or out or b"").decode("utf-8", "replace")
    except Exception as e:  # noqa: BLE001
        return 1, str(e)


async def _git_restore(dest_dir: str) -> bool:
    """Restaura a working tree a partir do HEAD do .git reconstruído."""
    # Garante que o git reconheça o repo como não-bare (index pode estar ausente).
    await _run_git(["-C", dest_dir, "config", "--local", "core.bare", "false"])
    # reset --hard reconstrói index + working tree a partir do HEAD (ideal p/ dump).
    rc, _ = await _run_git(["-C", dest_dir, "reset", "--hard", "HEAD"])
    if rc == 0:
        return True
    rc, _ = await _run_git(["-C", dest_dir, "checkout", "-f", "HEAD", "--", "."])
    if rc == 0:
        return True
    rc, _ = await _run_git(["-C", dest_dir, "checkout", "--", "."])
    return rc == 0
