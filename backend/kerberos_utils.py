"""Utilitários para lidar com tickets Kerberos (ccache) armazenados em base64.

Usado tanto para validar a expiração antes de tentar autenticar (SMB) quanto
para sinalizar na console de credenciais que um ticket já expirou.
"""
import base64
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

logger = logging.getLogger(__name__)


def _load_ccache_from_b64(ccache_b64: str):
    """Decodifica o base64 e instancia um objeto CCache do impacket."""
    raw = base64.b64decode(ccache_b64, validate=False)
    from impacket.krb5.ccache import CCache
    return CCache(raw)


def get_ccache_expiry(ccache_b64: Optional[str]) -> Optional[datetime]:
    """Retorna o datetime (UTC) de expiração do TGT do ccache.

    Prefere a credencial krbtgt (o TGT, que é o que importa para obter
    tickets de serviço). Se não houver, usa o maior endtime disponível.
    Retorna None quando não for possível determinar.
    """
    if not ccache_b64:
        return None
    try:
        ccache = _load_ccache_from_b64(ccache_b64)
    except Exception as e:
        logger.warning(f"Não foi possível ler o ccache para checar expiração: {e}")
        return None

    tgt_endtime = None
    max_endtime = None
    for cred in getattr(ccache, "credentials", []) or []:
        try:
            endtime = int(cred["time"]["endtime"])
        except Exception:
            continue
        if not endtime:
            continue
        if max_endtime is None or endtime > max_endtime:
            max_endtime = endtime
        try:
            server = cred["server"].prettyPrint()
            if isinstance(server, bytes):
                server = server.decode("utf-8", errors="replace")
            if server.lower().startswith("krbtgt/"):
                if tgt_endtime is None or endtime > tgt_endtime:
                    tgt_endtime = endtime
        except Exception:
            continue

    chosen = tgt_endtime if tgt_endtime is not None else max_endtime
    if chosen is None:
        return None
    try:
        return datetime.fromtimestamp(chosen, tz=timezone.utc)
    except (OverflowError, OSError, ValueError):
        return None


def get_ccache_principal(ccache_b64: Optional[str]):
    """Extrai (domínio/realm, usuário) do ccache. Retorna (None, None) em caso de falha."""
    if not ccache_b64:
        return None, None
    try:
        ccache = _load_ccache_from_b64(ccache_b64)
    except Exception as e:
        logger.warning(f"Não foi possível ler o principal do ccache: {e}")
        return None, None

    domain = None
    username = None
    try:
        realm = ccache.principal.realm["data"]
        domain = realm.decode("utf-8", errors="replace") if isinstance(realm, bytes) else realm
    except Exception:
        pass
    try:
        components = ccache.principal.components
        if components:
            comp = components[0]["data"]
            username = comp.decode("utf-8", errors="replace") if isinstance(comp, bytes) else comp
    except Exception:
        pass
    # Fallback: deriva o usuário do campo client da primeira credencial
    if not username:
        try:
            client = ccache.credentials[0]["client"].prettyPrint()
            if isinstance(client, bytes):
                client = client.decode("utf-8", errors="replace")
            username = client.split("@")[0]
        except Exception:
            pass
    return (domain or None), (username or None)


def is_ccache_expired(ccache_b64: Optional[str], skew_seconds: int = 0) -> Optional[bool]:
    """True se o ticket já expirou, False se válido, None se desconhecido.

    `skew_seconds` permite tolerar uma pequena diferença de relógio.
    """
    expiry = get_ccache_expiry(ccache_b64)
    if expiry is None:
        return None
    return datetime.now(timezone.utc) >= (expiry - timedelta(seconds=skew_seconds))


def assert_ccache_valid(ccache_b64: Optional[str]) -> None:
    """Levanta ValueError se o ccache estiver expirado.

    Um ccache ilegível (expiração desconhecida) NÃO bloqueia a tentativa de
    autenticação - apenas um ticket comprovadamente expirado é recusado aqui.
    """
    expired = is_ccache_expired(ccache_b64)
    if expired is True:
        expiry = get_ccache_expiry(ccache_b64)
        when = expiry.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC") if expiry else "desconhecido"
        raise ValueError(
            f"O ticket Kerberos (ccache) expirou em {when}. "
            "Gere um novo ticket (ex.: kinit / getTGT.py) e atualize a credencial."
        )
