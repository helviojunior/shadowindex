"""
Download Worker - Processador de downloads em background

Este módulo gerencia a fila de downloads e processa jobs de forma assíncrona.
Características:
- Número de downloads simultâneos configurável via AppSettings
- Processamento em background independente do navegador
- Suporte a downloads em chunks para arquivos grandes
- Atualização de progresso em tempo real via WebSocket
- Reset de jobs travados na inicialização
"""

import asyncio
import logging
import base64
import hashlib
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from database import FileVersion, ServerItem
from websocket_manager import get_websocket_manager

logger = logging.getLogger(__name__)

# Configurações do worker
CHUNK_SIZE = 1024 * 1024  # 1MB chunks
WORKER_POLL_INTERVAL = 2  # segundos entre verificações

# Instância global do worker
_worker_instance: Optional['DownloadWorker'] = None


async def ensure_parent_directories(db: AsyncSession, server, share_name: str, file_path: str, file_size: int = None):
    """
    Garante que todos os diretórios pais de um arquivo existam no banco de dados como ServerItem.
    Também cria o ServerItem do próprio arquivo se não existir.
    Isso permite que a árvore de navegação mostre corretamente os diretórios e arquivos mesmo quando
    arquivos são baixados via jobs em background.
    
    Args:
        db: Sessão do banco de dados
        server: Objeto Server
        share_name: Nome do share
        file_path: Caminho completo do arquivo (ex: \\\\ip\\share\\folder\\file.txt)
        file_size: Tamanho do arquivo em bytes (opcional)
    """
    try:
        # Normalizar o caminho
        original_file_path = file_path
        if not file_path.startswith('\\\\'):
            file_path = f"\\\\{server.ip}\\{share_name}\\{file_path}"
        
        # Dividir o caminho em partes
        parts = file_path.split('\\')
        # parts: ['', '', 'ip', 'share', 'folder1', 'folder2', 'file.txt']
        
        if len(parts) < 5:
            # Caminho muito curto (apenas share + arquivo direto no share)
            # Ainda precisamos criar o ServerItem do arquivo
            pass
        else:
            # O caminho do share é: \\ip\share
            share_path = f"\\\\{parts[2]}\\{parts[3]}"
            
            # Iterar pelos diretórios intermediários (excluindo o arquivo no final)
            # Ex: para \\ip\share\a\b\c\file.txt, criar a, b, c como diretórios
            for i in range(4, len(parts) - 1):
                dir_name = parts[i]
                current_full_path = '\\'.join([''] + [''] + parts[2:i+1])  # \\ip\share\a, \\ip\share\a\b, etc
                parent_path = '\\'.join([''] + [''] + parts[2:i]) if i > 4 else share_path
                
                # Verificar se já existe
                existing = await db.execute(
                    select(ServerItem).where(
                        ServerItem.server_guid == server.guid,
                        ServerItem.full_path == current_full_path
                    )
                )
                existing_item = existing.scalar_one_or_none()
                
                if not existing_item:
                    # Criar o diretório
                    new_dir = ServerItem(
                        server_guid=server.guid,
                        share_name=share_name,
                        parent_path=parent_path,
                        item_type='Directory',
                        name=dir_name,
                        full_path=current_full_path,
                        size='---',
                        modified=None,
                        access_denied=False,
                        has_children=True,  # Pelo menos tem o arquivo sendo baixado
                        children_fetched=False,  # Não foi expandido manualmente
                        discovered_at=datetime.now(timezone.utc)
                    )
                    db.add(new_dir)
                    logger.debug(f"Created directory ServerItem: {current_full_path}")
                else:
                    # Garantir que has_children é True (já que tem pelo menos o arquivo)
                    if not existing_item.has_children:
                        existing_item.has_children = True
        
        # Agora criar o ServerItem do próprio arquivo
        file_name = parts[-1] if len(parts) > 0 else original_file_path.split('\\')[-1]
        file_full_path = file_path
        file_parent_path = '\\'.join([''] + [''] + parts[2:-1]) if len(parts) > 4 else f"\\\\{parts[2]}\\{parts[3]}"
        
        # Verificar se o arquivo já existe como ServerItem
        existing_file = await db.execute(
            select(ServerItem).where(
                ServerItem.server_guid == server.guid,
                ServerItem.full_path == file_full_path
            )
        )
        existing_file_item = existing_file.scalar_one_or_none()
        
        if not existing_file_item:
            # Criar o ServerItem do arquivo
            size_str = str(file_size) if file_size is not None else '---'
            new_file = ServerItem(
                server_guid=server.guid,
                share_name=share_name,
                parent_path=file_parent_path,
                item_type='File',
                name=file_name,
                full_path=file_full_path,
                size=size_str,
                modified=None,
                access_denied=False,
                has_children=False,
                children_fetched=False,
                discovered_at=datetime.now(timezone.utc)
            )
            db.add(new_file)
            logger.debug(f"Created file ServerItem: {file_full_path}")
        else:
            # Atualizar tamanho se fornecido
            if file_size is not None:
                existing_file_item.size = str(file_size)
        
        await db.commit()
        logger.info(f"Ensured parent directories and file item for: {file_path}")
        
    except Exception as e:
        logger.warning(f"Error ensuring parent directories for {file_path}: {e}")


