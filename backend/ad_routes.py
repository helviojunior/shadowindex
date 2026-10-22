"""AD Explorer - endpoints de domínios, importação BloodHound (background/jobs),
navegação da árvore e busca."""
import os
import uuid
import asyncio
import logging
import shutil
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel
from sqlalchemy import select, delete, func, or_, and_

from database import (
    get_db, get_db_readonly, AsyncSessionLocal,
    AdDomain, AdObject, AdScanJob, AdGroupMember, Credential, POSTGRES_URL,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ad")

AD_IMPORT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "ad_import")


# --------------------------------------------------------------------------- #
# Models
# --------------------------------------------------------------------------- #
class AdDomainCreate(BaseModel):
    name: str
    dc_hosts: Optional[str] = None
    dc_discovery: Optional[bool] = True
    use_ldaps: Optional[bool] = True
    auth_method: Optional[str] = None
    credential_id: Optional[int] = None


class AdDomainResponse(BaseModel):
    id: int
    name: str
    domain_sid: Optional[str] = None
    netbios: Optional[str] = None
    source: Optional[str] = None
    object_count: int = 0
    dc_hosts: Optional[str] = None
    dc_discovery: Optional[bool] = True
    use_ldaps: Optional[bool] = True
    auth_method: Optional[str] = None
    credential_id: Optional[int] = None
    selected_dc: Optional[str] = None
    last_scan_at: Optional[datetime] = None
    created_at: datetime

    class Config:
        from_attributes = True


class AdObjectNode(BaseModel):
    id: int
    object_id: str
    object_type: str
    name: Optional[str] = None
    distinguished_name: Optional[str] = None
    samaccountname: Optional[str] = None
    description: Optional[str] = None
    enabled: Optional[bool] = None
    highvalue: Optional[bool] = None
    whencreated: Optional[int] = None
    has_children: Optional[bool] = False
    child_count: Optional[int] = 0

    class Config:
        from_attributes = True


class AdJobResponse(BaseModel):
    id: int
    domain_id: int
    job_type: str
    status: str
    total_objects: int = 0
    processed_objects: int = 0
    current_step: Optional[str] = None
    error_message: Optional[str] = None
    created_at: datetime
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# --------------------------------------------------------------------------- #
# Domínios CRUD
# --------------------------------------------------------------------------- #
@router.post("/domains", response_model=AdDomainResponse)
async def create_domain(payload: AdDomainCreate, db=Depends(get_db)):
    name = (payload.name or "").strip().lower()
    if not name:
        raise HTTPException(status_code=422, detail="Informe o domínio (FQDN).")
    existing = await db.execute(select(AdDomain).where(func.lower(AdDomain.name) == name))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Já existe um domínio com esse nome.")
    dom = AdDomain(
        guid=str(uuid.uuid4()),
        name=name,
        dc_hosts=payload.dc_hosts,
        dc_discovery=payload.dc_discovery if payload.dc_discovery is not None else True,
        use_ldaps=payload.use_ldaps if payload.use_ldaps is not None else True,
        auth_method=payload.auth_method,
        credential_id=payload.credential_id,
        source="bloodhound",
    )
    db.add(dom)
    await db.commit()
    await db.refresh(dom)
    return dom


@router.get("/domains", response_model=List[AdDomainResponse])
async def list_domains(db=Depends(get_db_readonly)):
    result = await db.execute(select(AdDomain).order_by(AdDomain.name))
    return result.scalars().all()


@router.get("/domains/{domain_id}", response_model=AdDomainResponse)
async def get_domain(domain_id: int, db=Depends(get_db_readonly)):
    dom = (await db.execute(select(AdDomain).where(AdDomain.id == domain_id))).scalar_one_or_none()
    if not dom:
        raise HTTPException(status_code=404, detail="Domínio não encontrado")
    return dom


class AdDomainUpdate(BaseModel):
    netbios: Optional[str] = None
    dc_hosts: Optional[str] = None
    dc_discovery: Optional[bool] = None
    use_ldaps: Optional[bool] = None
    auth_method: Optional[str] = None
    credential_id: Optional[int] = None
    client_cert: Optional[str] = None
    client_key: Optional[str] = None
    selected_dc: Optional[str] = None


