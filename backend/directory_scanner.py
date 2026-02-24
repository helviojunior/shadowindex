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
import re
import json
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import uuid

logger = logging.getLogger(__name__)

# Configurações do scanner
SCANNER_POLL_INTERVAL = 3  # segundos entre verificações
DEFAULT_MAX_SIMULTANEOUS_SCANS = 3  # padrão de workers simultâneos

# Instância global do scanner
_scanner_instance: Optional['DirectoryScanner'] = None

# Cache da configuração de Critical Search
_critical_search_config: Optional[Dict[str, Any]] = None


async def get_critical_search_config() -> Dict[str, Any]:
    """Obtém a configuração de Critical Search do banco de dados"""
    global _critical_search_config
    
    from database import AsyncSessionLocal, AppSettings
    
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(AppSettings).where(AppSettings.key == "critical_search_config")
        )
        setting = result.scalar_one_or_none()
        
        if setting and setting.value:
            try:
                _critical_search_config = json.loads(setting.value)
                return _critical_search_config
            except (json.JSONDecodeError, TypeError):
                pass
    
    # Retornar config padrão se não encontrar
    from routes_v2 import DEFAULT_CRITICAL_SEARCH_CONFIG
    return DEFAULT_CRITICAL_SEARCH_CONFIG


def is_critical_file(file_name: str, file_size: int, config: Dict[str, Any]) -> bool:
    """
    Verifica se um arquivo é considerado 'crítico' baseado nas regras de configuração.
    
    Args:
        file_name: Nome do arquivo
        file_size: Tamanho do arquivo em bytes
        config: Configuração de Critical Search
    
    Returns:
        True se o arquivo é crítico, False caso contrário
    """
    file_lower = file_name.lower()
    
    file_rules = config.get('file_rules', {})
    size_rules = config.get('size_rules', {})
    
    # 0. Verificar arquivos excluídos por nome exato (ignorar estes arquivos)
    excluded_files = file_rules.get('excluded_files', [])
    for excluded in excluded_files:
        if file_lower == excluded.lower():
            logger.debug(f"Excluded (file '{excluded}'): {file_name}")
            return False
    
    # 1. Verificar extensões excluídas (ignorar estes arquivos)
    excluded_extensions = file_rules.get('excluded_extensions', [])
    for ext in excluded_extensions:
        if file_lower.endswith(ext.lower()):
            logger.debug(f"Excluded (extension '{ext}'): {file_name}")
            return False
    
    # 2. Verificar regras de tamanho (aplicável a todos os arquivos)
    if size_rules.get('enabled', True):
        min_size = size_rules.get('min_bytes', 0)
        max_size = size_rules.get('max_bytes', 50 * 1024 * 1024)  # 50MB default
        
        # Arquivos fora do range de tamanho são ignorados
        if file_size < min_size:
            logger.debug(f"Excluded (size {file_size} < min {min_size}): {file_name}")
            return False
        if file_size > max_size:
            logger.debug(f"Excluded (size {file_size} > max {max_size}): {file_name}")
            return False
    
    # 3. Verificar palavras-chave no nome do arquivo
    keywords = file_rules.get('keywords', [])
    for keyword in keywords:
        if keyword.lower() in file_lower:
            logger.debug(f"Critical match (keyword '{keyword}'): {file_name}")
            return True
    
    # 4. Verificar extensões críticas
    extensions = file_rules.get('extensions', [])
    for ext in extensions:
        if file_lower.endswith(ext.lower()):
            logger.debug(f"Critical match (extension '{ext}'): {file_name}")
            return True
    
    # 5. Verificar nomes de arquivos exatos (críticos)
    exact_names = file_rules.get('exact_names', [])
    for exact in exact_names:
        if file_lower == exact.lower():
            logger.debug(f"Critical match (exact name '{exact}'): {file_name}")
            return True
    
    return False


