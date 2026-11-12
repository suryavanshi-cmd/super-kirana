'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { DueTag, EmptyState, ErrorBox, Icon, Money, SearchBox, Section, Skeleton, StaleNote } from '@/components/ui';
import { matches } from '@/lib/data';
import { relativeDay, useI18n } from '@/lib/i18n';
import { useShop } from '@/lib/session';
import { useCustomers } from '@/lib/lists';

/** The whole app for a shopkeeper: two actions and the list of who owes what. */
export default function HomePage() {
  const { t } = useI18n();
  const { shop } = useShop();
  const list = useCustomers();
  const [q, setQ] = useState('');
  const rows = useMemo(() => {
    const all = list.data ?? [];
    const shown = q.trim() ? all.filter((c) => matches(q, c.name, c.mobile)) : all.filter((c) => c.balance_paise > 0);
    return [...shown].sort((a, b) => b.balance_paise - a.balance_paise);   // largest dues first
  }, [list.data, q]);
  const total = (list.data ?? []).reduce((s, c) => s + Math.max(c.balance_paise, 0), 0);

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Link href="/udhari" className="flex min-h-24 items-center gap-4 rounded-2xl bg-brand-600 p-4 text-white hover:bg-brand-700">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/15"><Icon name="plus" className="h-8 w-8" /></span>
          <span><span className="block text-xl font-bold">{t('home.udhari')}</span><span className="block text-sm text-white/85">{t('home.udhariHint')}</span></span>
        </Link>
        <Link href="/scan" className="flex min-h-24 items-center gap-4 rounded-2xl border-2 border-brand-600 p-4 text-brand-800 hover:bg-brand-50">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-brand-50"><Icon name="camera" className="h-8 w-8" /></span>
          <span><span className="block text-xl font-bold">{t('home.scan')}</span><span className="block text-sm text-muted">{t('home.scanHint')}</span></span>
        </Link>
      </div>

      <Section title={t('home.customersDue')} action={list.data && total > 0 ? <span className="text-sm font-semibold text-due">{t('c.total')} <Money paise={total} /></span> : undefined}>
        <SearchBox value={q} onChange={setQ} placeholder={t('home.search')} />
        <StaleNote show={list.stale} />
        {!list.data && list.loading && <Skeleton lines={4} />}
        {!list.data && <ErrorBox error={list.error} onRetry={list.reload} />}
        {list.data && rows.length === 0 && (
          q.trim() ? <EmptyState icon="search" title={t('cust.noMatch')} /> : <EmptyState icon="check" title={t('home.noPending')} hint={t('home.addFirst')} />
        )}
        <ul className="mt-2 divide-y divide-line" data-testid="pending-list">
          {rows.map((c) => (
            <li key={c.id}>
              <Link href={`/customers/${c.id}`} className="flex min-h-16 items-center gap-3 py-2 hover:bg-slate-50">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-50 text-lg font-bold text-brand-800" aria-hidden="true">{[...c.name][0]}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{c.name}</span>
                  <span className="block truncate text-sm text-muted">{[c.mobile, c.last_at ? `${t('when.last')}: ${relativeDay(c.last_at, t, shop.timezone)}` : null].filter(Boolean).join(' · ')}</span>
                </span>
                <DueTag paise={c.balance_paise} />
              </Link>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
