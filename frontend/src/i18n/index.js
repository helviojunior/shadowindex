import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English', flag: '🇺🇸' },
  { code: 'pt', label: 'Português', flag: '🇧🇷' },
];

// Chave usada para persistir a escolha do usuário no navegador.
export const LANG_STORAGE_KEY = 'shadowindex_lang';

// Carrega automaticamente todos os namespaces em locales/<lng>/<ns>.json
// (webpack require.context — sem precisar registrar cada arquivo manualmente).
function loadResources() {
  const resources = {};
  const ctx = require.context('./locales', true, /\.json$/);
  ctx.keys().forEach((key) => {
    const match = key.match(/^\.\/([^/]+)\/(.+)\.json$/);
    if (!match) return;
    const [, lng, ns] = match;
    resources[lng] = resources[lng] || {};
    resources[lng][ns] = ctx(key);
  });
  return resources;
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: loadResources(),
    // Idioma: 1) escolha persistida do usuário, 2) idioma do navegador,
    // 3) fallback para inglês.
    fallbackLng: 'en',
    supportedLngs: ['en', 'pt'],
    nonExplicitSupportedLngs: true, // "pt-BR" -> "pt"
    load: 'languageOnly',
    defaultNS: 'common',
    detection: {
      order: ['localStorage', 'navigator', 'htmlTag'],
      lookupLocalStorage: LANG_STORAGE_KEY,
      caches: ['localStorage'],
    },
    interpolation: { escapeValue: false },
    returnEmptyString: false,
    react: { useSuspense: false },
  });

// Mantém o atributo lang do <html> sincronizado.
i18n.on('languageChanged', (lng) => {
  try {
    document.documentElement.lang = lng;
  } catch (e) {
    /* ignore */
  }
});

export default i18n;