async def emit_download_stats():
    """Busca e emite estatísticas de downloads via WebSocket"""
    from database import async_session_maker, DownloadJob
    
    try:
        async with async_session_maker() as db:
            result = await db.execute(
                select(DownloadJob.status, func.count(DownloadJob.id))
                .group_by(DownloadJob.status)
            )
            status_counts = dict(result.all())
            
            stats = {
                "total": sum(status_counts.values()),
                "pending": status_counts.get('pending', 0),
                "downloading": status_counts.get('downloading', 0),
                "completed": status_counts.get('completed', 0),
                "failed": status_counts.get('failed', 0),
                "cancelled": status_counts.get('cancelled', 0),
                "skipped": status_counts.get('skipped', 0)
            }
            
            ws_manager = get_websocket_manager()
            await ws_manager.emit_download_stats(stats)
    except Exception as e:
        logger.error(f"Error emitting download stats: {e}")


async def get_max_concurrent_downloads() -> int:
    """Obtém o número máximo de downloads simultâneos das configurações"""
    from database import AppSettings, AsyncSessionLocal
    
    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(AppSettings).where(AppSettings.key == 'max_simultaneous_downloads')
            )
            setting = result.scalar_one_or_none()
            if setting and setting.value:
                return int(setting.value)
    except Exception as e:
        logger.warning(f"Error getting max_simultaneous_downloads: {e}")
    
    return 3  # Valor padrão


