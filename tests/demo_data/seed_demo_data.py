#!/usr/bin/env python3
"""
Seed de DADOS DE DEMONSTRAÇÃO do ShadowIndex.

Popula o banco com um conjunto pequeno, porém representativo, de dados
FICTÍCIOS para capturar screenshots do repositório público. Nenhum dado real
de cliente é utilizado: domínio = tests.local, nomes de usuário/servidor
gerados a partir da BRWordList (ou fallback embutido).

Cobre as telas:
  - Servidores (lista com risco/leaks/shares/downloads)
  - Browse de um servidor (shares, árvore de arquivos, view/OCR de arquivo)
  - Credenciais: user/senha, NTLM (hash), Kerberos (ccache), token, SSH
  - Proxy Servers (SOCKS5 / Proxychains e HTTP)
  - AD Explorer (domínio tests.local + árvore de objetos BloodHound v6)
  - Leaks (findings do GitLeaks)
  - SQL (conexões + histórico de enumerações)

Projetado para rodar DENTRO do container backend (onde há os models e acesso
ao Postgres). Veja tests/seed-demo.sh.

Uso:
    python seed_demo_data.py            # popula (limpa dados de demo antes)
    python seed_demo_data.py --keep     # não limpa antes de inserir
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone

# ---------------------------------------------------------------------------
# Permite importar os models do backend tanto dentro do container (/app) quanto
# em um checkout local (backend/).
# ---------------------------------------------------------------------------
for _p in ("/app", os.path.join(os.path.dirname(__file__), "..", "..", "backend")):
    _p = os.path.abspath(_p)
    if os.path.isdir(_p) and _p not in sys.path:
        sys.path.insert(0, _p)

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from namegen import NameGenerator, DEMO_DOMAIN, DEMO_DOMAIN_UPPER, DEMO_NETBIOS  # noqa: E402

import database as db  # noqa: E402
from database import (  # noqa: E402
    AsyncSessionLocal,
    Credential,
    ProxyServer,
    PluginInstance,
    Server,
    ServerShare,
    ServerItem,
    DownloadedFile,
    FileVersion,
    GitleaksFinding,
    DatabaseType,
    DatabaseConnection,
    SqlQueryHistory,
    AdDomain,
    AdObject,
    AdGroupMember,
    AdScanJob,
)
from sqlalchemy import select, delete  # noqa: E402

NOW = datetime.now(timezone.utc)
G = NameGenerator(seed=20261126)

STORAGE_BASE = os.path.join(
    os.path.dirname(os.path.abspath(db.__file__)), "data", "storage"
)


def ago(**kw) -> datetime:
    return NOW - timedelta(**kw)


def new_guid() -> str:
    return str(uuid.uuid4())


# ===========================================================================
# Kerberos ccache (MIT ccache v4) — gerado via impacket para o status renderizar
# ===========================================================================
def build_demo_ccache(realm: str, username: str, expired: bool) -> str | None:
    """Monta um ccache MIT v4 mínimo (TGT) em base64, com endtime no passado ou
    futuro. Retorna None se o impacket não estiver disponível."""
    try:
        import struct

        def cos(data: bytes) -> bytes:  # counted octet string
            return struct.pack(">I", len(data)) + data

        def principal(realm_s: str, comps: list[str]) -> bytes:
            out = struct.pack(">I", 1)  # name_type = KRB5_NT_PRINCIPAL
            out += struct.pack(">I", len(comps))
            out += cos(realm_s.encode())
            for c in comps:
                out += cos(c.encode())
            return out

        endtime = int((NOW + timedelta(days=(-2 if expired else 7))).timestamp())
        authtime = int((NOW - timedelta(hours=10)).timestamp())

        client = principal(realm, [username])
        server = principal(realm, ["krbtgt", realm])

        keyblock = struct.pack(">H", 18) + cos(b"\x00" * 32)  # aes256
        times = struct.pack(">IIII", authtime, authtime, endtime, endtime)
        is_skey = b"\x00"
        tktflags = struct.pack(">I", 0x40E00000)
        addresses = struct.pack(">I", 0)
        authdata = struct.pack(">I", 0)
        ticket = cos(b"\x00" * 16)
        second_ticket = cos(b"")

        cred = client + server + keyblock + times + is_skey + tktflags
        cred += addresses + authdata + ticket + second_ticket

        header_tag = struct.pack(">HH", 1, 8) + struct.pack(">II", 0, 0)
        header = struct.pack(">H", len(header_tag)) + header_tag

        blob = struct.pack(">H", 0x0504) + header
        blob += principal(realm, [username])  # default principal
        blob += cred

        # valida com o próprio parser do backend
        from kerberos_utils import get_ccache_expiry

        b64 = base64.b64encode(blob).decode()
        _ = get_ccache_expiry(b64)  # levanta/retorna None se inválido
        return b64
    except Exception as exc:  # noqa: BLE001
        print(f"[seed] aviso: não foi possível montar ccache demo: {exc}")
        return None


# ===========================================================================
# Limpeza de dados de demonstração
# ===========================================================================
async def wipe(session):
    print("[seed] limpando dados anteriores...")
    for model in (
        SqlQueryHistory, DatabaseConnection,
        GitleaksFinding,
        FileVersion, DownloadedFile, ServerItem, ServerShare, Server,
        AdGroupMember, AdObject, AdScanJob, AdDomain,
        ProxyServer, Credential, PluginInstance,
    ):
        await session.execute(delete(model))
    await session.commit()


# ===========================================================================
# Plugins
# ===========================================================================
async def seed_plugins(session) -> dict:
    direct = PluginInstance(
        name="Interação Direta Padrão", plugin_type="direct_interaction",
        description="Acesso SMB direto (autenticação por credencial)",
        is_default=True, is_active=True,
    )
    senha = PluginInstance(
        name="Senha", plugin_type="direct_interaction",
        description="Interação direta usando credencial usuário/senha",
        is_default=False, is_active=True,
    )
    session.add_all([direct, senha])
    await session.flush()
    print(f"[seed] plugins: {direct.name!r}, {senha.name!r}")
    return {"direct": direct.id, "senha": senha.id}


# ===========================================================================
# Proxies (SOCKS5 / Proxychains + HTTP)
# ===========================================================================
async def seed_proxies(session):
    socks = ProxyServer(
        name="Proxychains (SOCKS5)", ip="127.0.0.1", port=1080,
        proxy_type="socks5", dns_servers="10.10.10.10,10.10.10.11",
    )
    http = ProxyServer(
        name="Proxy Corporativo (HTTP)", ip="10.10.0.8", port=3128,
        proxy_type="http", dns_servers="10.10.10.10",
    )
    session.add_all([socks, http])
    await session.flush()
    print("[seed] proxies: SOCKS5 (Proxychains) + HTTP")


# ===========================================================================
# Credenciais (todos os tipos)
# ===========================================================================
async def seed_credentials(session):
    creds = []

    # 1) user/senha
    u1 = G.username()
    creds.append(Credential(
        name=G.full_name(), credential_type="user_password", domain=DEMO_DOMAIN,
        username=u1, password="P@ssw0rd!Demo2026",
        verified=True, last_verified_at=ago(hours=3),
    ))

    # 2) NTLM (hash, SEM senha em claro)
    # NTLM = MD4(UTF-16LE(senha)); md4 nem sempre está disponível no OpenSSL do
    # container, então usamos um hash de exemplo fixo (dado fictício de demo).
    u2 = "svc_" + G.username()
    nt = "b4b9b02e6f09a9bd760f388b67351e2b"
    creds.append(Credential(
        name="T1_APPPOOL_SVC", credential_type="user_password", domain=DEMO_DOMAIN,
        username=u2, password=None, ntlm_hash=nt,
        verified=True, last_verified_at=ago(days=1),
    ))

    # 3) Kerberos (ccache) — expirado
    kuser = "t0_" + G.username()
    cc_exp = build_demo_ccache(DEMO_DOMAIN_UPPER, kuser, expired=True)
    creds.append(Credential(
        name="t0_ad_pool_01", credential_type="kerberos", domain=DEMO_DOMAIN_UPPER,
        username=kuser, kerberos_ccache=cc_exp, kdc_host=f"dc01.{DEMO_DOMAIN}",
        verified=True, last_verified_at=ago(days=2),
    ))

    # 4) Kerberos (ccache) — válido
    kuser2 = "t0_" + G.username()
    cc_ok = build_demo_ccache(DEMO_DOMAIN_UPPER, kuser2, expired=False)
    creds.append(Credential(
        name="t0_ad_pool_02", credential_type="kerberos", domain=DEMO_DOMAIN_UPPER,
        username=kuser2, kerberos_ccache=cc_ok, kdc_host=f"dc02.{DEMO_DOMAIN}",
        verified=True, last_verified_at=ago(hours=6),
    ))

    # 5) Token (bearer)
    creds.append(Credential(
        name="API Automação", credential_type="token",
        token="demo_" + base64.urlsafe_b64encode(os.urandom(24)).decode().rstrip("="),
        token_type="bearer", verified=False,
    ))

    # 6) SSH key
    creds.append(Credential(
        name="Jump Host (SSH)", credential_type="ssh_key",
        username="ansible",
        ssh_private_key="-----BEGIN OPENSSH PRIVATE KEY-----\n"
                        "b3BlbnNzaC1rZXktdjEAAAAA... (demo, truncado) ...\n"
                        "-----END OPENSSH PRIVATE KEY-----\n",
        verified=False,
    ))

    session.add_all(creds)
    await session.flush()
    kerb_status = "ok" if (cc_exp and cc_ok) else "ccache sintético"
    print(f"[seed] credenciais: user/senha, NTLM, Kerberos x2 ({kerb_status}), token, ssh")


# ===========================================================================
# Servidores + 1 servidor "featured" com árvore de arquivos navegável
# ===========================================================================
FEATURED_FOLDERS = [
    "Dados-Botucatu", "Engenharia", "Financas", "Gente & Gestao", "Impressao",
    "Juridico", "Operacao E Manutencao", "Presidencia", "Regulacao",
    "Servicos Corporativos", "Users", "Usuarios",
]


async def seed_servers(session, plugins: dict):
    servers = []
    featured = None
    n_servers = 30

    for i in range(n_servers):
        name = f"{G.server_name()}.{DEMO_DOMAIN}"
        shares_count = G.randint(0, 25)
        downloads = G.randint(0, 220)
        plugin_id = plugins["senha"] if G.random() < 0.4 else plugins["direct"]
        srv = Server(
            guid=new_guid(), name=name, ip=G.ip(), verified=True,
            favorite=(i == 0 or G.random() < 0.08),
            is_checked=True, shares_count=shares_count,
            downloaded_files_count=downloads,
            last_verified_at=ago(days=G.randint(0, 40), hours=G.randint(0, 23)),
            plugin_instance_id=plugin_id, plugin_type="direct_interaction",
        )
        servers.append(srv)
        if i == 0:
            featured = srv

    session.add_all(servers)
    await session.flush()
    print(f"[seed] servidores: {len(servers)} (featured: {featured.name})")

    await seed_featured_tree(session, featured)
    return servers, featured


async def seed_featured_tree(session, server):
    """Share VOL_1 com árvore de pastas + alguns arquivos reais (view/OCR)."""
    share = ServerShare(
        server_id=server.id, server_guid=server.guid, share_name="VOL_1",
        share_type="Disk", remark="Volume corporativo",
        has_children=True, children_fetched=True, discovered_at=ago(days=20),
    )
    session.add(share)
    await session.flush()

    share_root = f"\\\\{server.ip}\\VOL_1"
    server.shares_count = 22
    server.downloaded_files_count = 219

    # pastas de topo
    for folder in FEATURED_FOLDERS:
        session.add(ServerItem(
            server_guid=server.guid, share_name="VOL_1", parent_path=share_root,
            item_type="Directory", name=folder,
            full_path=f"{share_root}\\{folder}",
            has_children=(folder in ("Usuarios", "Servicos Corporativos")),
            children_fetched=(folder in ("Usuarios", "Servicos Corporativos")),
            discovered_at=ago(days=20),
        ))

    # subárvore em Usuarios\<pessoa>\
    person = G.full_name().replace(" ", "")
    usuarios = f"{share_root}\\Usuarios"
    pessoa_path = f"{usuarios}\\{person}"
    session.add(ServerItem(
        server_guid=server.guid, share_name="VOL_1", parent_path=usuarios,
        item_type="Directory", name=person, full_path=pessoa_path,
        has_children=True, children_fetched=True, discovered_at=ago(days=20),
    ))

    # arquivos reais com conteúdo (view/OCR)
    files_spec = [
        {
            "name": "robocopy.txt", "parent": share_root, "folder": "",
            "content": (
                f'robocopy "D:\\Restauradas\\{G.full_name()}_2119848" '
                f'"D:\\Operacao E Manutencao\\Desenvolvimento Operacional" /mir /b /sec /copyall /r:2\n'
                f'robocopy "D:\\Restauradas\\{G.full_name()}_GCRI_Ticket 2119292" '
                f'"D:\\Regulacao\\Gestao Contratual Rel Instit" /mir /b /sec /copyall /r:2\n'
                f'robocopy "D:\\Restauradas\\{G.full_name()}_Gestao_Contratual" '
                f'"D:\\Regulacao\\Gestao Contratual Rel Instit" /mir /b /sec\n'
            ),
            "ocr": None,
        },
        {
            "name": "Senha Cluster.txt", "parent": pessoa_path, "folder": "Usuarios\\" + person,
            "content": "usuario: clusteradmin\nsenha: ******** (mascarado na demo)\n",
            "ocr": "usuario clusteradmin senha mascarado demo",
        },
        {
            "name": "conexao.php", "parent": f"{share_root}\\Servicos Corporativos",
            "folder": "Servicos Corporativos",
            "content": (
                "<?php\n"
                "$host = 'sqlprod01." + DEMO_DOMAIN + "';\n"
                "$user = 'app_reader';\n"
                "$pass = 'Dem0C0nn!2026';  // credencial de exemplo\n"
                "$db   = 'faturamento';\n"
                "$conn = new mysqli($host, $user, $pass, $db);\n"
                "?>\n"
            ),
            "ocr": None,
        },
    ]

    featured_files = []
    for spec in files_spec:
        content = spec["content"].encode("utf-8")
        sha1 = hashlib.sha1(content).hexdigest()

        df = DownloadedFile(
            server_id=server.id, server_guid=server.guid, share_name="VOL_1",
            file_path=f"VOL_1\\{spec['folder']}\\{spec['name']}".replace("\\\\", "\\"),
            file_name=spec["name"], sanitized_path="pending",
            file_size=len(content), sha1_hash=sha1, mimetype="text/plain",
            downloaded_at=ago(days=5),
        )
        session.add(df)
        await session.flush()

        fv = FileVersion(
            server_guid=server.guid, share_name="VOL_1", file_path=df.file_path,
            version_number=1, sha1_hash=sha1, file_size=len(content),
            mimetype="text/plain", local_path="pending", is_current=True,
            ocr_content=spec["ocr"], ocr_processed=bool(spec["ocr"]),
            ocr_processed_at=ago(days=5) if spec["ocr"] else None,
            created_at=ago(days=5),
        )
        session.add(fv)
        await session.flush()

        # caminho padrão: {storage}/{guid}/{share_id}/{file_version_id}
        sanitized = f"{server.guid}/{share.id}/{fv.id}"
        df.sanitized_path = sanitized
        fv.local_path = sanitized

        abs_path = os.path.join(STORAGE_BASE, server.guid, str(share.id), str(fv.id))
        os.makedirs(os.path.dirname(abs_path), exist_ok=True)
        with open(abs_path, "wb") as f:
            f.write(content)

        # também cria o item navegável na árvore
        session.add(ServerItem(
            server_guid=server.guid, share_name="VOL_1", parent_path=spec["parent"],
            item_type="File", name=spec["name"],
            full_path=f"{spec['parent']}\\{spec['name']}",
            size=str(len(content)), modified_at=ago(days=6),
            has_children=False, children_fetched=True, discovered_at=ago(days=20),
        ))
        featured_files.append((df, spec))

    await session.flush()
    print(f"[seed]   featured: share VOL_1, {len(FEATURED_FOLDERS)} pastas, "
          f"{len(files_spec)} arquivos com conteúdo")
    return featured_files


# ===========================================================================
# Leaks (GitLeaks findings)
# ===========================================================================
async def seed_leaks(session, servers, featured):
    s2 = servers[1] if len(servers) > 1 else featured
    findings = [
        dict(rule_id="auto-pfx-private-key", description="Certificado PFX com chave privada",
             file_name="NSPRD.pfx", server_path="VOL_1\\Usuarios\\CertInt",
             tags=["Auto-PFX"], start_line=1, server=None),
        dict(rule_id="auto-pfx-private-key", description="Certificado PFX com chave privada",
             file_name="wildcard_tests_local.pfx", server_path="VOL_1\\Usuarios\\New folder",
             tags=["Auto-PFX"], start_line=1, server=None),
        dict(rule_id="manual-password", description="Credencial identificada manualmente",
             file_name="conexao.php", server_path="VOL_1\\Servicos Corporativos\\WWW",
             tags=["Manual"], start_line=8, server=featured),
        dict(rule_id="manual-password", description="Credencial identificada manualmente",
             file_name="Abertura.config", server_path="VOL_1\\Servicos Corporativos\\CSO",
             tags=["Manual"], start_line=13, server=featured),
        dict(rule_id="azure-ad-client-secret", description="Azure AD Client Secret",
             file_name="OnboardingScript.ps1", server_path="NETLOGON\\Azure_Arc",
             tags=["Scan"], start_line=30, server=s2),
        dict(rule_id="curl-auth-user", description="Possível basic auth em curl",
             file_name="deploy_linux.txt", server_path="NETLOGON\\old\\SIEM.old",
             tags=["Scan"], start_line=5, server=s2),
        dict(rule_id="generic-api-key", description="Chave de API genérica",
             file_name="settings.ini", server_path="VOL_1\\Engenharia\\scada",
             tags=["Scan"], start_line=42, server=s2),
    ]

    for i, f in enumerate(findings):
        srv = f["server"]
        full_path = f"{f['server_path']}\\{f['file_name']}"
        session.add(GitleaksFinding(
            fingerprint=f"demo-{i}-{uuid.uuid4().hex[:12]}",
            rule_id=f["rule_id"], description=f["description"],
            match="***** (mascarado na demo) *****", secret="*****",
            start_line=f["start_line"], end_line=f["start_line"],
            tags=f["tags"], file_name=f["file_name"], server_path=f["server_path"],
            file_path=full_path, original_file=full_path,
            share_name="VOL_1",
            server_name=srv.name if srv else None,
            server_ip=srv.ip if srv else None,
            server_id=srv.id if srv else None,
            extracted_server_guid=srv.guid if srv else None,
            scanned_at=ago(days=3), is_false_positive=False,
            raw_data={"RuleID": f["rule_id"], "demo": True},
        ))
    await session.flush()
    print(f"[seed] leaks: {len(findings)} findings")


# ===========================================================================
# SQL — conexões + histórico de enumerações
# ===========================================================================
async def seed_sql(session):
    # DatabaseTypes são semeados pelo init_db; buscamos os ids.
    res = await session.execute(select(DatabaseType))
    types = {t.code: t.id for t in res.scalars().all()}

    conns = [
        DatabaseConnection(
            name="SQLPROD01 - Faturamento", db_type_id=types.get("mssql"),
            connection_string=f"mssql://app_reader:***@sqlprod01.{DEMO_DOMAIN}:1433/faturamento",
            verified=True, last_verified_at=ago(hours=2),
        ),
        DatabaseConnection(
            name="MYSQL-APP01 - Portal", db_type_id=types.get("mysql"),
            connection_string=f"mysql://portal:***@mysqlapp01.{DEMO_DOMAIN}:3306/portal",
            verified=True, last_verified_at=ago(days=1),
        ),
        DatabaseConnection(
            name="PG-ANALYTICS", db_type_id=types.get("postgres"),
            connection_string=f"postgresql://analytics:***@pg-analytics.{DEMO_DOMAIN}:5432/dw",
            verified=True, last_verified_at=ago(hours=9),
        ),
        DatabaseConnection(
            name="ORACLE-ERP", db_type_id=types.get("oracle"),
            connection_string=f"oracle://erp:***@oracle-erp.{DEMO_DOMAIN}:1521/ERPPDB",
            verified=False,
        ),
    ]
    session.add_all(conns)
    await session.flush()

    enum_queries = [
        ("SELECT name FROM sys.databases ORDER BY name;",
         [["master"], ["msdb"], ["faturamento"], ["cobranca"], ["rh"]]),
        ("SELECT name FROM sys.server_principals WHERE type IN ('S','U') ORDER BY name;",
         [["sa"], ["app_reader"], [f"{DEMO_NETBIOS}\\svc_sql"], [f"{DEMO_NETBIOS}\\dba_group"]]),
        ("SELECT TABLE_SCHEMA, TABLE_NAME FROM INFORMATION_SCHEMA.TABLES;",
         [["dbo", "clientes"], ["dbo", "faturas"], ["dbo", "pagamentos"], ["dbo", "usuarios"]]),
    ]
    import json
    for i, (q, rows) in enumerate(enum_queries):
        conn = conns[0]
        session.add(SqlQueryHistory(
            connection_id=conn.id, connection_name=conn.name, query=q,
            result=json.dumps({"columns": ["col"] if len(rows[0]) == 1 else ["a", "b"],
                               "rows": rows}),
            success=True, execution_time_ms=G.randint(12, 240),
            executed_at=ago(hours=i + 1),
        ))
    await session.flush()
    print(f"[seed] sql: {len(conns)} conexões, {len(enum_queries)} enumerações no histórico")


# ===========================================================================
# AD Explorer — domínio tests.local + árvore BloodHound v6
# ===========================================================================
DOMAIN_SID = "S-1-5-21-1670000111-2450000222-4280000333"


def bh_user_props(sam, enabled=True, highvalue=False):
    return {
        "name": f"{sam.upper()}@{DEMO_DOMAIN_UPPER}", "domain": DEMO_DOMAIN_UPPER,
        "domainsid": DOMAIN_SID, "highvalue": highvalue,
        "distinguishedname": "", "unconstraineddelegation": False,
        "trustedtoauth": False, "passwordnotreqd": False, "enabled": enabled,
        "pwdneverexpires": False, "sensitive": False, "dontreqpreauth": False,
        "serviceprincipalnames": [], "hasspn": False,
    }


async def seed_ad(session):
    domain = AdDomain(
        guid=new_guid(), name=DEMO_DOMAIN, domain_sid=DOMAIN_SID,
        netbios=DEMO_NETBIOS, source="bloodhound", object_count=0,
        last_scan_at=ago(days=1),
    )
    session.add(domain)
    await session.flush()

    dc_dn = ",".join(f"DC={p.upper()}" for p in DEMO_DOMAIN.split("."))
    objects = []
    count = 0

    def add_obj(object_type, name, parent_oid, parent_dn, dn, sam=None,
                enabled=True, highvalue=False, child=False):
        nonlocal count
        count += 1
        oid = f"{DOMAIN_SID}-{10000 + count}"
        props = bh_user_props(sam or name, enabled, highvalue) if object_type in ("User", "Computer", "Group") else {"name": name}
        props["distinguishedname"] = dn
        o = AdObject(
            domain_id=domain.id, object_id=oid, object_type=object_type,
            name=name, distinguished_name=dn, samaccountname=sam,
            description=("Usuário administrativo do AD (Tier-0)" if highvalue else None),
            parent_object_id=parent_oid, parent_dn=parent_dn,
            enabled=enabled if object_type in ("User", "Computer") else None,
            highvalue=highvalue, has_children=child, child_count=0,
            properties=props,
            whencreated=int((NOW - timedelta(days=G.randint(30, 1200))).timestamp()),
        )
        objects.append(o)
        return oid, dn

    # domínio raiz
    root_oid = DOMAIN_SID
    objects.append(AdObject(
        domain_id=domain.id, object_id=root_oid, object_type="Domain",
        name=DEMO_DOMAIN_UPPER, distinguished_name=dc_dn, parent_object_id=None,
        parent_dn=None, has_children=True, child_count=0,
        properties={"name": DEMO_DOMAIN_UPPER, "domainsid": DOMAIN_SID},
    ))

    # OUs de topo (como no exemplo)
    top_ous = [
        "ADMIN", "DEVICES", "DOMAIN CONTROLLERS", "GROUPS", "USER ACCOUNTS",
        "TIER 1 SERVERS", "MANAGED SERVICE ACCOUNTS", "USERS", "COMPUTERS",
    ]
    ou_oids = {}
    for ou in top_ous:
        dn = f"OU={ou},{dc_dn}"
        oid, _ = add_obj("OU", ou, root_oid, dc_dn, dn, child=True)
        ou_oids[ou] = (oid, dn)

    # ADMIN > TIER 0 > T0-ACCOUNTS (usuários tier-0, alguns highvalue/desabilitados)
    admin_oid, admin_dn = ou_oids["ADMIN"]
    t0_oid, t0_dn = add_obj("OU", "TIER 0", admin_oid, admin_dn, f"OU=TIER 0,{admin_dn}", child=True)
    acc_oid, acc_dn = add_obj("OU", "T0-ACCOUNTS", t0_oid, t0_dn, f"OU=T0-ACCOUNTS,{t0_dn}", child=True)
    for _ in range(25):
        sam = "t0" + G.username()
        disp = sam.upper()
        add_obj("User", disp, acc_oid, acc_dn,
                f"CN=T0 - {G.full_name().upper()},{acc_dn}", sam=sam,
                enabled=G.random() > 0.3, highvalue=G.random() < 0.4)

    # USER ACCOUNTS > usuários comuns
    ua_oid, ua_dn = ou_oids["USER ACCOUNTS"]
    for _ in range(40):
        sam = G.username()
        add_obj("User", sam.upper(), ua_oid, ua_dn,
                f"CN={G.full_name().upper()},{ua_dn}", sam=sam,
                enabled=G.random() > 0.15)

    # DEVICES > computadores
    dev_oid, dev_dn = ou_oids["DEVICES"]
    for _ in range(35):
        host = G.server_name().upper().replace(".", "")
        add_obj("Computer", host + "$", dev_oid, dev_dn,
                f"CN={host},{dev_dn}", sam=host + "$", enabled=G.random() > 0.1)

    # DOMAIN CONTROLLERS
    dc_oid, dcdn = ou_oids["DOMAIN CONTROLLERS"]
    for i in range(3):
        host = f"DC0{i+1}"
        add_obj("Computer", host + "$", dc_oid, dcdn, f"CN={host},{dcdn}",
                sam=host + "$", enabled=True, highvalue=True)

    # GROUPS
    grp_oid, grp_dn = ou_oids["GROUPS"]
    for gname in ["Domain Admins", "Enterprise Admins", "Helpdesk", "SQL Admins",
                  "VPN Users", "Backup Operators", "Finance", "Engineering"]:
        add_obj("Group", gname, grp_oid, grp_dn, f"CN={gname},{grp_dn}",
                sam=gname, highvalue=gname.endswith("Admins"))

    session.add_all(objects)
    await session.flush()

    # ajusta contagens de filhos
    domain.object_count = len(objects)

    # job de importação concluído
    session.add(AdScanJob(
        domain_id=domain.id, job_type="bloodhound", status="completed",
        source_path="/app/data/ad_import/tests.local_bloodhound.zip",
        total_objects=len(objects), processed_objects=len(objects),
        current_step="Concluído", created_at=ago(days=1, hours=1),
        started_at=ago(days=1, hours=1), finished_at=ago(days=1),
    ))
    await session.flush()
    print(f"[seed] ad: domínio {DEMO_DOMAIN}, {len(objects)} objetos, 1 job concluído")


# ===========================================================================
# main
# ===========================================================================
async def main():
    keep = "--keep" in sys.argv
    # garante que as tabelas/seeds padrão existam (DatabaseTypes, presets, etc.)
    await db.init_db()

    async with AsyncSessionLocal() as session:
        if not keep:
            await wipe(session)

        plugins = await seed_plugins(session)
        await seed_proxies(session)
        await seed_credentials(session)
        servers, featured = await seed_servers(session, plugins)
        await seed_leaks(session, servers, featured)
        await seed_sql(session)
        await seed_ad(session)

        await session.commit()

    print("\n[seed] ✅ concluído. Abra http://localhost:3000 para capturar os screenshots.")


if __name__ == "__main__":
    asyncio.run(main())
