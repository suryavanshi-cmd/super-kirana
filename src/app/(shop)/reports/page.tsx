'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Button, Card, EmptyState, ErrorBox, Field, Icon, Input, Money, Notice, PageHeader, Row, Section, Segmented, Skeleton } from '@/components/ui';
import { rpc, type DailySummary, type DayTotals, type OutstandingRow, type Report } from '@/lib/api';
import { csvMoney, downloadText, toCsv } from '@/lib/csv';
import { useQuery } from '@/lib/data';
import { formatDateTime, todayIn, useI18n } from '@/lib/i18n';
import { useShop } from '@/lib/session';

type Tab = 'summary' | 'bills' | 'collections' | 'outstanding';
type Range = 'today' | 'yesterday' | 'week' | 'month' | 'custom';

function Summary({ s }: { s: DayTotals }) {
  const { t } = useI18n();
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Card>
        <h3 className="mb-1 font-bold">{t('rep.sales')}</h3>
        <Row label={t('rep.salesGross')}><Money paise={s.sales_gross_paise} /></Row>
        <Row label={t('rep.salesReversed')}>−<Money paise={s.sales_reversed_paise} /></Row>
        <Row label={t('rep.credits')}>−<Money paise={s.credits_paise} /></Row>
        <Row label={t('rep.netSales')} strong><span data-testid="net-sales"><Money paise={s.net_sales_paise} /></span></Row>
        <p className="num mt-1 text-sm text-muted">{t('rep.billsCount')}: {s.bills}</p>
      </Card>
      <Card>
        <h3 className="mb-1 font-bold">{t('rep.collected')}</h3>
        <Row label={t('rep.collectedGross')}><Money paise={s.collections_gross_paise} /></Row>
        <Row label={t('rep.collectedReversed')}>−<Money paise={s.collections_reversed_paise} /></Row>
        <Row label={t('rep.netCollected')} strong><span data-testid="net-collected"><Money paise={s.net_collections_paise} /></span></Row>
        <h4 className="mt-3 text-sm font-bold">{t('rep.cashUpi')}</h4>
        <Row label={t('method.cash')}><Money paise={s.cash_paise} /></Row>
        <Row label={t('method.upi')}><Money paise={s.upi_paise} /></Row>
        <Row label={t('method.other')}><Money paise={s.other_paise} /></Row>
      </Card>
    </div>
  );
}

