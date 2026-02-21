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

logger = logging.getLogger(__name__)

# Configurações do scanner
SCANNER_POLL_INTERVAL = 3  # segundos entre verificações
MAX_DIRS_PER_CYCLE = 50  # máximo de diretórios a processar por ciclo

# Instância global do scanner
_scanner_instance: Optional['DirectoryScanner'] = None


class ScanJob:
    """Representa um job de scan de diretório"""
    def __init__(self, server_id: int, share_name: str, path: str, depth: int, max_depth: int, max_file_size_bytes: Optional[int], apply_filters: bool = True):
        self.server_id = server_id
        self.share_name = share_name
        self.path = path
        self.depth = depth
        self.max_depth = max_depth
        self.max_file_size_bytes = max_file_size_bytes
        self.apply_filters = apply_filters  # Se False, ignora filtros de tamanho e extensão


class DirectoryScanner:
    """Worker que escaneia diretórios e adiciona arquivos à fila de downloads"""
    
    def __init__(self):
        self.running = False
        self._task: Optional[asyncio.Task] = None
        self.scan_queue: List[ScanJob] = []
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
    
    async def add_scan_job(self, server_id: int, share_name: str, path: str, max_depth: int, max_file_size_bytes: Optional[int], apply_filters: bool = True):
        """Adiciona um diretório para ser escaneado"""
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
            logger.info(f"Added scan job: {path}")
    
    async def _run_loop(self):
        """Loop principal do scanner"""
        while self.running:
            try:
                await self._process_scan_queue()
            except Exception as e:
                logger.error(f"Error in directory scanner loop: {e}")
            
            await asyncio.sleep(SCANNER_POLL_INTERVAL)
    
    async def _process_scan_queue(self):
        """Processa jobs de scan na fila"""
        if not self.scan_queue:
            return
        
        from database import Server, DownloadJob, AsyncSessionLocal
        from soap_service import get_default_soap_service
        
        # Pegar um lote de jobs para processar
        async with self._lock:
            jobs_to_process = self.scan_queue[:MAX_DIRS_PER_CYCLE]
            self.scan_queue = self.scan_queue[MAX_DIRS_PER_CYCLE:]
        
        async with AsyncSessionLocal() as db:
            for scan_job in jobs_to_process:
                try:
                    await self._scan_directory(db, scan_job)
                except Exception as e:
                    logger.error(f"Error scanning directory {scan_job.path}: {e}")
    
    async def _scan_directory(self, db: AsyncSession, scan_job: ScanJob):
        """Escaneia um diretório e adiciona arquivos à fila"""
        from database import Server, DownloadJob, AppSettings
        from soap_service import get_default_soap_service
        
        # Verificar limite de profundidade
        if scan_job.depth > scan_job.max_depth:
            return
        
        # Obter servidor
        result = await db.execute(select(Server).where(Server.id == scan_job.server_id))
        server = result.scalar_one_or_none()
        if not server:
            logger.warning(f"Server {scan_job.server_id} not found")
            return
        
        # Obter extensões ignoradas (apenas se aplicar filtros)
        ignored_extensions = []
        if scan_job.apply_filters:
            ext_result = await db.execute(select(AppSettings).where(AppSettings.key == 'ignored_extensions'))
            ext_setting = ext_result.scalar_one_or_none()
            if ext_setting and ext_setting.value:
                ignored_extensions = [ext.strip().lower() for ext in ext_setting.value.split(',') if ext.strip()]
        
        # Obter serviço SOAP
        soap_service = await get_default_soap_service(db)
        
        # Preparar path para listagem (Exec4)
        full_path = scan_job.path
        if not full_path.startswith('\\\\'):
            full_path = f"\\\\{server.ip}\\{scan_job.share_name}\\{scan_job.path}"
        
        try:
            # Chamar Exec4 para listar diretório
            params = {"s1": full_path, "s2": ""}
            result = await soap_service.call_soap_operation(db, "Exec4", params, ignore_cache=True)
            
            if not result:
                return
            
            # Verificar erros
            result_lower = result.lower()
            if "access" in result_lower and "denied" in result_lower:
                logger.warning(f"Access denied: {full_path}")
                return
            
            # Parsear resultado (formato CSV ou XML)
            items = self._parse_directory_listing(result)
            
            for item in items:
                item_type = item.get('type', '')
                item_name = item.get('name', '')
                item_size = int(item.get('size', 0))
                item_path = f"{scan_job.path}\\{item_name}" if scan_job.path else item_name
                
                if item_type == 'Directory':
                    # Adicionar subdiretório à fila de scan
                    if scan_job.depth < scan_job.max_depth:
                        async with self._lock:
                            sub_job = ScanJob(
                                server_id=scan_job.server_id,
                                share_name=scan_job.share_name,
                                path=item_path,
                                depth=scan_job.depth + 1,
                                max_depth=scan_job.max_depth,
                                max_file_size_bytes=scan_job.max_file_size_bytes,
                                apply_filters=scan_job.apply_filters
                            )
                            self.scan_queue.append(sub_job)
                
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
            
            await db.commit()
            logger.info(f"Scanned directory: {full_path}, found {len(items)} items")
            
        except Exception as e:
            logger.error(f"Error scanning {full_path}: {e}")
    
    def _parse_directory_listing(self, result: str) -> List[dict]:
        """Parseia o resultado da listagem de diretório"""
        items = []
        
        if not result or not result.strip():
            return items
        
        result = result.strip()
        
        # Se for XML
        if result.startswith('<'):
            try:
                import xml.etree.ElementTree as ET
                root = ET.fromstring(result)
                for item in root.findall('.//Item') or root.findall('.//item'):
                    item_dict = {
                        'name': item.findtext('Name') or item.findtext('name') or '',
                        'type': item.findtext('Type') or item.findtext('type') or 'File',
                        'size': item.findtext('Size') or item.findtext('size') or '0'
                    }
                    if item_dict['name']:
                        items.append(item_dict)
            except Exception as e:
                logger.warning(f"Error parsing XML directory listing: {e}")
        
        # Se for CSV ou texto separado por linha
        else:
            lines = result.split('\n')
            for line in lines:
                line = line.strip()
                if not line:
                    continue
                
                # Formato esperado: "name|type|size" ou "name,type,size"
                parts = line.split('|') if '|' in line else line.split(',')
                if len(parts) >= 2:
                    item_dict = {
                        'name': parts[0].strip(),
                        'type': parts[1].strip() if len(parts) > 1 else 'File',
                        'size': parts[2].strip() if len(parts) > 2 else '0'
                    }
                    if item_dict['name'] and item_dict['name'] not in ['.', '..']:
                        items.append(item_dict)
        
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


async def queue_directory_scan(server_id: int, share_name: str, path: str, max_depth: int, max_file_size_bytes: Optional[int]):
    """Adiciona um diretório para ser escaneado"""
    scanner = get_scanner()
    await scanner.add_scan_job(server_id, share_name, path, max_depth, max_file_size_bytes)