def is_log_directory(dir_name: str, items: List, config: Dict[str, Any]) -> bool:
    """
    Verifica se um diretório parece ser de logs baseado nos padrões de arquivos.
    
    Args:
        dir_name: Nome do diretório
        items: Lista de itens no diretório
        config: Configuração de Critical Search
    
    Returns:
        True se parece ser um diretório de logs, False caso contrário
    """
    log_detection = config.get('log_detection', {})
    if not log_detection.get('enabled', True):
        return False
    
    # Verificar se o nome do diretório contém palavras de log
    dir_lower = dir_name.lower()
    log_indicators = ['log', 'logs', 'logging', 'audit', 'trace']
    if any(indicator in dir_lower for indicator in log_indicators):
        return True
    
    # Verificar quantidade de arquivos similares (padrão de logs)
    min_similar = log_detection.get('min_similar_files', 10)
    log_patterns = log_detection.get('log_patterns', [])
    
    # Contar arquivos que correspondem a padrões de log
    log_files = 0
    files = [item for item in items if getattr(item, 'item_type', None) == 'File']
    
    for item in files:
        name = getattr(item, 'name', '')
        for pattern in log_patterns:
            if re.match(pattern, name, re.IGNORECASE):
                log_files += 1
                break
    
    # Se muitos arquivos parecem logs, provavelmente é um diretório de logs
    if log_files >= min_similar:
        logger.debug(f"Directory '{dir_name}' detected as log directory ({log_files} log-like files)")
        return True
    
    return False

# Configurações do scanner
SCANNER_POLL_INTERVAL = 3  # segundos entre verificações
MAX_DIRS_PER_CYCLE = 50  # máximo de diretórios a processar por ciclo

# Instância global do scanner
_scanner_instance: Optional['DirectoryScanner'] = None


class ScanJobMemory:
    """Representa um job de scan de diretório em memória (para processamento)"""
    def __init__(self, db_id: int, server_id: int, server_guid: str, share_name: str, path: str, depth: int, max_depth: int, max_file_size_bytes: Optional[int], apply_filters: bool = True, parent_id: int = None, critical_only: bool = False):
        self.db_id = db_id  # ID do banco de dados
        self.id = str(uuid.uuid4())[:8]  # ID curto único para uso interno
        self.parent_id = parent_id  # ID do scan pai (para subdiretórios) - agora é db_id
        self.server_id = server_id
        self.server_guid = server_guid
        self.share_name = share_name
        self.path = path
        self.depth = depth
        self.max_depth = max_depth
        self.max_file_size_bytes = max_file_size_bytes
        self.apply_filters = apply_filters
        self.critical_only = critical_only  # Flag para busca crítica
        self.status = 'pending'  # pending, scanning, completed, cancelled
        self.created_at = datetime.now(timezone.utc)
        self.files_found = 0
        self.dirs_found = 0
        self.critical_files_found = 0  # Contador de arquivos críticos
    
    def to_dict(self):
        return {
            'id': self.db_id,  # Usar ID do banco
            'internal_id': self.id,
            'parent_id': self.parent_id,
            'server_id': self.server_id,
            'server_guid': self.server_guid,
            'share_name': self.share_name,
            'path': self.path,
            'depth': self.depth,
            'max_depth': self.max_depth,
            'status': self.status,
            'files_found': self.files_found,
            'dirs_found': self.dirs_found,
            'critical_only': self.critical_only,
            'critical_files_found': self.critical_files_found,
            'created_at': self.created_at.isoformat()
        }


# Alias para compatibilidade - DEPRECATED, usar ScanJobMemory
ScanJob = ScanJobMemory


