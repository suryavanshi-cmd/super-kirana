'use client';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { entryHref } from '@/components/activity';
import { Button, Card, EmptyState, ErrorBox, Field, Icon, Input, Money, PageHeader, Skeleton, StaleNote, useToast } from '@/components/ui';
import { rpc, type CustomerDetail, type Ledger, type LedgerEntry } from '@/lib/api';
import { csvMoney, downloadText, shareText, toCsv } from '@/lib/csv';
import { useQuery } from '@/lib/data';
import { formatDateTime, useI18n } from '@/lib/i18n';
import { formatPaise } from '@/lib/money';
import { useShop } from '@/lib/session';

function LedgerView() {
  const { id } = useParams<{ id: string }>();
  const wantShare = useSearchParams().get('share') === '1';
  const { t, locale } = useI18n();
  const { shop, scope } = useShop();
  const toast = useToast();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const cust = useQuery(() => rpc<CustomerDetail>('get_customer', { p_shop_id: shop.id, p_customer_id: id }), [shop.id, id], `${scope}customer:${id}`);
  const q = useQuery(() => rpc<Ledger>('get_customer_ledger', { p_shop_id: shop.id, p_customer_id: id, p_from: from || null, p_to: to || null }),
    [shop.id, id, from, to], from || to ? undefined : `${scope}ledger:${id}`);
  const shopName = locale === 'mr-IN' ? shop.name_mr : shop.name_en;
  const name = cust.data?.name ?? '';
  const label = (e: LedgerEntry) => `${t(`entry.${e.entry_type}`)}${e.invoice_no ? ` #${e.invoice_no}` : ''}${e.method ? ` (${t(`method.${e.method}`)})` : ''}`;

  function statementText(l: Ledger): string {
    const lines = [shopName, `${t('cust.statement')}: ${name}`, ''];
    if (l.balance_before_paise !== 0) lines.push(`${t('cust.openingBefore')}: ${formatPaise(l.balance_before_paise)}`);
    for (const e of l.entries) lines.push(`${formatDateTime(e.posted_at, locale, shop.timezone, false)}  ${label(e)}  ${e.amount_paise > 0 ? '+' : '−'}${formatPaise(Math.abs(e.amount_paise))}  = ${formatPaise(e.running_paise)}`);
    lines.push('', `${t('cust.yourDue')}: ${formatPaise(l.balance_paise)}`);
    return lines.join('\n');
  }
  async function share() {
    if (!q.data) return;
    const r = await shareText(`${shopName} — ${name}`, statementText(q.data));
    if (r === 'copied') toast(t('c.copied'));
  }
  function csv() {
    if (!q.data) return;
    downloadText(`statement-${name}.csv`, toCsv([t('c.date'), t('c.status'), t('c.amount'), t('cust.running'), t('c.note')],
      q.data.entries.map((e) => [e.business_date, label(e), csvMoney(e.amount_paise), csvMoney(e.running_paise), e.note ?? e.reference ?? ''])));
  }
  return (
    <div>
      <PageHeader title={t('cust.history')} back={`/customers/${id}`} />
      <div className="print-area">
        <p className="text-lg font-bold">{name}</p>
        <p className="hidden text-sm print:block">{shopName}</p>
        <div className="no-print grid grid-cols-2 gap-3">
          <Field label={t('c.from')}>{(fid) => <Input id={fid} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}</Field>
          <Field label={t('c.to')}>{(fid) => <Input id={fid} type="date" value={to} onChange={(e) => setTo(e.target.value)} />}</Field>
        </div>
        <div className={`no-print mb-3 grid grid-cols-3 gap-2 ${wantShare ? 'rounded-2xl ring-2 ring-brand-500 ring-offset-4' : ''}`}>
          <Button variant="secondary" onClick={share} disabled={!q.data}><Icon name="share" className="h-5 w-5" />{t('c.share')}</Button>
          <Button variant="secondary" onClick={() => window.print()} disabled={!q.data}><Icon name="print" className="h-5 w-5" />{t('c.print')}</Button>
          <Button variant="secondary" onClick={csv} disabled={!q.data}><Icon name="download" className="h-5 w-5" />CSV</Button>
        </div>
        <StaleNote show={q.stale} />
        {!q.data && q.loading && <Skeleton lines={5} />}
        {!q.data && <ErrorBox error={q.error} onRetry={q.reload} />}
        {q.data && (
          <>
            {q.data.balance_before_paise !== 0 && <Card className="mb-2 flex justify-between"><span>{t('cust.openingBefore')}</span><Money paise={q.data.balance_before_paise} className="font-bold" /></Card>}
            {q.data.entries.length === 0 && <EmptyState icon="list" title={t('c.empty')} />}
            <ul className="divide-y divide-line rounded-2xl border border-line bg-white empty:hidden">
              {q.data.entries.map((e) => {
                const href = entryHref(e);
                const body = (
                  <div className="px-3 py-2">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-semibold">{label(e)}</span>
                      <span className={`num whitespace-nowrap font-bold ${e.amount_paise < 0 ? 'text-brand-700' : ''}`}>{e.amount_paise > 0 ? '+' : '−'}{formatPaise(Math.abs(e.amount_paise))}</span>
                    </div>
                    <div className="flex items-baseline justify-between gap-3 text-sm text-muted">
                      <span>{formatDateTime(e.posted_at, locale, shop.timezone)}</span>
                      <span>{t('cust.running')}: <Money paise={e.running_paise} /></span>
                    </div>
                    {e.allocations && e.allocations.filter((a) => a.amount_paise > 0).length > 0 && (
                      <p className="mt-0.5 text-xs text-muted">{t('pay.appliedTo')}: {e.allocations.filter((a) => a.amount_paise > 0).map((a) => `${a.target === 'opening' ? t('pay.toOpening') : `${t('pay.toBill')} ${a.invoice_no}`} ${formatPaise(a.amount_paise)}`).join(', ')}</p>
                    )}
                    {e.note && <p className="mt-0.5 text-xs text-muted">{e.note}</p>}
                  </div>
                );
                return <li key={e.id}>{href && e.entry_type !== 'opening_balance' ? <Link href={href} className="block hover:bg-slate-50">{body}</Link> : body}</li>;
              })}
            </ul>
            <Card className="mt-3 flex items-center justify-between border-amber-200 bg-due-bg">
              <span className="font-bold text-due">{t('cust.yourDue')}</span><Money paise={q.data.balance_paise} className="text-xl font-bold" />
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
export default function LedgerPage() { return <Suspense fallback={<Skeleton lines={5} />}><LedgerView /></Suspense>; }
