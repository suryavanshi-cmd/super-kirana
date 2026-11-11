'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { EmptyState, ErrorBox, Icon, LinkButton, Money, PageHeader, SearchBox, Skeleton, StaleNote } from '@/components/ui';
import { matches } from '@/lib/data';
import { useI18n } from '@/lib/i18n';
import { useProducts } from '@/lib/lists';
import { useShop } from '@/lib/session';

export default function ProductsPage() {
  const { t } = useI18n();
  const { isOwner } = useShop();
  const list = useProducts();
  const [q, setQ] = useState('');
  const rows = useMemo(() => (list.data ?? []).filter((p) => matches(q, p.name, p.name_en, p.name_mr, p.sku, p.barcode, p.category)), [list.data, q]);
  const add = isOwner ? <LinkButton href="/products/new" className="px-3"><Icon name="plus" className="h-5 w-5" />{t('prod.add')}</LinkButton> : undefined;
  return (
    <div>
      <PageHeader title={t('prod.title')} action={add} />
      <SearchBox value={q} onChange={setQ} placeholder={t('prod.searchPh')} />
      <StaleNote show={list.stale} />
      {!list.data && list.loading && <Skeleton lines={5} />}
      {!list.data && <ErrorBox error={list.error} onRetry={list.reload} />}
      {list.data && list.data.length === 0 && <EmptyState icon="box" title={t('prod.none')} hint={isOwner ? t('prod.noneHint') : t('c.ownerOnly')} action={add} />}
      {list.data && list.data.length > 0 && rows.length === 0 && <EmptyState icon="search" title={t('prod.noMatch')} />}
      <ul className="mt-3 divide-y divide-line">
        {rows.map((p) => {
          const body = (
            <div className="flex min-h-16 items-center gap-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{p.name}{!p.is_active && <span className="ml-2 text-sm font-normal text-muted">({t('c.inactive')})</span>}</span>
                <span className="block truncate text-sm text-muted">{[p.name_en, p.name_mr, p.category, p.sku].filter((x) => x && x !== p.name).join(' · ')}</span>
              </span>
              <span className="text-right"><Money paise={p.default_price_paise} className="font-bold" /><span className="block text-sm text-muted">{t('bill.perUnit')} {t(`unit.${p.unit}`)}</span></span>
              {isOwner && <Icon name="chevron" className="h-5 w-5 text-muted" />}
            </div>
          );
          return <li key={p.id}>{isOwner ? <Link href={`/products/${p.id}`} className="block hover:bg-slate-50">{body}</Link> : body}</li>;
        })}
      </ul>
    </div>
  );
}
