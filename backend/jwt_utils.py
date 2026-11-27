"""
Utilitários de JWT (sem verificação de assinatura) para:
- decodificar header/claims para exibição;
- gerar texto plano dos claims para INDEXAÇÃO/busca.

Nada aqui valida a assinatura — o objetivo é descoberta/visibilidade de conteúdo.
"""
import re
import json
import base64
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List

# JWT completo (3 partes) para fullmatch; e um padrão "solto" para varrer textos.
_JWT_FULL = re.compile(r"^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$")
_JWT_SCAN = re.compile(r"eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*")


def _b64url_decode(seg: str) -> bytes:
    seg = seg.replace("-", "+").replace("_", "/")
    seg += "=" * (-len(seg) % 4)
    return base64.b64decode(seg)


def looks_like_jwt(s: Optional[str]) -> bool:
    return bool(s) and bool(_JWT_FULL.match(s.strip()))


def decode_jwt(token: Optional[str]) -> Optional[Dict[str, Any]]:
    """Decodifica header + payload. Retorna None se não for um JWT decodificável."""
    if not token:
        return None
    parts = token.strip().split(".")
    if len(parts) < 2:
        return None
    try:
        header = json.loads(_b64url_decode(parts[0]))
        payload = json.loads(_b64url_decode(parts[1]))
    except Exception:  # noqa: BLE001
        return None
    if not isinstance(payload, dict):
        return {"header": header, "payload": payload, "exp": None, "expired": None}
    exp = payload.get("exp")
    exp_dt = None
    expired = None
    if isinstance(exp, (int, float)):
        ms = exp if exp > 1e12 else exp * 1000
        try:
            exp_dt = datetime.fromtimestamp(ms / 1000, tz=timezone.utc)
            expired = exp_dt < datetime.now(timezone.utc)
        except Exception:  # noqa: BLE001
            pass
    return {"header": header, "payload": payload, "exp": exp_dt, "expired": expired}


def _flatten(obj, out: List[str]):
    if isinstance(obj, dict):
        for k, v in obj.items():
            out.append(str(k))
            _flatten(v, out)
    elif isinstance(obj, list):
        for v in obj:
            _flatten(v, out)
    elif obj is not None:
        out.append(str(obj))


def jwt_search_text(token: Optional[str]) -> str:
    """Texto plano (chaves + valores de header e claims) de UM JWT, para busca.
    Retorna '' se não for um JWT decodificável."""
    d = decode_jwt(token)
    if not d:
        return ""
    out: List[str] = []
    _flatten(d.get("header"), out)
    _flatten(d.get("payload"), out)
    return " ".join(out)


def extract_and_decode_claims_text(text: Optional[str], max_tokens: int = 20) -> str:
    """Varre um texto por JWTs e devolve um bloco com os claims decodificados (JSON),
    para anexar ao conteúdo indexado. '' se não houver JWT."""
    if not text or "eyJ" not in text:
        return ""
    seen = set()
    blocks: List[str] = []
    for m in _JWT_SCAN.finditer(text):
        tok = m.group(0)
        if tok in seen:
            continue
        seen.add(tok)
        d = decode_jwt(tok)
        if not d:
            continue
        try:
            blocks.append(json.dumps({"header": d["header"], "payload": d["payload"]}, ensure_ascii=False))
        except Exception:  # noqa: BLE001
            continue
        if len(blocks) >= max_tokens:
            break
    return "\n".join(blocks)
