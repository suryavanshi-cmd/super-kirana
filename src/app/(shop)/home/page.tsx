'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { DueTag, EmptyState, ErrorBox, Icon, SearchBox, Skeleton, StaleNote } from '@/components/ui';
import { matches, prefetch } from '@/lib/data';
import { rpc } from '@/lib/api';
import { relativeDay, useI18n } from '@/lib/i18n';
import { useShop } from '@/lib/session';
import { useCustomers } from '@/lib/lists';
import { useQuickEntry } from '@/components/quick-entry';

/** The whole app for a shopkeeper: two actions and the list of who owes what. */
export default function HomePage() {
  const { t } = useI18n();
  const { shop, scope } = useShop();
  const list = useCustomers();
  const [q, setQ] = useState('');
  const rows = useMemo(() => {
    const all = list.data ?? [];
    const shown = q.trim() ? all.filter((c) => matches(q, c.name, c.mobile)) : all.filter((c) => c.balance_paise > 0);
    return [...shown].sort((a, b) => b.balance_paise - a.balance_paise);   // largest dues first
  }, [list.data, q]);
  const openEntry = useQuickEntry();
  const big = (testid: string, icon: string, label: string, hint: string, onClick: () => void, primary = false) => (
    <button type="button" onClick={onClick} data-testid={testid}
      className={`flex min-h-20 w-full items-center gap-4 rounded-2xl p-4 text-left shadow-[0_1px_3px_rgba(16,24,40,.10)] ${primary ? 'bg-brand-600 text-white' : 'bg-white text-ink'}`}>
      <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${primary ? 'bg-white/20' : 'bg-brand-50 text-brand-700'}`}><Icon name={icon} className="h-7 w-7" /></span>
      <span className="min-w-0"><span className="block text-lg font-bold leading-tight">{label}</span><span className={`block text-sm ${primary ? 'text-white/85' : 'text-muted'}`}>{hint}</span></span>
    </button>
  );

  return (
    <div>
      {/* The three everyday jobs. Each opens the quick entry with the keyboard already up. */}
      <div className="grid gap-3">
        {big('home-new', 'userPlus', t('home.newCust'), t('home.newCustHint'), () => openEntry('new'), true)}
        {big('home-existing', 'plus', t('home.addExisting'), t('home.addExistingHint'), () => openEntry('existing'))}
        {big('home-update', 'edit', t('home.updateExisting'), t('home.updateExistingHint'), () => openEntry('update'))}
      </div>

      <section className="mt-4 overflow-hidden rounded-2xl bg-white shadow-[0_1px_3px_rgba(16,24,40,.08)]">
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
