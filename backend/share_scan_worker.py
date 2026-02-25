"""
Share Scan Worker - Processa jobs de scan de shares em background
"""
import asyncio
import random
import logging
import traceback
from typing import Optional, Dict
from datetime import datetime, timezone

from sqlalchemy import select, func, update

logger = logging.getLogger(__name__)

_share_scan_worker: Optional['ShareScanWorker'] = None


class ShareScanWorker:
    """Worker para processamento de share scans em background"""

    def __init__(self):
        self.running = False
        self._task: Optional[asyncio.Task] = None
        self._active_count: Dict[int, int] = {}  # pool_id -> running count

    async def start(self):
        if self.running:
            return
        self.running = True
        self._task = asyncio.create_task(self._run_loop())
        logger.info("Share scan worker started")

    async def stop(self):
        self.running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("Share scan worker stopped")

    async def _run_loop(self):
        """Loop principal de processamento"""
        from database import AsyncSessionLocal
        from sqlalchemy.exc import OperationalError

        # Reset stale 'running' jobs on startup
        try:
            async with AsyncSessionLocal() as db:
                from database import ShareScanJob
                result = await db.execute(
                    update(ShareScanJob)
                    .where(ShareScanJob.status == 'running')
                    .values(status='pending', started_at=None)
                )
                if result.rowcount > 0:
                    await db.commit()
                    logger.info(f"Reset {result.rowcount} stale running share scan jobs to pending")
        except Exception as e:
            logger.error(f"Error resetting stale share scan jobs on startup: {e}")

        while self.running:
            try:
                async with AsyncSessionLocal() as db:
                    await self._process_pending_jobs(db)
            except OperationalError as e:
                if "database is locked" in str(e):
                    await asyncio.sleep(5)
                else:
                    logger.error(f"Database error in share scan worker: {e}")
            except Exception as e:
                logger.error(f"Error in share scan worker loop: {e}")

            await asyncio.sleep(3)

    async def _process_pending_jobs(self, db):
        """Busca e despacha jobs pendentes respeitando limites por pool"""
        from database import ShareScanJob, ScanPool

        # Get pending jobs ordered by priority DESC, created_at ASC
        result = await db.execute(
            select(ShareScanJob)
            .where(ShareScanJob.status == 'pending')
            .order_by(ShareScanJob.priority.desc(), ShareScanJob.created_at.asc())
            .limit(50)
        )
        pending_jobs = result.scalars().all()

        if not pending_jobs:
            return

        # Get unique pool IDs
        pool_ids = set(j.scan_pool_id for j in pending_jobs)

        # Load pool configs and count running jobs per pool
        pools = {}
        running_counts = {}
        for pool_id in pool_ids:
            pool_result = await db.execute(
                select(ScanPool).where(ScanPool.id == pool_id)
            )
            pool = pool_result.scalar_one_or_none()
            if pool:
                pools[pool_id] = pool

            count_result = await db.execute(
                select(func.count(ShareScanJob.id))
                .where(
                    ShareScanJob.scan_pool_id == pool_id,
                    ShareScanJob.status == 'running'
                )
            )
            running_counts[pool_id] = count_result.scalar() or 0

        # Dispatch jobs respecting pool limits
        for job in pending_jobs:
            pool = pools.get(job.scan_pool_id)
            if not pool:
                continue

            max_scanners = pool.simultaneous_scanners or 3
            current_running = running_counts.get(job.scan_pool_id, 0)

            if current_running >= max_scanners:
                continue

            # Dispatch this job
            running_counts[job.scan_pool_id] = current_running + 1
            asyncio.create_task(self._execute_scan(job.id, pool.id, pool.request_delay_min, pool.request_delay_max))

    async def _execute_scan(self, job_id: int, pool_id: int, delay_min: int, delay_max: int):
        """Executa um scan individual"""
        from database import AsyncSessionLocal, ShareScanJob, Server, ServerShare
        from plugins.factory import get_plugin_for_server
        from plugins.base import ShareInfo
        from plugins.exceptions import (
            CredentialNotSetException, ConnectionException,
            AccessDeniedException, ServerUnreachableException
        )

        try:
            async with AsyncSessionLocal() as db:
                # Load job
                result = await db.execute(
                    select(ShareScanJob).where(ShareScanJob.id == job_id)
                )
                job = result.scalar_one_or_none()
                if not job or job.status != 'pending':
                    return

                # Check if cancelled
                if job.status == 'cancelled':
                    return

                # Mark as running
                job.status = 'running'
                job.started_at = datetime.now(timezone.utc)
                await db.commit()

                # Apply delay
                if delay_min > 0 or delay_max > 0:
                    delay_ms = random.uniform(delay_min or 0, delay_max or 0)
                    await asyncio.sleep(delay_ms / 1000)

                # Re-check if cancelled after delay
                await db.refresh(job)
                if job.status == 'cancelled':
                    return

                # Load server
                server_result = await db.execute(
                    select(Server).where(Server.id == job.server_id)
                )
                server = server_result.scalar_one_or_none()
                if not server:
                    job.status = 'failed'
                    job.error_message = f"Server ID {job.server_id} not found"
                    job.completed_at = datetime.now(timezone.utc)
                    await db.commit()
                    return

                try:
                    # Get plugin and list shares
                    plugin = await get_plugin_for_server(db, server)
                    shares_list = await plugin.list_shares(server.ip, ignore_cache=True)

                    shares_data = []
                    if shares_list:
                        for share in shares_list:
                            share_name = share.name if isinstance(share, ShareInfo) else share.get('name', '')
                            if not share_name:
                                continue
                            # Skip special admin shares except C$, D$, E$
                            if share_name.endswith('$') and share_name not in ['C$', 'D$', 'E$']:
                                continue
                            shares_data.append({
                                'share_name': share_name,
                                'share_type': share.share_type if isinstance(share, ShareInfo) else share.get('share_type', 'Disk'),
                                'remark': share.remark if isinstance(share, ShareInfo) else share.get('remark', '')
                            })

                    # Upsert shares in DB
                    for share_data in shares_data:
                        existing = await db.execute(
                            select(ServerShare).where(
                                ServerShare.server_guid == server.guid,
                                ServerShare.share_name == share_data['share_name']
                            )
                        )
                        share = existing.scalar_one_or_none()
                        if share:
                            share.share_type = share_data['share_type']
                            share.remark = share_data['remark']
                        else:
                            share = ServerShare(
                                server_id=server.id,
                                server_guid=server.guid,
                                share_name=share_data['share_name'],
                                share_type=share_data['share_type'],
                                remark=share_data['remark']
                            )
                            db.add(share)

                    # Update server flags
                    server.verified = True
                    server.shares_count = len(shares_data)
                    server.last_verified_at = datetime.now(timezone.utc)
                    if server.is_unreachable:
                        server.is_unreachable = False

                    # Update has_no_admin_shares
                    from routes_v2 import update_has_no_admin_shares
                    await update_has_no_admin_shares(db, server)

                    # Mark job completed
                    job.status = 'completed'
                    job.shares_found = len(shares_data)
                    job.completed_at = datetime.now(timezone.utc)
                    await db.commit()

                    logger.info(f"Share scan job {job_id} completed: {len(shares_data)} shares found for server {server.ip}")

                except ServerUnreachableException as e:
                    server.is_unreachable = True
                    job.status = 'failed'
                    job.error_message = f"Server unreachable: {e}"
                    job.completed_at = datetime.now(timezone.utc)
                    await db.commit()
                    logger.warning(f"Share scan job {job_id} failed - server unreachable {server.ip}: {e}")

                except CredentialNotSetException as e:
                    job.status = 'failed'
                    job.error_message = f"Credential not set: {e.message}"
                    job.completed_at = datetime.now(timezone.utc)
                    await db.commit()
                    logger.warning(f"Share scan job {job_id} failed - credential not set: {e.message}")

                except ConnectionException as e:
                    job.status = 'failed'
                    job.error_message = f"Connection error: {e}"
                    job.completed_at = datetime.now(timezone.utc)
                    await db.commit()
                    logger.warning(f"Share scan job {job_id} failed - connection error for {server.ip}: {e}")

                except AccessDeniedException as e:
                    job.status = 'failed'
                    job.error_message = f"Access denied: {e}"
                    job.completed_at = datetime.now(timezone.utc)
                    await db.commit()
                    logger.warning(f"Share scan job {job_id} failed - access denied for {server.ip}: {e}")

                except ValueError as e:
                    job.status = 'failed'
                    job.error_message = f"Plugin not configured: {e}"
                    job.completed_at = datetime.now(timezone.utc)
                    await db.commit()
                    logger.warning(f"Share scan job {job_id} failed - plugin error: {e}")

                except Exception as e:
                    error_tb = traceback.format_exc()
                    job.status = 'failed'
                    job.error_message = f"Unexpected error: {str(e)}"
                    job.completed_at = datetime.now(timezone.utc)
                    await db.commit()
                    logger.error(f"Share scan job {job_id} failed with unexpected error: {e}\n{error_tb}")

        except Exception as e:
            logger.error(f"Fatal error executing share scan job {job_id}: {e}")

        # Emit stats after each job
        try:
            await self._emit_stats()
        except Exception as e:
            logger.warning(f"Error emitting share scan stats: {e}")

    async def _emit_stats(self):
        """Emite estatísticas de share scan via WebSocket"""
        from database import AsyncSessionLocal, ShareScanJob
        from websocket_manager import get_websocket_manager

        async with AsyncSessionLocal() as db:
            stats = {}
            for status in ['pending', 'running', 'completed', 'failed', 'cancelled']:
                result = await db.execute(
                    select(func.count(ShareScanJob.id))
                    .where(ShareScanJob.status == status)
                )
                stats[status] = result.scalar() or 0
            stats['total'] = sum(stats.values())

        ws = get_websocket_manager()
        await ws.emit_share_scan_stats(stats)


def get_share_scan_worker() -> ShareScanWorker:
    global _share_scan_worker
    if _share_scan_worker is None:
        _share_scan_worker = ShareScanWorker()
    return _share_scan_worker


async def start_share_scan_worker():
    worker = get_share_scan_worker()
    await worker.start()


async def stop_share_scan_worker():
    worker = get_share_scan_worker()
    await worker.stop()
