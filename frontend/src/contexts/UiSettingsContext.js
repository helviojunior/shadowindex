import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || '';
const API = BACKEND_URL + '/api';

// Resolve uma URL salva: externa (http/data) usa como está; relativa (/api/...)
// é prefixada com a URL do backend para que <img>/favicon carreguem corretamente.
export const resolveBrandingUrl = (value) => {
  if (!value) return '';
  if (/^(https?:|data:|blob:)/i.test(value)) return value;
  if (value.startsWith('/')) return BACKEND_URL + value;
  return value;
};

// Valores padrão (devem espelhar DEFAULT_SETTINGS do backend)
export const UI_DEFAULTS = {
  logoUrl: 'https://media.sec4us.com.br/logo/sec4us-dark-mode.svg',
  logoAlignment: 'left', // left | center | right
  sidebarActiveColor: '#34d399', // emerald-400
  faviconUrl: 'https://media.sec4us.com.br/icon/favicon.ico',
};

const UiSettingsContext = createContext();

const applyFavicon = (url) => {
  if (!url) return;
  try {
    let link = document.querySelector("link[rel~='icon']");
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = url;
  } catch (e) {
    // ignora falhas de DOM
  }
};

export const UiSettingsProvider = ({ children }) => {
  const [uiSettings, setUiSettings] = useState(UI_DEFAULTS);

  const reloadUiSettings = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API}/settings`);
      const next = {
        logoUrl: resolveBrandingUrl(data.ui_logo_url?.value || UI_DEFAULTS.logoUrl),
        logoAlignment: data.ui_logo_alignment?.value || UI_DEFAULTS.logoAlignment,
        sidebarActiveColor: data.ui_sidebar_active_color?.value || UI_DEFAULTS.sidebarActiveColor,
        faviconUrl: resolveBrandingUrl(data.ui_favicon_url?.value || UI_DEFAULTS.faviconUrl),
      };
      setUiSettings(next);
      applyFavicon(next.faviconUrl);
    } catch (error) {
      // Mantém defaults; a barra de conexão já informa falhas de backend
      applyFavicon(UI_DEFAULTS.faviconUrl);
    }
  }, []);

  useEffect(() => {
    reloadUiSettings();
  }, [reloadUiSettings]);

  return (
    <UiSettingsContext.Provider value={{ ...uiSettings, reloadUiSettings }}>
      {children}
    </UiSettingsContext.Provider>
  );
};

export const useUiSettings = () => {
  const context = useContext(UiSettingsContext);
  if (!context) {
    throw new Error('useUiSettings must be used within UiSettingsProvider');
  }
  return context;
};
