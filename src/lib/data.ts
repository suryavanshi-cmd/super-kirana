'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppError } from './api';
import { idbGet, idbSet } from './idb';
import { soundsLike } from './translit';

export interface Query<T> { data: T | undefined; error: AppError | null; loading: boolean; stale: boolean; reload: () => Promise<void> }

/**
 * Loads data from the server. With `cacheKey`, the last good copy is kept on the device and shown
 * (marked stale) while loading or when the network is down.
 */
export function useQuery<T>(fetcher: (() => Promise<T>) | null, deps: unknown[], cacheKey?: string): Query<T> {
  const [state, setState] = useState<{ data: T | undefined; error: AppError | null; loading: boolean; stale: boolean }>(
    { data: undefined, error: null, loading: true, stale: false });
  const seq = useRef(0);
  const fn = useRef(fetcher);
  fn.current = fetcher;

  const reload = useCallback(async () => {
    const my = ++seq.current;
    if (!fn.current) { setState({ data: undefined, error: null, loading: false, stale: false }); return; }
    setState((s) => ({ ...s, loading: true, error: null }));
    if (cacheKey) {
      const cached = await idbGet<T>('cache', cacheKey);
      if (my === seq.current && cached !== undefined) setState((s) => (s.data === undefined ? { ...s, data: cached, stale: true } : s));
    }
    try {
      const data = await fn.current();
      if (my !== seq.current) return;
      setState({ data, error: null, loading: false, stale: false });
      if (cacheKey) void idbSet('cache', cacheKey, data);
    } catch (e) {
      if (my !== seq.current) return;
      const err = e instanceof AppError ? e : new AppError('UNKNOWN', 'server');
      setState((s) => ({ data: s.data, error: err, loading: false, stale: s.data !== undefined }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setState({ data: undefined, error: null, loading: true, stale: false }); void reload(); }, deps);
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
