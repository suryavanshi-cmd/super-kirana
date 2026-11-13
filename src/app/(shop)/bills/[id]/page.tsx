'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { ReasonDialog } from '@/components/reason-dialog';
import { Button, ErrorBox, Icon, LinkButton, Money, Notice, PageHeader, Row, Skeleton, useToast } from '@/components/ui';
import { newKey, rpc, type Invoice } from '@/lib/api';
import { shareText } from '@/lib/csv';
import { useQuery } from '@/lib/data';
import { formatDateTime, useI18n } from '@/lib/i18n';
import { formatPaise } from '@/lib/money';
import { useShop } from '@/lib/session';

export default function BillReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useI18n();
  const { shop, isOwner, scope } = useShop();
  const toast = useToast();
  // Receipts are built only from the posted server record — never from a local draft.
  const q = useQuery(() => rpc<Invoice>('get_invoice', { p_shop_id: shop.id, p_invoice_id: id }), [shop.id, id], `${scope}invoice:${id}`, { persist: false });
  const [dialog, setDialog] = useState<'reverse' | 'return' | null>(null);
  const [key, setKey] = useState(newKey);
  const b = q.data;
  if (!b) return <div><PageHeader title={t('bill.receipt')} back="/home" />{q.loading ? <Skeleton lines={5} /> : <ErrorBox error={q.error} onRetry={q.reload} />}</div>;
  const shopName = locale === 'mr-IN' ? b.shop.name_mr : b.shop.name_en;
  const when = formatDateTime(b.posted_at, locale, b.shop.timezone);
  const reversed = b.status === 'reversed';

  function receiptText(): string {
    const lines = [shopName, `${t('bill.number')}: ${b!.invoice_no}`, when];
    if (b!.customer_name) lines.push(`${t('bill.customer')}: ${b!.customer_name}`);
    lines.push('');
    for (const it of b!.items) lines.push(`${it.name}  ${it.qty} ${t(`unit.${it.unit}`)} × ${formatPaise(it.unit_price_paise)}/${t(`unit.${it.price_unit}`)}  = ${formatPaise(it.line_total_paise)}`);
    lines.push('', `${t('bill.billTotal')}: ${formatPaise(b!.total_paise)}`, `${t('bill.paid')}: ${formatPaise(b!.paid_at_posting_paise)}`, `${t('bill.newDue')}: ${formatPaise(b!.bill_due_at_posting_paise)}`);
    if (b!.customer_id) lines.push(`${t('bill.prevDue')}: ${formatPaise(b!.previous_balance_paise)}`, `${t('bill.totalDue')}: ${formatPaise(b!.balance_after_paise)}`);
    return lines.join('\n');
  }
  async function act(kind: 'reverse' | 'return', reason: string, amountPaise: number) {
    if (kind === 'reverse') await rpc('reverse_invoice', { p_shop_id: shop.id, p_idempotency_key: key, p_invoice_id: id, p_reason: reason });
    else await rpc('issue_credit_or_return', { p_shop_id: shop.id, p_idempotency_key: key, p_customer_id: b!.customer_id, p_amount_paise: amountPaise, p_reason: reason, p_kind: 'return', p_invoice_id: id });
    setKey(newKey()); toast(t('c.saved')); await q.reload();
  }
  return (
    <div>
      <PageHeader title={t('bill.receipt')} back="/home" />
      {reversed && <Notice tone="warn" icon="x"><b>{t('bill.reversed')}</b>{b.reversal_reason ? ` — ${b.reversal_reason}` : ''}</Notice>}
      <article className="print-area rounded-2xl border border-line p-4" data-testid="receipt">
        <header className="border-b border-dashed border-slate-400 pb-3 text-center">
          <p className="text-xl font-bold">{shopName}</p>
          <p className="num mt-1 text-sm">{t('bill.number')}: <b>{b.invoice_no}</b> · {when}</p>
          {b.customer_name && <p className="mt-1 font-semibold">{t('bill.customer')}: {b.customer_name}</p>}
          {reversed && <p className="mt-1 font-bold uppercase">{t('rep.reversedTag')}</p>}
        </header>
        <table className="mt-3 w-full text-sm">
          <thead><tr className="text-left text-muted"><th className="py-1 font-semibold">{t('bill.items')}</th><th className="py-1 text-right font-semibold">{t('bill.lineTotal')}</th></tr></thead>
          <tbody>
            {b.items.map((it) => (
              <tr key={it.line_no} className="border-t border-line align-top">
                <td className="py-1.5"><span className="font-semibold">{it.name}</span>
                  {!(Number(it.qty) === 1 && it.unit === 'piece' && it.price_unit === 'piece' && it.discount_paise === 0) && <span className="num block text-muted">{it.qty} {t(`unit.${it.unit}`)} × {formatPaise(it.unit_price_paise)}/{t(`unit.${it.price_unit}`)}{it.discount_paise > 0 ? ` − ${t('bill.discount')} ${formatPaise(it.discount_paise)}` : ''}</span>}</td>
                <td className="num py-1.5 text-right font-semibold">{formatPaise(it.line_total_paise)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-3 border-t border-dashed border-slate-400 pt-2">
          <Row label={t('bill.billTotal')} strong><span data-testid="receipt-total"><Money paise={b.total_paise} /></span></Row>
          <Row label={t('bill.paid')}><Money paise={b.paid_at_posting_paise} /></Row>
          <Row label={t('bill.newDue')}><Money paise={b.bill_due_at_posting_paise} /></Row>
          {b.customer_id && (<>
            <Row label={t('bill.prevDue')}><Money paise={b.previous_balance_paise} /></Row>
            {b.old_dues_paid_paise > 0 && <Row label={t('bill.oldDuesPaid')}><Money paise={b.old_dues_paid_paise} /></Row>}
            <Row label={t('bill.totalDue')} strong><span data-testid="receipt-balance"><Money paise={b.balance_after_paise} /></span></Row>
          </>)}
        </div>
        <p className="mt-2 text-xs text-muted">{b.payments.filter((p) => p.kind === 'bill_payment').map((p) => `${t(`method.${p.method}`)}${p.reference ? ` (${p.reference})` : ''}`).join(', ')}
          {b.created_by_name ? ` · ${t('bill.by')}: ${b.created_by_name}` : ''}{b.source === 'ocr' ? ` · ${t('bill.source.ocr')}` : ''}</p>
      </article>

      {!reversed && b.customer_id && (
        <Notice tone={b.outstanding_paise > 0 ? 'warn' : 'ok'}>{b.outstanding_paise > 0 ? <>{t('bill.stillDue')}: <b><Money paise={b.outstanding_paise} /></b></> : t('bill.paidFull')}</Notice>
      )}
      <div className="no-print mt-4 grid grid-cols-2 gap-3">
        <Button variant="secondary" onClick={() => window.print()}><Icon name="print" className="h-5 w-5" />{t('c.print')}</Button>
        <Button variant="secondary" onClick={async () => { if ((await shareText(shopName, receiptText())) === 'copied') toast(t('c.copied')); }}><Icon name="share" className="h-5 w-5" />{t('c.share')}</Button>
        <LinkButton href="/udhari" className="col-span-2"><Icon name="plus" className="h-5 w-5" />{t('bill.newAnother')}</LinkButton>
      </div>
      {b.payments.length > 0 && (
        <ul className="no-print mt-4 divide-y divide-line rounded-2xl border border-line">
          {b.payments.map((p) => (
            <li key={p.id}><Link href={`/payments/${p.id}`} className="flex min-h-14 items-center justify-between gap-3 px-3 py-2 hover:bg-slate-50">
              <span><span className="font-semibold">{t(`pay.kind.${p.kind}`)} · {t(`method.${p.method}`)}</span>{p.status === 'reversed' && <span className="ml-2 text-sm text-muted">({t('rep.reversedTag')})</span>}</span>
              <Money paise={p.amount_paise} className="font-bold" /></Link></li>
          ))}
        </ul>
      )}
      {isOwner && !reversed && (
        <div className="no-print mt-6 grid gap-2 border-t border-line pt-4">
          {b.customer_id && <Button variant="secondary" onClick={() => setDialog('return')}>{t('bill.return')}</Button>}
          <Button variant="danger" onClick={() => setDialog('reverse')}>{t('bill.reverse')}</Button>
        </div>
      )}
      <ReasonDialog open={dialog === 'reverse'} title={t('bill.reverse')} hint={t('bill.reverseHint')} confirmLabel={t('bill.reverse')}
        onClose={() => setDialog(null)} onSubmit={(r, a) => act('reverse', r, a)} />
      <ReasonDialog open={dialog === 'return'} title={t('bill.return')} hint={t('bill.returnHint')} confirmLabel={t('c.save')} withAmount={t('bill.returnAmount')}
        onClose={() => setDialog(null)} onSubmit={(r, a) => act('return', r, a)} />
    </div>
  );
}
