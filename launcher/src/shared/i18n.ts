/**
 * Minimal i18n. No dependency: two locales and flat key lookup do not justify one.
 *
 * Every user-facing string in Ella goes through `t()`. Code, comments and identifiers
 * stay English; only display text is translated.
 */

import en from '../../locales/en.json' with { type: 'json' };
import fr from '../../locales/fr.json' with { type: 'json' };

export const LOCALES = ['en', 'fr'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  fr: 'Français',
};

type Catalog = Record<string, string>;

const catalogs: Record<Locale, Catalog> = {
  en: en as Catalog,
  fr: fr as Catalog,
};

export const isLocale = (value: string): value is Locale =>
  (LOCALES as readonly string[]).includes(value);

/** Maps a system locale such as `fr-FR` onto a supported one. */
export function resolveLocale(systemLocale: string | undefined): Locale {
  if (!systemLocale) return DEFAULT_LOCALE;
  const base = systemLocale.toLowerCase().split(/[-_]/)[0];
  return isLocale(base) ? base : DEFAULT_LOCALE;
}

/** `{name}` placeholders are replaced by the matching key in `params`. */
function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in params ? String(params[key]) : match,
  );
}

/**
 * This module is imported by the main process, the renderer and the tests, so it cannot
 * assume `process` exists. Reading it off `globalThis` keeps the check working under Node
 * and harmlessly false in the browser.
 */
const isProduction =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
    ?.NODE_ENV === 'production';

export function translate(
  locale: Locale,
  key: string,
  params?: Record<string, string | number>,
): string {
  const message = catalogs[locale]?.[key] ?? catalogs[DEFAULT_LOCALE][key];
  if (message === undefined) {
    // Surfacing the raw key beats showing nothing, and makes gaps obvious in review.
    if (!isProduction) console.warn(`[i18n] missing key: ${key}`);
    return key;
  }
  return interpolate(message, params);
}

/** Binds a locale so callers can write `t('key')`. */
export function createTranslator(locale: Locale) {
  return (key: string, params?: Record<string, string | number>): string =>
    translate(locale, key, params);
}

/**
 * Reports keys present in English but missing from another locale. Used by a test so a
 * new English string cannot land without its French counterpart.
 */
export function missingKeys(locale: Locale): string[] {
  return Object.keys(catalogs[DEFAULT_LOCALE]).filter((key) => !(key in catalogs[locale]));
}

/** Reports keys in a locale that no longer exist in English. */
export function orphanKeys(locale: Locale): string[] {
  return Object.keys(catalogs[locale]).filter((key) => !(key in catalogs[DEFAULT_LOCALE]));
}
