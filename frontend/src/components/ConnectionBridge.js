import { useEffect, useRef } from 'react';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useConnectionStatus } from '@/contexts/ConnectionStatusContext';

const API_URL = process.env.REACT_APP_BACKEND_URL || '';

/**
 * Componente bridge que monitora a conexão com o backend via health check HTTP
 * O WebSocket é usado apenas para dados em tempo real, não para status de conexão
 */
export const ConnectionBridge = ({ children }) => {
  const { isConnected: wsConnected } = useWebSocket();
  const { markConnected, markDisconnected, isConnected } = useConnectionStatus();
  const healthCheckIntervalRef = useRef(null);
  const consecutiveFailuresRef = useRef(0);
  const consecutiveSuccessRef = useRef(0);

  // Health check periódico via HTTP - única fonte de verdade para status de conexão
  useEffect(() => {
    const checkApiHealth = async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);
        
        const response = await fetch(`${API_URL}/api/`, {
          method: 'GET',
          signal: controller.signal,
          cache: 'no-store'
        });
        
        clearTimeout(timeoutId);
        
        if (response.ok) {
          consecutiveFailuresRef.current = 0;
          consecutiveSuccessRef.current += 1;
          
          // Precisa de 2 sucessos consecutivos para marcar como conectado
          // Isso evita falsos positivos durante instabilidade
          if (!isConnected && consecutiveSuccessRef.current >= 2) {
            markConnected();
          }
        } else {
          consecutiveSuccessRef.current = 0;
          consecutiveFailuresRef.current += 1;
          
          // Só marca como desconectado após 3 falhas consecutivas (30 segundos)
          if (consecutiveFailuresRef.current >= 3) {
            markDisconnected('Erro na comunicação com a API');
          }
        }
      } catch (error) {
        consecutiveSuccessRef.current = 0;
        consecutiveFailuresRef.current += 1;
        
        // Só marca como desconectado após 3 falhas consecutivas
        if (consecutiveFailuresRef.current >= 3) {
          markDisconnected('Servidor não está respondendo');
        }
      }
    };

    // Check inicial após 3 segundos
    const initialTimeout = setTimeout(checkApiHealth, 3000);
    
    // Check periódico a cada 10 segundos
    healthCheckIntervalRef.current = setInterval(checkApiHealth, 10000);

    return () => {
      clearTimeout(initialTimeout);
      if (healthCheckIntervalRef.current) {
        clearInterval(healthCheckIntervalRef.current);
      }
    };
  }, [markConnected, markDisconnected, isConnected]);

  // Se o WebSocket conectar, resetar contador de falhas (sinal positivo)
  useEffect(() => {
    if (wsConnected) {
      consecutiveFailuresRef.current = 0;
      consecutiveSuccessRef.current = 2; // Força reconexão imediata se WS conectou
      if (!isConnected) {
        markConnected();
      }
    }
  }, [wsConnected, isConnected, markConnected]);

  return children;
};

export default ConnectionBridge;
