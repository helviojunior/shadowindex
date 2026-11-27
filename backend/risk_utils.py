"""
Cálculo de criticidade/risco de um finding — FONTE ÚNICA server-side.

Base por tipo de secret (RuleID) e, para JWT, rebaixamento graduado conforme há
quanto tempo o token expirou:
  - expirado há <= 15 dias  -> -25 pontos
  - expirado entre 16 e 90 dias -> -50 pontos
  - expirado há > 90 dias   -> fixa em 10 pontos
O score nunca fica abaixo de 10. O "level" (critical/high/medium/low) é derivado
do score final, para os indicadores da UI ficarem consistentes com o número.
"""
from datetime import datetime, timezone
from typing import Optional, Dict, Any

import jwt_utils


def _base_score(rule_id: Optional[str]) -> int:
    rule = (rule_id or "").lower()
    if any(s in rule for s in ("private-key", "jwt", "rsa")):
        return 100
    if any(s in rule for s in ("aws", "stripe", "github", "ssh")):
        return 50
    if any(s in rule for s in ("slack", "webhook", "password", "token")):
        return 25
    return 10


def _level_from_score(score: int) -> str:
    if score >= 90:
        return "critical"
    if score >= 50:
        return "high"
    if score >= 25:
        return "medium"
    return "low"


def compute_risk(rule_id: Optional[str], secret: Optional[str] = None,
                 match: Optional[str] = None) -> Dict[str, Any]:
    rule = (rule_id or "").lower()
    score = _base_score(rule_id)
    jwt_expired = False
    jwt_exp_days = None

    if "jwt" in rule:
        token = None
        for c in (secret, match):
            if jwt_utils.looks_like_jwt(c):
                token = c.strip()
                break
        if token:
            d = jwt_utils.decode_jwt(token)
            exp = d.get("exp") if d else None  # datetime tz-aware ou None
            if isinstance(exp, datetime):
                now = datetime.now(timezone.utc)
                if exp < now:
                    jwt_expired = True
                    days = (now - exp).days
                    jwt_exp_days = days
                    if days <= 15:
                        score = max(10, score - 25)
                    elif days <= 90:
                        score = max(10, score - 50)
                    else:
                        score = 10

    level = _level_from_score(score)
    return {
        "score": score,
        "level": level,
        "critical": 1 if level == "critical" else 0,
        "high": 1 if level == "high" else 0,
        "medium": 1 if level == "medium" else 0,
        "low": 1 if level == "low" else 0,
        "jwt_expired": jwt_expired,
        "jwt_exp_days": jwt_exp_days,
    }
