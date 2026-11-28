"""
API dos overrides de DNS (Configurações -> DNS). CRUD + aplicação no /etc/hosts.
"""
import logging
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from database import get_db, get_db_readonly, DnsOverride
import dns_hosts

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/dns-overrides")


class DnsOverrideIn(BaseModel):
    hostname: str
    ip: str
    enabled: bool = True
    comment: Optional[str] = None


def _dict(o: DnsOverride) -> dict:
    return {
        "id": o.id,
        "hostname": o.hostname,
        "ip": o.ip,
        "enabled": bool(o.enabled),
        "comment": o.comment,
        "created_at": o.created_at.isoformat() if o.created_at else None,
        "updated_at": o.updated_at.isoformat() if o.updated_at else None,
    }


def _validate(payload: DnsOverrideIn):
    host = (payload.hostname or "").strip()
    ip = (payload.ip or "").strip()
    if not dns_hosts.valid_hostname(host):
        raise HTTPException(status_code=400, detail="Hostname inválido")
    if not dns_hosts.valid_ip(ip):
        raise HTTPException(status_code=400, detail="IP inválido (IPv4 ou IPv6)")
    return host, ip


@router.get("")
async def list_overrides(db=Depends(get_db_readonly)):
    rows = (await db.execute(select(DnsOverride).order_by(DnsOverride.hostname))).scalars().all()
    return [_dict(o) for o in rows]


@router.post("")
async def create_override(payload: DnsOverrideIn, db=Depends(get_db)):
    host, ip = _validate(payload)
    exists = (await db.execute(
        select(DnsOverride).where(DnsOverride.hostname == host)
    )).scalar_one_or_none()
    if exists:
        raise HTTPException(status_code=409, detail="Já existe um override para este hostname")
    o = DnsOverride(hostname=host, ip=ip, enabled=payload.enabled, comment=payload.comment)
    db.add(o)
    await db.commit()
    await db.refresh(o)
    await dns_hosts.apply_hosts(db)
    return _dict(o)


@router.put("/{override_id}")
async def update_override(override_id: int, payload: DnsOverrideIn, db=Depends(get_db)):
    host, ip = _validate(payload)
    o = (await db.execute(select(DnsOverride).where(DnsOverride.id == override_id))).scalar_one_or_none()
    if not o:
        raise HTTPException(status_code=404, detail="Override não encontrado")
    dup = (await db.execute(
        select(DnsOverride).where(DnsOverride.hostname == host, DnsOverride.id != override_id)
    )).scalar_one_or_none()
    if dup:
        raise HTTPException(status_code=409, detail="Já existe um override para este hostname")
    o.hostname = host
    o.ip = ip
    o.enabled = payload.enabled
    o.comment = payload.comment
    await db.commit()
    await db.refresh(o)
    await dns_hosts.apply_hosts(db)
    return _dict(o)


@router.delete("/{override_id}")
async def delete_override(override_id: int, db=Depends(get_db)):
    o = (await db.execute(select(DnsOverride).where(DnsOverride.id == override_id))).scalar_one_or_none()
    if not o:
        raise HTTPException(status_code=404, detail="Override não encontrado")
    await db.delete(o)
    await db.commit()
    await dns_hosts.apply_hosts(db)
    return {"success": True}


@router.post("/apply")
async def apply_overrides(db=Depends(get_db)):
    """Reaplica todos os overrides habilitados no /etc/hosts e testa a resolução."""
    return await dns_hosts.apply_hosts(db)


@router.get("/status")
async def dns_status(db=Depends(get_db)):
    """Diagnóstico: reaplica, testa a resolução E o alcance (TCP) do IP dentro do
    container, e mostra o bloco gerenciado atual do /etc/hosts."""
    import asyncio
    import socket as _socket

    res = await dns_hosts.apply_hosts(db)
    res["hosts_path"] = dns_hosts.HOSTS_PATH
    res["managed_block"] = dns_hosts.read_managed_block()

    def _tcp(ip, port, timeout=3):
        s = _socket.socket(_socket.AF_INET, _socket.SOCK_STREAM)
        s.settimeout(timeout)
        try:
            s.connect((ip, port))
            return True
        except Exception:  # noqa: BLE001
            return False
        finally:
            s.close()

    reach = {}
    for e in res.get("entries", []):
        ip = e["ip"]
        if ip in reach:
            continue
        r443 = await asyncio.to_thread(_tcp, ip, 443)
        r80 = await asyncio.to_thread(_tcp, ip, 80)
        reach[ip] = {"443": r443, "80": r80, "reachable": r443 or r80}
    res["reachability"] = reach
    return res
