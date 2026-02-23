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
MAX_DIRS_PER_CYCLE = 50  # máximo de diretórios a processar por ciclo

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
    
    # 0. Verificar extensões excluídas (ignorar estes arquivos)
    excluded_extensions = file_rules.get('excluded_extensions', [])
    for ext in excluded_extensions:
        if file_lower.endswith(ext.lower()):
            logger.debug(f"Excluded (extension '{ext}'): {file_name}")
            return False
    
    # 1. Verificar palavras-chave no nome do arquivo
    keywords = file_rules.get('keywords', [])
    for keyword in keywords:
        if keyword.lower() in file_lower:
            logger.debug(f"Critical match (keyword '{keyword}'): {file_name}")
            return True
    
    # 2. Verificar extensões críticas
    extensions = file_rules.get('extensions', [])
    for ext in extensions:
        if file_lower.endswith(ext.lower()):
            logger.debug(f"Critical match (extension '{ext}'): {file_name}")
            return True
    
    # 3. Verificar nomes de arquivos exatos
    exact_names = file_rules.get('exact_names', [])
    for exact in exact_names:
        if file_lower == exact.lower():
            logger.debug(f"Critical match (exact name '{exact}'): {file_name}")
            return True
    
    # 4. Verificar se tamanho está dentro do range crítico (se configurado)
    if size_rules.get('enabled', True):
        min_size = size_rules.get('min_bytes', 0)
        max_size = size_rules.get('max_bytes', 50 * 1024 * 1024)  # 50MB default
        
        # Arquivos muito pequenos ou muito grandes geralmente não são sensíveis
        if file_size < min_size or file_size > max_size:
            return False
    
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


class ScanJob:
    """Representa um job de scan de diretório"""
    def __init__(self, server_id: int, share_name: str, path: str, depth: int, max_depth: int, max_file_size_bytes: Optional[int], apply_filters: bool = True, parent_id: str = None, critical_only: bool = False):
        self.id = str(uuid.uuid4())[:8]  # ID curto único
        self.parent_id = parent_id  # ID do scan pai (para subdiretórios)
        self.server_id = server_id
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
            'critical_only': self.critical_only,
            'critical_files_found': self.critical_files_found,
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
    
    async def add_scan_job(self, server_id: int, share_name: str, path: str, max_depth: int, max_file_size_bytes: Optional[int], apply_filters: bool = True, critical_only: bool = False) -> str:
        """Adiciona um diretório para ser escaneado. Retorna o ID do job."""
        
        # Se for critical_only, carregar configurações
        if critical_only:
            try:
                from critical_search_service import get_critical_search_service
                service = get_critical_search_service()
                await service.load_config()
            except Exception as e:
                print(f"=== SCANNER: Error loading critical search config: {e} ===", flush=True)
        
        async with self._lock:
            job = ScanJob(
                server_id=server_id,
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
            print(f"=== SCANNER: Added {scan_type} scan job {job.id}: server={server_id}, share={share_name}, path={path} ===", flush=True)
            logger.info(f"Added scan job: {path} (critical_only={critical_only})")
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
                    
                    # Verificar se é um scan crítico ROOT que completou
                    # e se não há mais sub-scans pendentes
                    if scan_job.critical_only and scan_job.parent_id is None:
                        await self._check_and_trigger_gitleaks(scan_job)
                        
                except Exception as e:
                    scan_job.status = 'failed'
                    self.completed_scans.append(scan_job)
                    print(f"=== SCANNER ERROR scanning {scan_job.path}: {e} ===", flush=True)
                    logger.error(f"Error scanning directory {scan_job.path}: {e}")
    
    async def _check_and_trigger_gitleaks(self, root_scan_job: ScanJob):
        """
        Verifica se todos os sub-scans de um scan crítico root foram completados.
        Se sim, inicia o GitLeaks automaticamente.
        """
        # Verificar se há sub-scans pendentes
        async with self._lock:
            pending_subscans = [
                j for j in self.scan_queue 
                if j.parent_id == root_scan_job.id
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
            if completed.parent_id == root_scan_job.id:
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
                        # Verificar se scan foi cancelado
                        if scan_job.id in self.cancelled_ids:
                            break
                        
                        async with self._lock:
                            sub_job = ScanJob(
                                server_id=scan_job.server_id,
                                share_name=scan_job.share_name,
                                path=item_full_path,  # Usar path completo
                                depth=scan_job.depth + 1,
                                max_depth=scan_job.max_depth,
                                max_file_size_bytes=scan_job.max_file_size_bytes,
                                apply_filters=scan_job.apply_filters,
                                parent_id=scan_job.parent_id or scan_job.id,
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
