"""AD Explorer - varredura recursiva da árvore do AD via LDAP (ao vivo).

Percorre toda a subárvore do domínio com paged search (impacket), extrai os
campos no espírito do BloodHound v6 e persiste em ad_objects usando o mesmo
pipeline em lote do import. A hierarquia é montada pela própria DN (o pai de um
objeto é o objeto cuja DN é a DN do filho sem o primeiro RDN) — ou seja, segue
o mesmo princípio das OUs.
"""
import os
import json
import uuid
import base64
import logging
import tempfile
from datetime import datetime, timezone

import psycopg2
from psycopg2.extras import execute_values

logger = logging.getLogger(__name__)

# Atributos LDAP coletados (mapeáveis para os Properties do BloodHound v6)
LDAP_ATTRIBUTES = [
    "objectSid", "objectGUID", "objectClass", "distinguishedName", "name",
    "sAMAccountName", "description", "whenCreated", "userAccountControl",
    "adminCount", "servicePrincipalName", "operatingSystem", "operatingSystemVersion",
    "displayName", "mail", "memberOf", "primaryGroupID", "pwdLastSet",
    "lastLogonTimestamp", "gPCFileSysPath", "gPLink", "member",
]


def _decode(v):
    """Converte qualquer valor LDAP (bytes, str ou tipos asn1 do impacket) em str."""
    if isinstance(v, str):
        return v
    if isinstance(v, bytes):
        try:
            return v.decode("utf-8", errors="replace")
        except Exception:
            return v.hex()
    # Tipos asn1 do impacket (LDAPDN, OctetString, ...)
    try:
        return v.asOctets().decode("utf-8", errors="replace")
    except Exception:
        try:
            return bytes(v).decode("utf-8", errors="replace")
        except Exception:
            return str(v)


def _raw_bytes(v):
    """Extrai os bytes brutos de um valor LDAP (para objectSid/objectGUID)."""
    try:
        return v.asOctets()
    except Exception:
        try:
            return bytes(v)
        except Exception:
            return b""


