"""AD Explorer - conexão LDAP/LDAPS e descoberta de controladores de domínio.

- Descoberta de DCs via DNS SRV (estilo enumdns) com medição de latência TCP,
  escolhendo o DC mais rápido.
- Teste de conexão (bind) com três métodos: certificado cliente (mTLS/LDAPS,
  SASL EXTERNAL via ldap3), usuário/senha (NTLM via ldap3) e Kerberos
  (ticket ccache via impacket).
"""
import os
import ssl
import time
import socket
import base64
import tempfile
import logging

logger = logging.getLogger(__name__)

LDAP_PORT = 389
LDAPS_PORT = 636


# --------------------------------------------------------------------------- #
# Descoberta de DCs (DNS SRV + latência)
# --------------------------------------------------------------------------- #
def _tcp_latency(ip, port, timeout=3.0):
    """Mede a latência de um connect TCP em ms, ou None se inacessível."""
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(timeout)
    t0 = time.time()
    try:
        s.connect((ip, port))
        return round((time.time() - t0) * 1000, 1)
    except Exception:
        return None
    finally:
        try:
            s.close()
        except Exception:
            pass


def _resolver(nameservers=None):
    import dns.resolver
    r = dns.resolver.Resolver(configure=True)
    if nameservers:
        r.nameservers = nameservers
    r.lifetime = 5.0
    r.timeout = 5.0
    return r


def _resolve_a(resolver, host):
    try:
        ans = resolver.resolve(host, "A")
        return str(list(ans)[0])
    except Exception:
        # tenta pelo resolver do sistema
        try:
            return socket.gethostbyname(host)
        except Exception:
            return None


def discover_domain_controllers(domain, nameservers=None, use_ldaps=True,
                                manual_hosts=None, timeout=3.0):
    """Retorna DCs candidatos com latência, ordenados do mais rápido ao mais lento.

    Se manual_hosts for informado, mede apenas esses; caso contrário descobre via
    registros DNS SRV (_ldap._tcp.dc._msdcs.<dom>, _ldap._tcp.<dom>, _gc._tcp.<dom>).
    """
    port = LDAPS_PORT if use_ldaps else LDAP_PORT
    resolver = _resolver(nameservers)

    targets = {}  # host -> origem
    if manual_hosts:
        for h in manual_hosts:
            h = (h or "").strip()
            if h:
                targets[h] = "manual"
    else:
        srv_names = [
            f"_ldap._tcp.dc._msdcs.{domain}",
            f"_ldap._tcp.{domain}",
            f"_gc._tcp.{domain}",
        ]
        for name in srv_names:
            try:
                for a in resolver.resolve(name, "SRV"):
                    host = str(a.target).rstrip(".")
                    if host:
                        targets.setdefault(host, "srv")
            except Exception as e:
                logger.debug(f"SRV {name} falhou: {e}")

    results = []
    for host, origin in targets.items():
        # host informado pode já ser um IP
        ip = host if _looks_like_ip(host) else _resolve_a(resolver, host)
        latency = _tcp_latency(ip, port, timeout) if ip else None
        results.append({
            "host": host,
            "ip": ip,
            "port": port,
            "latency_ms": latency,
            "reachable": latency is not None,
            "source": origin,
        })

    results.sort(key=lambda x: (not x["reachable"], x["latency_ms"] if x["latency_ms"] is not None else 9e9))
    return results


def _looks_like_ip(value):
    import ipaddress
    try:
        ipaddress.ip_address(value)
        return True
    except ValueError:
        return False


# --------------------------------------------------------------------------- #
# Teste de conexão (bind)
# --------------------------------------------------------------------------- #
def _write_temp(content, suffix):
    fd, path = tempfile.mkstemp(prefix="shadowindex_ad_", suffix=suffix)
    with os.fdopen(fd, "w") as fh:
        fh.write(content)
    return path


def _rootdse_info_ldap3(conn):
    info = conn.server.info
    data = {}
    if info:
        try:
            data["naming_contexts"] = list(info.naming_contexts or [])
        except Exception:
            pass
        for attr in ("dnsHostName", "defaultNamingContext", "rootDomainNamingContext",
                     "domainFunctionality", "forestFunctionality"):
            try:
                v = info.other.get(attr) if info.other else None
                if v:
                    data[attr] = v[0] if isinstance(v, list) and len(v) == 1 else v
            except Exception:
                pass
    return data