export default function ReportsPage() {
  const { t, locale } = useI18n();
  const { shop, isOwner } = useShop();
  const tz = shop.timezone;
  const [tab, setTab] = useState<Tab>('summary');
  const [range, setRange] = useState<Range>('today');
  const [from, setFrom] = useState(todayIn(tz));
  const [to, setTo] = useState(todayIn(tz));
  const dates: [string, string] = range === 'today' ? [todayIn(tz), todayIn(tz)] : range === 'yesterday' ? [todayIn(tz, -1), todayIn(tz, -1)]
    : range === 'week' ? [todayIn(tz, -6), todayIn(tz)] : range === 'month' ? [`${todayIn(tz).slice(0, 8)}01`, todayIn(tz)] : [from, to];

  const today = useQuery(isOwner ? null : () => rpc<DailySummary>('get_shop_daily_summary', { p_shop_id: shop.id }), [shop.id, isOwner]);
  const rep = useQuery(isOwner && tab !== 'outstanding' ? () => rpc<Report>('get_report', { p_shop_id: shop.id, p_from: dates[0], p_to: dates[1] }) : null,
    [shop.id, isOwner, tab === 'outstanding', dates[0], dates[1]]);
  const out = useQuery(isOwner && tab === 'outstanding' ? () => rpc<OutstandingRow[]>('get_outstanding_report', { p_shop_id: shop.id }) : null, [shop.id, isOwner, tab]);
  const d = (iso: string) => formatDateTime(iso, locale, tz, false);
  const name = (n: string | null) => n ?? t('c.walkIn');

  if (!isOwner) {
    return (
      <div>
        <PageHeader title={t('rep.title')} />
        <Notice>{t('rep.cashierToday')}</Notice>
        {today.data ? <Summary s={today.data} /> : today.loading ? <Skeleton /> : <ErrorBox error={today.error} onRetry={today.reload} />}
      </div>
    );
  }
  function exportCsv() {
    const r = rep.data;
    if (tab === 'outstanding' && out.data) {
      downloadText('outstanding.csv', toCsv([t('cust.name'), t('cust.mobile'), t('cust.due'), t('rep.oldest')], out.data.map((x) => [x.name, x.mobile, csvMoney(x.balance_paise), x.oldest_unpaid_date])));
    } else if (tab === 'bills' && r) {
      downloadText(`bills-${r.from}-${r.to}.csv`, toCsv([t('bill.number'), t('c.date'), t('bill.customer'), t('bill.billTotal'), t('bill.paid'), t('bill.stillDue'), t('c.status')],
        r.bills.map((b) => [b.invoice_no, b.business_date, name(b.customer_name), csvMoney(b.total_paise), csvMoney(b.paid_at_posting_paise), csvMoney(b.outstanding_paise), b.status])));
    } else if (tab === 'collections' && r) {
      downloadText(`collections-${r.from}-${r.to}.csv`, toCsv([t('pay.number'), t('c.date'), t('bill.customer'), t('bill.method'), t('c.amount'), t('bill.reference'), t('c.status')],
        r.payments.map((p) => [p.payment_no, p.business_date, name(p.customer_name), p.method, csvMoney(p.amount_paise), p.reference, p.status])));
    } else if (r) {
      downloadText(`daily-${r.from}-${r.to}.csv`, toCsv([t('c.date'), t('rep.salesGross'), t('rep.salesReversed'), t('rep.credits'), t('rep.netSales'), t('rep.collectedGross'), t('rep.collectedReversed'), t('rep.netCollected'), t('method.cash'), t('method.upi'), t('method.other')],
        r.days.map((x) => [x.date, csvMoney(x.sales_gross_paise), csvMoney(x.sales_reversed_paise), csvMoney(x.credits_paise), csvMoney(x.net_sales_paise), csvMoney(x.collections_gross_paise), csvMoney(x.collections_reversed_paise), csvMoney(x.net_collections_paise), csvMoney(x.cash_paise), csvMoney(x.upi_paise), csvMoney(x.other_paise)])));
    }
  }
  const r = rep.data;
  return (
    <div>
      <PageHeader title={t('rep.title')} action={<Button variant="secondary" className="px-3" onClick={exportCsv} disabled={tab === 'outstanding' ? !out.data : !r}><Icon name="download" className="h-5 w-5" />CSV</Button>} />
      <Segmented label={t('rep.title')} value={tab} onChange={setTab} options={[{ value: 'summary', label: t('rep.summary') }, { value: 'bills', label: t('rep.bills') }, { value: 'collections', label: t('rep.collections') }, { value: 'outstanding', label: t('rep.outstanding') }]} />
      {tab !== 'outstanding' && (
        <div className="mt-3">
          <Segmented label={t('c.date')} value={range} onChange={setRange} options={[{ value: 'today', label: t('c.today') }, { value: 'yesterday', label: t('rep.yesterday') }, { value: 'week', label: t('rep.week') }, { value: 'month', label: t('rep.month') }, { value: 'custom', label: t('rep.custom') }]} />
          {range === 'custom' && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Field label={t('c.from')}>{(id) => <Input id={id} type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />}</Field>
              <Field label={t('c.to')}>{(id) => <Input id={id} type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />}</Field>
            </div>
          )}
          <p className="mt-2 text-sm text-muted">{d(dates[0])}{dates[0] !== dates[1] ? ` – ${d(dates[1])}` : ''}</p>
        </div>
      )}
      <div className="mt-4">
        {tab !== 'outstanding' && !r && (rep.loading ? <Skeleton /> : <ErrorBox error={rep.error} onRetry={rep.reload} />)}
        {tab === 'summary' && r && (
          <>
            <Summary s={r.totals} />
            <p className="mt-3 text-sm text-muted">{t('rep.cutoff')}</p>
            {r.days.length > 1 && (
              <Section title={t('rep.byDay')}>
                <div className="overflow-x-auto rounded-2xl border border-line">
                  <table className="w-full text-sm"><thead><tr className="bg-slate-50 text-left"><th className="p-2">{t('c.date')}</th><th className="p-2 text-right">{t('rep.netSales')}</th><th className="p-2 text-right">{t('rep.netCollected')}</th></tr></thead>
                    <tbody>{r.days.map((x) => <tr key={x.date} className="border-t border-line"><td className="p-2">{d(x.date)}</td><td className="num p-2 text-right"><Money paise={x.net_sales_paise} /></td><td className="num p-2 text-right"><Money paise={x.net_collections_paise} /></td></tr>)}</tbody></table>
                </div>
              </Section>
            )}
            {r.days.length === 0 && <EmptyState icon="chart" title={t('rep.noData')} />}
          </>
        )}
        {tab === 'bills' && r && (r.bills.length === 0 ? <EmptyState icon="list" title={t('rep.noData')} /> : (
          <ul className="divide-y divide-line rounded-2xl border border-line">
            {r.bills.map((b) => (
              <li key={b.id}><Link href={`/bills/${b.id}`} className="flex min-h-16 items-center justify-between gap-3 px-3 py-2 hover:bg-slate-50">
                <span className="min-w-0"><span className="block truncate font-semibold">#{b.invoice_no} · {name(b.customer_name)}</span>
                  <span className="block text-sm text-muted">{d(b.business_date)}{b.status === 'reversed' ? ` · ${t('rep.reversedTag')}` : b.outstanding_paise > 0 ? ` · ${t('cust.due')} ` : ''}{b.status !== 'reversed' && b.outstanding_paise > 0 && <Money paise={b.outstanding_paise} />}</span></span>
                <Money paise={b.total_paise} className={`font-bold ${b.status === 'reversed' ? 'text-muted line-through' : ''}`} /></Link></li>
            ))}
          </ul>
        ))}
        {tab === 'collections' && r && (r.payments.length === 0 ? <EmptyState icon="rupee" title={t('rep.noData')} /> : (
          <ul className="divide-y divide-line rounded-2xl border border-line">
            {r.payments.map((p) => (
              <li key={p.id}><Link href={`/payments/${p.id}`} className="flex min-h-16 items-center justify-between gap-3 px-3 py-2 hover:bg-slate-50">
                <span className="min-w-0"><span className="block truncate font-semibold">{name(p.customer_name)}</span>
                  <span className="block text-sm text-muted">{d(p.business_date)} · {t(`pay.kind.${p.kind}` as 'pay.kind.collection')} · {t(`method.${p.method}`)}{p.status === 'reversed' ? ` · ${t('rep.reversedTag')}` : ''}</span></span>
                <Money paise={p.amount_paise} className={`font-bold ${p.status === 'reversed' ? 'text-muted line-through' : ''}`} /></Link></li>
            ))}
          </ul>
        ))}
        {tab === 'outstanding' && (!out.data ? (out.loading ? <Skeleton /> : <ErrorBox error={out.error} onRetry={out.reload} />) : out.data.length === 0 ? <EmptyState icon="check" title={t('cust.noUnpaid')} /> : (
          <>
            <Card className="mb-3 flex items-center justify-between border-amber-200 bg-due-bg"><span className="font-bold text-due">{t('rep.totalOutstanding')}</span><Money paise={out.data.reduce((s, x) => s + x.balance_paise, 0)} className="text-xl font-bold" /></Card>
            <ul className="divide-y divide-line rounded-2xl border border-line">
              {out.data.map((x) => (
                <li key={x.customer_id}><Link href={`/customers/${x.customer_id}`} className="flex min-h-16 items-center justify-between gap-3 px-3 py-2 hover:bg-slate-50">
                  <span className="min-w-0"><span className="block truncate font-semibold">{x.name}</span>
                    <span className="block text-sm text-muted">{x.mobile ?? ''}{x.oldest_unpaid_date ? ` · ${t('rep.oldest')}: ${d(x.oldest_unpaid_date)}` : ''}</span></span>
                  <Money paise={x.balance_paise} className="font-bold text-due" /></Link></li>
              ))}
            </ul>
          </>
        ))}
      </div>
    </div>
  );
}
