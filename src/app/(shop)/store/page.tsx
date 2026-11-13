'use client';
import Link from 'next/link';
import { Card, Icon, Money, PageHeader } from '@/components/ui';
import { todayIn, useI18n } from '@/lib/i18n';
import { useShop } from '@/lib/session';
import { useInsights } from '@/lib/store';

/** One entry point from home: everything about the shop's business and stock. */
export default function StoreHub() {
  const { t } = useI18n();
  const { shop } = useShop();
  const today = todayIn(shop.timezone);
  const q = useInsights(today, today);
  const d = q.data;
  const tiles: { href: string; icon: string; title: string; hint: string; badge?: string }[] = [
    { href: '/store/summary', icon: 'list', title: t('st.summary'), hint: t('st.summaryHint') },
    { href: '/store/insights', icon: 'chart', title: t('st.insights'), hint: t('st.insightsHint') },
    { href: '/store/stock-in', icon: 'download', title: t('st.stockIn'), hint: t('st.stockInHint') },
    { href: '/store/inventory', icon: 'box', title: t('st.inventory'), hint: t('st.inventoryHint'),
      badge: d && d.low_stock.length > 0 ? t('st.lowStock', { n: d.low_stock.length }) : undefined },
    { href: '/store/catalog', icon: 'plus', title: t('st.catalog'), hint: t('st.catalogHint') },
  ];
  return (
    <div>
      <PageHeader title={t('st.title')} back="/home" />
      <Card className="mb-4">
        <p className="mb-2 text-sm font-semibold text-muted">{t('st.today')}</p>
        <div className="grid grid-cols-2 gap-3" data-testid="store-today">
          <div><p className="text-sm text-muted">{t('st.sales')}</p><p className="text-xl font-bold">{d ? <Money paise={d.totals.net_sales_paise} /> : '—'}</p></div>
          <div><p className="text-sm text-muted">{t('st.collected')}</p><p className="text-xl font-bold">{d ? <Money paise={d.totals.net_collections_paise} /> : '—'}</p></div>
          <div><p className="text-sm text-muted">{t('st.bills')}</p><p className="text-xl font-bold">{d ? d.totals.bills : '—'}</p></div>
          <div><p className="text-sm text-muted">{t('st.dues')}</p><p className="text-xl font-bold text-due">{d ? <Money paise={d.dues.total_paise} /> : '—'}</p></div>
        </div>
      </Card>
      <ul className="space-y-3">
        {tiles.map((x) => (
          <li key={x.href}>
            <Link href={x.href} className="flex min-h-20 items-center gap-4 rounded-2xl border border-line bg-white p-3 hover:border-brand-600">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-brand-800"><Icon name={x.icon} className="h-7 w-7" /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-lg font-bold">{x.title}</span>
                <span className="block text-sm text-muted">{x.hint}</span>
                {x.badge && <span className="mt-1 inline-block rounded-full bg-due-bg px-2 py-0.5 text-xs font-bold text-due">{x.badge}</span>}
              </span>
              <Icon name="chevron" className="h-5 w-5 text-muted" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
