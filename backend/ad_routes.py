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
    AdDomain, AdObject, AdScanJob, Credential, POSTGRES_URL,
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
    has_children: bool = False
    child_count: int = 0

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
async def get_tree(domain_id: int, parent: Optional[str] = None, db=Depends(get_db_readonly)):
    """Retorna os filhos de um nó. Sem 'parent' retorna a raiz (parent_object_id IS NULL)."""
    q = select(AdObject).where(AdObject.domain_id == domain_id)
    if parent:
        q = q.where(AdObject.parent_object_id == parent)
    else:
        q = q.where(AdObject.parent_object_id.is_(None))
    result = await db.execute(q)
    nodes = result.scalars().all()
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


@router.get("/domains/{domain_id}/search", response_model=List[AdObjectNode])
async def search_objects(
    domain_id: int,
    q: str,
    object_type: Optional[str] = None,
    limit: int = 200,
    db=Depends(get_db_readonly),
):
    """Busca por nome, samAccountName, DN, descrição ou SID/GUID."""
    term = (q or "").strip()
    if len(term) < 2:
        raise HTTPException(status_code=422, detail="Informe ao menos 2 caracteres.")
    like = f"%{term}%"
    conds = or_(
        AdObject.name.ilike(like),
        AdObject.samaccountname.ilike(like),
        AdObject.distinguished_name.ilike(like),
        AdObject.description.ilike(like),
        AdObject.object_id.ilike(like),
    )
    query = select(AdObject).where(AdObject.domain_id == domain_id, conds)
    if object_type:
        query = query.where(AdObject.object_type == object_type)
    query = query.limit(min(max(limit, 1), 1000))
    result = await db.execute(query)
    return result.scalars().all()
