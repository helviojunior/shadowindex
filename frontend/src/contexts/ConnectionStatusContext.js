import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';

const ConnectionStatusContext = createContext(null);

export const ConnectionStatusProvider = ({ children }) => {
  const [isConnected, setIsConnected] = useState(true);
  const [errorMessage, setErrorMessage] = useState(null);
  const [errorCount, setErrorCount] = useState(0);
  const reconnectAttempts = useRef(0);
  const lastErrorTime = useRef(null);
  
  // Marcar como desconectado
  const markDisconnected = useCallback((message = 'Falha na comunicação com o backend') => {
    const now = Date.now();
    
    // Evitar spam de erros - só atualiza se passou mais de 1 segundo desde o último erro
    if (lastErrorTime.current && now - lastErrorTime.current < 1000) {
      return;
    }
    
    lastErrorTime.current = now;
    reconnectAttempts.current += 1;
    setErrorCount(prev => prev + 1);
    setIsConnected(false);
    setErrorMessage(message);
  }, []);
  
  // Marcar como conectado
  const markConnected = useCallback(() => {
    reconnectAttempts.current = 0;
    setIsConnected(true);
    setErrorMessage(null);
  }, []);
  
  // Resetar estado (útil para quando o usuário clica em "tentar novamente")
  const resetConnection = useCallback(() => {
    reconnectAttempts.current = 0;
    setErrorCount(0);
    setIsConnected(true);
    setErrorMessage(null);
    lastErrorTime.current = null;
  }, []);

  // Auto-recuperação: se passou muito tempo sem novos erros, limpar o estado
  useEffect(() => {
    if (!isConnected) {
      const timeout = setTimeout(() => {
        // Se não houve novo erro em 30 segundos, tentar resetar
        const now = Date.now();
        if (lastErrorTime.current && now - lastErrorTime.current > 30000) {
          markConnected();
        }
      }, 30000);
      
      return () => clearTimeout(timeout);
    }
  }, [isConnected, errorCount, markConnected]);

  const value = {
    isConnected,
    errorMessage,
    errorCount,
    reconnectAttempts: reconnectAttempts.current,
    markDisconnected,
    markConnected,
    resetConnection
  };

  return (
    <ConnectionStatusContext.Provider value={value}>
      {children}
    </ConnectionStatusContext.Provider>
  );
};

export const useConnectionStatus = () => {
  const context = useContext(ConnectionStatusContext);
  if (!context) {
    throw new Error('useConnectionStatus must be used within ConnectionStatusProvider');
  }
  return context;
};

export default ConnectionStatusContext;
