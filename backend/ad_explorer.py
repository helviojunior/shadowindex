"""AD Explorer - importação da árvore do Active Directory a partir de arquivos
BloodHound v6 (SharpHound CE), com parsing em streaming e escrita em lote.

A árvore é montada pelo mesmo princípio das OUs: os relacionamentos
pai→filho vêm do campo ChildObjects de Domain/OU/Container.
"""
import os
import re
import glob
import json
import logging
import zipfile
from decimal import Decimal

import ijson
import psycopg2
from psycopg2.extras import execute_values

logger = logging.getLogger(__name__)

# Tipo do objeto a partir do nome do arquivo do SharpHound:
#   <timestamp>_<tipo>[_NN].json
BH_TYPE_RE = re.compile(
    r'_(domains|ous|containers|gpos|groups|users|computers)(?:_\d+)?\.json$',
    re.IGNORECASE,
)

BH_TYPE_MAP = {
    "domains": "Domain",
    "ous": "OU",
    "containers": "Container",
    "gpos": "GPO",
    "groups": "Group",
    "users": "User",
    "computers": "Computer",
}

# Tipos "container" cujos ChildObjects definem a hierarquia da árvore
CONTAINER_TYPES = {"Domain", "OU", "Container"}


def _sanitize(value):
    """Converte Decimals (vindos do ijson) em int/float recursivamente."""
    if isinstance(value, Decimal):
        f = float(value)
        return int(f) if f.is_integer() else f
    if isinstance(value, dict):
        return {k: _sanitize(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_sanitize(v) for v in value]
    return value


def _to_int(value):
    try:
        if isinstance(value, Decimal):
            return int(value)
        if value is None:
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


def detect_bh_type(path):
    """Retorna o tipo de objeto (singular) a partir do nome do arquivo, ou None."""
    m = BH_TYPE_RE.search(os.path.basename(path))
    if not m:
        return None
    return BH_TYPE_MAP.get(m.group(1).lower())


def discover_bloodhound_files(source_dir):
    """Lista arquivos BloodHound (.json por tipo) em um diretório, extraindo
    zips encontrados para um subdiretório _extracted."""
    files = []
    # Extrair zips primeiro
    for zpath in glob.glob(os.path.join(source_dir, "*.zip")):
        try:
            extract_dir = os.path.join(source_dir, "_extracted")
            os.makedirs(extract_dir, exist_ok=True)
            with zipfile.ZipFile(zpath) as zf:
                zf.extractall(extract_dir)
        except Exception as e:
            logger.warning(f"Falha ao extrair {zpath}: {e}")

    for root, _dirs, names in os.walk(source_dir):
        for n in names:
            if n.lower().endswith(".json") and BH_TYPE_RE.search(n):
                files.append(os.path.join(root, n))
    # Ordena para processar containers/ous/domains cedo (ajuda cache), mas a
    # ligação de pais é feita por staging, então a ordem não é crítica.
    return sorted(files)


_OBJECT_COLUMNS = (
    "domain_id", "object_id", "object_type", "name", "distinguished_name",
    "samaccountname", "description", "parent_object_id", "enabled",
    "highvalue", "whencreated", "properties",
)


def import_bloodhound_files(pg_dsn, domain_id, source_dir, job_id=None, batch_size=2000):
    """Importa todos os arquivos BloodHound de um diretório para ad_objects.

    Retorna um dict com estatísticas. Atualiza ad_scan_jobs.processed_objects
    periodicamente quando job_id é informado.
    """
    files = discover_bloodhound_files(source_dir)
    if not files:
        raise ValueError("Nenhum arquivo BloodHound (.json por tipo) encontrado no upload.")

    conn = psycopg2.connect(pg_dsn)
    conn.autocommit = False
    cur = conn.cursor()

    # Tabela de staging para as arestas da árvore (pai→filho)
    cur.execute(
        "CREATE TABLE IF NOT EXISTS ad_import_edges "
        "(domain_id integer, child text, parent text)"
    )
    cur.execute("DELETE FROM ad_import_edges WHERE domain_id = %s", (domain_id,))
    conn.commit()

    obj_batch = []
    edge_batch = []
    total = 0
    domain_sid = None
    root_oid = None

    def flush_objects():
        nonlocal obj_batch
        if not obj_batch:
            return
        execute_values(
            cur,
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
              enabled=EXCLUDED.enabled, highvalue=EXCLUDED.highvalue,
              whencreated=EXCLUDED.whencreated, properties=EXCLUDED.properties
            """,
            obj_batch,
            template="(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,now())",
            page_size=batch_size,
        )
        obj_batch = []

    def flush_edges():
        nonlocal edge_batch
        if not edge_batch:
            return
        execute_values(
            cur,
            "INSERT INTO ad_import_edges (domain_id, child, parent) VALUES %s",
            edge_batch,
            page_size=batch_size,
        )
        edge_batch = []

    def update_progress(step=None):
        if job_id is None:
            return
        try:
            if step is not None:
                cur.execute(
                    "UPDATE ad_scan_jobs SET processed_objects=%s, current_step=%s WHERE id=%s",
                    (total, step, job_id),
                )
            else:
                cur.execute(
                    "UPDATE ad_scan_jobs SET processed_objects=%s WHERE id=%s",
                    (total, job_id),
                )
        except Exception:
            pass

    try:
        for path in files:
            obj_type = detect_bh_type(path)
            if not obj_type:
                continue
            update_progress(step=f"Importando {os.path.basename(path)}")
            with open(path, "rb") as fh:
                for obj in ijson.items(fh, "data.item"):
                    oid = obj.get("ObjectIdentifier")
                    if not oid:
                        continue
                    props = _sanitize(obj.get("Properties") or {})

                    if obj_type == "Domain":
                        root_oid = root_oid or oid
                        domain_sid = domain_sid or props.get("domainsid") or oid

                    _dn = props.get("distinguishedname")
                    _pdn = _dn.split(",", 1)[1].strip() if _dn and "," in _dn else None
                    obj_batch.append((
                        domain_id,
                        oid,
                        obj_type,
                        props.get("name"),
                        _dn,
                        props.get("samaccountname"),
                        props.get("description"),
                        None,  # parent_object_id resolvido depois via staging
                        _pdn,  # parent_dn (navegação incremental)
                        props.get("enabled"),
                        props.get("highvalue"),
                        _to_int(props.get("whencreated")),
                        json.dumps(props),
                    ))

                    # Arestas da árvore a partir de ChildObjects
                    if obj_type in CONTAINER_TYPES:
                        for child in (obj.get("ChildObjects") or []):
                            child_oid = child.get("ObjectIdentifier")
                            if child_oid:
                                edge_batch.append((domain_id, child_oid, oid))

                    total += 1
                    if len(obj_batch) >= batch_size:
                        flush_objects()
                    if len(edge_batch) >= batch_size:
                        flush_edges()
                    if total % 10000 == 0:
                        flush_objects()
                        flush_edges()
                        conn.commit()
                        update_progress()
                        conn.commit()

        flush_objects()
        flush_edges()
        conn.commit()

        # Resolve a hierarquia (parent_object_id) a partir das arestas
        update_progress(step="Montando a árvore")
        conn.commit()
        cur.execute(
            """
            UPDATE ad_objects o
            SET parent_object_id = e.parent
            FROM ad_import_edges e
            WHERE e.domain_id = %s AND o.domain_id = %s AND o.object_id = e.child
            """,
            (domain_id, domain_id),
        )
        conn.commit()

        # Órfãos (sem pai e que não são a raiz) vão para a raiz do domínio
        if root_oid:
            cur.execute(
                """
                UPDATE ad_objects
                SET parent_object_id = %s
                WHERE domain_id = %s AND parent_object_id IS NULL AND object_id <> %s
                """,
                (root_oid, domain_id, root_oid),
            )
            conn.commit()

        # Contagem de filhos
        update_progress(step="Calculando contagens")
        conn.commit()
        cur.execute("UPDATE ad_objects SET child_count = 0, has_children = false WHERE domain_id = %s", (domain_id,))
        cur.execute(
            """
            UPDATE ad_objects p
            SET child_count = c.cnt, has_children = true
            FROM (
                SELECT parent_object_id AS poid, count(*) AS cnt
                FROM ad_objects
                WHERE domain_id = %s AND parent_object_id IS NOT NULL
                GROUP BY parent_object_id
            ) c
            WHERE p.domain_id = %s AND p.object_id = c.poid
            """,
            (domain_id, domain_id),
        )
        conn.commit()

        # Atualiza o domínio
        cur.execute(
            """
            UPDATE ad_domains
            SET domain_sid = COALESCE(%s, domain_sid),
                object_count = (SELECT count(*) FROM ad_objects WHERE domain_id = %s),
                last_scan_at = now(), updated_at = now()
            WHERE id = %s
            """,
            (domain_sid, domain_id, domain_id),
        )
        cur.execute("DELETE FROM ad_import_edges WHERE domain_id = %s", (domain_id,))
        conn.commit()

        return {
            "total_objects": total,
            "domain_sid": domain_sid,
            "root_object_id": root_oid,
        }
    except Exception:
        conn.rollback()
        raise
    finally:
        try:
            cur.close()
            conn.close()
        except Exception:
            pass
