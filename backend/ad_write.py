"""Operações de escrita no AD via LDAP (impacket).

Reutiliza o mesmo esquema de autenticação da navegação/varredura (NTLM via
impacket — funciona no OpenSSL 3 — ou Kerberos por ccache). Todas as funções
são SÍNCRONAS e devem ser chamadas em thread (asyncio.to_thread).

As operações que gravam senha (reset de senha, criação de usuário com senha)
exigem canal protegido (LDAPS), pois o AD só aceita `unicodePwd` sobre conexão
cifrada.
"""
import os
import base64
import tempfile
import contextlib
import logging

logger = logging.getLogger(__name__)

# Flags de userAccountControl
UAC_ACCOUNTDISABLE = 0x0002
UAC_NORMAL_ACCOUNT = 0x0200  # 512
# groupType: grupo de segurança global
GROUP_TYPE_GLOBAL_SECURITY = 0x80000002  # -2147483646 como int32


@contextlib.contextmanager
def ldap_session(k):
    """Context manager: abre uma LDAPConnection autenticada a partir dos kwargs
    de `_resolve_scan_kwargs` (host, use_ldaps, auth_method, domain, username,
    password/nthash/ccache_b64, kdc_host, base_dn) e a fecha ao final."""
    from impacket.ldap import ldap as impkt_ldap

    host = k["host"]
    proto = "ldaps" if k.get("use_ldaps") else "ldap"
    base_dn = k.get("base_dn")
    kdc_host = k.get("kdc_host")
    conn = impkt_ldap.LDAPConnection(f"{proto}://{host}", base_dn, kdc_host)

    prev = os.environ.get("KRB5CCNAME")
    cc_path = None
    try:
        if k.get("auth_method") == "kerberos":
            raw = base64.b64decode(k.get("ccache_b64") or "", validate=False)
            fd, cc_path = tempfile.mkstemp(prefix="shadowindex_adw_", suffix=".ccache")
            with os.fdopen(fd, "wb") as fh:
                fh.write(raw)
            os.environ["KRB5CCNAME"] = cc_path
            conn.kerberosLogin(k.get("username") or "", "", (k.get("domain") or "").upper(),
                               "", "", "", kdcHost=kdc_host, useCache=True)
        else:
            nthash = (k.get("nthash") or "").strip()
            lm, nt = (nthash.split(":", 1) if ":" in nthash else ("", nthash))
            conn.login(k.get("username") or "", k.get("password") or "", k.get("domain") or "", lm, nt)
        yield conn
    finally:
        with contextlib.suppress(Exception):
            conn.close()
        if cc_path:
            with contextlib.suppress(OSError):
                os.unlink(cc_path)
        if prev is None:
            os.environ.pop("KRB5CCNAME", None)
        else:
            os.environ["KRB5CCNAME"] = prev


def _get_uac(conn, dn):
    """Lê o userAccountControl atual (int) de um objeto; None se ausente."""
    from impacket.ldap import ldapasn1

    found = {"uac": None}

    def cb(item):
        if not isinstance(item, ldapasn1.SearchResultEntry):
            return
        for attr in item["attributes"]:
            if str(attr["type"]) == "userAccountControl":
                vals = attr["vals"]
                if len(vals):
                    try:
                        found["uac"] = int(str(vals[0]))
                    except (ValueError, TypeError):
                        pass

    conn.search(searchBase=dn, scope=ldapasn1.Scope("baseObject"),
                searchFilter="(objectClass=*)", attributes=["userAccountControl"],
                perRecordCallback=cb)
    return found["uac"]


def set_account_enabled(k, dn, enabled):
    """Habilita/desabilita uma conta (bit ACCOUNTDISABLE do userAccountControl)."""
    with ldap_session(k) as conn:
        uac = _get_uac(conn, dn)
        if uac is None:
            uac = UAC_NORMAL_ACCOUNT
        new_uac = (uac & ~UAC_ACCOUNTDISABLE) if enabled else (uac | UAC_ACCOUNTDISABLE)
        if new_uac == uac:
            return {"ok": True, "unchanged": True, "userAccountControl": uac}
        conn.modify(dn, {"userAccountControl": [(2, str(new_uac))]})
        return {"ok": True, "userAccountControl": new_uac}


def reset_password(k, dn, new_password):
    """Reseta a senha de um objeto (unicodePwd). Requer LDAPS."""
    if not k.get("use_ldaps"):
        raise ValueError("Reset de senha exige LDAPS habilitado no domínio.")
    pwd = ('"%s"' % new_password).encode("utf-16-le")
    with ldap_session(k) as conn:
        conn.modify(dn, {"unicodePwd": [(2, pwd)]})
    return {"ok": True}


def add_group_member(k, group_dn, member_dn):
    """Adiciona um membro (member_dn) a um grupo (group_dn)."""
    with ldap_session(k) as conn:
        conn.modify(group_dn, {"member": [(0, member_dn)]})  # 0 = add
    return {"ok": True}


def create_user(k, parent_dn, cn, sam, password=None, upn=None):
    """Cria um usuário sob parent_dn. Se houver senha e LDAPS, já cria habilitado."""
    dn = f"CN={cn},{parent_dn}"
    with ldap_session(k) as conn:
        attrs = {
            "sAMAccountName": sam,
            "userAccountControl": str(UAC_NORMAL_ACCOUNT | UAC_ACCOUNTDISABLE),  # 514 (criado desabilitado)
        }
        if upn:
            attrs["userPrincipalName"] = upn
        conn.add(dn, ("top", "person", "organizationalPerson", "user"), attrs)
        if password and k.get("use_ldaps"):
            pwd = ('"%s"' % password).encode("utf-16-le")
            conn.modify(dn, {"unicodePwd": [(2, pwd)]})
            conn.modify(dn, {"userAccountControl": [(2, str(UAC_NORMAL_ACCOUNT))]})  # habilita
            return {"ok": True, "dn": dn, "enabled": True}
        return {"ok": True, "dn": dn, "enabled": False,
                "note": "Usuário criado desabilitado (sem senha ou sem LDAPS)."}


def create_group(k, parent_dn, cn, sam):
    """Cria um grupo de segurança global sob parent_dn."""
    dn = f"CN={cn},{parent_dn}"
    with ldap_session(k) as conn:
        # groupType como int32 com sinal
        gt = GROUP_TYPE_GLOBAL_SECURITY - (1 << 32)
        conn.add(dn, ("top", "group"), {"sAMAccountName": sam, "groupType": str(gt)})
    return {"ok": True, "dn": dn}
