import i18n from '@/i18n';

// Locale completo do Intl a partir da linguagem atual do i18n.
export function dateLocale() {
  const lng = (i18n?.language || 'pt').toLowerCase();
  if (lng.startsWith('pt')) return 'pt-BR';
  if (lng.startsWith('en')) return 'en-US';
  return lng;
}

// Data + hora formatadas conforme a linguagem atual do usuário.
export function formatDateTime(value, opts) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString(dateLocale(), opts);
  } catch (e) {
    return String(value);
  }
}

// Apenas a data.
export function formatDate(value, opts) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleDateString(dateLocale(), opts);
  } catch (e) {
    return String(value);
  }
}
