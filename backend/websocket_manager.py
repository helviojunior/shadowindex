"""
WebSocket Manager - Gerenciamento centralizado de conexões WebSocket
"""
import asyncio
import json
import logging
from typing import Dict, Set, Any, Optional
from fastapi import WebSocket, WebSocketDisconnect
from datetime import datetime, timezone

logger = logging.getLogger(__name__)


class WebSocketManager:
    """Gerenciador centralizado de conexões WebSocket"""
    
    _instance: Optional['WebSocketManager'] = None
    
    def __init__(self):
        self.active_connections: Set[WebSocket] = set()
        self._lock = asyncio.Lock()
    
    @classmethod
    def get_instance(cls) -> 'WebSocketManager':
        if cls._instance is None:
            cls._instance = WebSocketManager()
        return cls._instance
    
    async def connect(self, websocket: WebSocket):
        """Aceita nova conexão WebSocket"""
        await websocket.accept()
        async with self._lock:
            self.active_connections.add(websocket)
        logger.info(f"WebSocket connected. Total connections: {len(self.active_connections)}")
    
    async def disconnect(self, websocket: WebSocket):
        """Remove conexão WebSocket"""
        async with self._lock:
            self.active_connections.discard(websocket)
        logger.info(f"WebSocket disconnected. Total connections: {len(self.active_connections)}")
    
    async def broadcast(self, message: Dict[str, Any]):
        """Envia mensagem para todos os clientes conectados"""
        if not self.active_connections:
            return
        
        message_json = json.dumps(message, default=str)
        disconnected = set()
        
        async with self._lock:
            for connection in self.active_connections:
                try:
                    await connection.send_text(message_json)
                except Exception as e:
                    logger.warning(f"Failed to send to websocket: {e}")
                    disconnected.add(connection)
            
            # Remove conexões que falharam
            for conn in disconnected:
                self.active_connections.discard(conn)
    
    async def send_to_one(self, websocket: WebSocket, message: Dict[str, Any]):
        """Envia mensagem para um cliente específico"""
        try:
            await websocket.send_text(json.dumps(message, default=str))
        except Exception as e:
            logger.warning(f"Failed to send to specific websocket: {e}")
    
    # === Métodos de eventos específicos ===
    
    async def emit_download_progress(self, job_id: int, progress: float, 
                                      downloaded_bytes: int, total_bytes: int,
                                      file_name: str = None):
        """Emite evento de progresso de download"""
        await self.broadcast({
            "type": "download_progress",
            "job_id": job_id,
            "progress": progress,
            "downloaded_bytes": downloaded_bytes,
            "total_bytes": total_bytes,
            "file_name": file_name,
            "timestamp": datetime.now(timezone.utc).isoformat()
        })
    
    async def emit_download_complete(self, job_id: int, file_path: str, 
                                      file_id: int = None, success: bool = True):
        """Emite evento de download concluído"""
        await self.broadcast({
            "type": "download_complete",
            "job_id": job_id,
            "file_path": file_path,
            "file_id": file_id,
            "success": success,
            "timestamp": datetime.now(timezone.utc).isoformat()
        })
    
    async def emit_download_failed(self, job_id: int, file_path: str, error: str):
        """Emite evento de download falhado"""
        await self.broadcast({
            "type": "download_failed",
            "job_id": job_id,
            "file_path": file_path,
            "error": error,
            "timestamp": datetime.now(timezone.utc).isoformat()
        })
    
    async def emit_download_started(self, job_id: int, file_path: str, file_name: str):
        """Emite evento de download iniciado"""
        await self.broadcast({
            "type": "download_started",
            "job_id": job_id,
            "file_path": file_path,
            "file_name": file_name,
            "timestamp": datetime.now(timezone.utc).isoformat()
        })
    
    async def emit_scan_progress(self, scan_id: int, status: str, 
                                  processed: int, total: int, queued: int):
        """Emite evento de progresso de scan"""
        await self.broadcast({
            "type": "scan_progress",
            "scan_id": scan_id,
            "status": status,
            "processed_files": processed,
            "total_files": total,
            "queued_files": queued,
            "timestamp": datetime.now(timezone.utc).isoformat()
        })
    
    async def emit_scan_complete(self, scan_id: int, total_files: int, queued_files: int):
        """Emite evento de scan concluído"""
        await self.broadcast({
            "type": "scan_complete",
            "scan_id": scan_id,
            "total_files": total_files,
            "queued_files": queued_files,
            "timestamp": datetime.now(timezone.utc).isoformat()
        })
    
    async def emit_new_leak(self, fingerprint: str, rule_id: str, 
                            file_path: str, severity: str = "medium"):
        """Emite evento de novo leak detectado"""
        await self.broadcast({
            "type": "new_leak",
            "fingerprint": fingerprint,
            "rule_id": rule_id,
            "file_path": file_path,
            "severity": severity,
            "timestamp": datetime.now(timezone.utc).isoformat()
        })
    
    async def emit_stats_update(self, stats: Dict[str, Any]):
        """Emite atualização de estatísticas gerais"""
        await self.broadcast({
            "type": "stats_update",
            **stats,
            "timestamp": datetime.now(timezone.utc).isoformat()
        })
    
    async def emit_download_stats(self, stats: Dict[str, int]):
        """Emite estatísticas de downloads (para notificação sonora)"""
        await self.broadcast({
            "type": "downloads_stats_updated",
            "data": stats,
            "timestamp": datetime.now(timezone.utc).isoformat()
        })
    
    async def emit_gitleaks_stats(self, stats: Dict[str, int]):
        """Emite estatísticas de GitLeaks (para notificação sonora)"""
        await self.broadcast({
            "type": "gitleaks_stats_updated",
            "data": stats,
            "timestamp": datetime.now(timezone.utc).isoformat()
        })
    
    async def emit_ocr_stats(self, stats: Dict[str, int]):
        """Emite estatísticas de OCR (para notificação sonora)"""
        await self.broadcast({
            "type": "ocr_stats_updated",
            "data": stats,
            "timestamp": datetime.now(timezone.utc).isoformat()
        })
    
    async def emit_file_status_change(self, file_path: str, server_id: int, 
                                       status: str, file_id: int = None):
        """Emite mudança de status de arquivo (para tree view)"""
        await self.broadcast({
            "type": "file_status_change",
            "file_path": file_path,
            "server_id": server_id,
            "status": status,
            "file_id": file_id,
            "timestamp": datetime.now(timezone.utc).isoformat()
        })


# Instância global
def get_websocket_manager() -> WebSocketManager:
    return WebSocketManager.get_instance()
