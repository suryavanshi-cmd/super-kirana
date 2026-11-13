'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { DueTag, EmptyState, ErrorBox, PageHeader, SearchBox, Skeleton } from '@/components/ui';
import { matches } from '@/lib/data';
import { useI18n } from '@/lib/i18n';
import { useCustomers } from '@/lib/lists';

/** "Receive payment" from the menu: pick who paid, then the normal पैसे जमा screen. */
export default function CollectPage() {
  const { t } = useI18n();
  const customers = useCustomers();
  const [q, setQ] = useState('');
  const rows = useMemo(() => (customers.data ?? [])
    .filter((c) => c.is_active && c.balance_paise > 0 && matches(q, c.name, c.mobile))
    .sort((a, b) => b.balance_paise - a.balance_paise), [customers.data, q]);
  return (
    <div>
      <PageHeader title={t('col.title')} back="/home" />
      <SearchBox value={q} onChange={setQ} placeholder={t('home.search')} autoFocus />
      {!customers.data && (customers.loading ? <Skeleton lines={4} /> : <ErrorBox error={customers.error} onRetry={customers.reload} />)}
      {customers.data && rows.length === 0 && <EmptyState icon="check" title={q.trim() ? t('cust.noMatch') : t('home.noPending')} />}
      <ul className="mt-2 divide-y divide-line overflow-hidden rounded-2xl bg-white shadow-[0_1px_3px_rgba(16,24,40,.08)]" data-testid="collect-list">
        {rows.map((c) => (
          <li key={c.id}>
            <Link href={`/customers/${c.id}/pay`} className="flex min-h-16 items-center justify-between gap-3 px-3 py-2 hover:bg-slate-50">
              <span className="min-w-0"><span className="block truncate font-semibold">{c.name}</span>{c.mobile && <span className="num block text-sm text-muted">{c.mobile}</span>}</span>
              <DueTag paise={c.balance_paise} />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
