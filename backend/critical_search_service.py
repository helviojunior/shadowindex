"""
Critical Search Service - Verifica se arquivos correspondem aos critérios de busca crítica

Este serviço é usado pelo scan job quando critical_only=true para filtrar
apenas arquivos que são potencialmente sensíveis.
"""

import re
import os
import logging
from typing import Optional, Dict, Any, List
from collections import defaultdict

logger = logging.getLogger(__name__)

# Configuração padrão (será sobrescrita pela configuração do banco)
DEFAULT_CONFIG = {
    "enabled": True,
    "text_files": {
        "enabled": True,
        "max_size_bytes": 1024,
        "extensions": [".txt"],
        "mime_types": ["text/"]
    },
    "office_files": {
        "enabled": True,
        "max_size_bytes": 1048576,
        "extensions": [".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".ods", ".odp", ".rtf", ".csv"],
        "mime_types": ["application/msword", "application/vnd.openxmlformats-officedocument", "application/vnd.ms-excel", "application/vnd.ms-powerpoint", "application/vnd.oasis.opendocument"]
    },
    "keyword_files": {
        "enabled": True,
        "keywords": ["senha", "password", "pwd", "pass", "acesso", "access", "login", "auth", "credencial", "credential", "cred", "secret", "segredo", "chave", "key", "token", "api_key", "apikey", "config", "configuracao", "settings", "backup", "dump", "export", "private", "privado", "cert", "conexao", "connection", "conn", "usuario", "user", "admin"],
        "case_sensitive": False
    },
    "keepass_files": {
        "enabled": True,
        "extensions": [".kdbx", ".kdb", ".key"],
        "mime_types": []
    },
    "critical_extensions": {
        "enabled": True,
        "extensions": [".pfx", ".p12", ".jks", ".keystore", ".pem", ".crt", ".cer", ".der", ".cmd", ".bat", ".sh", ".ps1", ".psm1", ".conf", ".ini", ".env", ".yml", ".yaml", ".properties", ".cfg", ".config", ".htpasswd", ".htaccess", ".npmrc", ".pypirc", ".netrc", ".pgpass", ".my.cnf", ".aws", ".boto", ".ssh", ".gnupg"],
        "mime_types": ["application/x-pkcs12", "application/x-x509-ca-cert", "application/x-pem-file"]
    },
    "log_detection": {
        "enabled": True,
        "min_similar_files": 10,
        "log_patterns": [r".*\d{4}[-_]\d{2}[-_]\d{2}.*", r".*\.log\.\d+$", r".*_\d{8,}.*", r".*-\d{6,}.*"],
        "log_extensions": [".log", ".logs"]
    },
    "auto_gitleaks": {
        "enabled": True,
        "delay_seconds": 5
    }
}


class CriticalSearchService:
    """Serviço para verificação de arquivos críticos (sem cache - busca sempre do banco)"""
    
    _instance = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance
    
    async def load_config(self) -> Dict[str, Any]:
        """Carrega configuração do banco de dados (sem cache)"""
        try:
            from database import async_session_maker, AppSettings
            from sqlalchemy import select
            import json
            
            async with async_session_maker() as db:
                result = await db.execute(
                    select(AppSettings).where(AppSettings.key == "critical_search_config")
                )
                setting = result.scalar_one_or_none()
                
                if setting and setting.value:
                    config = json.loads(setting.value)
                    logger.debug("Critical Search config loaded from database")
                    return config
                else:
                    logger.debug("Using default Critical Search config")
                    return DEFAULT_CONFIG.copy()
        except Exception as e:
            logger.error(f"Error loading Critical Search config: {e}")
            return DEFAULT_CONFIG.copy()
    
    async def get_config(self) -> Dict[str, Any]:
        """Obtém configuração atual (sempre do banco)"""
        return await self.load_config()
    
    @property
    def config(self) -> Dict[str, Any]:
        """DEPRECATED: Use get_config() async method"""
        logger.warning("CriticalSearchService.config é síncrono e retorna config padrão. Use get_config().")
        return DEFAULT_CONFIG
    
    async def is_critical_file_async(
        self,
        file_name: str,
        file_size: int = 0,
        mime_type: str = None
    ) -> bool:
        """Verifica se arquivo é crítico (versão async que busca config do banco)"""
        config = await self.get_config()
        return self._check_critical(file_name, file_size, mime_type, config)
    
    def _check_critical(
        self,
        file_name: str,
        file_size: int,
        mime_type: str,
        config: Dict[str, Any]
    ) -> bool:
        """Lógica interna de verificação de arquivo crítico"""
        if not config.get("enabled", True):
            return False
        
        file_lower = file_name.lower()
        ext = os.path.splitext(file_lower)[1] if '.' in file_lower else ''
        
        # KeePass files
        keepass_config = config.get("keepass_files", {})
        if keepass_config.get("enabled", True):
            if ext in keepass_config.get("extensions", []):
                return True
        
        # Critical extensions
        critical_ext_config = config.get("critical_extensions", {})
        if critical_ext_config.get("enabled", True):
            if ext in critical_ext_config.get("extensions", []):
                return True
            # Check mime types
            if mime_type:
                for mt in critical_ext_config.get("mime_types", []):
                    if mt in mime_type.lower():
                        return True
        
        # Config files by pattern
        config_files = config.get("config_files", {})
        if config_files.get("enabled", True):
            patterns = config_files.get("patterns", [])
            for pattern in patterns:
                if fnmatch.fnmatch(file_lower, pattern.lower()):
                    return True
        
        # Backup files
        backup_config = config.get("backup_files", {})
        if backup_config.get("enabled", True):
            backup_exts = backup_config.get("extensions", [])
            if ext in backup_exts:
                return True
            # Check patterns
            for pattern in backup_config.get("patterns", []):
                if fnmatch.fnmatch(file_lower, pattern.lower()):
                    return True
        
        return False
    
    def is_critical_file(
        self,
        file_name: str,
        file_size: Optional[int] = None,
        mime_type: Optional[str] = None
    ) -> tuple[bool, str]:
        """
        Verifica se um arquivo é crítico com base na configuração.
        
        Returns:
            tuple[bool, str]: (é crítico, razão)
        """
        if not self._config.get("enabled", True):
            return False, "Critical search disabled"
        
        file_name_lower = file_name.lower()
        _, ext = os.path.splitext(file_name_lower)
        
        # 1. Verificar arquivos KeePass
        keepass_config = self._config.get("keepass_files", {})
        if keepass_config.get("enabled", True):
            if ext in keepass_config.get("extensions", []):
                return True, "KeePass file"
        
        # 2. Verificar extensões críticas (certificados, scripts, configs)
        critical_ext_config = self._config.get("critical_extensions", {})
        if critical_ext_config.get("enabled", True):
            if ext in critical_ext_config.get("extensions", []):
                return True, f"Critical extension: {ext}"
            
            # Verificar mime types
            if mime_type:
                for mt in critical_ext_config.get("mime_types", []):
                    if mime_type.startswith(mt):
                        return True, f"Critical mime type: {mime_type}"
        
        # 3. Verificar palavras-chave no nome
        keyword_config = self._config.get("keyword_files", {})
        if keyword_config.get("enabled", True):
            keywords = keyword_config.get("keywords", [])
            case_sensitive = keyword_config.get("case_sensitive", False)
            
            check_name = file_name if case_sensitive else file_name_lower
            
            for keyword in keywords:
                check_keyword = keyword if case_sensitive else keyword.lower()
                if check_keyword in check_name:
                    return True, f"Keyword match: {keyword}"
        
        # 4. Verificar arquivos texto pequenos
        text_config = self._config.get("text_files", {})
        if text_config.get("enabled", True):
            max_size = text_config.get("max_size_bytes", 1024)
            
            if ext in text_config.get("extensions", []):
                if file_size is not None and file_size <= max_size:
                    return True, f"Small text file ({file_size} bytes)"
            
            # Verificar mime type text/*
            if mime_type:
                for mt in text_config.get("mime_types", []):
                    if mime_type.startswith(mt):
                        if file_size is not None and file_size <= max_size:
                            return True, f"Small text file by mime ({file_size} bytes)"
        
        # 5. Verificar arquivos office
        office_config = self._config.get("office_files", {})
        if office_config.get("enabled", True):
            max_size = office_config.get("max_size_bytes", 1048576)
            
            if ext in office_config.get("extensions", []):
                if file_size is None or file_size <= max_size:
                    return True, f"Office file: {ext}"
            
            # Verificar mime types office
            if mime_type:
                for mt in office_config.get("mime_types", []):
                    if mime_type.startswith(mt):
                        if file_size is None or file_size <= max_size:
                            return True, f"Office file by mime"
        
        return False, "Not critical"
    
    def is_log_directory(self, file_names: List[str]) -> bool:
        """
        Verifica se uma lista de arquivos indica um diretório de logs.
        
        Args:
            file_names: Lista de nomes de arquivos no diretório
            
        Returns:
            True se parecer ser um diretório de logs
        """
        log_config = self._config.get("log_detection", {})
        if not log_config.get("enabled", True):
            return False
        
        min_similar = log_config.get("min_similar_files", 10)
        log_patterns = log_config.get("log_patterns", [])
        log_extensions = log_config.get("log_extensions", [])
        
        # Contar arquivos com extensões de log
        log_ext_count = sum(1 for f in file_names if any(f.lower().endswith(ext) for ext in log_extensions))
        if log_ext_count >= min_similar:
            return True
        
        # Compilar padrões de log
        compiled_patterns = []
        for pattern in log_patterns:
            try:
                compiled_patterns.append(re.compile(pattern, re.IGNORECASE))
            except:
                pass
        
        # Contar arquivos que correspondem aos padrões
        pattern_match_count = 0
        for file_name in file_names:
            for pattern in compiled_patterns:
                if pattern.match(file_name):
                    pattern_match_count += 1
                    break
        
        if pattern_match_count >= min_similar:
            return True
        
        # Verificar se há muitos arquivos com nomes similares (mesmo prefixo)
        if len(file_names) >= min_similar:
            prefixes = defaultdict(int)
            for f in file_names:
                # Extrair prefixo (parte antes de números ou datas)
                prefix = re.sub(r'[\d_-]+.*$', '', f)
                if prefix:
                    prefixes[prefix] += 1
            
            # Se algum prefixo aparece em muitos arquivos, é provável log
            max_prefix_count = max(prefixes.values()) if prefixes else 0
            if max_prefix_count >= min_similar:
                return True
        
        return False
    
    def should_auto_start_gitleaks(self) -> bool:
        """Verifica se GitLeaks deve ser iniciado automaticamente"""
        auto_config = self._config.get("auto_gitleaks", {})
        return auto_config.get("enabled", True)
    
    def get_gitleaks_delay(self) -> int:
        """Retorna o delay em segundos antes de iniciar GitLeaks"""
        auto_config = self._config.get("auto_gitleaks", {})
        return auto_config.get("delay_seconds", 5)


# Singleton
_critical_search_service = None

def get_critical_search_service() -> CriticalSearchService:
    global _critical_search_service
    if _critical_search_service is None:
        _critical_search_service = CriticalSearchService()
    return _critical_search_service