class DirectoryScanner:
    """Worker que escaneia diretórios e adiciona arquivos à fila de downloads"""
    
    def __init__(self):
        self.running = False
        self._task: Optional[asyncio.Task] = None
        self.scan_queue: List[ScanJobMemory] = []
        self.completed_scans: List[ScanJobMemory] = []  # Últimos scans completados
        self.cancelled_ids: set = set()  # IDs de scans cancelados (db_ids)
        self._lock = asyncio.Lock()
    
    async def start(self):
        """Inicia o scanner em background"""
        if self.running:
            logger.info("Directory scanner already running")
            return
        
        self.running = True
        
        # Restaurar jobs pendentes do banco de dados
        await self._restore_pending_jobs()
        
        self._task = asyncio.create_task(self._run_loop())
        logger.info("Directory scanner started")
    
    async def _restore_pending_jobs(self):
        """Restaura jobs pendentes/running do banco de dados após reinício"""
        from database import AsyncSessionLocal, ScanJob as ScanJobDB, Server
        
        try:
            async with AsyncSessionLocal() as db:
                # Buscar jobs pendentes ou running
                result = await db.execute(
                    select(ScanJobDB).where(
                        ScanJobDB.status.in_(['pending', 'running'])
                    ).order_by(ScanJobDB.created_at)
                )
                pending_jobs = result.scalars().all()
                
                if pending_jobs:
                    print(f"=== SCANNER: Restoring {len(pending_jobs)} pending scan jobs from database ===", flush=True)
                    
                    for db_job in pending_jobs:
                        # Buscar server_id pelo guid
                        server_result = await db.execute(
                            select(Server).where(Server.guid == db_job.server_guid)
                        )
                        server = server_result.scalar_one_or_none()
                        
                        if not server:
                            print(f"=== SCANNER: Server not found for job {db_job.id}, marking as failed ===", flush=True)
                            db_job.status = 'failed'
                            db_job.error_message = 'Server not found'
                            continue
                        
                        # Criar job em memória
                        mem_job = ScanJobMemory(
                            db_id=db_job.id,
                            server_id=server.id,
                            server_guid=db_job.server_guid,
                            share_name=db_job.share_name,
                            path=db_job.path,
                            depth=1,  # Reiniciar do começo do path
                            max_depth=db_job.max_depth,
                            max_file_size_bytes=None,  # Usar configuração geral
                            apply_filters=True,
                            parent_id=None,
                            critical_only=db_job.critical_only
                        )
                        mem_job.status = 'pending'  # Reset para pending
                        mem_job.files_found = db_job.total_files or 0
                        mem_job.critical_files_found = db_job.critical_files_found or 0
                        
                        self.scan_queue.append(mem_job)
                        print(f"=== SCANNER: Restored job {db_job.id}: {db_job.path} ===", flush=True)
                    
                    await db.commit()
                else:
                    print("=== SCANNER: No pending jobs to restore ===", flush=True)
                    
        except Exception as e:
            print(f"=== SCANNER ERROR restoring jobs: {e} ===", flush=True)
            logger.error(f"Error restoring scan jobs: {e}")
    
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
    
    async def get_scan_jobs(self) -> List[dict]:
        """Retorna lista de scan jobs do banco de dados"""
        from database import AsyncSessionLocal, ScanJob as ScanJobDB
        
        jobs = []
        
        # Jobs em memória (pendentes e em scanning)
        for job in self.scan_queue:
            jobs.append(job.to_dict())
        
        # Jobs do banco (completed, cancelled, failed) - últimos 50
        try:
            async with AsyncSessionLocal() as db:
                result = await db.execute(
                    select(ScanJobDB).where(
                        ScanJobDB.status.in_(['completed', 'cancelled', 'failed'])
                    ).order_by(ScanJobDB.created_at.desc()).limit(50)
                )
                db_jobs = result.scalars().all()
                
                for db_job in db_jobs:
                    jobs.append({
                        'id': db_job.id,
                        'server_guid': db_job.server_guid,
                        'share_name': db_job.share_name,
                        'path': db_job.path,
                        'max_depth': db_job.max_depth,
                        'status': db_job.status,
                        'total_files': db_job.total_files or 0,
                        'processed_files': db_job.processed_files or 0,
                        'queued_files': db_job.queued_files or 0,
                        'critical_only': db_job.critical_only,
                        'critical_files_found': db_job.critical_files_found or 0,
                        'error_message': db_job.error_message,
                        'created_at': db_job.created_at.isoformat() if db_job.created_at else None,
                        'started_at': db_job.started_at.isoformat() if db_job.started_at else None,
                        'completed_at': db_job.completed_at.isoformat() if db_job.completed_at else None
                    })
        except Exception as e:
            logger.error(f"Error fetching scan jobs from DB: {e}")
        
        return jobs
    
    async def cancel_scan(self, scan_id: int) -> bool:
        """Cancela um scan job pelo ID do banco"""
        from database import AsyncSessionLocal, ScanJob as ScanJobDB
        
        async with self._lock:
            # Marcar como cancelado
            self.cancelled_ids.add(scan_id)
            
            # Remover da fila em memória se pendente
            for job in self.scan_queue:
                if job.db_id == scan_id:
                    job.status = 'cancelled'
                    self.scan_queue.remove(job)
                    
                    # Atualizar no banco
                    try:
                        async with AsyncSessionLocal() as db:
                            result = await db.execute(
                                select(ScanJobDB).where(ScanJobDB.id == scan_id)
                            )
                            db_job = result.scalar_one_or_none()
                            if db_job:
                                db_job.status = 'cancelled'
                                db_job.completed_at = datetime.now(timezone.utc)
                                await db.commit()
                    except Exception as e:
                        logger.error(f"Error updating cancelled scan in DB: {e}")
                    
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
            
            # Tentar cancelar direto no banco se não estava em memória
            try:
                async with AsyncSessionLocal() as db:
                    result = await db.execute(
                        select(ScanJobDB).where(ScanJobDB.id == scan_id)
                    )
                    db_job = result.scalar_one_or_none()
                    if db_job and db_job.status in ['pending', 'running']:
                        db_job.status = 'cancelled'
                        db_job.completed_at = datetime.now(timezone.utc)
                        await db.commit()
                        print(f"=== SCANNER: Cancelled scan job {scan_id} in DB ===", flush=True)
                        return True
            except Exception as e:
                logger.error(f"Error cancelling scan in DB: {e}")
            
            return False
    
    async def clear_finished_scans(self) -> int:
        """Limpa scans finalizados (completed, cancelled, failed) do banco"""
        from database import AsyncSessionLocal, ScanJob as ScanJobDB
        from sqlalchemy import delete
        
        async with self._lock:
            count = len(self.completed_scans)
            self.completed_scans.clear()
            self.cancelled_ids.clear()
            
            # Limpar do banco também
            try:
                async with AsyncSessionLocal() as db:
                    result = await db.execute(
                        delete(ScanJobDB).where(
                            ScanJobDB.status.in_(['completed', 'cancelled', 'failed'])
                        )
                    )
                    db_count = result.rowcount
                    await db.commit()
                    count += db_count
                    print(f"=== SCANNER: Cleared {db_count} finished scans from DB ===", flush=True)
            except Exception as e:
                logger.error(f"Error clearing finished scans from DB: {e}")
            
            print(f"=== SCANNER: Cleared {count} total finished scans ===", flush=True)
            return count
    
    async def cancel_all_scans(self) -> int:
        """Cancela todos os scan jobs pendentes"""
        from database import AsyncSessionLocal, ScanJob as ScanJobDB
        
        async with self._lock:
            count = len(self.scan_queue)
            
            # Cancelar jobs em memória
            db_ids_to_cancel = []
            for job in self.scan_queue:
                job.status = 'cancelled'
                self.cancelled_ids.add(job.db_id)
                db_ids_to_cancel.append(job.db_id)
            self.scan_queue.clear()
            
            # Atualizar no banco
            try:
                async with AsyncSessionLocal() as db:
                    # Cancelar os que estavam em memória
                    for db_id in db_ids_to_cancel:
                        result = await db.execute(
                            select(ScanJobDB).where(ScanJobDB.id == db_id)
                        )
                        db_job = result.scalar_one_or_none()
                        if db_job:
                            db_job.status = 'cancelled'
                            db_job.completed_at = datetime.now(timezone.utc)
                    
                    # Cancelar quaisquer outros pendentes no banco
                    result = await db.execute(
                        select(ScanJobDB).where(
                            ScanJobDB.status.in_(['pending', 'running'])
                        )
                    )
                    other_jobs = result.scalars().all()
                    for db_job in other_jobs:
                        db_job.status = 'cancelled'
                        db_job.completed_at = datetime.now(timezone.utc)
                        count += 1
                    
                    await db.commit()
            except Exception as e:
                logger.error(f"Error cancelling all scans in DB: {e}")
            
            print(f"=== SCANNER: Cancelled all {count} scan jobs ===", flush=True)
            return count
    
    async def add_scan_job(self, server_id: int, share_name: str, path: str, max_depth: int, max_file_size_bytes: Optional[int], apply_filters: bool = True, critical_only: bool = False) -> int:
        """Adiciona um diretório para ser escaneado. Retorna o ID do job do banco."""
        from database import AsyncSessionLocal, ScanJob as ScanJobDB, Server
        
        # Se for critical_only, carregar configurações
        if critical_only:
            try:
                from critical_search_service import get_critical_search_service
                service = get_critical_search_service()
                await service.load_config()
            except Exception as e:
                print(f"=== SCANNER: Error loading critical search config: {e} ===", flush=True)
        
        # Buscar server_guid
        server_guid = None
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Server).where(Server.id == server_id))
            server = result.scalar_one_or_none()
            if server:
                server_guid = server.guid
        
        if not server_guid:
            raise ValueError(f"Server {server_id} not found")
        
        # Criar job no banco de dados
        db_job_id = None
        async with AsyncSessionLocal() as db:
            db_job = ScanJobDB(
                server_guid=server_guid,
                share_name=share_name,
                path=path,
                max_depth=max_depth,
                critical_only=critical_only,
                status='pending',
                created_at=datetime.now(timezone.utc)
            )
            db.add(db_job)
            await db.commit()
            await db.refresh(db_job)
            db_job_id = db_job.id
        
        # Criar job em memória
        async with self._lock:
            job = ScanJobMemory(
                db_id=db_job_id,
                server_id=server_id,
                server_guid=server_guid,
                share_name=share_name,
                path=path,
                depth=1,
                max_depth=max_depth,
                max_file_size_bytes=max_file_size_bytes,
                apply_filters=apply_filters,
                critical_only=critical_only
            )
            self.scan_queue.append(job)
            scan_type = "CRITICAL" if critical_only else ""
            print(f"=== SCANNER: Added {scan_type} scan job {db_job_id}: server={server_id}, share={share_name}, path={path} ===", flush=True)
            logger.info(f"Added scan job {db_job_id}: {path} (critical_only={critical_only})")
            return db_job_id
    
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
        
        # Pegar um lote de jobs para processar
        async with self._lock:
            jobs_to_process = self.scan_queue[:MAX_DIRS_PER_CYCLE]
            self.scan_queue = self.scan_queue[MAX_DIRS_PER_CYCLE:]
        
        async with AsyncSessionLocal() as db:
            for scan_job in jobs_to_process:
                # Verificar se foi cancelado (por db_id)
                if scan_job.db_id in self.cancelled_ids or scan_job.parent_id in self.cancelled_ids:
                    scan_job.status = 'cancelled'
                    self.completed_scans.append(scan_job)
                    print(f"=== SCANNER: Skipping cancelled job {scan_job.db_id} ===", flush=True)
                    continue
                
                try:
                    scan_job.status = 'scanning'
                    
                    # Atualizar status no banco para 'running'
                    await self._update_job_status_in_db(scan_job.db_id, 'running', started=True)
                    
                    print(f"=== SCANNER: Scanning directory: {scan_job.path} ===", flush=True)
                    await self._scan_directory(db, scan_job)
                    scan_job.status = 'completed'
                    self.completed_scans.append(scan_job)
                    
                    # Atualizar status no banco para 'completed'
                    await self._update_job_status_in_db(
                        scan_job.db_id, 
                        'completed', 
                        completed=True,
                        total_files=scan_job.files_found,
                        critical_files=scan_job.critical_files_found
                    )
                    
                    # Manter apenas últimos 50 completados
                    if len(self.completed_scans) > 50:
                        self.completed_scans = self.completed_scans[-50:]
                    
                    # Verificar se é um scan crítico ROOT que completou
                    # e se não há mais sub-scans pendentes
                    if scan_job.critical_only and scan_job.parent_id is None:
                        await self._check_and_trigger_gitleaks(scan_job)
                        
                except Exception as e:
                    scan_job.status = 'failed'
                    self.completed_scans.append(scan_job)
                    
                    # Atualizar status no banco para 'failed'
                    await self._update_job_status_in_db(scan_job.db_id, 'failed', completed=True, error=str(e))
                    
                    print(f"=== SCANNER ERROR scanning {scan_job.path}: {e} ===", flush=True)
                    logger.error(f"Error scanning directory {scan_job.path}: {e}")
    
    async def _update_job_status_in_db(self, db_id: int, status: str, started: bool = False, completed: bool = False, 
                                        total_files: int = None, critical_files: int = None, error: str = None):
        """Atualiza o status de um job no banco de dados"""
        from database import AsyncSessionLocal, ScanJob as ScanJobDB
        
        if not db_id:
            return
        
        try:
            async with AsyncSessionLocal() as db:
                result = await db.execute(select(ScanJobDB).where(ScanJobDB.id == db_id))
                db_job = result.scalar_one_or_none()
                
                if db_job:
                    db_job.status = status
                    
                    if started:
                        db_job.started_at = datetime.now(timezone.utc)
                    
                    if completed:
                        db_job.completed_at = datetime.now(timezone.utc)
                    
                    if total_files is not None:
                        db_job.total_files = total_files
                    
                    if critical_files is not None:
                        db_job.critical_files_found = critical_files
                    
                    if error:
                        db_job.error_message = error
                    
                    await db.commit()
        except Exception as e:
            logger.error(f"Error updating job {db_id} status in DB: {e}")
    
    async def _check_and_trigger_gitleaks(self, root_scan_job: ScanJobMemory):
        """
        Verifica se todos os sub-scans de um scan crítico root foram completados.
        Se sim, inicia o GitLeaks automaticamente.
        """
        # Verificar se há sub-scans pendentes (usar db_id como parent_id)
        async with self._lock:
            pending_subscans = [
                j for j in self.scan_queue 
                if j.parent_id == root_scan_job.db_id
            ]
            if pending_subscans:
                # Ainda há sub-scans, será chamado novamente quando completarem
                return
        
        # Obter configuração
        critical_config = await get_critical_search_config()
        auto_gitleaks = critical_config.get('auto_gitleaks', {})
        
        if not auto_gitleaks.get('enabled', True):
            print("=== SCANNER: Auto GitLeaks disabled, skipping ===", flush=True)
            return
        
        # Calcular total de arquivos críticos encontrados
        total_critical = root_scan_job.critical_files_found
        for completed in self.completed_scans:
            if completed.parent_id == root_scan_job.db_id:
                total_critical += completed.critical_files_found
        
        if total_critical == 0:
            print("=== SCANNER: No critical files found, skipping GitLeaks ===", flush=True)
            return
        
        print(f"=== SCANNER: Critical scan complete! Found {total_critical} critical files. Starting GitLeaks... ===", flush=True)
        
        # Aguardar delay configurado
        delay = auto_gitleaks.get('delay_seconds', 5)
        await asyncio.sleep(delay)
        
        # Iniciar GitLeaks
        try:
            from leaks_service import start_gitleaks_scan
            await start_gitleaks_scan(root_scan_job.server_id)
            print(f"=== SCANNER: GitLeaks scan started for server {root_scan_job.server_id} ===", flush=True)
        except Exception as e:
            print(f"=== SCANNER ERROR starting GitLeaks: {e} ===", flush=True)
            logger.error(f"Error starting GitLeaks after critical scan: {e}")
    
    async def _scan_directory(self, db: AsyncSession, scan_job: ScanJob):
        """Escaneia um diretório e adiciona arquivos à fila"""
        from database import Server, DownloadJob, AppSettings
        from plugins.factory import get_plugin_for_server
        
        print(f"=== SCANNER: _scan_directory called for {scan_job.path}, depth={scan_job.depth}/{scan_job.max_depth} ===", flush=True)
        
        # Verificar limite de profundidade
        if scan_job.depth > scan_job.max_depth:
            print("=== SCANNER: Max depth reached, skipping ===", flush=True)
            return
        
        # Obter servidor
        result = await db.execute(select(Server).where(Server.id == scan_job.server_id))
        server = result.scalar_one_or_none()
        if not server:
            print(f"=== SCANNER: Server {scan_job.server_id} not found ===", flush=True)
            logger.warning(f"Server {scan_job.server_id} not found")
            return
        
        # Refresh para garantir que os atributos estão carregados
        await db.refresh(server)
        
        print(f"=== SCANNER: Found server {server.name} ({server.ip}), plugin_instance_id={server.plugin_instance_id} ===", flush=True)
        
        # Verificar se o servidor tem instância de plugin configurada
        if not server.plugin_instance_id:
            print(f"=== SCANNER: Server {server.name} has no plugin instance configured ===", flush=True)
            logger.warning(f"Server {server.name} has no plugin instance configured")
            return
        
        # Obter extensões ignoradas (apenas se aplicar filtros)
        ignored_extensions = []
        if scan_job.apply_filters:
            ext_result = await db.execute(select(AppSettings).where(AppSettings.key == 'ignored_extensions'))
            ext_setting = ext_result.scalar_one_or_none()
            if ext_setting and ext_setting.value:
                ignored_extensions = [ext.strip().lower() for ext in ext_setting.value.split(',') if ext.strip()]
        
        # Obter plugin usando a instância configurada no servidor
        try:
            plugin = await get_plugin_for_server(db, server)
            if not plugin:
                print(f"=== SCANNER: Could not get plugin for server {server.name} ===", flush=True)
                return
            print(f"=== SCANNER: Using plugin instance ID {server.plugin_instance_id} ===", flush=True)
        except Exception as e:
            print(f"=== SCANNER: Error getting plugin: {e} ===", flush=True)
            logger.error(f"Error getting plugin for server {server.id}: {e}")
            return
        
        # Preparar path para listagem
        full_path = scan_job.path
        if not full_path.startswith('\\\\'):
            full_path = f"\\\\{server.ip}\\{scan_job.share_name}\\{scan_job.path}"
        
        print(f"=== SCANNER: Calling list_directory for path: {full_path} ===", flush=True)
        
        try:
            # Usar o método list_directory do plugin
            items = await plugin.list_directory(full_path, ignore_cache=True)
            
            print(f"=== SCANNER: list_directory returned {len(items) if items else 0} items ===", flush=True)
            
            if not items:
                print("=== SCANNER: Empty result from list_directory ===", flush=True)
                return
            
            files_added = 0
            dirs_added = 0
            critical_files_added = 0
            
            # Carregar configuração de Critical Search se necessário
            critical_config = None
            if scan_job.critical_only:
                critical_config = await get_critical_search_config()
                print("=== SCANNER: Critical search mode, config loaded ===", flush=True)
            
            for item in items:
                # DirectoryItem tem: name, item_type, size, full_path, etc.
                item_type = item.item_type  # 'File' ou 'Directory'
                item_name = item.name
                item_size = item.size or 0
                item_full_path = item.full_path or f"{full_path}\\{item_name}"
                
                if item_type == 'Directory':
                    # Para Critical Search, verificar se é diretório de logs
                    if scan_job.critical_only:
                        if is_log_directory(item_name, items, critical_config):
                            logger.info(f"Skipping log directory in critical search: {item_name}")
                            print(f"=== SCANNER: Skipping log directory: {item_name} ===", flush=True)
                            continue
                    
                    # Adicionar subdiretório à fila de scan
                    if scan_job.depth < scan_job.max_depth:
                        # Verificar se scan foi cancelado (por db_id)
                        if scan_job.db_id in self.cancelled_ids:
                            break
                        
                        async with self._lock:
                            # Sub-jobs não são persistidos no banco (somente o job root é)
                            # Eles usam parent_id apontando para o db_id do root
                            sub_job = ScanJobMemory(
                                db_id=None,  # Sub-jobs não têm entrada no banco
                                server_id=scan_job.server_id,
                                server_guid=scan_job.server_guid,
                                share_name=scan_job.share_name,
                                path=item_full_path,  # Usar path completo
                                depth=scan_job.depth + 1,
                                max_depth=scan_job.max_depth,
                                max_file_size_bytes=scan_job.max_file_size_bytes,
                                apply_filters=scan_job.apply_filters,
                                parent_id=scan_job.parent_id or scan_job.db_id,  # Apontar para o root
                                critical_only=scan_job.critical_only  # Propagar flag
                            )
                            self.scan_queue.append(sub_job)
                            dirs_added += 1
                
                elif item_type == 'File':
                    # Para Critical Search, verificar se é arquivo crítico
                    if scan_job.critical_only and critical_config:
                        if not is_critical_file(item_name, item_size, critical_config):
                            continue  # Pular arquivos não-críticos
                        critical_files_added += 1
                        print(f"=== SCANNER: Critical file found: {item_name} ===", flush=True)
                    
                    # Verificar extensão ignorada (apenas se aplicar filtros e não for critical_only)
                    if scan_job.apply_filters and ignored_extensions and not scan_job.critical_only:
                        file_lower = item_name.lower()
                        should_skip = False
                        for ext in ignored_extensions:
                            if ext.endswith('.*'):
                                # Padrão com wildcard: .log.* deve ignorar .log.1, .log.2, etc.
                                base_ext = ext[:-2]  # Remove .*
                                if base_ext in file_lower:
                                    # Verificar se tem algo após o padrão base (ex: .log.1, .log.2)
                                    pattern = re.escape(base_ext) + r'\.\d+'
                                    if re.search(pattern, file_lower):
                                        should_skip = True
                                        break
                            elif file_lower.endswith(ext):
                                should_skip = True
                                break
                        if should_skip:
                            logger.debug(f"Skipping file by extension: {item_name}")
                            continue
                    
                    # Verificar se já existe job para este arquivo
                    existing = await db.execute(
                        select(DownloadJob).where(
                            DownloadJob.server_id == scan_job.server_id,
                            DownloadJob.file_path == item_full_path,
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
                        file_path=item_full_path,
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
            scan_job.critical_files_found = critical_files_added
            
            if scan_job.critical_only:
                print(f"=== SCANNER: Critical scan {full_path}, found {critical_files_added} critical files, {dirs_added} subdirs ===", flush=True)
            else:
                print(f"=== SCANNER: Scanned {full_path}, added {files_added} files, {dirs_added} subdirs ===", flush=True)
            logger.info(f"Scanned directory: {full_path}, found {len(items)} items")
            
        except Exception as e:
            print(f"=== SCANNER ERROR in _scan_directory: {e} ===", flush=True)
            logger.error(f"Error scanning {full_path}: {e}")


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


async def queue_directory_scan(server_id: int, share_name: str, path: str, max_depth: int, max_file_size_bytes: Optional[int], apply_filters: bool = True, critical_only: bool = False):
    """Adiciona um diretório para ser escaneado"""
    scanner = get_scanner()
    await scanner.add_scan_job(server_id, share_name, path, max_depth, max_file_size_bytes, apply_filters, critical_only)