@router.put("/domains/{domain_id}", response_model=AdDomainResponse)
async def update_domain(domain_id: int, payload: AdDomainUpdate, db=Depends(get_db)):
    dom = (await db.execute(select(AdDomain).where(AdDomain.id == domain_id))).scalar_one_or_none()
    if not dom:
        raise HTTPException(status_code=404, detail="Domínio não encontrado")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(dom, field, value)
    dom.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(dom)
    return dom


class DiscoverRequest(BaseModel):
    nameservers: Optional[List[str]] = None


@router.post("/domains/{domain_id}/discover-dcs")
async def discover_dcs(domain_id: int, payload: DiscoverRequest, db=Depends(get_db_readonly)):
    """Descobre controladores de domínio (DNS SRV) e mede a latência de cada um."""
    from ad_ldap import discover_domain_controllers

    dom = (await db.execute(select(AdDomain).where(AdDomain.id == domain_id))).scalar_one_or_none()
    if not dom:
        raise HTTPException(status_code=404, detail="Domínio não encontrado")

    manual = None
    if dom.dc_hosts and not dom.dc_discovery:
        manual = [h.strip() for h in dom.dc_hosts.replace(";", ",").split(",") if h.strip()]

    try:
        dcs = await asyncio.to_thread(
            discover_domain_controllers, dom.name,
            payload.nameservers, bool(dom.use_ldaps), manual,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Falha na descoberta de DCs: {e}")

    fastest = next((d for d in dcs if d["reachable"]), None)
    return {"domain": dom.name, "use_ldaps": bool(dom.use_ldaps), "dcs": dcs,
            "fastest": fastest["host"] if fastest else None}


class TestConnectionRequest(BaseModel):
    host: Optional[str] = None
    kdc_host: Optional[str] = None


@router.post("/domains/{domain_id}/test-connection")
async def test_connection(domain_id: int, payload: TestConnectionRequest, db=Depends(get_db)):
    """Testa o bind LDAP/LDAPS no DC informado (ou no selecionado) com a auth do domínio."""
    from ad_ldap import test_ldap_connection

    dom = (await db.execute(select(AdDomain).where(AdDomain.id == domain_id))).scalar_one_or_none()
    if not dom:
        raise HTTPException(status_code=404, detail="Domínio não encontrado")

    host = (payload.host or dom.selected_dc or "").strip()
    if not host and dom.dc_hosts:
        host = dom.dc_hosts.replace(";", ",").split(",")[0].strip()
    if not host:
        raise HTTPException(status_code=422, detail="Informe um DC (host) ou rode a descoberta antes.")

    auth = dom.auth_method or "user_password"
    kwargs = dict(host=host, use_ldaps=bool(dom.use_ldaps), auth_method=auth,
                  domain=dom.name, kdc_host=payload.kdc_host)

    if auth == "cert":
        kwargs["client_cert"] = dom.client_cert
        kwargs["client_key"] = dom.client_key
    elif auth in ("user_password", "kerberos"):
        if not dom.credential_id:
            raise HTTPException(status_code=422, detail="Selecione uma credencial para este domínio.")
        cred = (await db.execute(select(Credential).where(Credential.id == dom.credential_id))).scalar_one_or_none()
        if not cred:
            raise HTTPException(status_code=404, detail="Credencial não encontrada.")
        if auth == "user_password":
            kwargs.update(username=cred.username, password=cred.password,
                          nthash=cred.ntlm_hash, domain=cred.domain or dom.name)
        else:  # kerberos
            kwargs.update(ccache_b64=cred.kerberos_ccache, username=cred.username,
                          kdc_host=payload.kdc_host or cred.kdc_host)

    result = await asyncio.to_thread(test_ldap_connection, **kwargs)

    if result.get("success"):
        dom.selected_dc = host
        dom.updated_at = datetime.now(timezone.utc)
        await db.commit()
    return result


@router.delete("/domains/{domain_id}")
async def delete_domain(domain_id: int, db=Depends(get_db)):
    dom = (await db.execute(select(AdDomain).where(AdDomain.id == domain_id))).scalar_one_or_none()
    if not dom:
        raise HTTPException(status_code=404, detail="Domínio não encontrado")
    await db.execute(delete(AdObject).where(AdObject.domain_id == domain_id))
    await db.execute(delete(AdScanJob).where(AdScanJob.domain_id == domain_id))
    await db.execute(delete(AdDomain).where(AdDomain.id == domain_id))
    await db.commit()
    return {"success": True}


# --------------------------------------------------------------------------- #
# Importação BloodHound (upload + background job)
# --------------------------------------------------------------------------- #
async def _run_bloodhound_import(job_id: int, domain_id: int, source_dir: str):
    """Executa a importação em background e atualiza o status do job."""
    from ad_explorer import import_bloodhound_files

    async with AsyncSessionLocal() as session:
        job = (await session.execute(select(AdScanJob).where(AdScanJob.id == job_id))).scalar_one_or_none()
        if job:
            job.status = "running"
            job.started_at = datetime.now(timezone.utc)
            await session.commit()

    try:
        stats = await asyncio.to_thread(
            import_bloodhound_files, POSTGRES_URL, domain_id, source_dir, job_id
        )
        async with AsyncSessionLocal() as session:
            job = (await session.execute(select(AdScanJob).where(AdScanJob.id == job_id))).scalar_one_or_none()
            if job:
                job.status = "completed"
                job.total_objects = stats.get("total_objects", 0)
                job.processed_objects = stats.get("total_objects", 0)
                job.current_step = "Concluído"
                job.finished_at = datetime.now(timezone.utc)
                await session.commit()
        logger.info(f"AD import job {job_id} concluído: {stats}")
    except Exception as e:
        logger.exception(f"AD import job {job_id} falhou")
        async with AsyncSessionLocal() as session:
            job = (await session.execute(select(AdScanJob).where(AdScanJob.id == job_id))).scalar_one_or_none()
            if job:
                job.status = "failed"
                job.error_message = str(e)
                job.finished_at = datetime.now(timezone.utc)
                await session.commit()
    finally:
        # Limpa os arquivos enviados após a importação
        try:
            shutil.rmtree(source_dir, ignore_errors=True)
        except Exception:
            pass


@router.post("/domains/{domain_id}/import", response_model=AdJobResponse)
async def import_bloodhound(domain_id: int, files: List[UploadFile] = File(...), db=Depends(get_db)):
    """Recebe arquivos BloodHound (JSON por tipo ou .zip) e inicia a importação
    em background, monitorada por um job."""
    if not POSTGRES_URL:
        raise HTTPException(status_code=400, detail="A importação do AD Explorer requer PostgreSQL.")

    dom = (await db.execute(select(AdDomain).where(AdDomain.id == domain_id))).scalar_one_or_none()
    if not dom:
        raise HTTPException(status_code=404, detail="Domínio não encontrado")
    if not files:
        raise HTTPException(status_code=422, detail="Nenhum arquivo enviado.")

    # Salva os uploads num diretório de trabalho
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    source_dir = os.path.join(AD_IMPORT_DIR, f"{dom.guid}_{ts}")
    os.makedirs(source_dir, exist_ok=True)
    saved = 0
    for up in files:
        safe = os.path.basename(up.filename or "").replace("/", "_") or f"file_{saved}"
        dest = os.path.join(source_dir, safe)
        with open(dest, "wb") as out:
            while True:
                chunk = await up.read(1024 * 1024)
                if not chunk:
                    break
                out.write(chunk)
        saved += 1

    job = AdScanJob(
        domain_id=domain_id,
        job_type="bloodhound",
        status="pending",
        source_path=source_dir,
        current_step="Na fila",
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)

    # Dispara a importação em background
    asyncio.create_task(_run_bloodhound_import(job.id, domain_id, source_dir))
    return job


def _base_dn_from_domain(name):
    return "dc=" + ",dc=".join((name or "").lower().split("."))


async def _resolve_scan_kwargs(db, dom, host):
    """Monta os kwargs de autenticação para a varredura LDAP a partir do domínio."""
    auth = dom.auth_method or "user_password"
    kwargs = dict(
        host=host, use_ldaps=bool(dom.use_ldaps), base_dn=_base_dn_from_domain(dom.name),
        auth_method=auth, domain=dom.name, kdc_host=None,
    )
    if auth == "cert":
        raise HTTPException(status_code=400, detail="Varredura ao vivo por certificado ainda não suportada; use usuário/senha ou Kerberos.")
    if not dom.credential_id:
        raise HTTPException(status_code=422, detail="Selecione uma credencial para o domínio.")
    cred = (await db.execute(select(Credential).where(Credential.id == dom.credential_id))).scalar_one_or_none()
    if not cred:
        raise HTTPException(status_code=404, detail="Credencial não encontrada.")
    if auth == "user_password":
        kwargs.update(username=cred.username, password=cred.password, nthash=cred.ntlm_hash,
                      domain=cred.domain or dom.name)
    else:  # kerberos
        kwargs.update(username=cred.username, ccache_b64=cred.kerberos_ccache,
                      kdc_host=cred.kdc_host, domain=cred.domain or dom.name)
    return kwargs


async def _run_ldap_scan(job_id: int, domain_id: int, scan_kwargs: dict):
    from ad_scan import scan_ldap_tree
    async with AsyncSessionLocal() as session:
        job = (await session.execute(select(AdScanJob).where(AdScanJob.id == job_id))).scalar_one_or_none()
        if job:
            job.status = "running"
            job.started_at = datetime.now(timezone.utc)
            job.current_step = "Conectando ao DC"
            await session.commit()
    try:
        stats = await asyncio.to_thread(scan_ldap_tree, POSTGRES_URL, domain_id, job_id=job_id, **scan_kwargs)
        async with AsyncSessionLocal() as session:
            job = (await session.execute(select(AdScanJob).where(AdScanJob.id == job_id))).scalar_one_or_none()
            if job:
                job.status = "completed"
                job.total_objects = stats.get("total_objects", 0)
                job.processed_objects = stats.get("total_objects", 0)
                job.current_step = "Concluído"
                job.finished_at = datetime.now(timezone.utc)
                await session.commit()
    except Exception as e:
        logger.exception(f"AD LDAP scan job {job_id} falhou")
        async with AsyncSessionLocal() as session:
            job = (await session.execute(select(AdScanJob).where(AdScanJob.id == job_id))).scalar_one_or_none()
            if job:
                job.status = "failed"
                job.error_message = str(e)
                job.finished_at = datetime.now(timezone.utc)
                await session.commit()


async def recover_interrupted_ad_jobs():
    """Re-lança jobs de AD (import/varredura) que ficaram 'running'/'pending'
    após um reinício do backend — torna os jobs resilientes a restart.

    As gravações são idempotentes (ON CONFLICT upsert), então reexecutar o job
    o conclui corretamente (reinicia a contagem, mas finaliza a árvore)."""
    to_launch = []
    async with AsyncSessionLocal() as session:
        jobs = (await session.execute(
            select(AdScanJob).where(AdScanJob.status.in_(["running", "pending"]))
        )).scalars().all()
        for job in jobs:
            dom = (await session.execute(select(AdDomain).where(AdDomain.id == job.domain_id))).scalar_one_or_none()
            if job.job_type == "bloodhound" and job.source_path and os.path.isdir(job.source_path):
                job.status = "pending"
                job.processed_objects = 0
                job.current_step = "Retomando após reinício do backend"
                to_launch.append(("bh", job.id, job.domain_id, job.source_path))
            elif job.job_type == "ldap" and dom:
                try:
                    host = (job.source_path or dom.selected_dc or "").strip()
                    kwargs = await _resolve_scan_kwargs(session, dom, host)
                    job.status = "pending"
                    job.processed_objects = 0
                    job.current_step = "Retomando após reinício do backend"
                    to_launch.append(("ldap", job.id, job.domain_id, kwargs))
                except Exception as e:
                    job.status = "failed"
                    job.error_message = f"Interrompido por reinício; não foi possível retomar: {e}"
                    job.finished_at = datetime.now(timezone.utc)
            else:
                job.status = "failed"
                job.error_message = "Interrompido por reinício do backend (sem origem para retomar)."
                job.finished_at = datetime.now(timezone.utc)
        await session.commit()

    for item in to_launch:
        if item[0] == "bh":
            asyncio.create_task(_run_bloodhound_import(item[1], item[2], item[3]))
        else:
            asyncio.create_task(_run_ldap_scan(item[1], item[2], item[3]))
    if to_launch:
        logger.info(f"AD Explorer: {len(to_launch)} job(s) retomados após reinício")


class ScanRequest(BaseModel):
    host: Optional[str] = None


@router.post("/domains/{domain_id}/scan", response_model=AdJobResponse)
async def start_ldap_scan(domain_id: int, payload: ScanRequest, db=Depends(get_db)):
    """Inicia a varredura LDAP recursiva da árvore do domínio em background."""
    if not POSTGRES_URL:
        raise HTTPException(status_code=400, detail="A varredura requer PostgreSQL.")
    dom = (await db.execute(select(AdDomain).where(AdDomain.id == domain_id))).scalar_one_or_none()
    if not dom:
        raise HTTPException(status_code=404, detail="Domínio não encontrado")

    host = (payload.host or dom.selected_dc or "").strip()
    if not host and dom.dc_hosts:
        host = dom.dc_hosts.replace(";", ",").split(",")[0].strip()
    if not host:
        raise HTTPException(status_code=422, detail="Nenhum DC definido. Rode a descoberta ou informe um DC.")

    scan_kwargs = await _resolve_scan_kwargs(db, dom, host)

    job = AdScanJob(domain_id=domain_id, job_type="ldap", status="pending",
                    current_step="Na fila", source_path=host)
    db.add(job)
    await db.commit()
    await db.refresh(job)

    asyncio.create_task(_run_ldap_scan(job.id, domain_id, scan_kwargs))
    return job


@router.get("/domains/{domain_id}/ldap-browse")
async def ldap_browse_live(domain_id: int, dn: Optional[str] = None,
                           host: Optional[str] = None, db=Depends(get_db)):
    """Navegação LDAP ao vivo: lista os filhos imediatos de um nó (ou a raiz do
    domínio quando dn é vazio), buscando sob demanda — sem varredura prévia."""
    from ad_scan import ldap_browse

    dom = (await db.execute(select(AdDomain).where(AdDomain.id == domain_id))).scalar_one_or_none()
    if not dom:
        raise HTTPException(status_code=404, detail="Domínio não encontrado")

    target = (host or dom.selected_dc or "").strip()
    if not target and dom.dc_hosts:
        target = dom.dc_hosts.replace(";", ",").split(",")[0].strip()
    if not target:
        raise HTTPException(status_code=422, detail="Nenhum DC definido. Rode a descoberta ou informe um DC.")

    k = await _resolve_scan_kwargs(db, dom, target)
    try:
        nodes = await asyncio.to_thread(
            ldap_browse,
            k["host"], k["use_ldaps"], (dn or None), k["auth_method"],
            k.get("domain"), k.get("username"), k.get("password"), k.get("nthash"),
            k.get("ccache_b64"), k.get("kdc_host"), (not dn), k["base_dn"],
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Falha ao navegar no LDAP: {e}")

    # Atribui um id sintético (sem persistência) para o front usar como chave
    for i, n in enumerate(nodes):
        n["id"] = i
    return nodes


@router.get("/domains/{domain_id}/ldap-members")
async def ldap_members_live(domain_id: int, dn: str,
                            host: Optional[str] = None, db=Depends(get_db)):
    """Membros diretos de um grupo via LDAP ao vivo (filtro memberOf)."""
    from ad_scan import ldap_browse

    dom = (await db.execute(select(AdDomain).where(AdDomain.id == domain_id))).scalar_one_or_none()
    if not dom:
        raise HTTPException(status_code=404, detail="Domínio não encontrado")

    target = (host or dom.selected_dc or "").strip()
    if not target and dom.dc_hosts:
        target = dom.dc_hosts.replace(";", ",").split(",")[0].strip()
    if not target:
        raise HTTPException(status_code=422, detail="Nenhum DC definido. Rode a descoberta ou informe um DC.")

    k = await _resolve_scan_kwargs(db, dom, target)
    try:
        nodes = await asyncio.to_thread(
            ldap_browse,
            k["host"], k["use_ldaps"], None, k["auth_method"],
            k.get("domain"), k.get("username"), k.get("password"), k.get("nthash"),
            k.get("ccache_b64"), k.get("kdc_host"), False, k["base_dn"], dn,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Falha ao listar membros no LDAP: {e}")

    for i, n in enumerate(nodes):
        n["id"] = i
    return nodes


@router.get("/jobs", response_model=List[AdJobResponse])
async def list_jobs(domain_id: Optional[int] = None, db=Depends(get_db_readonly)):
    q = select(AdScanJob).order_by(AdScanJob.created_at.desc())
    if domain_id is not None:
        q = q.where(AdScanJob.domain_id == domain_id)
    result = await db.execute(q.limit(100))
    return result.scalars().all()


@router.get("/jobs/{job_id}", response_model=AdJobResponse)
async def get_job(job_id: int, db=Depends(get_db_readonly)):
    job = (await db.execute(select(AdScanJob).where(AdScanJob.id == job_id))).scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job não encontrado")
    return job


# --------------------------------------------------------------------------- #
# Navegação da árvore + busca
# --------------------------------------------------------------------------- #
def _order_by_type_name():
    # OUs/Containers primeiro, depois grupos/usuários/computadores, alfabético
    type_rank = {
        "Domain": 0, "OU": 1, "Container": 2, "GPO": 3,
        "Group": 4, "User": 5, "Computer": 6,
    }
    # Usa CASE no SQL para ordenar; em Python basta ordenar depois.
    return type_rank


@router.get("/domains/{domain_id}/tree", response_model=List[AdObjectNode])
async def get_tree(domain_id: int, parent_dn: Optional[str] = None,
                   parent: Optional[str] = None, db=Depends(get_db_readonly)):
    """Retorna os filhos de um nó pela hierarquia de DN (navegável mesmo durante
    a varredura). Sem 'parent_dn' retorna a raiz (objeto Domain)."""
    q = select(AdObject).where(AdObject.domain_id == domain_id)
    if parent_dn:
        q = q.where(AdObject.parent_dn == parent_dn)
    elif parent:
        # compat: navegação antiga por object_id
        q = q.where(AdObject.parent_object_id == parent)
    else:
        q = q.where(AdObject.object_type == "Domain")
    nodes = (await db.execute(q)).scalars().all()

    # has_children calculado ao vivo (durante a varredura o child_count pode ser 0)
    dns = [n.distinguished_name for n in nodes if n.distinguished_name]
    have = set()
    if dns:
        res = await db.execute(
            select(AdObject.parent_dn).where(
                AdObject.domain_id == domain_id, AdObject.parent_dn.in_(dns)
            ).distinct()
        )
        have = {r[0] for r in res.fetchall()}
    for n in nodes:
        n.has_children = n.distinguished_name in have
        if n.child_count is None:
            n.child_count = 0

    rank = _order_by_type_name()
    nodes.sort(key=lambda n: (rank.get(n.object_type, 9), (n.name or "").lower()))
    return nodes


@router.get("/objects/{obj_pk}")
async def get_object(obj_pk: int, db=Depends(get_db_readonly)):
    """Detalhe completo de um objeto (incluindo todas as Properties do BH v6)."""
    obj = (await db.execute(select(AdObject).where(AdObject.id == obj_pk))).scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="Objeto não encontrado")
    return {
        "id": obj.id,
        "domain_id": obj.domain_id,
        "object_id": obj.object_id,
        "object_type": obj.object_type,
        "name": obj.name,
        "distinguished_name": obj.distinguished_name,
        "samaccountname": obj.samaccountname,
        "description": obj.description,
        "parent_object_id": obj.parent_object_id,
        "enabled": obj.enabled,
        "highvalue": obj.highvalue,
        "whencreated": obj.whencreated,
        "has_children": obj.has_children,
        "child_count": obj.child_count,
        "properties": obj.properties,
    }


@router.get("/objects/{obj_pk}/members", response_model=List[AdObjectNode])
async def get_group_members(obj_pk: int, db=Depends(get_db_readonly)):
    """Membros diretos de um grupo (dados importados)."""
    grp = (await db.execute(select(AdObject).where(AdObject.id == obj_pk))).scalar_one_or_none()
    if not grp:
        raise HTTPException(status_code=404, detail="Objeto não encontrado")
    query = (
        select(AdObject)
        .join(
            AdGroupMember,
            and_(
                AdGroupMember.member_object_id == AdObject.object_id,
                AdGroupMember.domain_id == AdObject.domain_id,
            ),
        )
        .where(
            AdGroupMember.domain_id == grp.domain_id,
            AdGroupMember.group_object_id == grp.object_id,
        )
    )
    nodes = (await db.execute(query)).scalars().all()
    rank = _order_by_type_name()
    nodes.sort(key=lambda n: (rank.get(n.object_type, 9), (n.name or "").lower()))
    return nodes


def _date_to_epoch(value: Optional[str], end_of_day: bool = False) -> Optional[int]:
    """Converte 'YYYY-MM-DD' em epoch (segundos, UTC). Retorna None se vazio/inválido."""
    if not value:
        return None
    try:
        dt = datetime.strptime(value.strip(), "%Y-%m-%d").replace(tzinfo=timezone.utc)
        if end_of_day:
            dt = dt.replace(hour=23, minute=59, second=59)
        return int(dt.timestamp())
    except (ValueError, TypeError):
        return None


@router.get("/domains/{domain_id}/search", response_model=List[AdObjectNode])
async def search_objects(
    domain_id: int,
    q: Optional[str] = None,
    object_type: Optional[str] = None,
    enabled: Optional[bool] = None,
    highvalue: Optional[bool] = None,
    created_from: Optional[str] = None,
    created_to: Optional[str] = None,
    pwd_from: Optional[str] = None,
    pwd_to: Optional[str] = None,
    limit: int = 200,
    db=Depends(get_db_readonly),
):
    """Busca avançada: texto (nome/sam/DN/descrição/SID) + filtros opcionais
    (tipo, habilitado, high value, data de criação e último pwdLastSet)."""
    from sqlalchemy import cast, BigInteger

    term = (q or "").strip()
    has_filter = any([
        object_type, enabled is not None, highvalue is not None,
        created_from, created_to, pwd_from, pwd_to,
    ])
    if len(term) < 2 and not has_filter:
        raise HTTPException(status_code=422, detail="Informe ao menos 2 caracteres ou um filtro.")

    query = select(AdObject).where(AdObject.domain_id == domain_id)

    if len(term) >= 2:
        like = f"%{term}%"
        query = query.where(or_(
            AdObject.name.ilike(like),
            AdObject.samaccountname.ilike(like),
            AdObject.distinguished_name.ilike(like),
            AdObject.description.ilike(like),
            AdObject.object_id.ilike(like),
        ))
    if object_type:
        query = query.where(AdObject.object_type == object_type)
    if enabled is not None:
        query = query.where(AdObject.enabled == enabled)
    if highvalue is not None:
        query = query.where(AdObject.highvalue == highvalue)

    cf = _date_to_epoch(created_from)
    ct = _date_to_epoch(created_to, end_of_day=True)
    if cf is not None:
        query = query.where(AdObject.whencreated >= cf)
    if ct is not None:
        query = query.where(AdObject.whencreated <= ct)

    # pwdLastSet vive nas Properties (BH v6): filtro por epoch armazenado como texto
    pf = _date_to_epoch(pwd_from)
    pt = _date_to_epoch(pwd_to, end_of_day=True)
    if pf is not None or pt is not None:
        pwd_expr = cast(AdObject.properties['pwdlastset'].astext, BigInteger)
        if pf is not None:
            query = query.where(pwd_expr >= pf)
        if pt is not None:
            query = query.where(pwd_expr <= pt)

    rank = _order_by_type_name()
    query = query.limit(min(max(limit, 1), 1000))
    result = await db.execute(query)
    nodes = result.scalars().all()
    nodes.sort(key=lambda n: (rank.get(n.object_type, 9), (n.name or "").lower()))
    return nodes


# --------------------------------------------------------------------------- #
# Operações de escrita no AD (LDAP ao vivo) — exigem DC + credencial
# --------------------------------------------------------------------------- #
import ad_write  # noqa: E402


class SetEnabledBody(BaseModel):
    enabled: bool


class PasswordBody(BaseModel):
    password: str


class MemberBody(BaseModel):
    member_pk: Optional[int] = None
    member_dn: Optional[str] = None


class GroupRefBody(BaseModel):
    group_pk: Optional[int] = None
    group_dn: Optional[str] = None


class CreateUserBody(BaseModel):
    name: str
    sam: str
    password: Optional[str] = None


class CreateGroupBody(BaseModel):
    name: str
    sam: str


async def _get_domain_or_404(db, domain_id):
    dom = (await db.execute(select(AdDomain).where(AdDomain.id == domain_id))).scalar_one_or_none()
    if not dom:
        raise HTTPException(status_code=404, detail="Domínio não encontrado")
    return dom


async def _get_obj_or_404(db, obj_pk):
    obj = (await db.execute(select(AdObject).where(AdObject.id == obj_pk))).scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="Objeto não encontrado")
    if not obj.distinguished_name:
        raise HTTPException(status_code=422, detail="Objeto sem Distinguished Name (não navegável por LDAP).")
    return obj


async def _ldap_write_kwargs(db, dom):
    """Monta os kwargs de conexão LDAP para escrita; valida DC + credencial."""
    target = (dom.selected_dc or "").strip()
    if not target and dom.dc_hosts:
        target = dom.dc_hosts.replace(";", ",").split(",")[0].strip()
    if not target:
        raise HTTPException(status_code=422, detail="Nenhum DC definido. Configure o LDAP do domínio.")
    if not dom.credential_id:
        raise HTTPException(status_code=422, detail="Selecione uma credencial para o domínio (LDAP não configurado).")
    return await _resolve_scan_kwargs(db, dom, target)


async def _resolve_member_dn(db, member_pk, member_dn):
    if member_dn:
        return member_dn
    if member_pk:
        obj = await _get_obj_or_404(db, member_pk)
        return obj.distinguished_name
    raise HTTPException(status_code=422, detail="Informe o objeto (member_pk ou member_dn).")


@router.post("/domains/{domain_id}/objects/{obj_pk}/set-enabled")
async def ad_set_enabled(domain_id: int, obj_pk: int, body: SetEnabledBody, db=Depends(get_db)):
    dom = await _get_domain_or_404(db, domain_id)
    obj = await _get_obj_or_404(db, obj_pk)
    k = await _ldap_write_kwargs(db, dom)
    try:
        res = await asyncio.to_thread(ad_write.set_account_enabled, k, obj.distinguished_name, body.enabled)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Falha ao {'desbloquear' if body.enabled else 'bloquear'}: {e}")
    obj.enabled = body.enabled
    await db.commit()
    return res


@router.post("/domains/{domain_id}/objects/{obj_pk}/reset-password")
async def ad_reset_password(domain_id: int, obj_pk: int, body: PasswordBody, db=Depends(get_db)):
    if not body.password or len(body.password) < 1:
        raise HTTPException(status_code=422, detail="Informe a nova senha.")
    dom = await _get_domain_or_404(db, domain_id)
    obj = await _get_obj_or_404(db, obj_pk)
    k = await _ldap_write_kwargs(db, dom)
    try:
        return await asyncio.to_thread(ad_write.reset_password, k, obj.distinguished_name, body.password)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Falha ao trocar senha: {e}")


@router.post("/domains/{domain_id}/objects/{obj_pk}/add-to-group")
async def ad_add_to_group(domain_id: int, obj_pk: int, body: GroupRefBody, db=Depends(get_db)):
    dom = await _get_domain_or_404(db, domain_id)
    obj = await _get_obj_or_404(db, obj_pk)
    group_dn = body.group_dn
    if not group_dn and body.group_pk:
        g = await _get_obj_or_404(db, body.group_pk)
        group_dn = g.distinguished_name
    if not group_dn:
        raise HTTPException(status_code=422, detail="Informe o grupo (group_pk ou group_dn).")
    k = await _ldap_write_kwargs(db, dom)
    try:
        return await asyncio.to_thread(ad_write.add_group_member, k, group_dn, obj.distinguished_name)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Falha ao adicionar ao grupo: {e}")


@router.post("/domains/{domain_id}/groups/{obj_pk}/add-member")
async def ad_group_add_member(domain_id: int, obj_pk: int, body: MemberBody, db=Depends(get_db)):
    dom = await _get_domain_or_404(db, domain_id)
    grp = await _get_obj_or_404(db, obj_pk)
    member_dn = await _resolve_member_dn(db, body.member_pk, body.member_dn)
    k = await _ldap_write_kwargs(db, dom)
    try:
        return await asyncio.to_thread(ad_write.add_group_member, k, grp.distinguished_name, member_dn)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Falha ao inserir membro: {e}")


@router.post("/domains/{domain_id}/containers/{obj_pk}/create-user")
async def ad_create_user(domain_id: int, obj_pk: int, body: CreateUserBody, db=Depends(get_db)):
    if not body.name or not body.sam:
        raise HTTPException(status_code=422, detail="Informe Nome e samAccountName.")
    dom = await _get_domain_or_404(db, domain_id)
    parent = await _get_obj_or_404(db, obj_pk)
    k = await _ldap_write_kwargs(db, dom)
    upn = f"{body.sam}@{dom.name}"
    try:
        return await asyncio.to_thread(ad_write.create_user, k, parent.distinguished_name,
                                       body.name, body.sam, body.password, upn)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Falha ao inserir usuário: {e}")


@router.post("/domains/{domain_id}/containers/{obj_pk}/create-group")
async def ad_create_group(domain_id: int, obj_pk: int, body: CreateGroupBody, db=Depends(get_db)):
    if not body.name or not body.sam:
        raise HTTPException(status_code=422, detail="Informe Nome e samAccountName.")
    dom = await _get_domain_or_404(db, domain_id)
    parent = await _get_obj_or_404(db, obj_pk)
    k = await _ldap_write_kwargs(db, dom)
    try:
        return await asyncio.to_thread(ad_write.create_group, k, parent.distinguished_name,
                                       body.name, body.sam)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Falha ao inserir grupo: {e}")
