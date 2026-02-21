"""
Directory Scanner Worker - Lista diretórios e arquivos para adicionar à fila de downloads

Este worker é responsável por:
- Listar recursivamente diretórios e arquivos
- Adicionar arquivos à fila de downloads (DownloadJob)
- Respeitar limites de profundidade e tamanho
- NÃO contabiliza no limite de downloads simultâneos

Arquitetura:
- 1 worker de scan (este) que lista diretórios e enfileira arquivos
- N workers de download que processam os arquivos da fila
"""

import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional, List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import uuid

logger = logging.getLogger(__name__)

# Configurações do scanner
SCANNER_POLL_INTERVAL = 3  # segundos entre verificações
MAX_DIRS_PER_CYCLE = 50  # máximo de diretórios a processar por ciclo

# Instância global do scanner
_scanner_instance: Optional['DirectoryScanner'] = None


class ScanJob:
    """Representa um job de scan de diretório"""
    def __init__(self, server_id: int, share_name: str, path: str, depth: int, max_depth: int, max_file_size_bytes: Optional[int], apply_filters: bool = True, parent_id: str = None):
        self.id = str(uuid.uuid4())[:8]  # ID curto único
        self.parent_id = parent_id  # ID do scan pai (para subdiretórios)
        self.server_id = server_id
        self.share_name = share_name
        self.path = path
        self.depth = depth
        self.max_depth = max_depth
        self.max_file_size_bytes = max_file_size_bytes
        self.apply_filters = apply_filters
        self.status = 'pending'  # pending, scanning, completed, cancelled
        self.created_at = datetime.now(timezone.utc)
        self.files_found = 0
        self.dirs_found = 0
    
    def to_dict(self):
        return {
            'id': self.id,
            'parent_id': self.parent_id,
            'server_id': self.server_id,
            'share_name': self.share_name,
            'path': self.path,
            'depth': self.depth,
            'max_depth': self.max_depth,
            'status': self.status,
            'files_found': self.files_found,
            'dirs_found': self.dirs_found,
            'created_at': self.created_at.isoformat()
        }


