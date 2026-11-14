'use client';
// Home, khata style: what you will give / get, then every customer with their balance.
// Tap a customer to add credit ("You gave") or take a payment ("You got"); "Add customer" opens the
// quick entry with the keyboard already up.
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { EmptyState, ErrorBox, Icon, Money, Skeleton, StaleNote } from '@/components/ui';
import { matches, prefetch } from '@/lib/data';
import { rpc, type CustomerRow } from '@/lib/api';
import { relativeTime, useI18n } from '@/lib/i18n';
import { useShop } from '@/lib/session';
import { useCustomers } from '@/lib/lists';
import { useQuickEntry } from '@/components/quick-entry';

type Sort = 'recent' | 'amount' | 'name';
const SORTS: Sort[] = ['recent', 'amount', 'name'];
const AVATAR = ['bg-sky-600', 'bg-indigo-500', 'bg-teal-600', 'bg-amber-600', 'bg-rose-500', 'bg-violet-500', 'bg-emerald-600', 'bg-blue-500'];
const avatar = (name: string) => AVATAR[[...name].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % AVATAR.length];
const card = 'rounded-2xl bg-white shadow-[0_1px_3px_rgba(16,24,40,.08)]';

export default function HomePage() {
  const { t } = useI18n();
  const { shop, scope, isOwner } = useShop();
  const list = useCustomers();
  const openEntry = useQuickEntry();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('recent');

  const all = list.data;
  const get = (all ?? []).reduce((s, c) => s + Math.max(c.balance_paise, 0), 0);
  const give = (all ?? []).reduce((s, c) => s + Math.max(-c.balance_paise, 0), 0);
  const rows = useMemo(() => {
    const shown = (all ?? []).filter((c) => !q.trim() || matches(q, c.name, c.mobile));
    const at = (c: CustomerRow) => (c.last_at ? Date.parse(c.last_at) : 0);
    return [...shown].sort((a, b) => sort === 'amount' ? Math.abs(b.balance_paise) - Math.abs(a.balance_paise)
      : sort === 'name' ? a.name.localeCompare(b.name) : at(b) - at(a));
  }, [all, q, sort]);
  const nextSort = () => setSort((s) => SORTS[(SORTS.indexOf(s) + 1) % SORTS.length]);

  return (
    <div>
      {/* You will give / You will get */}
      <section className={`${card} overflow-hidden`} data-testid="khata-summary">
        <div className="grid grid-cols-2 divide-x divide-line py-3 text-center">
          <div>
            <p className="text-sm text-muted">{t('home.willGive')}</p>
            <p className="mt-0.5 text-xl font-bold text-got"><Money paise={give} short /></p>
          </div>
          <div>
            <p className="text-sm text-muted">{t('home.willGet')}</p>
            <p className={`mt-0.5 text-xl font-bold ${get > 0 ? 'text-due' : ''}`} data-testid="total-get"><Money paise={get} short /></p>
          </div>
        </div>
        <div className="grid grid-cols-2 border-t border-line text-xs font-bold uppercase tracking-wide">
          <Link href={isOwner ? '/store' : '/reports'} className="flex min-h-11 items-center justify-center gap-1.5 text-brand-700"><Icon name="chart" className="h-4 w-4" />{t('home.viewReport')}</Link>
          <Link href="/reports" className="flex min-h-11 items-center justify-center gap-1.5 border-l border-line text-brand-700"><Icon name="book" className="h-4 w-4" />{t('home.cashbook')}</Link>
        </div>
      </section>

      {/* Search · sort · PDF */}
      <div className="no-print mt-3 flex items-center gap-2">
        <label className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-full bg-white px-4 shadow-[0_1px_3px_rgba(16,24,40,.08)]">
          <Icon name="search" className="h-5 w-5 shrink-0 text-muted" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('home.searchCustomer')} aria-label={t('home.searchCustomer')}
            className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted" data-testid="home-search" />
        </label>
        <button type="button" onClick={nextSort} aria-label={t('home.sort', { n: t(`home.sort.${sort}`) })} title={t(`home.sort.${sort}`)}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-ink shadow-[0_1px_3px_rgba(16,24,40,.08)]" data-testid="home-sort"><Icon name="sort" className="h-5 w-5" /></button>
        <button type="button" onClick={() => window.print()} aria-label={t('home.pdf')}
          className="flex h-11 items-center justify-center rounded-xl border-2 border-muted/60 bg-white px-2 text-xs font-bold text-muted">PDF</button>
      </div>
      <p className="no-print mt-1 px-2 text-xs text-muted">{t('home.sortedBy', { n: t(`home.sort.${sort}`) })}</p>

      {/* Customers */}
      <div className="mt-1"><StaleNote show={list.stale} /></div>
      {!all && list.loading && <Skeleton lines={4} />}
      {!all && <ErrorBox error={list.error} onRetry={list.reload} />}
      {all && rows.length === 0 && (q.trim() ? <EmptyState icon="search" title={t('cust.noMatch')} /> : <EmptyState icon="users" title={t('home.noCustomers')} hint={t('home.addFirst')} />)}
      {rows.length > 0 && (
        <ul className={`${card} mt-1 divide-y divide-line overflow-hidden`} data-testid="pending-list">
          {rows.map((c) => (
            <li key={c.id}>
              <Link href={`/customers/${c.id}`} onPointerDown={() => prefetch(`${scope}customer:${c.id}`, () => rpc('get_customer', { p_shop_id: shop.id, p_customer_id: c.id }), true)}
                className="flex min-h-[4.25rem] items-center gap-3 px-3 py-2 hover:bg-slate-50">
                <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg font-bold text-white ${avatar(c.name)}`} aria-hidden="true">{[...c.name][0]?.toUpperCase()}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-base font-semibold">{c.name}</span>
                  <span className="block truncate text-sm text-muted">{c.last_at ? relativeTime(c.last_at, t) : c.mobile ?? ''}</span>
                </span>
                <span className="shrink-0 text-right leading-tight">
                  <span className={`block text-base font-bold ${c.balance_paise > 0 ? 'text-due' : c.balance_paise < 0 ? 'text-got' : ''}`}><Money paise={Math.abs(c.balance_paise)} short /></span>
                  {c.balance_paise !== 0 && <span className="block text-xs text-muted">{c.balance_paise > 0 ? t('home.youGet') : t('home.youGive')}</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {/* Add customer */}
      <button type="button" onClick={() => openEntry('new')} data-testid="home-new"
        className="no-print fixed bottom-[calc(var(--fab-offset,0px)+1rem)] right-4 z-50 flex h-14 items-center gap-2 rounded-full bg-brand-600 px-5 text-base font-bold text-white shadow-xl"
        style={{ marginBottom: 'env(safe-area-inset-bottom)' }}>
        <Icon name="userPlus" className="h-6 w-6" />{t('home.addCustomer')}
      </button>
    </div>
  );
}
