/**
 * Configuração centralizada da API
 * 
 * Detecta automaticamente o endereço do backend baseado no host atual.
 * - Se REACT_APP_BACKEND_URL estiver definido e não for localhost, usa ele
 * - Caso contrário, usa o mesmo host do frontend na porta 9090
 */

function getBackendUrl() {
  const envUrl = process.env.REACT_APP_BACKEND_URL;
  
  // Se estiver definido e não for localhost/127.0.0.1, usar a variável de ambiente
  if (envUrl && !envUrl.includes('localhost') && !envUrl.includes('127.0.0.1')) {
    return envUrl;
  }
  
  // Detectar dinamicamente baseado no host atual
  if (typeof window !== 'undefined') {
    const protocol = window.location.protocol;
    const hostname = window.location.hostname;
    
    // Se estiver acessando via localhost, manter localhost
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return `${protocol}//${hostname}:9090`;
    }
    
    // Caso contrário, usar o mesmo host na porta 9090
    return `${protocol}//${hostname}:9090`;
  }
  
  // Fallback para SSR ou ambiente sem window
  return envUrl || 'http://localhost:9090';
}

export const BACKEND_URL = getBackendUrl();
export const API = `${BACKEND_URL}/api`;
export const API_V2 = `${BACKEND_URL}/api/v2`;

export default BACKEND_URL;
