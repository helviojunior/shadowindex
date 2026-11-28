import i18n from '@/i18n';

// Mapeia a linguagem do i18n para um locale completo do Intl.
function currentLocale() {
  const lng = (i18n?.language || 'pt').toLowerCase();
  if (lng.startsWith('pt')) return 'pt-BR';
  if (lng.startsWith('en')) return 'en-US';
  return lng;
}

// Data + hora formatadas conforme a linguagem atual do usuário.
export function formatDateTime(value, opts) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString(currentLocale(), opts);
  } catch (e) {
    return String(value);
  }
}

// Apenas a data.
export function formatDate(value, opts) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleDateString(currentLocale(), opts);
  } catch (e) {
    return String(value);
  }
}
