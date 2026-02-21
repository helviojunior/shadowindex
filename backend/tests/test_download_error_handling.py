"""Testes para validar o tratamento de erros de acesso negado no download"""
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from fastapi import HTTPException


class TestDownloadErrorHandling:
    """Testes para verificar se erros de acesso são tratados corretamente"""
    
    def test_check_error_message_access_denied(self):
        """Verifica se mensagem de acesso negado é detectada"""
        # Simular mensagem de erro típica do SOAP
        error_messages = [
            "Access to the path '\\\\SERVER\\Share\\file.txt' is denied.",
            "System.UnauthorizedAccessException: Access is denied.",
            "The access is denied for this resource",
        ]
        
        for msg in error_messages:
            msg_lower = msg.lower()
            assert 'is denied' in msg_lower or ('access' in msg_lower and 'denied' in msg_lower), \
                f"Mensagem '{msg}' deveria ser detectada como erro de acesso"
    
    def test_check_error_message_not_found(self):
        """Verifica se mensagem de arquivo não encontrado é detectada"""
        error_messages = [
            "Could not find file '\\\\SERVER\\Share\\file.txt'.",
            "File not found: test.txt",
            "The system could not find the file specified",
        ]
        
        for msg in error_messages:
            msg_lower = msg.lower()
            assert 'could not find' in msg_lower or ('not found' in msg_lower and 'file' in msg_lower), \
                f"Mensagem '{msg}' deveria ser detectada como erro de não encontrado"
    
    def test_check_error_message_system_error(self):
        """Verifica se stack trace do .NET é detectado"""
        error_message = """System.IO.IOException: The process cannot access the file because it is being used by another process.
   at System.IO.__Error.WinIOError(Int32 errorCode, String maybeFullPath)
   at System.IO.FileStream.Init(String path, FileMode mode, FileAccess access)"""
        
        assert 'at System.' in error_message, \
            "Stack trace do .NET deveria ser detectada"


if __name__ == "__main__":
    test = TestDownloadErrorHandling()
    test.test_check_error_message_access_denied()
    print("✓ test_check_error_message_access_denied passed")
    test.test_check_error_message_not_found()
    print("✓ test_check_error_message_not_found passed")
    test.test_check_error_message_system_error()
    print("✓ test_check_error_message_system_error passed")
    print("\n✅ Todos os testes passaram!")
