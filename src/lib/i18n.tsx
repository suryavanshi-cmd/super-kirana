'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { DEFAULT_LOCALE, dictionaries, type Key, type Locale } from './dictionary';

const STORAGE_KEY = 'sk.lang';
interface I18n { locale: Locale; t: (key: Key, vars?: Record<string, string | number>) => string; setLocale: (l: Locale) => void }
const Ctx = createContext<I18n | null>(null);

export function translate(locale: Locale, key: Key, vars?: Record<string, string | number>): string {
  let s = dictionaries[locale][key] ?? dictionaries[DEFAULT_LOCALE][key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  // Marathi on the very first visit; afterwards the choice saved on this device.
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'mr-IN' || saved === 'en-IN') setLocaleState(saved);
  }, []);
  useEffect(() => { document.documentElement.lang = locale === 'mr-IN' ? 'mr' : 'en'; }, [locale]);
  const setLocale = useCallback((l: Locale) => { localStorage.setItem(STORAGE_KEY, l); setLocaleState(l); }, []);
  const value = useMemo<I18n>(() => ({ locale, setLocale, t: (k, v) => translate(locale, k, v) }), [locale, setLocale]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error('I18nProvider missing');
  return v;
}

/** Localised message for a server/application error code. */
export function errorKey(code: string): Key {
  const k = `err.${code}` as Key;
  return k in dictionaries[DEFAULT_LOCALE] ? k : 'err.UNKNOWN';
}

/** Dates are shown in the shop's timezone with Latin digits in both languages. */
export function formatDateTime(iso: string, locale: Locale, timeZone = 'Asia/Kolkata', withTime = true): string {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00+05:30` : iso);
  return new Intl.DateTimeFormat(locale === 'mr-IN' ? 'mr-IN-u-nu-latn' : 'en-IN', {
    timeZone, day: '2-digit', month: 'short', year: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit', hour12: true } : {}),
  }).format(d);
}

export function todayIn(timeZone = 'Asia/Kolkata', offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