class DownloadWorker:
    """Worker que processa downloads em background"""
    
    def __init__(self):
        self.running = False
        self.active_downloads = 0
        self.max_concurrent = 3  # Será atualizado do banco
        self.semaphore = asyncio.Semaphore(3)
        self._task: Optional[asyncio.Task] = None
    
    async def start(self):
        """Inicia o worker em background"""
        if self.running:
            logger.info("Download worker already running")
            return
        
        # Resetar jobs que ficaram travados com status 'downloading' de execuções anteriores
        await self._reset_stale_downloading_jobs()
        
        # Carregar configurações do banco
        self.max_concurrent = await get_max_concurrent_downloads()
        self.semaphore = asyncio.Semaphore(self.max_concurrent)
        logger.info(f"Download worker starting with {self.max_concurrent} concurrent downloads")
        
        self.running = True
        self._task = asyncio.create_task(self._run_loop())
        logger.info("Download worker started")
    
    async def _reset_stale_downloading_jobs(self):
        """Reseta jobs que ficaram com status 'downloading' de execuções anteriores"""
        from database import async_session_maker, DownloadJob
        from sqlalchemy import update
        
        try:
            async with async_session_maker() as db:
                result = await db.execute(
                    update(DownloadJob)
                    .where(DownloadJob.status == 'downloading')
                    .values(status='queued', progress=0, downloaded_bytes=0, error_message='Resetado: download interrompido')
                )
                await db.commit()
                
                if result.rowcount > 0:
                    logger.warning(f"Reset {result.rowcount} stale downloading jobs to queued")
        except Exception as e:
            logger.error(f"Error resetting stale jobs: {e}")
    
    async def stop(self):
        """Para o worker"""
        self.running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("Download worker stopped")
    
    async def _run_loop(self):
        """Loop principal do worker"""
        from sqlalchemy.exc import OperationalError
        
        while self.running:
            try:
                await self._process_pending_jobs()
            except OperationalError as e:
                if "database is locked" in str(e):
                    logger.warning("Database locked in download worker, retrying in 3s...")
                    await asyncio.sleep(3)
                else:
                    logger.error(f"Database error in download worker loop: {e}")
            except Exception as e:
                logger.error(f"Error in download worker loop: {e}")
            
            await asyncio.sleep(WORKER_POLL_INTERVAL)
    
    async def _process_pending_jobs(self):
        """Busca e processa jobs pendentes"""
        from database import DownloadJob, AsyncSessionLocal
        
        async with AsyncSessionLocal() as db:
            # Buscar jobs pendentes ordenados por prioridade
            result = await db.execute(
                select(DownloadJob)
                .where(DownloadJob.status == 'pending')
                .order_by(DownloadJob.priority.desc(), DownloadJob.created_at.asc())
                .limit(self.max_concurrent - self.active_downloads)
            )
            jobs = result.scalars().all()
            
            for job in jobs:
                if self.active_downloads < self.max_concurrent:
                    # Iniciar download em task separada
                    asyncio.create_task(self._download_file(job.id))
    
    async def _download_file(self, job_id: int):
        """Processa um job de download"""
        async with self.semaphore:
            self.active_downloads += 1
            try:
                await self._execute_download(job_id)
            except Exception as e:
                logger.error(f"Error downloading job {job_id}: {e}")
                await self._update_job_status(job_id, 'failed', error_message=str(e))
            finally:
                self.active_downloads -= 1
    
    async def _execute_download(self, job_id: int):
        """Executa o download de um arquivo"""
        from database import DownloadJob, Server, AsyncSessionLocal
        from plugins.factory import get_plugin_for_server
        from plugins.exceptions import CredentialNotSetException, AccessDeniedException, ItemNotFoundException
        
        async with AsyncSessionLocal() as db:
            # Carregar job
            result = await db.execute(select(DownloadJob).where(DownloadJob.id == job_id))
            job = result.scalar_one_or_none()
            
            if not job or job.status != 'pending':
                return
            
            # Marcar como downloading
            job.status = 'downloading'
            job.started_at = datetime.now(timezone.utc)
            await db.commit()
            
            try:
                # Obter servidor
                result = await db.execute(select(Server).where(Server.id == job.server_id))
                server = result.scalar_one_or_none()
                if not server:
                    raise Exception("Server not found")
                
                # Verificar se deve ignorar por tamanho
                if job.max_file_size_bytes and job.file_size:
                    if job.file_size > job.max_file_size_bytes:
                        job.status = 'skipped'
                        job.skip_reason = f"Arquivo excede limite de {job.max_file_size_bytes / (1024*1024):.1f}MB"
                        job.completed_at = datetime.now(timezone.utc)
                        await db.commit()
                        return
                
                # Obter o plugin correto para o servidor
                plugin = await get_plugin_for_server(db, server)
                logger.info(f"Downloading job {job_id} using plugin {server.plugin_type}")
                
                # Preparar path para download
                # O file_path já deve ser relativo ao share, não incluir o caminho UNC completo
                file_path = job.file_path
                
                # Se o file_path já contém o caminho UNC completo, usar diretamente
                if file_path.startswith('\\\\'):
                    full_path = file_path
                else:
                    # Caso contrário, construir o caminho completo
                    full_path = f"\\\\{server.ip}\\{job.share_name}\\{file_path}"
                
                # Fazer download usando o plugin
                if job.file_size and job.file_size > CHUNK_SIZE:
                    # Download em chunks
                    await self._download_chunked_via_plugin(db, job, plugin, full_path, server)
                else:
                    # Download direto
                    await self._download_direct_via_plugin(db, job, plugin, full_path, server)
                
                # Marcar como concluído
                job.status = 'completed'
                job.progress = 100
                job.completed_at = datetime.now(timezone.utc)
                await db.commit()
                
                # Emitir evento WebSocket de conclusão
                ws_manager = get_websocket_manager()
                await ws_manager.emit_download_complete(
                    job_id=job.id,
                    file_path=job.file_path,
                    file_id=getattr(job, 'downloaded_file_id', None),
                    success=True
                )
                await ws_manager.emit_file_status_change(
                    file_path=job.file_path,
                    server_id=job.server_id,
                    status='downloaded'
                )
                
                # Emitir stats atualizadas (para notificação sonora)
                await emit_download_stats()
                
                logger.info(f"Download completed: {job.file_path}")
            
            except CredentialNotSetException as e:
                job.status = 'failed'
                job.error_message = f"Credencial não configurada: {e.message}"
                job.completed_at = datetime.now(timezone.utc)
                await db.commit()
                # Emitir evento WebSocket de falha
                ws_manager = get_websocket_manager()
                await ws_manager.emit_download_failed(job.id, job.file_path, job.error_message)
                await emit_download_stats()
                raise
            except AccessDeniedException:
                job.status = 'failed'
                job.error_message = "Acesso negado"
                job.completed_at = datetime.now(timezone.utc)
                await db.commit()
                ws_manager = get_websocket_manager()
                await ws_manager.emit_download_failed(job.id, job.file_path, job.error_message)
                await emit_download_stats()
                raise
            except ItemNotFoundException:
                job.status = 'failed'
                job.error_message = "Arquivo não encontrado"
                job.completed_at = datetime.now(timezone.utc)
                await db.commit()
                ws_manager = get_websocket_manager()
                await ws_manager.emit_download_failed(job.id, job.file_path, job.error_message)
                await emit_download_stats()
                raise
            except Exception as e:
                job.status = 'failed'
                job.error_message = str(e)
                job.completed_at = datetime.now(timezone.utc)
                await db.commit()
                ws_manager = get_websocket_manager()
                await ws_manager.emit_download_failed(job.id, job.file_path, str(e))
                await emit_download_stats()
                raise
    
    async def _download_direct_via_plugin(self, db: AsyncSession, job, plugin, full_path: str, server):
        """Download direto usando o plugin (arquivo pequeno)"""
        # Emitir evento de início
        ws_manager = get_websocket_manager()
        await ws_manager.emit_download_started(
            job_id=job.id,
            file_path=job.file_path,
            file_name=job.file_name or full_path.split('\\')[-1]
        )
        
        # Passar expected_size para o plugin para validar arquivos zerados
        expected_size = job.file_size if hasattr(job, 'file_size') else None
        logger.info(f"Downloading file {full_path} with expected_size={expected_size}")
        
        file_content = await plugin.download_file(
            full_path, 
            ignore_cache=True,
            expected_size=expected_size
        )
        
        # Aceitar arquivos zerados - não é erro se o plugin retornou sucesso
        if not file_content or file_content.data is None:
            raise Exception("Null response from plugin")
        
        # Log do resultado
        logger.info(f"Downloaded {full_path}: got {len(file_content.data)} bytes (expected={expected_size})")
        
        # Se o conteúdo está vazio mas o tamanho esperado é > 0, é um erro
        # Se expected_size é 0 ou None, aceitar arquivo vazio como válido
        if len(file_content.data) == 0 and expected_size is not None and expected_size > 0:
            raise Exception(f"Empty response for file with expected size {expected_size} bytes")
        
        # Salvar arquivo (pode ser zerado)
        await self._save_file_content_bytes(db, job, file_content.data, server)
    
    async def _download_chunked_via_plugin(self, db: AsyncSession, job, plugin, full_path: str, server):
        """Download em chunks usando o plugin (arquivo grande)"""
        total_size = job.file_size or 0
        downloaded = 0
        chunks = []
        
        # Emitir evento de início
        ws_manager = get_websocket_manager()
        await ws_manager.emit_download_started(
            job_id=job.id,
            file_path=job.file_path,
            file_name=job.file_name or full_path.split('\\')[-1]
        )
        
        # Se o arquivo tem tamanho 0, não precisa fazer loop de chunks
        if total_size == 0:
            logger.info(f"Zero-byte file detected: {full_path}")
            await self._save_file_content_bytes(db, job, b'', server)
            return
        
        while downloaded < total_size:
            # Calcular expected_size para este chunk
            remaining = total_size - downloaded
            expected_chunk_size = min(CHUNK_SIZE, remaining)
            
            file_content = await plugin.download_file(
                full_path, 
                offset=downloaded, 
                length=CHUNK_SIZE, 
                ignore_cache=True,
                expected_size=expected_chunk_size
            )
            
            if not file_content or file_content.data is None:
                break
            
            # Se retornou vazio mas esperava conteúdo, é um erro
            if len(file_content.data) == 0 and expected_chunk_size > 0:
                logger.warning(f"Empty chunk for file {full_path} at offset {downloaded}")
                break
            
            chunks.append(file_content.data)
            downloaded += len(file_content.data)
            
            # Atualizar progresso
            job.downloaded_bytes = downloaded
            job.total_bytes = total_size
            job.progress = int((downloaded / total_size) * 100)
            await db.commit()
            
            # Emitir evento de progresso via WebSocket
            await ws_manager.emit_download_progress(
                job_id=job.id,
                progress=job.progress,
                downloaded_bytes=downloaded,
                total_bytes=total_size,
                file_name=job.file_name
            )
            
            # Se o plugin indicou que é o último chunk, parar
            if file_content.is_complete or len(file_content.data) < CHUNK_SIZE:
                break
        
        # Concatenar chunks e salvar
        full_content = b''.join(chunks)
        await self._save_file_content_bytes(db, job, full_content, server)
    
    async def _save_file_content_bytes(self, db: AsyncSession, job, content: bytes, server):
        """Salva o conteúdo do arquivo (bytes) no storage"""
        from database import DownloadedFile
        from storage_utils import get_server_storage_path
        import magic
        
        try:
            logger.info(f"Saving file content for job {job.id}: {job.file_path}")
            
            file_bytes = content
            
            # Calcular hash
            sha1_hash = hashlib.sha1(file_bytes).hexdigest()
            logger.info(f"Calculated SHA1: {sha1_hash}, size: {len(file_bytes)} bytes")
            
            # Criar estrutura de diretórios
            storage_base = get_server_storage_path(server.guid)
            
            # Sanitizar o file_path removendo prefixo UNC e caracteres especiais
            file_path = job.file_path
            
            # Remover prefixo UNC se existir (ex: \\127.0.0.1\D$\...)
            if file_path.startswith('\\\\'):
                # Remove \\server\share\ do início
                parts = file_path.split('\\')
                # parts será ['', '', 'server', 'share', 'rest', 'of', 'path']
                if len(parts) > 4:
                    file_path = '\\'.join(parts[4:])  # Pega do 5º elemento em diante
                else:
                    file_path = parts[-1] if parts else job.file_name or 'unknown_file'
            
            # Converter barras e remover caracteres problemáticos
            relative_path = file_path.replace('\\', '/').lstrip('/')
            
            # Remover caracteres especiais do Windows que não são válidos em Linux
            relative_path = relative_path.replace('$', '_').replace(':', '_')
            
            full_storage_path = storage_base / relative_path
            logger.info(f"Storage path: {full_storage_path}")
            
            # Criar diretórios
            full_storage_path.parent.mkdir(parents=True, exist_ok=True)
            
            # Salvar arquivo
            with open(full_storage_path, 'wb') as f:
                f.write(file_bytes)
            
            logger.info(f"File saved successfully: {full_storage_path}")
            
            # Calcular mimetype por extensão primeiro (mais confiável no ambiente)
            mimetype = None
            import mimetypes
            try:
                mimetype, _ = mimetypes.guess_type(str(full_storage_path))
                logger.info(f"Calculated mimetype (extension): {mimetype}")
            except Exception as e:
                logger.warning(f"Could not calculate mimetype by extension: {e}")
            
            # Tentar libmagic como fallback se extensão não funcionou
            if not mimetype:
                try:
                    mime = magic.Magic(mime=True)
                    mimetype = mime.from_file(str(full_storage_path))
                    logger.info(f"Calculated mimetype (libmagic): {mimetype}")
                except Exception as e:
                    logger.warning(f"Could not calculate mimetype with libmagic: {e}")
                    # Fallback final: application/octet-stream
                    mimetype = 'application/octet-stream'
            
            # Atualizar job
            job.downloaded_bytes = len(file_bytes)
            job.total_bytes = len(file_bytes)
            
            # Registrar no banco (DownloadedFile)
            logger.info(f"Looking for existing DownloadedFile: server_guid={server.guid}, share={job.share_name}, path={job.file_path}")
            existing = await db.execute(
                select(DownloadedFile).where(
                    DownloadedFile.server_guid == server.guid,
                    DownloadedFile.share_name == job.share_name,
                    DownloadedFile.file_path == job.file_path
                )
            )
            downloaded_file = existing.scalar_one_or_none()
            
            if downloaded_file:
                # Atualizar existente
                logger.info(f"Updating existing DownloadedFile id={downloaded_file.id}")
                downloaded_file.sha1_hash = sha1_hash
                downloaded_file.file_size = len(file_bytes)
                downloaded_file.mimetype = mimetype
                downloaded_file.downloaded_at = datetime.now(timezone.utc)
                downloaded_file.sanitized_path = relative_path
                downloaded_file.local_path = str(full_storage_path)
                downloaded_file.file_name = job.file_name
                downloaded_file.server_id = server.id
            else:
                # Criar novo registro - usar relative_path que já foi sanitizado
                logger.info("Creating new DownloadedFile record")
                downloaded_file = DownloadedFile(
                    server_id=server.id,
                    server_guid=server.guid,
                    share_name=job.share_name,
                    file_path=job.file_path,
                    file_name=job.file_name,
                    sanitized_path=relative_path,
                    local_path=str(full_storage_path),
                    sha1_hash=sha1_hash,
                    file_size=len(file_bytes),
                    mimetype=mimetype,
                    downloaded_at=datetime.now(timezone.utc)
                )
                db.add(downloaded_file)
                
                # Incrementar contador do servidor
                server.downloaded_files_count = (server.downloaded_files_count or 0) + 1
            
            # Garantir que os diretórios pais existam como ServerItem
            await ensure_parent_directories(db, server, job.share_name, job.file_path, len(file_bytes))
            
            # Criar/atualizar FileVersion (como o sync manual)
            existing_version = await db.execute(
                select(FileVersion).where(
                    FileVersion.server_guid == server.guid,
                    FileVersion.share_name == job.share_name,
                    FileVersion.file_path == job.file_path,
                    FileVersion.sha1_hash == sha1_hash
                )
            )
            version = existing_version.scalar_one_or_none()
            
            if not version:
                # Marcar versões anteriores como não-atuais
                await db.execute(
                    select(FileVersion).where(
                        FileVersion.server_guid == server.guid,
                        FileVersion.file_path == job.file_path,
                        FileVersion.is_current.is_(True)
                    )
                )
                # Contar versões existentes
                version_count = await db.execute(
                    select(FileVersion).where(
                        FileVersion.server_guid == server.guid,
                        FileVersion.file_path == job.file_path
                    )
                )
                versions_list = version_count.scalars().all()
                for v in versions_list:
                    v.is_current = False
                next_version = len(versions_list) + 1
                
                # Criar nova versão
                version = FileVersion(
                    server_guid=server.guid,
                    share_name=job.share_name,
                    file_path=job.file_path,
                    version_number=next_version,
                    sha1_hash=sha1_hash,
                    file_size=len(file_bytes),
                    mimetype=mimetype,
                    local_path=str(full_storage_path),
                    is_current=True
                )
                db.add(version)
                logger.info(f"Created new FileVersion #{next_version} for {job.file_path}")
            
            await db.commit()
            await db.refresh(downloaded_file)
            if version:
                await db.refresh(version)
            logger.info(f"DownloadedFile record saved successfully for {job.file_path}")
            
            # Verificar configurações de Auto OCR
            auto_ocr_enabled = True
            auto_ocr_extensions = []
            auto_ocr_mimetypes = []
            auto_ocr_excluded_extensions = []
            
            try:
                from database import AppSettings
                
                # Verificar se auto OCR está habilitado
                enabled_result = await db.execute(
                    select(AppSettings).where(AppSettings.key == 'auto_ocr_enabled')
                )
                enabled_setting = enabled_result.scalar_one_or_none()
                if enabled_setting:
                    auto_ocr_enabled = enabled_setting.value.lower() in ('true', '1', 'yes', 'on')
                
                # Buscar extensões configuradas
                ext_result = await db.execute(
                    select(AppSettings).where(AppSettings.key == 'auto_ocr_extensions')
                )
                ext_setting = ext_result.scalar_one_or_none()
                if ext_setting and ext_setting.value:
                    auto_ocr_extensions = [e.strip().lower() for e in ext_setting.value.split(',') if e.strip()]
                
                # Buscar mimetypes configurados
                mime_result = await db.execute(
                    select(AppSettings).where(AppSettings.key == 'auto_ocr_mimetypes')
                )
                mime_setting = mime_result.scalar_one_or_none()
                if mime_setting and mime_setting.value:
                    auto_ocr_mimetypes = [m.strip().lower() for m in mime_setting.value.split(',') if m.strip()]
                
                # Buscar extensões excluídas (precedência sobre inclusão)
                excluded_result = await db.execute(
                    select(AppSettings).where(AppSettings.key == 'auto_ocr_excluded_extensions')
                )
                excluded_setting = excluded_result.scalar_one_or_none()
                if excluded_setting and excluded_setting.value:
                    auto_ocr_excluded_extensions = [e.strip().lower() for e in excluded_setting.value.split(',') if e.strip()]
                    
            except Exception as settings_err:
                logger.warning(f"Could not load auto OCR settings: {settings_err}")
            
            # Verificar se deve adicionar à fila de OCR
            should_ocr = False
            if auto_ocr_enabled:
                file_ext = ('.' + job.file_name.rsplit('.', 1)[-1]).lower() if '.' in job.file_name else ''
                mime_lower = (mimetype or '').lower()
                
                # PRIMEIRO: Verificar lista de exclusão (tem precedência)
                is_excluded = False
                if file_ext and auto_ocr_excluded_extensions:
                    for excluded_ext in auto_ocr_excluded_extensions:
                        # Normalizar extensão (adicionar ponto se não tiver)
                        excluded_ext_normalized = excluded_ext if excluded_ext.startswith('.') else f'.{excluded_ext}'
                        if file_ext == excluded_ext_normalized:
                            is_excluded = True
                            logger.info(f"Auto OCR skipped for {job.file_name} (excluded extension: {file_ext})")
                            break
                
                # Se não está excluído, verificar se deve incluir
                if not is_excluded:
                    # Verificar por extensão
                    if file_ext and any(file_ext == ext or file_ext.endswith(ext) for ext in auto_ocr_extensions):
                        should_ocr = True
                        logger.info(f"Auto OCR enabled for {job.file_name} (extension match: {file_ext})")
                    
                    # Verificar por mimetype (match parcial)
                    if not should_ocr and mime_lower:
                        for mime_pattern in auto_ocr_mimetypes:
                            if mime_pattern in mime_lower:
                                should_ocr = True
                                logger.info(f"Auto OCR enabled for {job.file_name} (mimetype match: {mime_lower})")
                                break
            
            # Adicionar à fila de OCR se configurado
            if should_ocr:
                try:
                    from ocr_worker import queue_ocr_job
                    
                    version_id = version.id if version else None
                    
                    await queue_ocr_job(
                        db=db,
                        file_id=downloaded_file.id,
                        version_id=version_id,
                        server_id=server.id,
                        file_path=job.file_path,
                        file_name=job.file_name,
                        local_path=str(full_storage_path),
                        ocr_language="eng+por",
                        priority=0
                    )
                    logger.info(f"OCR job queued for {job.file_name}")
                except Exception as ocr_err:
                    logger.warning(f"Failed to queue OCR job: {ocr_err}")
            
        except Exception as e:
            logger.error(f"Error saving file content: {e}")
            raise
    
    async def _update_job_status(self, job_id: int, status: str, error_message: str = None):
        """Atualiza status de um job"""
        from database import DownloadJob, AsyncSessionLocal
        
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(DownloadJob).where(DownloadJob.id == job_id))
            job = result.scalar_one_or_none()
            if job:
                job.status = status
                if error_message:
                    job.error_message = error_message
                job.completed_at = datetime.now(timezone.utc)
                await db.commit()


def get_worker() -> DownloadWorker:
    """Retorna a instância global do worker"""
    global _worker_instance
    if _worker_instance is None:
        _worker_instance = DownloadWorker()
    return _worker_instance


async def start_download_worker():
    """Inicia o worker de downloads"""
    worker = get_worker()
    await worker.start()


async def stop_download_worker():
    """Para o worker de downloads"""
    worker = get_worker()
    await worker.stop()
