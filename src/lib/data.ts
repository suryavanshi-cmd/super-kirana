'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppError } from './api';
import { FRESH_MS, load, mem } from './cache';
import { idbGet, idbSet } from './idb';
import { soundsLike } from './translit';

export interface Query<T> { data: T | undefined; error: AppError | null; loading: boolean; stale: boolean; reload: () => Promise<void> }

/** Fetches in the background so the next screen opens instantly. Errors are ignored here. */
export function prefetch<T>(key: string, fetcher: () => Promise<T>, persist = false): void {
  const hit = mem.get(key);
  if (hit && Date.now() - hit.at < 30_000) return;
  void load(key, fetcher).then((d) => { if (persist) void idbSet('cache', key, d); }, () => undefined);
}

export { clearMemoryCache, invalidate } from './cache';

/**
 * Loads data from the server. With `cacheKey`, the last answer is shown immediately (from memory,
 * or from the device when `persist`), and refreshed in the background.
 */
export function useQuery<T>(fetcher: (() => Promise<T>) | null, deps: unknown[], cacheKey?: string, opts: { persist?: boolean } = {}): Query<T> {
  const persist = opts.persist ?? true;
  const initial = () => {
    const hit = cacheKey && fetcher ? mem.get(cacheKey) : undefined;
    return { data: hit?.data as T | undefined, error: null as AppError | null, loading: !!fetcher, stale: false };
  };
  const [state, setState] = useState(initial);
  const seq = useRef(0);
  const fn = useRef(fetcher);
  fn.current = fetcher;
  const keyRef = useRef(cacheKey);
  keyRef.current = cacheKey;

  const run = useCallback(async (force: boolean) => {
    const my = ++seq.current;
    const key = keyRef.current;
    if (!fn.current) { setState({ data: undefined, error: null, loading: false, stale: false }); return; }
    const hit = key ? mem.get(key) : undefined;
    if (hit) {
      setState({ data: hit.data as T, error: null, loading: true, stale: false });
      if (!force && Date.now() - hit.at < FRESH_MS) { setState((s) => ({ ...s, loading: false })); return; }
    } else {
      setState((s) => ({ ...s, loading: true, error: null }));
      if (key && persist) {
        const cached = await idbGet<T>('cache', key);
        if (my === seq.current && cached !== undefined) setState((s) => (s.data === undefined ? { ...s, data: cached, stale: true } : s));
      }
    }
    try {
      const data = await load(key, fn.current);
      if (my !== seq.current) return;
      setState({ data, error: null, loading: false, stale: false });
      if (key && persist) void idbSet('cache', key, data);
    } catch (e) {
      if (my !== seq.current) return;
      const err = e instanceof AppError ? e : new AppError('UNKNOWN', 'server', e instanceof Error ? e.message : String(e));
      setState((s) => ({ data: s.data, error: err, loading: false, stale: s.data !== undefined }));
    }
  }, [persist]);

  const reload = useCallback(() => run(true), [run]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const hit = keyRef.current && fn.current ? mem.get(keyRef.current) : undefined;
    if (!hit) setState({ data: undefined, error: null, loading: !!fn.current, stale: false });
    void run(false);
  }, deps);
  return { ...state, reload };
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update); window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);
  return online;
}

/** Case-insensitive match that works for Devanagari and Latin text and for phone digits. */
export function matches(query: string, ...fields: (string | null | undefined)[]): boolean {
  const q = query.normalize('NFC').toLowerCase().trim();
  if (!q) return true;
  const digits = q.replace(/[\s-]/g, '');
  return fields.some((f) => !!f && (
    f.normalize('NFC').toLowerCase().includes(q)
    || (/^\+?\d{3,}$/.test(digits) && f.replace(/[\s-]/g, '').includes(digits))   // phone typed with or without spaces
    || soundsLike(q, f)));                                                         // "suresh" finds सुरेश
}