class DirectoryScanner:
    """Worker que escaneia diretórios e adiciona arquivos à fila de downloads"""
    
    def __init__(self):
        self.running = False
        self._task: Optional[asyncio.Task] = None
        self.scan_queue: List[ScanJob] = []
        self.completed_scans: List[ScanJob] = []  # Últimos scans completados
        self.cancelled_ids: set = set()  # IDs de scans cancelados
        self._lock = asyncio.Lock()
    
    async def start(self):
        """Inicia o scanner em background"""
        if self.running:
            logger.info("Directory scanner already running")
            return
        
        self.running = True
        self._task = asyncio.create_task(self._run_loop())
        logger.info("Directory scanner started")
    
    async def stop(self):
        """Para o scanner"""
        self.running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("Directory scanner stopped")
    
    def get_scan_jobs(self) -> List[dict]:
        """Retorna lista de scan jobs (pendentes + últimos completados)"""
        jobs = []
        # Jobs pendentes e em scanning
        for job in self.scan_queue:
            jobs.append(job.to_dict())
        # Últimos completados (máximo 20)
        for job in self.completed_scans[-20:]:
            jobs.append(job.to_dict())
        return jobs
    
    async def cancel_scan(self, scan_id: str) -> bool:
        """Cancela um scan job pelo ID"""
        async with self._lock:
            # Marcar como cancelado
            self.cancelled_ids.add(scan_id)
            
            # Remover da fila se pendente
            for job in self.scan_queue:
                if job.id == scan_id:
                    job.status = 'cancelled'
                    self.scan_queue.remove(job)
                    self.completed_scans.append(job)
                    print(f"=== SCANNER: Cancelled scan job {scan_id} ===", flush=True)
                    return True
            
            # Cancelar todos os sub-scans deste parent
            to_remove = [j for j in self.scan_queue if j.parent_id == scan_id]
            for job in to_remove:
                job.status = 'cancelled'
                self.scan_queue.remove(job)
            
            if to_remove:
                print(f"=== SCANNER: Cancelled {len(to_remove)} sub-scans of {scan_id} ===", flush=True)
                return True
            
            return False
    
    async def clear_finished_scans(self) -> int:
        """Limpa scans finalizados (completed, cancelled, failed)"""
        async with self._lock:
            count = len(self.completed_scans)
            self.completed_scans.clear()
            self.cancelled_ids.clear()
            print(f"=== SCANNER: Cleared {count} finished scans ===", flush=True)
            return count
    
    async def cancel_all_scans(self) -> int:
        """Cancela todos os scan jobs pendentes"""
        async with self._lock:
            count = len(self.scan_queue)
            for job in self.scan_queue:
                job.status = 'cancelled'
                self.cancelled_ids.add(job.id)
                self.completed_scans.append(job)
            self.scan_queue.clear()
            print(f"=== SCANNER: Cancelled all {count} scan jobs ===", flush=True)
            return count
    
    async def add_scan_job(self, server_id: int, share_name: str, path: str, max_depth: int, max_file_size_bytes: Optional[int], apply_filters: bool = True) -> str:
        """Adiciona um diretório para ser escaneado. Retorna o ID do job."""
        async with self._lock:
            job = ScanJob(
                server_id=server_id,
                share_name=share_name,
                path=path,
                depth=1,
                max_depth=max_depth,
                max_file_size_bytes=max_file_size_bytes,
                apply_filters=apply_filters
            )
            self.scan_queue.append(job)
            print(f"=== SCANNER: Added scan job {job.id}: server={server_id}, share={share_name}, path={path} ===", flush=True)
            logger.info(f"Added scan job: {path}")
            return job.id
    
    async def _run_loop(self):
        """Loop principal do scanner"""
        print("=== SCANNER: Loop started ===", flush=True)
        while self.running:
            try:
                await self._process_scan_queue()
            except Exception as e:
                print(f"=== SCANNER ERROR in loop: {e} ===", flush=True)
                logger.error(f"Error in directory scanner loop: {e}")
            
            await asyncio.sleep(SCANNER_POLL_INTERVAL)
    
    async def _process_scan_queue(self):
        """Processa jobs de scan na fila"""
        if not self.scan_queue:
            return
        
        print(f"=== SCANNER: Processing queue with {len(self.scan_queue)} jobs ===", flush=True)
        
        from database import Server, DownloadJob, AsyncSessionLocal
        from soap_service import get_default_soap_service
        
        # Pegar um lote de jobs para processar
        async with self._lock:
            jobs_to_process = self.scan_queue[:MAX_DIRS_PER_CYCLE]
            self.scan_queue = self.scan_queue[MAX_DIRS_PER_CYCLE:]
        
        async with AsyncSessionLocal() as db:
            for scan_job in jobs_to_process:
                # Verificar se foi cancelado
                if scan_job.id in self.cancelled_ids or scan_job.parent_id in self.cancelled_ids:
                    scan_job.status = 'cancelled'
                    self.completed_scans.append(scan_job)
                    print(f"=== SCANNER: Skipping cancelled job {scan_job.id} ===", flush=True)
                    continue
                
                try:
                    scan_job.status = 'scanning'
                    print(f"=== SCANNER: Scanning directory: {scan_job.path} ===", flush=True)
                    await self._scan_directory(db, scan_job)
                    scan_job.status = 'completed'
                    self.completed_scans.append(scan_job)
                    # Manter apenas últimos 50 completados
                    if len(self.completed_scans) > 50:
                        self.completed_scans = self.completed_scans[-50:]
                except Exception as e:
                    scan_job.status = 'failed'
                    self.completed_scans.append(scan_job)
                    print(f"=== SCANNER ERROR scanning {scan_job.path}: {e} ===", flush=True)
                    logger.error(f"Error scanning directory {scan_job.path}: {e}")
    
    async def _scan_directory(self, db: AsyncSession, scan_job: ScanJob):
        """Escaneia um diretório e adiciona arquivos à fila"""
        from database import Server, DownloadJob, AppSettings
        from soap_service import get_default_soap_service
        
        print(f"=== SCANNER: _scan_directory called for {scan_job.path}, depth={scan_job.depth}/{scan_job.max_depth} ===", flush=True)
        
        # Verificar limite de profundidade
        if scan_job.depth > scan_job.max_depth:
            print(f"=== SCANNER: Max depth reached, skipping ===", flush=True)
            return
        
        # Obter servidor
        result = await db.execute(select(Server).where(Server.id == scan_job.server_id))
        server = result.scalar_one_or_none()
        if not server:
            print(f"=== SCANNER: Server {scan_job.server_id} not found ===", flush=True)
            logger.warning(f"Server {scan_job.server_id} not found")
            return
        
        print(f"=== SCANNER: Found server {server.name} ({server.ip}) ===", flush=True)
        
        # Obter extensões ignoradas (apenas se aplicar filtros)
        ignored_extensions = []
        if scan_job.apply_filters:
            ext_result = await db.execute(select(AppSettings).where(AppSettings.key == 'ignored_extensions'))
            ext_setting = ext_result.scalar_one_or_none()
            if ext_setting and ext_setting.value:
                ignored_extensions = [ext.strip().lower() for ext in ext_setting.value.split(',') if ext.strip()]
        
        # Obter serviço SOAP
        soap_service = await get_default_soap_service(db)
        if not soap_service:
            print(f"=== SCANNER: No SOAP service available ===", flush=True)
            return
        
        # Preparar path para listagem (Exec4)
        full_path = scan_job.path
        if not full_path.startswith('\\\\'):
            full_path = f"\\\\{server.ip}\\{scan_job.share_name}\\{scan_job.path}"
        
        print(f"=== SCANNER: Calling Exec4 for path: {full_path} ===", flush=True)
        
        try:
            # Chamar Exec4 para listar diretório
            params = {"s1": full_path, "s2": ""}
            result = await soap_service.call_soap_operation(db, "Exec4", params, ignore_cache=True)
            
            print(f"=== SCANNER: Exec4 result length: {len(result) if result else 0} ===", flush=True)
            
            if not result:
                print(f"=== SCANNER: Empty result from Exec4 ===", flush=True)
                return
            
            # Verificar erros
            result_lower = result.lower()
            if "access" in result_lower and "denied" in result_lower:
                print(f"=== SCANNER: Access denied for {full_path} ===", flush=True)
                logger.warning(f"Access denied: {full_path}")
                return
            
            # Parsear resultado (formato CSV ou XML)
            items = self._parse_directory_listing(result)
            print(f"=== SCANNER: Parsed {len(items)} items from directory listing ===", flush=True)
            
            files_added = 0
            dirs_added = 0
            
            for item in items:
                item_type = item.get('type', '')
                item_name = item.get('name', '')
                item_size = int(item.get('size', 0))
                item_path = f"{scan_job.path}\\{item_name}" if scan_job.path else item_name
                
                if item_type == 'Directory':
                    # Adicionar subdiretório à fila de scan
                    if scan_job.depth < scan_job.max_depth:
                        # Verificar se scan foi cancelado
                        if scan_job.id in self.cancelled_ids:
                            break
                        
                        async with self._lock:
                            sub_job = ScanJob(
                                server_id=scan_job.server_id,
                                share_name=scan_job.share_name,
                                path=item_path,
                                depth=scan_job.depth + 1,
                                max_depth=scan_job.max_depth,
                                max_file_size_bytes=scan_job.max_file_size_bytes,
                                apply_filters=scan_job.apply_filters,
                                parent_id=scan_job.parent_id or scan_job.id  # Herdar parent_id ou usar ID atual
                            )
                            self.scan_queue.append(sub_job)
                            dirs_added += 1
                
                elif item_type == 'File':
                    # Verificar extensão ignorada (apenas se aplicar filtros)
                    if scan_job.apply_filters and ignored_extensions:
                        file_lower = item_name.lower()
                        should_skip = any(file_lower.endswith(ext) for ext in ignored_extensions)
                        if should_skip:
                            logger.debug(f"Skipping file by extension: {item_name}")
                            continue
                    # Verificar se já existe job para este arquivo
                    existing = await db.execute(
                        select(DownloadJob).where(
                            DownloadJob.server_id == scan_job.server_id,
                            DownloadJob.file_path == item_path,
                            DownloadJob.status.in_(['pending', 'downloading', 'completed'])
                        )
                    )
                    if existing.scalar_one_or_none():
                        continue
                    
                    # Verificar tamanho máximo
                    status = 'pending'
                    skip_reason = None
                    if scan_job.max_file_size_bytes and item_size > scan_job.max_file_size_bytes:
                        status = 'skipped'
                        skip_reason = f"Arquivo excede limite de {scan_job.max_file_size_bytes / (1024*1024):.1f}MB"
                    
                    # Criar job de download
                    download_job = DownloadJob(
                        server_id=scan_job.server_id,
                        server_name=server.name,
                        server_ip=server.ip,
                        share_name=scan_job.share_name,
                        file_path=item_path,
                        file_name=item_name,
                        file_size=item_size,
                        status=status,
                        skip_reason=skip_reason,
                        max_file_size_bytes=scan_job.max_file_size_bytes,
                        max_depth=scan_job.max_depth
                    )
                    db.add(download_job)
                    files_added += 1
            
            await db.commit()
            scan_job.files_found = files_added
            scan_job.dirs_found = dirs_added
            print(f"=== SCANNER: Scanned {full_path}, added {files_added} files, {dirs_added} subdirs ===", flush=True)
            logger.info(f"Scanned directory: {full_path}, found {len(items)} items")
            
        except Exception as e:
            print(f"=== SCANNER ERROR in _scan_directory: {e} ===", flush=True)
            logger.error(f"Error scanning {full_path}: {e}")
    
    def _parse_directory_listing(self, result: str) -> List[dict]:
        """Parseia o resultado da listagem de diretório (formato SOAP Exec4)"""
        # Usar a função utilitária do server.py
        from server import parse_exec4_directory_listing
        
        items = parse_exec4_directory_listing(result)
        print(f"=== SCANNER PARSE: Found {len(items)} items ===", flush=True)
        return items


def get_scanner() -> DirectoryScanner:
    """Retorna a instância global do scanner"""
    global _scanner_instance
    if _scanner_instance is None:
        _scanner_instance = DirectoryScanner()
    return _scanner_instance


async def start_directory_scanner():
    """Inicia o scanner de diretórios"""
    scanner = get_scanner()
    await scanner.start()


async def stop_directory_scanner():
    """Para o scanner de diretórios"""
    scanner = get_scanner()
    await scanner.stop()


async def queue_directory_scan(server_id: int, share_name: str, path: str, max_depth: int, max_file_size_bytes: Optional[int], apply_filters: bool = True):
    """Adiciona um diretório para ser escaneado"""
    scanner = get_scanner()
    await scanner.add_scan_job(server_id, share_name, path, max_depth, max_file_size_bytes, apply_filters)
