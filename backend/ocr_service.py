"""
OCR Service - Apache Tika Integration

Provides OCR and metadata extraction capabilities using Apache Tika server.
"""

import os
import logging
import asyncio
from typing import Optional, Dict, Any, Tuple
from pathlib import Path
from datetime import datetime, timezone

import requests

logger = logging.getLogger(__name__)

# Tika server URL from environment
TIKA_SERVER_URL = os.environ.get("TIKA_SERVER_URL", "http://tika:9998")


class TikaService:
    """
    Service for OCR and metadata extraction using Apache Tika.
    
    Connects to an external Tika server (apache/tika:latest-full).
    """
    
    def __init__(self, server_url: str = None):
        self.server_url = server_url or TIKA_SERVER_URL
        self._initialized = False
        self._available = False
    
    async def initialize(self) -> bool:
        """
        Initialize and test Tika server connection.
        
        Returns:
            True if Tika server is available, False otherwise
        """
        try:
            logger.info(f"Initializing Tika service at {self.server_url}")
            
            # Test connection
            response = await asyncio.to_thread(
                requests.get,
                f"{self.server_url}/tika",
                timeout=10
            )
            
            if response.status_code == 200:
                self._available = True
                self._initialized = True
                logger.info("Tika server is available and ready")
                return True
            else:
                logger.warning(f"Tika server returned status {response.status_code}")
                self._available = False
                return False
                
        except requests.exceptions.ConnectionError as e:
            logger.warning(f"Cannot connect to Tika server at {self.server_url}: {e}")
            self._available = False
            return False
        except Exception as e:
            logger.error(f"Error initializing Tika service: {e}")
            self._available = False
            return False
    
    @property
    def is_available(self) -> bool:
        """Check if Tika server is available"""
        return self._available
    
    async def extract_text_and_metadata(
        self, 
        file_path: str,
        ocr_language: str = "eng+por",
        pdf_strategy: str = "ocr_and_text"
    ) -> Tuple[Optional[str], Optional[Dict[str, Any]], Optional[str]]:
        """
        Extract text content and metadata from a file using Tika.
        
        Args:
            file_path: Path to the file to process
            ocr_language: OCR language(s) to use (e.g., "eng+por" for English+Portuguese)
            pdf_strategy: PDF OCR strategy ("ocr_only", "no_ocr", "ocr_and_text")
            
        Returns:
            Tuple of (content, metadata, error)
        """
        if not self._available:
            return None, None, "Tika server not available"
        
        file_path = Path(file_path)
        if not file_path.exists():
            return None, None, f"File not found: {file_path}"
        
        # Calcular timeout baseado no tamanho do arquivo
        file_size = file_path.stat().st_size
        # Base: 120s + 30s por cada 10MB
        base_timeout = 120
        size_timeout = (file_size // (10 * 1024 * 1024)) * 30
        text_timeout = min(base_timeout + size_timeout, 600)  # Max 10 minutos
        
        try:
            # Headers for OCR configuration
            headers = {
                "X-Tika-OCRLanguage": ocr_language,
                "X-Tika-PDFocrStrategy": pdf_strategy,
                "Accept": "text/plain; charset=UTF-8"  # Get plain text content with UTF-8
            }
            
            # Read file and send to Tika
            with open(file_path, 'rb') as f:
                file_content = f.read()
            
            logger.info(f"Sending {len(file_content)} bytes to Tika (timeout: {text_timeout}s)")
            
            # Extract text content
            text_response = await asyncio.to_thread(
                requests.put,
                f"{self.server_url}/tika",
                data=file_content,
                headers=headers,
                timeout=text_timeout
            )
            
            content = None
            if text_response.status_code == 200:
                # Force UTF-8 encoding interpretation
                text_response.encoding = 'utf-8'
                content = text_response.text.strip()
                
                # Try to fix double-encoded UTF-8 (UTF-8 interpreted as Latin-1 then encoded again)
                if content:
                    try:
                        # Check for common double-encoding patterns (Ã followed by special chars)
                        if 'Ã' in content and any(c in content for c in ['§', '£', '©', '³', '¡', '­', '±']):
                            # Try to fix by encoding as latin-1 and decoding as utf-8
                            fixed_content = content.encode('latin-1').decode('utf-8')
                            content = fixed_content
                            logger.info(f"Fixed double-encoded UTF-8 content for {file_path.name}")
                    except (UnicodeDecodeError, UnicodeEncodeError):
                        # Keep original content if fix fails
                        pass
                
                if content:
                    logger.info(f"Extracted {len(content)} characters from {file_path.name}")
            elif text_response.status_code == 422:
                # Arquivo não suportado pelo Tika
                return None, None, f"Tika não suporta este tipo de arquivo (HTTP 422)"
            elif text_response.status_code >= 500:
                # Erro do servidor Tika
                return None, None, f"Erro no servidor Tika (HTTP {text_response.status_code})"
            
            # Extract metadata (timeout menor, é mais rápido)
            metadata_headers = {
                "Accept": "application/json"
            }
            
            metadata_response = await asyncio.to_thread(
                requests.put,
                f"{self.server_url}/meta",
                data=file_content,
                headers=metadata_headers,
                timeout=60
            )
            
            metadata = None
            if metadata_response.status_code == 200:
                try:
                    metadata = metadata_response.json()
                    # Clean up metadata - convert lists to strings for single values
                    cleaned_metadata = {}
                    for key, value in metadata.items():
                        if isinstance(value, list) and len(value) == 1:
                            cleaned_metadata[key] = value[0]
                        else:
                            cleaned_metadata[key] = value
                    metadata = cleaned_metadata
                    logger.info(f"Extracted {len(metadata)} metadata fields from {file_path.name}")
                except Exception as e:
                    logger.warning(f"Error parsing metadata JSON: {e}")
            
            return content, metadata, None
            
        except requests.exceptions.Timeout:
            file_size_mb = file_size / (1024 * 1024)
            error = f"Timeout no processamento Tika (arquivo: {file_size_mb:.1f}MB, timeout: {text_timeout}s)"
            logger.error(f"{error} for {file_path}")
            return None, None, error
        except requests.exceptions.ConnectionError as e:
            error = f"Erro de conexão com Tika: {str(e)}"
            logger.error(f"{error} for {file_path}")
            return None, None, error
        except Exception as e:
            error = f"Erro no processamento Tika: {str(e)}"
            logger.error(f"{error} for {file_path}")
            return None, None, error
    
    async def get_supported_types(self) -> list:
        """Get list of MIME types supported by Tika"""
        if not self._available:
            return []
        
        try:
            response = await asyncio.to_thread(
                requests.get,
                f"{self.server_url}/mime-types",
                headers={"Accept": "application/json"},
                timeout=10
            )
            
            if response.status_code == 200:
                return list(response.json().keys())
            return []
        except Exception as e:
            logger.error(f"Error getting supported types: {e}")
            return []


# Global Tika service instance
_tika_service: Optional[TikaService] = None


def get_tika_service() -> TikaService:
    """Get or create global Tika service instance"""
    global _tika_service
    if _tika_service is None:
        _tika_service = TikaService()
    return _tika_service


async def initialize_tika() -> bool:
    """Initialize Tika service on application startup"""
    service = get_tika_service()
    return await service.initialize()


async def process_file_ocr(
    file_path: str,
    ocr_language: str = "eng+por"
) -> Tuple[Optional[str], Optional[Dict[str, Any]], Optional[str]]:
    """
    Process a file for OCR and metadata extraction.
    
    Args:
        file_path: Path to the file
        ocr_language: OCR language(s)
        
    Returns:
        Tuple of (content, metadata, error)
    """
    service = get_tika_service()
    
    if not service.is_available:
        # Try to initialize
        await service.initialize()
    
    return await service.extract_text_and_metadata(file_path, ocr_language)
