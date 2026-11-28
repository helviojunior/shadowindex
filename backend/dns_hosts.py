"""
Aplica os overrides de DNS (hostname -> IP) no /etc/hosts do container, dentro de
um bloco gerenciado (entre marcadores). Vale para todo o processo (clones, httpx,
etc.). O Docker recria o /etc/hosts a cada restart, então o bloco é reaplicado no
startup a partir do banco.
"""
import os
import re
import socket
import ipaddress
import logging
from typing import Optional

logger = logging.getLogger(__name__)

HOSTS_PATH = os.environ.get("HOSTS_FILE", "/etc/hosts")
BEGIN = "# >>> shadowindex DNS overrides >>>"
END = "# <<< shadowindex DNS overrides <<<"

_HOSTNAME_RE = re.compile(r"^(?=.{1,253}$)([A-Za-z0-9_](?:[A-Za-z0-9_-]{0,62}[A-Za-z0-9_])?)(\.[A-Za-z0-9_](?:[A-Za-z0-9_-]{0,62}[A-Za-z0-9_])?)*$")


def valid_hostname(h: str) -> bool:
    return bool(h) and bool(_HOSTNAME_RE.match(h.strip()))


def valid_ip(ip: str) -> bool:
    try:
        ipaddress.ip_address((ip or "").strip())
        return True
    except ValueError:
        return False


def _strip_block(content: str) -> str:
    """Remove um bloco gerenciado existente (entre BEGIN e END, inclusive)."""
    pattern = re.compile(
        re.escape(BEGIN) + r".*?" + re.escape(END) + r"\n?",
        re.DOTALL,
    )
    return pattern.sub("", content)


def _render_block(entries) -> str:
    lines = [BEGIN]
    for ip, hostname in entries:
        lines.append(f"{ip}\t{hostname}")
    lines.append(END)
    return "\n".join(lines)


def _write_hosts(entries) -> Optional[str]:
    """entries: lista de (ip, hostname) habilitados. Reescreve o bloco gerenciado.
    Trunca e reescreve IN-PLACE (sem os.replace) p/ funcionar em bind-mount do Docker.
    Retorna None em sucesso, ou a mensagem de erro."""
    try:
        with open(HOSTS_PATH, "r") as f:
            content = f.read()
    except FileNotFoundError:
        content = ""
    except Exception as e:  # noqa: BLE001
        msg = f"não foi possível ler {HOSTS_PATH}: {e}"
        logger.error(f"[dns] {msg}")
        return msg

    base = _strip_block(content).rstrip("\n")
    if entries:
        new = f"{base}\n\n{_render_block(entries)}\n"
    else:
        new = base + "\n"

    try:
        with open(HOSTS_PATH, "w") as f:
            f.write(new)
        return None
    except Exception as e:  # noqa: BLE001
        msg = f"não foi possível escrever {HOSTS_PATH}: {e}"
        logger.error(f"[dns] {msg}")
        return msg


async def apply_hosts(db) -> dict:
    """Lê os overrides habilitados do banco e aplica no /etc/hosts. Retorna
    {count, written, error, entries, resolved}."""
    import asyncio
    from database import DnsOverride
    from sqlalchemy import select
    try:
        rows = (await db.execute(
            select(DnsOverride).where(DnsOverride.enabled.is_(True)).order_by(DnsOverride.hostname)
        )).scalars().all()
    except Exception as e:  # noqa: BLE001
        logger.error(f"[dns] erro ao ler overrides: {e}")
        return {"count": 0, "written": False, "error": str(e), "entries": [], "resolved": {}}

    entries = []
    seen = set()
    for r in rows:
        host = (r.hostname or "").strip()
        ip = (r.ip or "").strip()
        if not host or host.lower() in seen or not valid_ip(ip):
            continue
        seen.add(host.lower())
        entries.append((ip, host))

    err = await asyncio.to_thread(_write_hosts, entries)
    # Teste de resolução DENTRO do container (confirma se o /etc/hosts "pegou").
    resolved = {}
    for ip, host in entries:
        try:
            got = await asyncio.to_thread(socket.gethostbyname, host)
            resolved[host] = {"expected": ip, "got": got, "ok": got == ip}
        except Exception as e:  # noqa: BLE001
            resolved[host] = {"expected": ip, "got": None, "ok": False, "error": str(e)[:120]}

    logger.info(f"[dns] /etc/hosts: {len(entries)} override(s), written={err is None}")
    return {"count": len(entries), "written": err is None, "error": err,
            "entries": [{"ip": ip, "hostname": h} for ip, h in entries], "resolved": resolved}


def read_managed_block() -> str:
    """Retorna o bloco gerenciado atual do /etc/hosts (p/ diagnóstico)."""
    try:
        content = open(HOSTS_PATH, "r").read()
    except Exception:  # noqa: BLE001
        return ""
    m = re.search(re.escape(BEGIN) + r".*?" + re.escape(END), content, re.DOTALL)
    return m.group(0) if m else ""
