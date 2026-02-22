import { useEffect, useRef } from 'react';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useConnectionStatus } from '@/contexts/ConnectionStatusContext';

const API_URL = process.env.REACT_APP_BACKEND_URL || '';

/**
 * Componente bridge que conecta o WebSocket ao ConnectionStatus
 * e também monitora falhas de API HTTP
 * Deve ser renderizado dentro de ambos os providers
 */
export const ConnectionBridge = ({ children }) => {
  const { setConnectionStatusCallback, isConnected: wsConnected } = useWebSocket();
  const { markConnected, markDisconnected, isConnected } = useConnectionStatus();
  const healthCheckIntervalRef = useRef(null);
  const failedChecksRef = useRef(0);

  useEffect(() => {
    // Registrar callback no WebSocket para atualizar status de conexão
    setConnectionStatusCallback(({ connected, message }) => {
      if (connected) {
        failedChecksRef.current = 0;
        markConnected();
      } else {
        markDisconnected(message);
      }
    });
  }, [setConnectionStatusCallback, markConnected, markDisconnected]);

  // Sincronizar estado inicial
  useEffect(() => {
    if (wsConnected) {
      failedChecksRef.current = 0;
      markConnected();
    }
  }, [wsConnected, markConnected]);

  // Health check periódico para detectar problemas de API HTTP
  useEffect(() => {
    const checkApiHealth = async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        
        const response = await fetch(`${API_URL}/api/`, {
          method: 'GET',
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (response.ok) {
          failedChecksRef.current = 0;
          if (!isConnected) {
            markConnected();
          }
        } else {
          failedChecksRef.current += 1;
          if (failedChecksRef.current >= 2) {
            markDisconnected('Erro na comunicação com a API');
          }
        }
      } catch (error) {
        failedChecksRef.current += 1;
        // Só marca como desconectado após 2 falhas consecutivas
        if (failedChecksRef.current >= 2) {
          markDisconnected('Servidor não está respondendo');
        }
      }
    };

    // Check inicial após 2 segundos
    const initialTimeout = setTimeout(checkApiHealth, 2000);
    
    // Check periódico a cada 10 segundos
    healthCheckIntervalRef.current = setInterval(checkApiHealth, 10000);

    return () => {
      clearTimeout(initialTimeout);
      if (healthCheckIntervalRef.current) {
        clearInterval(healthCheckIntervalRef.current);
      }
    };
  }, [markConnected, markDisconnected, isConnected]);

  return children;
};

export default ConnectionBridge;