def _gentime_to_epoch(value):
    """Converte generalizedTime (ex.: 20200101000000.0Z) em epoch (int)."""
    if not value:
        return None
    try:
        s = str(value).split(".")[0].rstrip("Z")
        dt = datetime.strptime(s, "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
        return int(dt.timestamp())
    except Exception:
        return None


def _object_type_from_classes(classes):
    cl = {c.lower() for c in classes}
    if "computer" in cl:
        return "Computer"
    if "grouppolicycontainer" in cl:
        return "GPO"
    if "organizationalunit" in cl:
        return "OU"
    if "group" in cl:
        return "Group"
    if "domaindns" in cl or "domain" in cl:
        return "Domain"
    if "user" in cl:
        return "User"
    if "container" in cl:
        return "Container"
    if "foreignsecurityprincipal" in cl:
        return "ForeignSecurityPrincipal"
    # usa a classe mais específica como fallback
    ordered = [c for c in classes if c.lower() != "top"]
    return (ordered[-1][:1].upper() + ordered[-1][1:]) if ordered else "Base"


def _format_sid(raw):
    try:
        from impacket.ldap.ldaptypes import LDAP_SID
        sid = LDAP_SID()
        sid.fromString(raw)
        return sid.formatCanonical()
    except Exception:
        return None


def _format_guid(raw):
    try:
        return str(uuid.UUID(bytes_le=raw)).upper()
    except Exception:
        try:
            return str(uuid.UUID(bytes=raw)).upper()
        except Exception:
            return None


def _parent_dn(dn):
    if not dn or "," not in dn:
        return None
    return dn.split(",", 1)[1].strip()


def _parse_search_entry(item):
    """Converte uma SearchResultEntry do impacket em (dn, attrs dict)."""
    from impacket.ldap import ldapasn1
    if not isinstance(item, ldapasn1.SearchResultEntry):
        return None, None
    dn = _decode(item["objectName"])
    attrs = {}
    for attr in item["attributes"]:
        key = str(attr["type"])
        vals = attr["vals"]
        if key == "objectSid":
            attrs["_objectSid_raw"] = _raw_bytes(vals[0]) if len(vals) else b""
            continue
        if key == "objectGUID":
            attrs["_objectGUID_raw"] = _raw_bytes(vals[0]) if len(vals) else b""
            continue
        decoded = [_decode(v) for v in vals]
        if key in ("objectClass", "servicePrincipalName", "memberOf", "member"):
            attrs[key] = decoded
        else:
            attrs[key] = decoded[0] if decoded else None
    return dn, attrs


CONTAINER_TYPES = {"Domain", "OU", "Container"}


def _attrs_to_node(dn, attrs):
    """Monta um nó (dict) para navegação ao vivo a partir dos atributos LDAP."""
    classes = attrs.get("objectClass") or []
    otype = _object_type_from_classes(classes)
    oid = None
    if attrs.get("_objectSid_raw"):
        oid = _format_sid(attrs["_objectSid_raw"])
    if not oid and attrs.get("_objectGUID_raw"):
        oid = _format_guid(attrs["_objectGUID_raw"])
    oid = oid or dn

    uac = attrs.get("userAccountControl")
    enabled = None
    try:
        if uac is not None:
            enabled = not (int(uac) & 0x2)
    except Exception:
        enabled = None

    admincount = attrs.get("adminCount")
    props = {
        "name": attrs.get("name"),
        "distinguishedname": dn,
        "samaccountname": attrs.get("sAMAccountName"),
        "description": attrs.get("description"),
        "displayname": attrs.get("displayName"),
        "email": attrs.get("mail"),
        "enabled": enabled,
        "admincount": str(admincount) == "1" if admincount is not None else None,
        "operatingsystem": attrs.get("operatingSystem"),
        "serviceprincipalnames": attrs.get("servicePrincipalName"),
        "memberof": attrs.get("memberOf"),
        "whencreated": _gentime_to_epoch(attrs.get("whenCreated")),
        "objectclass": classes,
    }
    props = {k: v for k, v in props.items() if v is not None}
    members = attrs.get("member") or []
    # Grupos são expansíveis quando possuem membros diretos (atributo `member`)
    is_group = otype == "Group"
    return {
        "object_id": oid,
        "object_type": otype,
        "name": attrs.get("name") or dn,
        "distinguished_name": dn,
        "samaccountname": attrs.get("sAMAccountName"),
        "description": attrs.get("description"),
        "enabled": enabled,
        "highvalue": (str(admincount) == "1") or None,
        "whencreated": _gentime_to_epoch(attrs.get("whenCreated")),
        "has_children": (otype in CONTAINER_TYPES) or (is_group and len(members) > 0),
        "child_count": len(members) if is_group else 0,
        "properties": props,
    }


class _TreeWriter:
    """Acumula objetos e grava em lote em ad_objects; progresso no job."""

    def __init__(self, pg_dsn, domain_id, job_id=None, batch_size=1000):
        self.conn = psycopg2.connect(pg_dsn)
        self.conn.autocommit = False
        self.cur = self.conn.cursor()
        self.domain_id = domain_id
        self.job_id = job_id
        self.batch_size = batch_size
        self.batch = []
        self.total = 0
        self.domain_sid = None
        self.root_oid = None

    def add(self, row):
        self.batch.append(row)
        self.total += 1
        if len(self.batch) >= self.batch_size:
            self.flush()
        if self.total % 5000 == 0 and self.job_id is not None:
            self.cur.execute(
                "UPDATE ad_scan_jobs SET processed_objects=%s, current_step=%s WHERE id=%s",
                (self.total, f"Coletados {self.total} objetos", self.job_id),
            )
            self.conn.commit()

    def flush(self):
        if not self.batch:
            return
        execute_values(
            self.cur,
            """
            INSERT INTO ad_objects
              (domain_id, object_id, object_type, name, distinguished_name,
               samaccountname, description, parent_object_id, parent_dn, enabled, highvalue,
               whencreated, properties, created_at)
            VALUES %s
            ON CONFLICT (domain_id, object_id) DO UPDATE SET
              object_type=EXCLUDED.object_type, name=EXCLUDED.name,
              distinguished_name=EXCLUDED.distinguished_name,
              samaccountname=EXCLUDED.samaccountname, description=EXCLUDED.description,
              parent_dn=EXCLUDED.parent_dn,
              enabled=EXCLUDED.enabled, whencreated=EXCLUDED.whencreated,
              properties=EXCLUDED.properties
            """,
            self.batch,
            template="(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,now())",
            page_size=self.batch_size,
        )
        self.conn.commit()
        self.batch = []

    def finalize(self):
        self.flush()
        did = self.domain_id
        # Resolve o pai pela DN (pai = objeto cuja DN == DN do filho sem o 1º RDN)
        if self.job_id is not None:
            self.cur.execute("UPDATE ad_scan_jobs SET current_step=%s WHERE id=%s", ("Montando a árvore", self.job_id))
            self.conn.commit()
        self.cur.execute(
            """
            UPDATE ad_objects c
            SET parent_object_id = p.object_id
            FROM ad_objects p
            WHERE c.domain_id = %s AND p.domain_id = %s
              AND c.distinguished_name IS NOT NULL
              AND lower(p.distinguished_name) = lower(substring(c.distinguished_name from position(',' in c.distinguished_name) + 1))
              AND c.object_id <> p.object_id
            """,
            (did, did),
        )
        self.conn.commit()
        # Órfãos vão para a raiz
        if self.root_oid:
            self.cur.execute(
                "UPDATE ad_objects SET parent_object_id=%s WHERE domain_id=%s AND parent_object_id IS NULL AND object_id<>%s",
                (self.root_oid, did, self.root_oid),
            )
            self.conn.commit()
        # Contagem de filhos
        self.cur.execute("UPDATE ad_objects SET child_count=0, has_children=false WHERE domain_id=%s", (did,))
        self.cur.execute(
            """
            UPDATE ad_objects p SET child_count=c.cnt, has_children=true
            FROM (SELECT parent_object_id poid, count(*) cnt FROM ad_objects
                  WHERE domain_id=%s AND parent_object_id IS NOT NULL GROUP BY parent_object_id) c
            WHERE p.domain_id=%s AND p.object_id=c.poid
            """,
            (did, did),
        )
        self.cur.execute(
            """
            UPDATE ad_domains SET domain_sid=COALESCE(%s, domain_sid),
              object_count=(SELECT count(*) FROM ad_objects WHERE domain_id=%s),
              last_scan_at=now(), updated_at=now(), source='ldap' WHERE id=%s
            """,
            (self.domain_sid, did, did),
        )
        self.conn.commit()

    def close(self):
        try:
            self.cur.close(); self.conn.close()
        except Exception:
            pass


def _entry_to_row(writer, dn, attrs):
    """Converte um conjunto de atributos LDAP numa linha de ad_objects."""
    classes = attrs.get("objectClass") or []
    obj_type = _object_type_from_classes(classes)

    oid = None
    if attrs.get("_objectSid_raw"):
        oid = _format_sid(attrs["_objectSid_raw"])
    if not oid and attrs.get("_objectGUID_raw"):
        oid = _format_guid(attrs["_objectGUID_raw"])
    if not oid:
        oid = dn  # fallback

    if obj_type == "Domain":
        writer.root_oid = writer.root_oid or oid
        if attrs.get("_objectSid_raw"):
            writer.domain_sid = writer.domain_sid or _format_sid(attrs["_objectSid_raw"])

    uac = attrs.get("userAccountControl")
    enabled = None
    try:
        if uac is not None:
            enabled = not (int(uac) & 0x2)  # ACCOUNTDISABLE
    except Exception:
        enabled = None

    admincount = attrs.get("adminCount")
    highvalue = True if str(admincount) == "1" else None

    # Properties no espírito do BloodHound v6
    props = {
        "name": attrs.get("name"),
        "distinguishedname": dn,
        "samaccountname": attrs.get("sAMAccountName"),
        "description": attrs.get("description"),
        "displayname": attrs.get("displayName"),
        "email": attrs.get("mail"),
        "enabled": enabled,
        "admincount": str(admincount) == "1" if admincount is not None else None,
        "operatingsystem": attrs.get("operatingSystem"),
        "serviceprincipalnames": attrs.get("servicePrincipalName"),
        "memberof": attrs.get("memberOf"),
        "whencreated": _gentime_to_epoch(attrs.get("whenCreated")),
        "objectclass": classes,
    }
    props = {k: v for k, v in props.items() if v is not None}

    return (
        writer.domain_id, oid, obj_type,
        attrs.get("name"), dn, attrs.get("sAMAccountName"),
        attrs.get("description"), None, _parent_dn(dn), enabled, highvalue,
        _gentime_to_epoch(attrs.get("whenCreated")), json.dumps(props),
    )


def scan_ldap_tree(pg_dsn, domain_id, host, use_ldaps, base_dn,
                   auth_method, domain=None, username=None, password=None,
                   nthash=None, ccache_b64=None, kdc_host=None,
                   job_id=None, size_limit=0):
    """Varre toda a subárvore do domínio via LDAP e persiste em ad_objects."""
    from impacket.ldap import ldap as impkt_ldap, ldapasn1
    from impacket.ldap.ldap import LDAPSearchError

    proto = "ldaps" if use_ldaps else "ldap"
    conn = impkt_ldap.LDAPConnection(f"{proto}://{host}", base_dn, kdc_host)

    prev = os.environ.get("KRB5CCNAME")
    cc_path = None
    try:
        if auth_method == "kerberos":
            raw = base64.b64decode(ccache_b64, validate=False)
            fd, cc_path = tempfile.mkstemp(prefix="shadowindex_ad_", suffix=".ccache")
            with os.fdopen(fd, "wb") as fh:
                fh.write(raw)
            os.environ["KRB5CCNAME"] = cc_path
            conn.kerberosLogin(username or "", "", (domain or "").upper(), "", "", "", kdcHost=kdc_host, useCache=True)
        else:
            lm, nt = ("", "")
            if nthash:
                nthash = nthash.strip()
                lm, nt = (nthash.split(":", 1) if ":" in nthash else ("", nthash))
            conn.login(username or "", password or "", domain or "", lm, nt)

        writer = _TreeWriter(pg_dsn, domain_id, job_id)

        def process(item):
            dn, attrs = _parse_search_entry(item)
            if dn is None:
                return
            try:
                writer.add(_entry_to_row(writer, dn, attrs))
            except Exception as e:
                logger.warning(f"Falha ao processar {dn}: {e}")

        try:
            sc = ldapasn1.SimplePagedResultsControl(criticality=True, size=1000)
        except Exception:
            sc = None

        conn.search(
            searchBase=base_dn,
            searchFilter="(objectClass=*)",
            attributes=LDAP_ATTRIBUTES,
            sizeLimit=size_limit,
            searchControls=[sc] if sc else None,
            perRecordCallback=process,
        )

        writer.finalize()
        total = writer.total
        domain_sid = writer.domain_sid
        writer.close()
        try:
            conn.close()
        except Exception:
            pass
        return {"total_objects": total, "domain_sid": domain_sid}
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


def _ldap_filter_escape(value):
    """Escapa um valor para uso seguro em filtro LDAP (RFC 4515)."""
    out = []
    for ch in (value or ""):
        if ch == "\\":
            out.append("\\5c")
        elif ch == "(":
            out.append("\\28")
        elif ch == ")":
            out.append("\\29")
        elif ch == "*":
            out.append("\\2a")
        elif ch == "\x00":
            out.append("\\00")
        else:
            out.append(ch)
    return "".join(out)


def ldap_browse(host, use_ldaps, parent_dn, auth_method, domain=None, username=None,
                password=None, nthash=None, ccache_b64=None, kdc_host=None,
                root=False, base_dn=None, members_of=None):
    """Lista os filhos imediatos de um nó (scope singleLevel) ou o próprio nó raiz
    (baseObject). Com `members_of` (DN de um grupo), lista os membros diretos do
    grupo (subtree + filtro memberOf). Usado para navegação LDAP ao vivo, sem
    persistência."""
    from impacket.ldap import ldap as impkt_ldap, ldapasn1

    if members_of:
        search_base = base_dn
    else:
        search_base = base_dn if root else parent_dn
    proto = "ldaps" if use_ldaps else "ldap"
    conn = impkt_ldap.LDAPConnection(f"{proto}://{host}", base_dn or parent_dn, kdc_host)

    prev = os.environ.get("KRB5CCNAME")
    cc_path = None
    try:
        if auth_method == "kerberos":
            raw = base64.b64decode(ccache_b64, validate=False)
            fd, cc_path = tempfile.mkstemp(prefix="shadowindex_ad_", suffix=".ccache")
            with os.fdopen(fd, "wb") as fh:
                fh.write(raw)
            os.environ["KRB5CCNAME"] = cc_path
            conn.kerberosLogin(username or "", "", (domain or "").upper(), "", "", "", kdcHost=kdc_host, useCache=True)
        else:
            lm, nt = ("", "")
            if nthash:
                nthash = nthash.strip()
                lm, nt = (nthash.split(":", 1) if ":" in nthash else ("", nthash))
            conn.login(username or "", password or "", domain or "", lm, nt)

        if members_of:
            scope = ldapasn1.Scope("wholeSubtree")
            search_filter = f"(memberOf={_ldap_filter_escape(members_of)})"
        elif root:
            scope = ldapasn1.Scope("baseObject")
            search_filter = "(objectClass=*)"
        else:
            scope = ldapasn1.Scope("singleLevel")
            search_filter = "(objectClass=*)"
        nodes = []

        def cb(item):
            dn, attrs = _parse_search_entry(item)
            if dn is None:
                return
            # Em singleLevel, ignora eventual retorno do próprio base
            if not root and not members_of and dn and dn.strip().lower() == (search_base or "").strip().lower():
                return
            nodes.append(_attrs_to_node(dn, attrs))

        try:
            sc = ldapasn1.SimplePagedResultsControl(criticality=True, size=1000)
        except Exception:
            sc = None

        conn.search(searchBase=search_base, scope=scope, searchFilter=search_filter,
                    attributes=LDAP_ATTRIBUTES, sizeLimit=0,
                    searchControls=[sc] if sc else None, perRecordCallback=cb)
        try:
            conn.close()
        except Exception:
            pass

        rank = {"Domain": 0, "OU": 1, "Container": 2, "GPO": 3, "Group": 4, "User": 5, "Computer": 6}
        nodes.sort(key=lambda n: (rank.get(n["object_type"], 9), (n["name"] or "").lower()))
        return nodes
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
