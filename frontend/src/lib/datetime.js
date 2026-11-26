import i18n from '@/i18n';

/**
 * Retorna o locale BCP-47 de data/hora correspondente ao idioma ativo da
 * interface (ex.: 'pt' -> 'pt-BR', 'en' -> 'en-US'). Usar com
 * Date.prototype.toLocaleString / toLocaleDateString / toLocaleTimeString para
 * que as datas sigam o idioma selecionado pelo usuário.
 */
export function dateLocale() {
  const lng = (i18n.resolvedLanguage || i18n.language || 'en').split('-')[0];
  return lng === 'pt' ? 'pt-BR' : 'en-US';
}
