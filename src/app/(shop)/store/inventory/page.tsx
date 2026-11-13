'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { EmptyState, ErrorBox, Icon, LinkButton, Money, PageHeader, SearchBox, Segmented, Skeleton, StaleNote } from '@/components/ui';
import { matches } from '@/lib/data';
import { useI18n } from '@/lib/i18n';
import { fmtQty, isLow, num, useInventory } from '@/lib/store';

type Filter = 'all' | 'low' | 'tracked';

export default function InventoryPage() {
  const { t } = useI18n();
  const inv = useInventory();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const rows = useMemo(() => {
    let all = (inv.data ?? []).filter((p) => matches(q, p.name, p.name_mr, p.name_en, p.category));
    if (filter === 'low') all = all.filter(isLow);
    if (filter === 'tracked') all = all.filter((p) => num(p.stock) !== null);
    // Running-low items first, then by name.
    return [...all].sort((a, b) => Number(isLow(b)) - Number(isLow(a)) || a.name.localeCompare(b.name));
  }, [inv.data, q, filter]);
  const lowCount = (inv.data ?? []).filter(isLow).length;

  return (
    <div>
      <PageHeader title={t('inv.title')} back="/store" />
      <div className="mb-3 grid grid-cols-2 gap-2">
        <LinkButton href="/store/stock-in"><Icon name="download" className="h-5 w-5" />{t('st.stockIn')}</LinkButton>
        <LinkButton href="/store/catalog" variant="secondary"><Icon name="plus" className="h-5 w-5" />{t('st.catalog')}</LinkButton>
      </div>
      <SearchBox value={q} onChange={setQ} placeholder={t('inv.search')} />
      <div className="mt-2">
        <Segmented label={t('inv.title')} value={filter} onChange={setFilter}
          options={[{ value: 'all', label: t('inv.all') }, { value: 'low', label: `${t('inv.low')}${lowCount ? ` (${lowCount})` : ''}` }, { value: 'tracked', label: t('inv.tracked') }]} />
      </div>
      <StaleNote show={inv.stale} />
      {!inv.data && (inv.loading ? <Skeleton lines={6} /> : <ErrorBox error={inv.error} onRetry={inv.reload} />)}
      {inv.data && inv.data.length === 0 && <EmptyState icon="box" title={t('inv.empty')} hint={t('inv.emptyHint')} />}
      <ul className="mt-2 divide-y divide-line overflow-hidden rounded-2xl bg-white shadow-[0_1px_3px_rgba(16,24,40,.08)]" data-testid="inventory-list">
        {rows.map((p) => {
          const low = isLow(p);
          const tracked = num(p.stock) !== null;
          return (
            <li key={p.id}>
              <Link href={`/store/inventory/${p.id}`} className={`flex min-h-16 items-center gap-3 px-3 py-2 hover:bg-slate-50 ${p.is_active ? '' : 'opacity-60'}`}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{p.name}</span>
                  <span className="block truncate text-sm text-muted">
                    <Money paise={p.default_price_paise} /> / {t(`unit.${p.unit}`)}
                    {Number(p.sold_7d) > 0 && <> · {t('inv.sold7', { q: `${fmtQty(p.sold_7d)} ${t(`unit.${p.unit}`)}` })}</>}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  {tracked
                    ? <span className={`block font-bold ${low ? 'text-due' : ''}`}>{fmtQty(p.stock)} {t(`unit.${p.unit}`)}</span>
                    : <span className="block text-xs text-muted">{t('inv.notTracked')}</span>}
                  {low && <span className="mt-0.5 inline-block rounded-full bg-due-bg px-2 text-xs font-bold text-due">{t('inv.lowTag')}</span>}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
