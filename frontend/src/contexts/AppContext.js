import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const API_URL = process.env.REACT_APP_BACKEND_URL || '';

const AppContext = createContext();

export const AppProvider = ({ children }) => {
  const [ignoreCache, setIgnoreCache] = useState(() => {
    const saved = localStorage.getItem('ignoreCache');
    return saved === 'true';
  });

  // Estado do modo offline
  const [offlineMode, setOfflineModeState] = useState(false);
  const [loadingOffline, setLoadingOffline] = useState(true);

  // Estado do proxy ativo
  const [activeProxy, setActiveProxy] = useState(null);
  const [proxies, setProxies] = useState([]);
  const [loadingProxy, setLoadingProxy] = useState(true);

  // Carregar status do modo offline
  const fetchOfflineMode = useCallback(async () => {
    try {
      setLoadingOffline(true);
      const response = await fetch(`${API_URL}/api/offline-mode`);
      if (response.ok) {
        const data = await response.json();
        setOfflineModeState(data.offline_mode);
      }
    } catch (error) {
      console.error('Erro ao carregar modo offline:', error);
    } finally {
      setLoadingOffline(false);
    }
  }, []);

  // Definir modo offline
  const setOfflineMode = useCallback(async (enabled) => {
    try {
      const response = await fetch(`${API_URL}/api/offline-mode?enabled=${enabled}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' }
      });
      if (response.ok) {
        setOfflineModeState(enabled);
        return true;
      }
      return false;
    } catch (error) {
      console.error('Erro ao definir modo offline:', error);
      return false;
    }
  }, []);

  // Carregar lista de proxies
  const fetchProxies = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/api/proxy-servers`);
      if (response.ok) {
        const data = await response.json();
        setProxies(data);
      }
    } catch (error) {
      console.error('Erro ao carregar proxies:', error);
    }
  }, []);

  // Carregar proxy ativo
  const fetchActiveProxy = useCallback(async () => {
    try {
      setLoadingProxy(true);
      const response = await fetch(`${API_URL}/api/active-proxy`);
      if (response.ok) {
        const data = await response.json();
        setActiveProxy(data.proxy);
      }
    } catch (error) {
      console.error('Erro ao carregar proxy ativo:', error);
    } finally {
      setLoadingProxy(false);
    }
  }, []);

  // Definir proxy ativo
  const updateActiveProxy = useCallback(async (proxyId) => {
    try {
      const response = await fetch(`${API_URL}/api/active-proxy`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proxy_id: proxyId })
      });
      if (response.ok) {
        const data = await response.json();
        setActiveProxy(data.proxy);
        return true;
      }
      return false;
    } catch (error) {
      console.error('Erro ao definir proxy ativo:', error);
      return false;
    }
  }, []);

  // Carregar dados iniciais
  useEffect(() => {
    fetchProxies();
    fetchActiveProxy();
    fetchOfflineMode();
  }, [fetchProxies, fetchActiveProxy, fetchOfflineMode]);

  useEffect(() => {
    localStorage.setItem('ignoreCache', ignoreCache);
  }, [ignoreCache]);

  return (
    <AppContext.Provider value={{ 
      ignoreCache, 
      setIgnoreCache,
      offlineMode,
      setOfflineMode,
      loadingOffline,
      activeProxy,
      proxies,
      loadingProxy,
      updateActiveProxy,
      refreshProxies: fetchProxies
    }}>
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within AppProvider');
  }
  return context;
};