def test_ldap_connection(host, use_ldaps=True, auth_method="user_password",
                         domain=None, username=None, password=None, nthash=None,
                         client_cert=None, client_key=None, ccache_b64=None,
                         kdc_host=None, port=None, timeout=10):
    """Tenta autenticar em um DC e lê o RootDSE. Retorna dict com success e info."""
    port = port or (LDAPS_PORT if use_ldaps else LDAP_PORT)

    if auth_method == "kerberos":
        return _test_kerberos(host, port, use_ldaps, domain, username, ccache_b64, kdc_host, timeout)

    if auth_method == "cert":
        return _test_cert(host, port, client_cert, client_key, timeout)

    # usuário/senha → NTLM via impacket (evita o problema de MD4 do OpenSSL 3)
    return _test_ntlm(host, port, use_ldaps, domain, username, password, nthash)


def _base_dn(domain):
    if not domain:
        return ""
    return "dc=" + ",dc=".join(domain.lower().split("."))


def _split_nthash(ntlm_hash):
    ntlm_hash = (ntlm_hash or "").strip()
    if not ntlm_hash:
        return "", ""
    if ":" in ntlm_hash:
        lm, nt = ntlm_hash.split(":", 1)
        return lm.strip(), nt.strip()
    return "", ntlm_hash


def _test_cert(host, port, client_cert, client_key, timeout):
    """mTLS/LDAPS com SASL EXTERNAL via ldap3."""
    from ldap3 import Server, Connection, Tls, ALL, SASL, EXTERNAL
    if not client_cert or not client_key:
        return {"success": False, "error": "Certificado e chave privada são obrigatórios."}
    cert_path = _write_temp(client_cert, ".crt")
    key_path = _write_temp(client_key, ".key")
    try:
        tls = Tls(validate=ssl.CERT_NONE, local_certificate_file=cert_path,
                  local_private_key_file=key_path)
        server = Server(host, port=port, use_ssl=True, tls=tls, get_info=ALL, connect_timeout=timeout)
        conn = Connection(server, authentication=SASL, sasl_mechanism=EXTERNAL)
        if not conn.bind():
            return {"success": False, "error": str(conn.result)}
        info = _rootdse_info_ldap3(conn)
        conn.unbind()
        return {"success": True, "server": host, "port": port, "info": info}
    except Exception as e:
        return {"success": False, "error": str(e)}
    finally:
        for p in (cert_path, key_path):
            try:
                os.unlink(p)
            except OSError:
                pass


def _test_ntlm(host, port, use_ldaps, domain, username, password, nthash):
    """Bind NTLM via impacket (login com senha ou hash NT)."""
    if not username:
        return {"success": False, "error": "Usuário é obrigatório para autenticação usuário/senha."}
    try:
        from impacket.ldap import ldap as impkt_ldap
        proto = "ldaps" if use_ldaps else "ldap"
        base_dn = _base_dn(domain)
        lmhash, nt = _split_nthash(nthash)
        conn = impkt_ldap.LDAPConnection(f"{proto}://{host}", base_dn)
        conn.login(username, password or "", domain or "", lmhash, nt)
        conn.close()
        return {"success": True, "server": host, "port": port,
                "info": {"defaultNamingContext": base_dn, "user": username}}
    except Exception as e:
        return {"success": False, "error": str(e)}


def _test_kerberos(host, port, use_ldaps, domain, username, ccache_b64, kdc_host, timeout):
    """Bind Kerberos (GSSAPI) via impacket usando o ticket ccache."""
    if not ccache_b64:
        return {"success": False, "error": "ccache do Kerberos não informado."}
    prev = os.environ.get("KRB5CCNAME")
    cc_path = None
    try:
        from impacket.ldap import ldap as impkt_ldap
        from kerberos_utils import get_ccache_principal

        raw = base64.b64decode(ccache_b64, validate=False)
        fd, cc_path = tempfile.mkstemp(prefix="shadowindex_ad_", suffix=".ccache")
        with os.fdopen(fd, "wb") as fh:
            fh.write(raw)
        os.environ["KRB5CCNAME"] = cc_path

        cc_domain, cc_user = get_ccache_principal(ccache_b64)
        realm = (domain or cc_domain or "").upper()
        user = username or cc_user or ""

        proto = "ldaps" if use_ldaps else "ldap"
        base_dn = "dc=" + ",dc=".join(realm.lower().split(".")) if realm else ""
        conn = impkt_ldap.LDAPConnection(f"{proto}://{host}", base_dn, kdc_host)
        conn.kerberosLogin(user, "", realm, "", "", "", kdcHost=kdc_host, useCache=True)
        conn.close()
        return {"success": True, "server": host, "port": port,
                "info": {"realm": realm, "user": user, "defaultNamingContext": base_dn}}
    except Exception as e:
        return {"success": False, "error": str(e)}
    finally:
        if cc_path:
            try:
                os.unlink(cc_path)
            except OSError:
                pass
        if prev is None:
            os.environ.pop("KRB5CCNAME", None)
        else:
            os.environ["KRB5CCNAME"] = prev
