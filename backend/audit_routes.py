"""API de auditoria — Chamadas externas (OUTBOUND) registradas pelo ExternalClient."""
import logging
from typing import Optional, Any, Dict

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func, or_

from database import get_db_readonly, ExternalApiCall

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/audit")


def _call_dict(c: ExternalApiCall) -> Dict[str, Any]:
    return {
        "id": c.id,
        "provider": c.provider,
        "context": c.context,
        "method": c.method,
        "url": c.url,
        "status_code": c.status_code,
        "duration_ms": c.duration_ms,
        "request_headers": c.request_headers,
        "request_payload": c.request_payload,
        "response_payload": c.response_payload,
        "error": c.error,
        "created_at": c.created_at.isoformat() if c.created_at else None,
    }


@router.get("/external-calls")
async def list_external_calls(
    q: Optional[str] = None,
    errors_only: bool = False,
    limit: int = Query(100, le=500),
    offset: int = 0,
    db=Depends(get_db_readonly),
):
    base = select(ExternalApiCall)
    cnt = select(func.count(ExternalApiCall.id))
    conds = []
    if q and q.strip():
        like = f"%{q.strip()}%"
        conds.append(or_(
            ExternalApiCall.url.ilike(like),
            ExternalApiCall.provider.ilike(like),
            ExternalApiCall.context.ilike(like),
        ))
    if errors_only:
        conds.append(or_(ExternalApiCall.status_code >= 400, ExternalApiCall.error.isnot(None)))
    for c in conds:
        base = base.where(c)
        cnt = cnt.where(c)
    total = (await db.execute(cnt)).scalar() or 0
    rows = (await db.execute(
        base.order_by(ExternalApiCall.created_at.desc()).limit(limit).offset(offset)
    )).scalars().all()
    return {"total": total, "count": len(rows), "offset": offset,
            "calls": [_call_dict(c) for c in rows]}


@router.get("/external-calls/stats")
async def external_calls_stats(db=Depends(get_db_readonly)):
    total = (await db.execute(select(func.count(ExternalApiCall.id)))).scalar() or 0
    errors = (await db.execute(
        select(func.count(ExternalApiCall.id)).where(
            or_(ExternalApiCall.status_code >= 400, ExternalApiCall.error.isnot(None))
        )
    )).scalar() or 0
    return {"total": total, "errors": errors}
