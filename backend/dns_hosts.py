"""
Aplica os overrides de DNS (hostname -> IP) no /etc/hosts do container, dentro de
um bloco gerenciado (entre marcadores). Vale para todo o processo (clones, httpx,
etc.). O Docker recria o /etc/hosts a cada restart, então o bloco é reaplicado no
startup a partir do banco.
"""
import os
import re
import ipaddress
import logging

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


def _write_hosts(entries) -> None:
    """entries: lista de (ip, hostname) habilitados. Reescreve o bloco gerenciado.
    Trunca e reescreve IN-PLACE (sem os.replace) para funcionar em bind-mount do Docker."""
    try:
        with open(HOSTS_PATH, "r") as f:
            content = f.read()
    except FileNotFoundError:
        content = ""
    except Exception as e:  # noqa: BLE001
        logger.error(f"[dns] não foi possível ler {HOSTS_PATH}: {e}")
        return

    base = _strip_block(content).rstrip("\n")
    if entries:
        new = f"{base}\n\n{_render_block(entries)}\n"
    else:
        new = base + "\n"

    try:
        with open(HOSTS_PATH, "w") as f:
            f.write(new)
    except Exception as e:  # noqa: BLE001
        logger.error(f"[dns] não foi possível escrever {HOSTS_PATH}: {e}")


async def apply_hosts(db) -> int:
    """Lê os overrides habilitados do banco e aplica no /etc/hosts. Retorna a
    quantidade aplicada."""
    from database import DnsOverride
    from sqlalchemy import select
    try:
        rows = (await db.execute(
            select(DnsOverride).where(DnsOverride.enabled.is_(True)).order_by(DnsOverride.hostname)
        )).scalars().all()
    except Exception as e:  # noqa: BLE001
        logger.error(f"[dns] erro ao ler overrides: {e}")
        return 0

    entries = []
    seen = set()
    for r in rows:
        host = (r.hostname or "").strip()
        ip = (r.ip or "").strip()
        if not host or host.lower() in seen or not valid_ip(ip):
            continue
        seen.add(host.lower())
        entries.append((ip, host))

    await _run_in_thread(_write_hosts, entries)
    logger.info(f"[dns] /etc/hosts atualizado com {len(entries)} override(s)")
    return len(entries)


async def _run_in_thread(fn, *args):
    import asyncio
    await asyncio.to_thread(fn, *args)
