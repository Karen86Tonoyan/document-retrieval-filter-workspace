import { Languages } from 'lucide-react';
import { useI18n, type Lang } from '@/lib/i18n';

const OPTIONS: { value: Lang; short: string }[] = [
  { value: 'pl', short: 'PL' },
  { value: 'en', short: 'EN' },
];

export function LanguageSwitcher() {
  const { lang, setLang, t } = useI18n();

  return (
    <div className="flex items-center gap-2" role="group" aria-label={t('lang.label')}>
      <Languages className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden />
      <div className="flex rounded-md border border-sidebar-border overflow-hidden">
        {OPTIONS.map((o) => {
          const active = lang === o.value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => setLang(o.value)}
              aria-pressed={active}
              title={t(`lang.${o.value}`)}
              className={`px-3 py-1 text-[11px] font-mono tracking-wider transition-colors ${
                active
                  ? 'bg-sidebar-accent text-primary'
                  : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
              }`}
            >
              {o.short}
            </button>
          );
        })}
      </div>
    </div>
  );
}
