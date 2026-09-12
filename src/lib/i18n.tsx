import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Lang = 'pl' | 'en';

const STORAGE_KEY = 'alfa_lang';

type Dict = Record<string, { pl: string; en: string }>;

export const TRANSLATIONS: Dict = {
  'nav.dashboard': { pl: 'Dashboard', en: 'Dashboard' },
  'nav.rc21': { pl: 'RC2.1 Safety', en: 'RC2.1 Safety' },
  'nav.filters': { pl: 'Filtry — Docs', en: 'Filters — Docs' },
  'nav.spec': { pl: 'Filter Spec', en: 'Filter Spec' },
  'nav.simulator': { pl: 'Symulator & NDI', en: 'Simulator & NDI' },
  'nav.models': { pl: 'Provider Manager', en: 'Provider Manager' },
  'nav.analysis': { pl: 'Live Analysis', en: 'Live Analysis' },
  'nav.chat': { pl: 'Dual Chat', en: 'Dual Chat' },
  'nav.benchmark': { pl: 'Benchmark Lab', en: 'Benchmark Lab' },
  'nav.incidents': { pl: 'Incydenty', en: 'Incidents' },
  'nav.llm': { pl: 'LLM Self-Test', en: 'LLM Self-Test' },
  'nav.diagnostics': { pl: 'Diagnostyka', en: 'Diagnostics' },
  'sidebar.subtitle': { pl: 'Pipeline Control', en: 'Pipeline Control' },
  'sidebar.footer': { pl: 'Pipeline niezależny od modelu', en: 'Model-agnostic pipeline' },
  'lang.label': { pl: 'Język', en: 'Language' },
  'lang.pl': { pl: 'Polski', en: 'Polish' },
  'lang.en': { pl: 'Angielski', en: 'English' },
};

function readLang(): Lang {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'pl' || v === 'en') return v;
  } catch {
    /* ignore */
  }
  return 'pl';
}

type I18nValue = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string) => string;
};

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readLang);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* ignore */
    }
  }, []);

  const t = useCallback(
    (key: string) => {
      const entry = TRANSLATIONS[key];
      if (!entry) return key;
      return entry[lang] ?? entry.pl;
    },
    [lang],
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}
