import { useEffect } from 'react';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useConnectionStatus } from '@/contexts/ConnectionStatusContext';

/**
 * Componente bridge que conecta o WebSocket ao ConnectionStatus
 * Deve ser renderizado dentro de ambos os providers
 */
export const ConnectionBridge = ({ children }) => {
  const { setConnectionStatusCallback, isConnected: wsConnected } = useWebSocket();
  const { markConnected, markDisconnected } = useConnectionStatus();

  useEffect(() => {
    // Registrar callback no WebSocket para atualizar status de conexão
    setConnectionStatusCallback(({ connected, message }) => {
      if (connected) {
        markConnected();
      } else {
        markDisconnected(message);
      }
    });
  }, [setConnectionStatusCallback, markConnected, markDisconnected]);

  // Sincronizar estado inicial
  useEffect(() => {
    if (wsConnected) {
      markConnected();
    }
  }, [wsConnected, markConnected]);

  return children;
};

export default ConnectionBridge;
