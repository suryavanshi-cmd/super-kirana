'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppError, authAdmin, rpc, type Context, type Role, type ShopRef } from './api';
import { clearMemoryCache } from './cache';
import { idbClearAll } from './idb';
import { useI18n } from './i18n';
import { supabase } from './supabase';

type Status = 'loading' | 'signedOut' | 'ready';
interface Session {
  status: Status;
  ctx: Context | null;
  shop: ShopRef | null;
  role: Role | null;
  isOwner: boolean;
  offlineContext: boolean;           // context came from this device because the server was unreachable
  signIn: (username: string, password: string) => Promise<void>;
  demoSignIn: (code: string) => Promise<void>;
  signOut: (reason?: 'idle') => Promise<void>;
  selectShop: (id: string | null) => void;
  refresh: () => Promise<void>;
}
const Ctx = createContext<Session | null>(null);

const K = { ctx: 'sk.ctx', shop: 'sk.shop', lastUser: 'sk.lastUser', activity: 'sk.activity', notice: 'sk.notice' };
const IDLE_LIMIT_MS = 12 * 60 * 60 * 1000;

/** Removes everything this app stored on the device (except the language choice). */
export async function wipeLocalData(): Promise<void> {
  clearMemoryCache();
  await idbClearAll();
  for (const k of [K.ctx, K.shop, K.activity]) localStorage.removeItem(k);
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const { setLocale } = useI18n();
  const [status, setStatus] = useState<Status>('loading');
  const [ctx, setCtx] = useState<Context | null>(null);
  const [shopId, setShopId] = useState<string | null>(null);
  const [offlineContext, setOfflineContext] = useState(false);
  const loading = useRef(false);

  const load = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      const { data } = await supabase().auth.getSession();
      const user = data.session?.user;
      if (!user) { setCtx(null); setStatus('signedOut'); return; }
      // A different person signing in on this device must never see the previous person's data.
      const last = localStorage.getItem(K.lastUser);
      if (last && last !== user.id) await wipeLocalData();
      localStorage.setItem(K.lastUser, user.id);
      // Instant start: open the app at once with the last known access for this same user, and
      // confirm it with the server in the background (a revoked user is signed out a moment later;
      // the database itself still checks every read and write).
      try {
        const known = localStorage.getItem(K.ctx);
        const parsed = known ? (JSON.parse(known) as Context) : null;
        if (parsed?.user_id === user.id && !parsed.must_change_password) {
          setCtx((c) => c ?? parsed);
          setShopId((x) => x ?? localStorage.getItem(K.shop));
          setStatus((st) => (st === 'loading' ? 'ready' : st));
        }
      } catch { /* damaged copy: wait for the server */ }
      try {
        const c = await rpc<Context>('my_context');
        localStorage.setItem(K.ctx, JSON.stringify(c));
        // Remember the only shop, so gaining access to a second one later does not interrupt work.
        if (!localStorage.getItem(K.shop) && c.shops.length === 1) localStorage.setItem(K.shop, c.shops[0].id);
        setCtx(c); setOfflineContext(false);
        if (!localStorage.getItem('sk.lang')) setLocale(c.preferred_language);
      } catch (e) {
        const cached = localStorage.getItem(K.ctx);
        const parsed = cached ? (JSON.parse(cached) as Context) : null;
        if (e instanceof AppError && e.kind === 'network' && parsed?.user_id === user.id) {
          setCtx(parsed); setOfflineContext(true);
        } else if (e instanceof AppError && e.kind === 'network') {
          setCtx(null); setStatus('signedOut'); return;
        } else {
          await supabase().auth.signOut({ scope: 'local' });
          await wipeLocalData();
          setCtx(null); setStatus('signedOut'); return;
        }
      }
      setShopId(localStorage.getItem(K.shop));
      localStorage.setItem(K.activity, String(Date.now()));
      setStatus('ready');
    } finally { loading.current = false; }
  }, [setLocale]);

  useEffect(() => { void load(); }, [load]);

  const signOut = useCallback(async (reason?: 'idle') => {
    await supabase().auth.signOut({ scope: 'local' }).catch(() => undefined);
    await wipeLocalData();
    if (reason) sessionStorage.setItem(K.notice, reason);
    setCtx(null); setShopId(null); setStatus('signedOut');
  }, []);

  // Idle timeout + re-check of access whenever the app comes back to the foreground or online.
  useEffect(() => {
    if (status !== 'ready') return;
    const touch = () => localStorage.setItem(K.activity, String(Date.now()));
    const check = () => {
      if (Date.now() - Number(localStorage.getItem(K.activity) ?? Date.now()) > IDLE_LIMIT_MS) void signOut('idle');
    };
    const onVisible = () => { if (document.visibilityState === 'visible') { check(); void load(); } };
    const onOnline = () => void load();
    window.addEventListener('pointerdown', touch); window.addEventListener('keydown', touch);
    document.addEventListener('visibilitychange', onVisible); window.addEventListener('online', onOnline);
    const timer = setInterval(check, 60_000);
    return () => {
      window.removeEventListener('pointerdown', touch); window.removeEventListener('keydown', touch);
      document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('online', onOnline);
      clearInterval(timer);
    };
  }, [status, signOut, load]);

  const signIn = useCallback(async (username: string, password: string) => {
    const s = await authAdmin<{ access_token: string; refresh_token: string }>('login', { username, password });
    const { error } = await supabase().auth.setSession(s);
    if (error) throw new AppError('INVALID_CREDENTIALS', 'auth');
    await load();
  }, [load]);

  /** Demo code → the demo shop, in English. No username or password. */
  const demoSignIn = useCallback(async (code: string) => {
    const s = await authAdmin<{ access_token: string; refresh_token: string }>('demo-login', { code });
    await wipeLocalData();
    const { error } = await supabase().auth.setSession(s);
    if (error) throw new AppError('INVALID_DEMO_CODE', 'auth');
    setLocale('en-IN');
    await load();
  }, [load, setLocale]);

  const selectShop = useCallback((id: string | null) => {
    if (id) localStorage.setItem(K.shop, id); else localStorage.removeItem(K.shop);
    setShopId(id);
  }, []);

  const value = useMemo<Session>(() => {
    const shops = ctx?.shops ?? [];
    const shop = shops.find((s) => s.id === shopId) ?? (shops.length === 1 ? shops[0] : null);
    return { status, ctx, shop, role: shop?.role ?? null, isOwner: shop?.role === 'owner', offlineContext, signIn, demoSignIn, signOut, selectShop, refresh: load };
  }, [status, ctx, shopId, offlineContext, signIn, demoSignIn, signOut, selectShop, load]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const v = useContext(Ctx);
  if (!v) throw new Error('SessionProvider missing');
  return v;
}

/** For screens inside a shop: the shop is guaranteed by the layout guard. */
export function useShop(): { shop: ShopRef; userId: string; isOwner: boolean; scope: string } {
  const { shop, ctx, isOwner } = useSession();
  if (!shop || !ctx) throw new Error('no shop selected');
  return { shop, userId: ctx.user_id, isOwner, scope: `${ctx.user_id}:${shop.id}:` };
}

export function consumeNotice(): string | null {
  const n = sessionStorage.getItem(K.notice);
  if (n) sessionStorage.removeItem(K.notice);
  return n;
}
