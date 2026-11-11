'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';
import { DueTag, EmptyState, ErrorBox, Icon, LinkButton, PageHeader, SearchBox, Skeleton, StaleNote } from '@/components/ui';
import { matches } from '@/lib/data';
import { useI18n } from '@/lib/i18n';
import { useCustomers } from '@/lib/lists';

function CustomerList() {
  const { t } = useI18n();
  const pickPay = useSearchParams().get('pick') === 'pay';
  const list = useCustomers();
  const [q, setQ] = useState('');
  const [onlyDue, setOnlyDue] = useState(pickPay);
  const rows = useMemo(() => (list.data ?? []).filter((c) => (!onlyDue || c.balance_paise > 0) && matches(q, c.name, c.mobile))
    .sort((a, b) => Number(b.is_active) - Number(a.is_active)), [list.data, q, onlyDue]);
  return (
    <div>
      <PageHeader title={pickPay ? t('pay.pickCustomer') : t('cust.title')} back={pickPay ? '/home' : undefined}
        action={!pickPay && <LinkButton href="/customers/new" className="px-3"><Icon name="plus" className="h-5 w-5" />{t('cust.add')}</LinkButton>} />
      <SearchBox value={q} onChange={setQ} placeholder={t('cust.searchPh')} />
      <label className="mt-3 flex min-h-11 items-center gap-2 text-sm font-semibold">
        <input type="checkbox" className="h-5 w-5 accent-[var(--color-brand-600)]" checked={onlyDue} onChange={(e) => setOnlyDue(e.target.checked)} />{t('cust.onlyDue')}
      </label>
      <StaleNote show={list.stale} />
      {!list.data && list.loading && <Skeleton lines={5} />}
      {!list.data && <ErrorBox error={list.error} onRetry={list.reload} />}
      {list.data && list.data.length === 0 && <EmptyState icon="users" title={t('cust.none')} hint={t('cust.noneHint')} action={<LinkButton href="/customers/new">{t('cust.add')}</LinkButton>} />}
      {list.data && list.data.length > 0 && rows.length === 0 && <EmptyState icon="search" title={pickPay && !q ? t('pay.nothingDue') : t('cust.noMatch')} />}
      <ul className="mt-2 divide-y divide-line">
        {rows.map((c) => (
          <li key={c.id}>
            <Link href={pickPay ? `/customers/${c.id}/pay` : `/customers/${c.id}`} className="flex min-h-16 items-center gap-3 py-2 hover:bg-slate-50">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-50 text-lg font-bold text-brand-800" aria-hidden="true">{[...c.name][0]}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{c.name}{!c.is_active && <span className="ml-2 text-sm font-normal text-muted">({t('c.inactive')})</span>}</span>
                {c.mobile && <span className="num block text-sm text-muted">{c.mobile}</span>}
              </span>
              <DueTag paise={c.balance_paise} />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
export default function CustomersPage() {
  return <Suspense fallback={<Skeleton lines={5} />}><CustomerList /></Suspense>;
}
