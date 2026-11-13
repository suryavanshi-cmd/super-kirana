'use client';
import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';
import { DueTag, EmptyState, ErrorBox, Icon, Money, SearchBox, Skeleton, StaleNote } from '@/components/ui';
import { matches, prefetch } from '@/lib/data';
import { rpc } from '@/lib/api';
import { relativeDay, todayIn, useI18n } from '@/lib/i18n';
import { useShop } from '@/lib/session';
import { useInsights } from '@/lib/store';
import { useCustomers } from '@/lib/lists';

/** The whole app for a shopkeeper: two actions and the list of who owes what. */
export default function HomePage() {
  const { t } = useI18n();
  const { shop, isOwner, scope } = useShop();
  const list = useCustomers();
  const [q, setQ] = useState('');
  const rows = useMemo(() => {
    const all = list.data ?? [];
    const shown = q.trim() ? all.filter((c) => matches(q, c.name, c.mobile)) : all.filter((c) => c.balance_paise > 0);
    return [...shown].sort((a, b) => b.balance_paise - a.balance_paise);   // largest dues first
  }, [list.data, q]);
  const get = (list.data ?? []).reduce((s, c) => s + Math.max(c.balance_paise, 0), 0);
  const give = (list.data ?? []).reduce((s, c) => s + Math.max(-c.balance_paise, 0), 0);
  const action = (href: string, icon: string, label: string, testid?: string) => (
    <Link href={href} data-testid={testid} className="flex min-w-0 flex-col items-center gap-1.5 rounded-2xl p-2 text-center hover:bg-brand-50">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-700"><Icon name={icon} className="h-6 w-6" /></span>
      <span className="line-clamp-2 text-xs font-semibold leading-tight text-ink">{label}</span>
    </Link>
  );

  return (
    <div>
      {/* You'll get / You'll give — the first thing a shopkeeper looks for. */}
      <div className="-mx-4 -mt-4 bg-brand-700 px-4 pb-12 pt-1" />
      <div className="-mt-12 rounded-2xl bg-white p-4 shadow-[0_2px_10px_rgba(16,24,40,.10)]" data-testid="khata-summary">
        <div className="grid grid-cols-2 divide-x divide-line">
          <div className="pr-3">
            <p className="text-sm text-muted">{t('home.youGet')}</p>
            <p className="text-2xl font-bold text-due" data-testid="total-get">{list.data ? <Money paise={get} /> : '—'}</p>
          </div>
          <div className="pl-3">
            <p className="text-sm text-muted">{t('home.youGive')}</p>
            <p className="text-2xl font-bold text-got">{list.data ? <Money paise={give} /> : '—'}</p>
          </div>
        </div>
        <Link href={isOwner ? '/store' : '/reports'} className="mt-3 flex min-h-11 items-center justify-center gap-1 border-t border-line pt-2 text-sm font-bold text-brand-700">
          {t('home.viewReport')} <Icon name="chevron" className="h-4 w-4" />
        </Link>
      </div>

      <div className="mt-3 grid grid-cols-4 gap-1 rounded-2xl bg-white p-2 shadow-[0_1px_3px_rgba(16,24,40,.08)]" aria-label={t('home.actions')}>
        {action('/udhari', 'plus', t('home.udhari'))}
        {action('/collect', 'rupee', t('fab.collect'))}
        {action('/scan', 'camera', t('home.scan'))}
        {action('/voice', 'mic', t('home.voice'), 'voice-entry')}
      </div>

      {isOwner && <div className="mt-3"><TodayCard /></div>}

      <section className="mt-3 overflow-hidden rounded-2xl bg-white shadow-[0_1px_3px_rgba(16,24,40,.08)]">
        <div className="flex items-center justify-between gap-2 px-3 pt-3">
          <h2 className="text-base font-bold">{t('home.customersDue')}</h2>
          <Link href="/customers" className="text-sm font-bold text-brand-700">{t('nav.customers')}</Link>
        </div>
        <div className="p-3 pb-1"><SearchBox value={q} onChange={setQ} placeholder={t('home.search')} /></div>
        <div className="px-3"><StaleNote show={list.stale} /></div>
        {!list.data && list.loading && <div className="px-3"><Skeleton lines={4} /></div>}
        {!list.data && <div className="px-3"><ErrorBox error={list.error} onRetry={list.reload} /></div>}
        {list.data && rows.length === 0 && (
          q.trim() ? <EmptyState icon="search" title={t('cust.noMatch')} /> : <EmptyState icon="check" title={t('home.noPending')} hint={t('home.addFirst')} />
        )}
        <ul className="divide-y divide-line" data-testid="pending-list">
          {rows.map((c) => (
            <li key={c.id}>
              <Link href={`/customers/${c.id}`} onPointerDown={() => prefetch(`${scope}customer:${c.id}`, () => rpc('get_customer', { p_shop_id: shop.id, p_customer_id: c.id }), true)}
                className="flex min-h-16 items-center gap-3 px-3 py-2.5 hover:bg-slate-50">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-100 text-lg font-bold text-brand-800" aria-hidden="true">{[...c.name][0]}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{c.name}</span>
                  <span className="block truncate text-xs text-muted">{c.last_at ? relativeDay(c.last_at, t, shop.timezone) : c.mobile}</span>
                </span>
                <DueTag paise={c.balance_paise} />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/** The owner's day at a glance, right on the first screen; tap for the full shop accounts. */
function TodayCard() {
  const { t } = useI18n();
  const { shop } = useShop();
  const today = todayIn(shop.timezone);
  const q = useInsights(today, today);
  const d = q.data;
  const cell = (label: string, value: ReactNode, tone = '') => (
    <div className="min-w-0"><p className="truncate text-xs text-white/80">{label}</p><p className={`truncate text-lg font-bold ${tone}`}>{value}</p></div>
  );
  return (
    <Link href="/store" className="block rounded-2xl bg-gradient-to-br from-brand-700 to-brand-600 p-4 text-white shadow-sm" data-testid="today-card">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 font-bold"><Icon name="chart" className="h-5 w-5" />{t('home.todayCard')}</span>
        <span className="flex items-center text-sm font-semibold text-white/90">{t('home.openStore')}<Icon name="chevron" className="h-4 w-4" /></span>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cell(t('st.sales'), d ? <Money paise={d.totals.net_sales_paise} /> : '—')}
        {cell(t('st.collected'), d ? <Money paise={d.totals.net_collections_paise} /> : '—')}
        {cell(t('st.bills'), d ? d.totals.bills : '—')}
        {cell(t('st.dues'), d ? <Money paise={d.dues.total_paise} /> : '—')}
      </div>
      {d && d.low_stock.length > 0 && <p className="mt-2 inline-block rounded-full bg-white/20 px-2 py-0.5 text-xs font-bold">{t('st.lowStock', { n: d.low_stock.length })}</p>}
    </Link>
  );
}
