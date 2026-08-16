/**
 * Locale context for the renderer. Wraps the shared translator so components call
 * `t('key')` without threading the locale through props.
 */

import { createContext, useContext, useMemo, useState, useEffect, type ReactNode } from 'react';
import { createTranslator, DEFAULT_LOCALE, type Locale } from '../../shared/i18n.ts';

interface I18nValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nValue>({
  locale: DEFAULT_LOCALE,
  setLocale: () => {},
  t: createTranslator(DEFAULT_LOCALE),
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    void window.ella.config.get().then((config) => setLocaleState(config.locale));
  }, []);

  const value = useMemo<I18nValue>(
    () => ({
      locale,
      setLocale: (next) => {
        setLocaleState(next);
        void window.ella.config.set({ locale: next });
      },
      t: createTranslator(locale),
    }),
    [locale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = (): I18nValue => useContext(I18nContext);
