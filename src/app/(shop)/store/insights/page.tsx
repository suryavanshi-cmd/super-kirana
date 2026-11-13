'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { BarList, CHART_COLORS, DayBars, Donut, OTHERS_COLOR, type Slice } from '@/components/charts';
import { Card, EmptyState, ErrorBox, Money, PageHeader, Section, Segmented, Skeleton } from '@/components/ui';
import { todayIn, useI18n } from '@/lib/i18n';
import { useShop } from '@/lib/session';
import { fmtQty, rupeesShort, useInsights, type Insights } from '@/lib/store';

type Period = 'day' | 'week' | 'month';
const DAYS: Record<Period, number> = { day: 1, week: 7, month: 30 };

function topSlices<T>(rows: T[], value: (r: T) => number, label: (r: T) => string, sub: (r: T) => string | undefined, othersLabel: string): Slice[] {
  const top = rows.slice(0, 5).map((r, i) => ({ label: label(r), value: value(r), color: CHART_COLORS[i], sub: sub(r) }));
  const rest = rows.slice(5).reduce((s, r) => s + value(r), 0);
  return rest > 0 ? [...top, { label: othersLabel, value: rest, color: OTHERS_COLOR }] : top;
}

export default function InsightsPage() {
  const { t } = useI18n();
  const { shop } = useShop();
  const [period, setPeriod] = useState<Period>('week');
  const [metric, setMetric] = useState<'amount' | 'qty'>('amount');
  const to = todayIn(shop.timezone);
  const from = todayIn(shop.timezone, -(DAYS[period] - 1));
  const q = useInsights(from, to);
  const d: Insights | undefined = q.data;

  const customerSlices = useMemo(() => (d ? topSlices(d.customers, (c) => c.amount_paise, (c) => c.name ?? t('in.walkIn'),
    (c) => t('in.billsN', { n: c.bills }), t('in.others')) : []), [d, t]);
  const productSlices = useMemo(() => (d ? topSlices(d.products, (p) => p.amount_paise, (p) => p.name,
    (p) => `${fmtQty(p.qty)} ${t(`unit.${p.unit}`)}`, t('in.others')) : []), [d, t]);
  const productBars = useMemo(() => {
    if (!d) return [];
    const rows = [...d.products];
    // Quantities can only be compared within the same unit, so "by quantity" ranks inside each unit.
    if (metric === 'qty') rows.sort((a, b) => (a.unit === b.unit ? Number(b.qty) - Number(a.qty) : a.unit.localeCompare(b.unit)));
    return rows.slice(0, 10).map((p) => ({
      label: p.name, sub: p.linked ? undefined : `(${t('in.notInList')})`,
      value: metric === 'qty' ? Number(p.qty) : p.amount_paise,
      display: metric === 'qty' ? `${fmtQty(p.qty)} ${t(`unit.${p.unit}`)}` : rupeesShort(p.amount_paise),
    }));
  }, [d, metric, t]);
  const dayLabel = (iso: string) => `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}`;

  return (
    <div>
      <PageHeader title={t('st.insights')} back="/store" />
      <Segmented label={t('in.period')} value={period} onChange={setPeriod}
        options={[{ value: 'day', label: t('in.day') }, { value: 'week', label: t('in.week') }, { value: 'month', label: t('in.month') }]} />
      {!d && (q.loading ? <div className="mt-4"><Skeleton lines={6} /></div> : <ErrorBox error={q.error} onRetry={q.reload} />)}
      {d && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3" data-testid="insight-totals">
            <Card><p className="text-sm text-muted">{t('st.sales')}</p><p className="text-xl font-bold"><Money paise={d.totals.net_sales_paise} /></p><p className="text-xs text-muted">{t('in.billsN', { n: d.totals.bills })}</p></Card>
            <Card><p className="text-sm text-muted">{t('st.collected')}</p><p className="text-xl font-bold"><Money paise={d.totals.net_collections_paise} /></p></Card>
          </div>

          {period !== 'day' && (
            <Section title={t('in.byDay')}>
              <DayBars days={d.days.map((x) => ({ date: x.date, value: x.sales_paise }))} label={dayLabel} />
            </Section>
          )}

          <Section title={t('in.topCustomers')}>
            {d.customers.length === 0 ? <EmptyState icon="chart" title={t('in.noSales')} />
              : <Donut slices={customerSlices} format={rupeesShort} testId="donut-customers" />}
          </Section>

          <Section title={t('in.topProducts')}>
            {d.products.length === 0 ? <EmptyState icon="chart" title={t('in.noSales')} /> : (
              <>
                <Donut slices={productSlices} format={rupeesShort} testId="donut-products" />
                <div className="my-4">
                  <Segmented label={t('in.topProducts')} value={metric} onChange={setMetric}
                    options={[{ value: 'amount', label: t('in.byAmount') }, { value: 'qty', label: t('in.byQty') }]} />
                </div>
                <BarList rows={productBars} testId="bars-products" />
              </>
            )}
          </Section>

          {d.dues.top.length > 0 && (
            <Section title={t('in.topDues')}>
              <ul className="divide-y divide-line">
                {d.dues.top.map((c) => (
                  <li key={c.customer_id}>
                    <Link href={`/customers/${c.customer_id}`} className="flex min-h-12 items-center justify-between gap-2 py-2 hover:bg-slate-50">
                      <span className="truncate font-semibold">{c.name}</span><span className="font-bold text-due"><Money paise={c.due_paise} /></span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {d.low_stock.length > 0 && (
            <Section title={t('in.lowStock')}>
              <ul className="divide-y divide-line">
                {d.low_stock.map((p) => (
                  <li key={p.product_id}>
                    <Link href={`/store/inventory/${p.product_id}`} className="flex min-h-12 items-center justify-between gap-2 py-2 hover:bg-slate-50">
                      <span className="truncate font-semibold">{p.name}</span>
                      <span className="font-bold text-due">{fmtQty(p.stock)} {t(`unit.${p.unit}`)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </>
      )}
    </div>
  );
}
