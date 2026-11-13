'use client';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { ReasonDialog } from '@/components/reason-dialog';
import { Button, ErrorBox, Icon, LinkButton, Money, Notice, PageHeader, Row, Skeleton, useToast } from '@/components/ui';
import { newKey, rpc, type Payment } from '@/lib/api';
import { shareText } from '@/lib/csv';
import { useQuery } from '@/lib/data';
import { formatDateTime, useI18n } from '@/lib/i18n';
import { formatPaise } from '@/lib/money';
import { useShop } from '@/lib/session';

export default function PaymentReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useI18n();
  const { shop, isOwner, scope } = useShop();
  const toast = useToast();
  const q = useQuery(() => rpc<Payment>('get_payment', { p_shop_id: shop.id, p_payment_id: id }), [shop.id, id], `${scope}payment:${id}`, { persist: false });
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(newKey);
  const p = q.data;
  if (!p) return <div><PageHeader title={t('pay.receipt')} back="/home" />{q.loading ? <Skeleton /> : <ErrorBox error={q.error} onRetry={q.reload} />}</div>;
  const shopName = locale === 'mr-IN' ? p.shop.name_mr : p.shop.name_en;
  const when = formatDateTime(p.posted_at, locale, p.shop.timezone);
  const applied = p.allocations.filter((a) => a.amount_paise > 0);
  const text = [shopName, `${t('pay.number')}: ${p.payment_no}`, when, p.customer_name ? `${t('bill.customer')}: ${p.customer_name}` : '',
    `${t('pay.amount')}: ${formatPaise(p.amount_paise)} (${t(`method.${p.method}`)})`,
    p.customer_id ? `${t('cust.yourDue')}: ${formatPaise(p.balance_after_paise)}` : ''].filter(Boolean).join('\n');
  return (
    <div>
      <PageHeader title={t('pay.receipt')} back={p.customer_id ? `/customers/${p.customer_id}` : '/home'} />
      {p.status === 'reversed' && <Notice tone="warn" icon="x"><b>{t('pay.reversed')}</b>{p.reversal_reason ? ` — ${p.reversal_reason}` : ''}</Notice>}
      <article className="print-area rounded-2xl border border-line p-4" data-testid="payment-receipt">
        <header className="border-b border-dashed border-slate-400 pb-3 text-center">
          <p className="text-xl font-bold">{shopName}</p>
          <p className="num mt-1 text-sm">{t('pay.number')}: <b>{p.payment_no}</b> · {when}</p>
          {p.customer_name && <p className="mt-1 font-semibold">{t('bill.customer')}: {p.customer_name}</p>}
        </header>
        <p className="mt-4 text-center text-sm font-semibold text-brand-800">{t(`pay.kind.${p.kind}`)} · {t(`method.${p.method}`)}{p.reference ? ` · ${p.reference}` : ''}</p>
        <p className="text-center text-3xl font-bold"><Money paise={p.amount_paise} /></p>
        {p.customer_id && (
          <div className="mt-3 border-t border-dashed border-slate-400 pt-2">
            <Row label={t('bill.prevDue')}><Money paise={p.previous_balance_paise} /></Row>
            <Row label={t('pay.afterDue')} strong><span data-testid="payment-balance"><Money paise={p.balance_after_paise} /></span></Row>
          </div>
        )}
        {applied.length > 0 && (
          <div className="mt-3 text-sm">
            <p className="font-semibold">{t('pay.appliedTo')}</p>
            <ul>{applied.map((a, i) => <li key={i} className="flex justify-between py-0.5"><span>{a.target === 'opening' ? t('pay.toOpening') : `${t('pay.toBill')} ${a.invoice_no}`}</span><Money paise={a.amount_paise} /></li>)}</ul>
          </div>
        )}
        <p className="mt-2 text-xs text-muted">{t('method.note')}{p.created_by_name ? ` · ${t('bill.by')}: ${p.created_by_name}` : ''}</p>
      </article>
      <div className="no-print mt-4 grid grid-cols-2 gap-3">
        <Button variant="secondary" onClick={() => window.print()}><Icon name="print" className="h-5 w-5" />{t('c.print')}</Button>
        <Button variant="secondary" onClick={async () => { if ((await shareText(shopName, text)) === 'copied') toast(t('c.copied')); }}><Icon name="share" className="h-5 w-5" />{t('c.share')}</Button>
        {p.invoice_id && <LinkButton href={`/bills/${p.invoice_id}`} variant="secondary" className="col-span-2">{t('bill.details')}</LinkButton>}
      </div>
      {isOwner && p.status === 'posted' && p.customer_id && (
        <div className="no-print mt-6 border-t border-line pt-4"><Button variant="danger" full onClick={() => setOpen(true)}>{t('pay.reverse')}</Button></div>
      )}
      <ReasonDialog open={open} title={t('pay.reverse')} hint={t('pay.reverseHint')} confirmLabel={t('pay.reverse')} onClose={() => setOpen(false)}
        onSubmit={async (reason) => { await rpc('reverse_payment', { p_shop_id: shop.id, p_idempotency_key: key, p_payment_id: id, p_reason: reason }); setKey(newKey()); toast(t('c.saved')); await q.reload(); }} />
    </div>
  );
}
