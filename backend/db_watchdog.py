"""
Database Watchdog - Monitors database health and triggers restart if needed.

Monitors for persistent database errors (like QueuePool exhaustion, locked database, etc.)
and forces a service restart if errors persist beyond a threshold.
"""

import asyncio
import logging
import os
import sys
import signal
from datetime import datetime, timezone, timedelta
from typing import Optional
from collections import deque

logger = logging.getLogger(__name__)

# Configurações do watchdog
DB_ERROR_THRESHOLD_SECONDS = 120  # Tempo em segundos de erros persistentes antes de restart
DB_CHECK_INTERVAL_SECONDS = 10    # Intervalo entre verificações de saúde do DB
DB_ERROR_PATTERNS = [
    'queuepool',
    'pool limit',
    'overflow',
    'connection timed out',
    'database is locked',
    'cannot operate on a closed database',
    'disk i/o error',
    'unable to open database',
    'no such table',
    'sqlite3.operationalerror',
]


class DatabaseWatchdog:
    """
    Watchdog que monitora a saúde do banco de dados.
    Se detectar erros persistentes, força restart do serviço.
    """
    
    def __init__(self, error_threshold_seconds: int = DB_ERROR_THRESHOLD_SECONDS):
        self.error_threshold = timedelta(seconds=error_threshold_seconds)
        self.first_error_time: Optional[datetime] = None
        self.last_error_time: Optional[datetime] = None
        self.consecutive_errors = 0
        self.error_history: deque = deque(maxlen=50)  # Últimos 50 erros
        self.running = False
        self._task: Optional[asyncio.Task] = None
        self.healthy_checks = 0
        self.total_checks = 0
    
    def record_db_error(self, error_message: str):
        """Registra um erro de banco de dados"""
        now = datetime.now(timezone.utc)
        error_lower = error_message.lower()
        
        # Verificar se é um erro de DB conhecido
        is_db_error = any(pattern in error_lower for pattern in DB_ERROR_PATTERNS)
        
        if is_db_error:
            if self.first_error_time is None:
                self.first_error_time = now
                logger.warning(f"=== DB WATCHDOG: First DB error detected: {error_message[:100]} ===")
            
            self.last_error_time = now
            self.consecutive_errors += 1
            self.error_history.append({
                'time': now.isoformat(),
                'error': error_message[:200],
                'consecutive': self.consecutive_errors
            })
            
            # Verificar se passou do threshold
            error_duration = now - self.first_error_time
            if error_duration >= self.error_threshold:
                logger.critical(
                    f"=== DB WATCHDOG: CRITICAL - DB errors persisting for {error_duration.total_seconds():.0f}s "
                    f"(threshold: {self.error_threshold.total_seconds():.0f}s). "
                    f"Consecutive errors: {self.consecutive_errors}. TRIGGERING RESTART! ==="
                )
                self._trigger_restart()
    
    def record_healthy_check(self):
        """Registra uma verificação de saúde bem-sucedida"""
        self.healthy_checks += 1
        
        # Se tiver 3 checks saudáveis consecutivos, resetar estado de erro
        if self.first_error_time is not None and self.healthy_checks >= 3:
            logger.info(
                f"=== DB WATCHDOG: Database recovered after {self.consecutive_errors} errors. Resetting state. ==="
            )
            self.first_error_time = None
            self.last_error_time = None
            self.consecutive_errors = 0
            self.healthy_checks = 0
    
    def _trigger_restart(self):
        """Força o restart do serviço"""
        logger.critical("=== DB WATCHDOG: Initiating service restart... ===")
        print("=== DB WATCHDOG: FORCING SERVICE RESTART DUE TO PERSISTENT DB ERRORS ===", flush=True)
        
        # Salvar estado antes do restart
        try:
            with open('/tmp/db_watchdog_restart.log', 'a') as f:
                f.write(f"\n{'='*60}\n")
                f.write(f"RESTART TRIGGERED AT: {datetime.now(timezone.utc).isoformat()}\n")
                f.write(f"First error: {self.first_error_time}\n")
                f.write(f"Consecutive errors: {self.consecutive_errors}\n")
                f.write("Recent errors:\n")
                for err in list(self.error_history)[-10:]:
                    f.write(f"  - {err['time']}: {err['error'][:100]}\n")
                f.write(f"{'='*60}\n")
        except Exception as e:
            logger.error(f"Failed to write restart log: {e}")
        
        # Enviar SIGTERM para o próprio processo (graceful shutdown)
        # O supervisor vai reiniciar automaticamente
        os.kill(os.getpid(), signal.SIGTERM)
    
    async def _health_check_loop(self):
        """Loop de verificação de saúde do banco de dados"""
        from database import AsyncSessionLocal
        from sqlalchemy import text
        
        logger.info("=== DB WATCHDOG: Health check loop started ===")
        print("=== DB WATCHDOG: Started ===", flush=True)
        
        while self.running:
            try:
                self.total_checks += 1
                
                # Tentar uma query simples no banco
                async with AsyncSessionLocal() as db:
                    result = await db.execute(text("SELECT 1"))
                    result.scalar()
                
                # Se chegou aqui, banco está saudável
                self.record_healthy_check()
                
            except Exception as e:
                error_msg = str(e)
                logger.warning(f"=== DB WATCHDOG: Health check failed: {error_msg[:100]} ===")
                self.healthy_checks = 0  # Reset contador de checks saudáveis
                self.record_db_error(error_msg)
            
            await asyncio.sleep(DB_CHECK_INTERVAL_SECONDS)
    
    async def start(self):
        """Inicia o watchdog"""
        if self.running:
            return
        
        self.running = True
        self._task = asyncio.create_task(self._health_check_loop())
        logger.info("=== DB WATCHDOG: Started monitoring database health ===")
    
    async def stop(self):
        """Para o watchdog"""
        self.running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("=== DB WATCHDOG: Stopped ===")
    
    def get_status(self) -> dict:
        """Retorna o status atual do watchdog"""
        now = datetime.now(timezone.utc)
        error_duration = None
        if self.first_error_time:
            error_duration = (now - self.first_error_time).total_seconds()
        
        return {
            "running": self.running,
            "total_checks": self.total_checks,
            "healthy_checks": self.healthy_checks,
            "consecutive_errors": self.consecutive_errors,
            "first_error_time": self.first_error_time.isoformat() if self.first_error_time else None,
            "last_error_time": self.last_error_time.isoformat() if self.last_error_time else None,
            "error_duration_seconds": error_duration,
            "threshold_seconds": self.error_threshold.total_seconds(),
            "recent_errors": list(self.error_history)[-5:],
            "will_restart_in": max(0, self.error_threshold.total_seconds() - (error_duration or 0)) if error_duration else None
        }


# Instância global do watchdog
_db_watchdog: Optional[DatabaseWatchdog] = None


def get_db_watchdog() -> DatabaseWatchdog:
    """Obtém a instância global do watchdog"""
    global _db_watchdog
    if _db_watchdog is None:
        _db_watchdog = DatabaseWatchdog()
    return _db_watchdog


async def start_db_watchdog():
    """Inicia o watchdog do banco de dados"""
    watchdog = get_db_watchdog()
    await watchdog.start()
    return watchdog


async def stop_db_watchdog():
    """Para o watchdog do banco de dados"""
    watchdog = get_db_watchdog()
    await watchdog.stop()


def report_db_error(error_message: str):
    """
    Função para outros módulos reportarem erros de DB ao watchdog.
    Pode ser chamada de qualquer lugar do código.
    """
    try:
        watchdog = get_db_watchdog()
        if watchdog.running:
            watchdog.record_db_error(error_message)
    except Exception:
        pass  # Não falhar se o watchdog não estiver disponível
