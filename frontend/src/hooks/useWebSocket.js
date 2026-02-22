import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';

// Contexto do WebSocket
const WebSocketContext = createContext(null);

// URL do WebSocket
const getWebSocketUrl = () => {
  const backendUrl = process.env.REACT_APP_BACKEND_URL || '';
  // Converter http(s) para ws(s)
  const wsUrl = backendUrl.replace(/^http/, 'ws');
  return `${wsUrl}/ws`;
};

export const WebSocketProvider = ({ children }) => {
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState(null);
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const pingIntervalRef = useRef(null);
  const listenersRef = useRef(new Map());
  const connectionStatusCallbackRef = useRef(null);

  // Registrar callback para status de conexão (será usado pelo ConnectionStatusContext)
  const setConnectionStatusCallback = useCallback((callback) => {
    connectionStatusCallbackRef.current = callback;
  }, []);

  // Conectar ao WebSocket
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const wsUrl = getWebSocketUrl();
    console.log('Connecting to WebSocket:', wsUrl);
    
    try {
      wsRef.current = new WebSocket(wsUrl);

      wsRef.current.onopen = () => {
        console.log('WebSocket connected');
        setIsConnected(true);
        
        // Notificar que está conectado
        if (connectionStatusCallbackRef.current) {
          connectionStatusCallbackRef.current({ connected: true });
        }
        
        // Iniciar ping a cada 30 segundos para manter conexão viva
        pingIntervalRef.current = setInterval(() => {
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send('ping');
          }
        }, 30000);
      };

      wsRef.current.onclose = (event) => {
        console.log('WebSocket disconnected:', event.code, event.reason);
        setIsConnected(false);
        
        // Limpar ping interval
        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
        }
        
        // Não notificar desconexão - deixar o health check HTTP decidir
        // WebSocket pode desconectar temporariamente durante reconexões normais
        
        // Reconectar após 3 segundos (exceto se fechado intencionalmente)
        if (event.code !== 1000) {
          reconnectTimeoutRef.current = setTimeout(() => {
            console.log('Attempting to reconnect WebSocket...');
            connect();
          }, 3000);
        }
      };

      wsRef.current.onerror = (error) => {
        console.error('WebSocket error:', error);
        // Não notificar aqui, o onclose será chamado após o erro
      };

      wsRef.current.onmessage = (event) => {
        // Ignorar pong
        if (event.data === 'pong') return;
        
        try {
          const message = JSON.parse(event.data);
          setLastMessage(message);
          
          // Notificar todos os listeners registrados para este tipo de evento
          const typeListeners = listenersRef.current.get(message.type) || [];
          typeListeners.forEach(callback => callback(message));
          
          // Notificar listeners de "all" (recebem todos os eventos)
          const allListeners = listenersRef.current.get('all') || [];
          allListeners.forEach(callback => callback(message));
          
        } catch (e) {
          console.error('Error parsing WebSocket message:', e);
        }
      };
    } catch (error) {
      console.error('Error creating WebSocket:', error);
      // Notificar erro de conexão
      if (connectionStatusCallbackRef.current) {
        connectionStatusCallbackRef.current({ 
          connected: false, 
          message: 'Erro ao conectar WebSocket' 
        });
      }
    }
  }, []);

  // Desconectar
  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
    }
    if (wsRef.current) {
      wsRef.current.close(1000, 'User disconnect');
    }
  }, []);

  // Registrar listener para um tipo de evento
  const subscribe = useCallback((eventType, callback) => {
    if (!listenersRef.current.has(eventType)) {
      listenersRef.current.set(eventType, []);
    }
    listenersRef.current.get(eventType).push(callback);
    
    // Retornar função para cancelar subscription
    return () => {
      const listeners = listenersRef.current.get(eventType) || [];
      const index = listeners.indexOf(callback);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    };
  }, []);

  // Conectar automaticamente ao montar
  useEffect(() => {
    connect();
    
    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  const value = {
    isConnected,
    lastMessage,
    subscribe,
    connect,
    disconnect,
    setConnectionStatusCallback
  };

  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  );
};

// Hook para usar o WebSocket
export const useWebSocket = () => {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }
  return context;
};

// Hook específico para eventos de download
export const useDownloadEvents = (onProgress, onComplete, onFailed, onStarted) => {
  const { subscribe } = useWebSocket();
  
  useEffect(() => {
    const unsubscribers = [];
    
    if (onProgress) {
      unsubscribers.push(subscribe('download_progress', onProgress));
    }
    if (onComplete) {
      unsubscribers.push(subscribe('download_complete', onComplete));
    }
    if (onFailed) {
      unsubscribers.push(subscribe('download_failed', onFailed));
    }
    if (onStarted) {
      unsubscribers.push(subscribe('download_started', onStarted));
    }
    
    return () => {
      unsubscribers.forEach(unsub => unsub());
    };
  }, [subscribe, onProgress, onComplete, onFailed, onStarted]);
};

// Hook específico para eventos de scan
export const useScanEvents = (onProgress, onComplete) => {
  const { subscribe } = useWebSocket();
  
  useEffect(() => {
    const unsubscribers = [];
    
    if (onProgress) {
      unsubscribers.push(subscribe('scan_progress', onProgress));
    }
    if (onComplete) {
      unsubscribers.push(subscribe('scan_complete', onComplete));
    }
    
    return () => {
      unsubscribers.forEach(unsub => unsub());
    };
  }, [subscribe, onProgress, onComplete]);
};

// Hook para eventos de leak
export const useLeakEvents = (onNewLeak) => {
  const { subscribe } = useWebSocket();
  
  useEffect(() => {
    if (!onNewLeak) return;
    return subscribe('new_leak', onNewLeak);
  }, [subscribe, onNewLeak]);
};

// Hook para mudanças de status de arquivo (tree view)
export const useFileStatusEvents = (onStatusChange) => {
  const { subscribe } = useWebSocket();
  
  useEffect(() => {
    if (!onStatusChange) return;
    return subscribe('file_status_change', onStatusChange);
  }, [subscribe, onStatusChange]);
};

// Hook para atualizações de stats (dashboard)
export const useStatsEvents = (onStatsUpdate) => {
  const { subscribe } = useWebSocket();
  
  useEffect(() => {
    if (!onStatsUpdate) return;
    return subscribe('stats_update', onStatsUpdate);
  }, [subscribe, onStatsUpdate]);
};

export default WebSocketContext;
