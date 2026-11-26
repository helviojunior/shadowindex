import { useTranslation } from 'react-i18next';
import { Languages } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { SUPPORTED_LANGUAGES } from '@/i18n';

/**
 * Seletor de idioma. A escolha é persistida automaticamente no localStorage
 * pelo i18next-browser-languagedetector (caches: ['localStorage']).
 */
const LanguageSwitcher = () => {
  const { i18n, t } = useTranslation();
  const current = (i18n.resolvedLanguage || i18n.language || 'en').split('-')[0];
  const active = SUPPORTED_LANGUAGES.find((l) => l.code === current) || SUPPORTED_LANGUAGES[0];

  const changeLanguage = (code) => {
    i18n.changeLanguage(code);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 px-2"
          title={t('header.language')}
          data-testid="language-switcher"
        >
          <Languages className="w-4 h-4" />
          <span className="text-sm">{active.flag} {active.code.toUpperCase()}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {SUPPORTED_LANGUAGES.map((lng) => (
          <DropdownMenuItem
            key={lng.code}
            onClick={() => changeLanguage(lng.code)}
            className={current === lng.code ? 'font-semibold' : ''}
            data-testid={`lang-option-${lng.code}`}
          >
            <span className="mr-2">{lng.flag}</span>
            {lng.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default LanguageSwitcher;
