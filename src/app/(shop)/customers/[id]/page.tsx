'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { CustomerForm } from '@/components/customer-form';
import { Button, Card, Dialog, EmptyState, ErrorBox, Field, Icon, LinkButton, Money, MoneyInput, Notice, PageHeader, Row, Section, Skeleton, StaleNote, useToast } from '@/components/ui';
import { AppError, newKey, rpc, type CustomerDetail } from '@/lib/api';
import { useQuery } from '@/lib/data';
import { formatDateTime, useI18n } from '@/lib/i18n';
import { formatPaise, paiseToInputText, parseRupees } from '@/lib/money';
import { shareText } from '@/lib/csv';
import { useShop } from '@/lib/session';

export default function CustomerPage() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useI18n();
  const { shop, isOwner, scope } = useShop();
  const toast = useToast();
  const q = useQuery(() => rpc<CustomerDetail>('get_customer', { p_shop_id: shop.id, p_customer_id: id }), [shop.id, id], `${scope}customer:${id}`);
  const [editing, setEditing] = useState(false);
  const [openingOpen, setOpeningOpen] = useState(false);
  const [opening, setOpening] = useState('');
  const [openingKey, setOpeningKey] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | string | null>(null);
  const c = q.data;

  async function saveOpening() {
    const p = parseRupees(opening, { allowZero: true });
    if (!p.ok) { setError(t('bill.checkAmount')); return; }
    setBusy(true); setError(null);
    try {
      await rpc('set_opening_balance', { p_shop_id: shop.id, p_idempotency_key: openingKey, p_customer_id: id, p_amount_paise: p.value });
      setOpeningOpen(false); setOpeningKey(newKey()); toast(t('c.saved')); await q.reload();
    } catch (e) { setError(e instanceof AppError ? e : new AppError('UNKNOWN', 'server')); }
    finally { setBusy(false); }
  }

  if (!c) return <div><PageHeader title={t('cust.details')} back="/home" />{q.loading ? <Skeleton lines={4} /> : <ErrorBox error={q.error} onRetry={q.reload} />}</div>;
  return (
    <div>
      <PageHeader title={c.name} back="/home"
        action={isOwner && <Button variant="ghost" onClick={() => setEditing(true)}>{t('c.edit')}</Button>} />
      <StaleNote show={q.stale} />
      {!c.is_active && <Notice tone="warn">{t('cust.inactiveNote')}</Notice>}
      <Card className={c.balance_paise > 0 ? 'border-amber-200 bg-due-bg' : 'border-brand-100 bg-brand-50'}>
        <p className={`flex items-center gap-1 text-sm font-semibold ${c.balance_paise > 0 ? 'text-due' : 'text-brand-800'}`}>
          <Icon name={c.balance_paise > 0 ? 'clock' : 'check'} className="h-4 w-4" />{t('cust.balance')}
        </p>
        <p className="text-3xl font-bold" data-testid="customer-balance"><Money paise={c.balance_paise} /></p>
        {c.mobile && <p className="num mt-1 text-sm text-muted">{c.mobile}</p>}
        <p className="text-xs text-muted">{t('cust.since')}: {formatDateTime(c.created_at, locale, shop.timezone, false)}</p>
      </Card>
      {!c.reconciled && <Notice tone="warn">{t('cust.mismatch')}</Notice>}
      {c.balance_paise > 0 && (() => {
        const text = t('cust.remindText', { n: c.name, s: locale === 'mr-IN' ? shop.name_mr : shop.name_en, a: formatPaise(c.balance_paise) });
        const phone = (c.mobile ?? '').replace(/\D/g, '');
        const wa = phone.length === 10 ? `91${phone}` : phone.length > 10 ? phone : '';
        return wa
          ? <a href={`https://wa.me/${wa}?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer" data-testid="remind"
              className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-brand-600 bg-white px-4 font-semibold text-brand-700 hover:bg-brand-50"><Icon name="share" className="h-5 w-5" />{t('cust.remind')}</a>
          : <Button variant="secondary" full className="mt-3" onClick={async () => { if ((await shareText(t('cust.remindShare'), text)) === 'copied') toast(t('c.copied')); }}><Icon name="share" className="h-5 w-5" />{t('cust.remindShare')}</Button>;
      })()}
      <div className="mt-4 grid grid-cols-2 gap-3">
        {c.is_active ? <LinkButton href={`/udhari?customer=${c.id}`}><Icon name="plus" className="h-5 w-5" />{t('home.udhari')}</LinkButton> : <Button disabled>{t('home.udhari')}</Button>}
        {c.balance_paise > 0 ? <LinkButton href={`/customers/${c.id}/pay`} variant="secondary"><Icon name="rupee" className="h-5 w-5" />{t('home.receive')}</LinkButton> : <Button variant="secondary" disabled>{t('home.receive')}</Button>}
        <LinkButton href={`/customers/${c.id}/ledger`} variant="secondary"><Icon name="list" className="h-5 w-5" />{t('cust.history')}</LinkButton>
        <LinkButton href={`/customers/${c.id}/ledger?share=1`} variant="secondary"><Icon name="share" className="h-5 w-5" />{t('cust.shareStatement')}</LinkButton>
      </div>
      <Section title={t('cust.statement')}>
        <Card>
          <Row label={t('entry.opening_balance')}><Money paise={c.opening_balance_paise} /></Row>
          <Row label={t('cust.purchases')}><Money paise={c.purchases_paise} /></Row>
          <Row label={t('cust.payments')}><Money paise={c.payments_paise} /></Row>
          <Row label={t('cust.credits')}><Money paise={c.credits_paise} /></Row>
          <Row label={t('cust.balance')} strong><Money paise={c.balance_paise} /></Row>
          {c.reconciled && <p className="mt-2 flex items-center gap-1 text-sm text-brand-800"><Icon name="check" className="h-4 w-4" />{t('cust.checked')}</p>}
          {isOwner && <Button variant="ghost" className="mt-2 px-0 text-brand-700" onClick={() => { setOpening(paiseToInputText(c.opening_balance_paise)); setError(null); setOpeningOpen(true); }}>{t('cust.setOpening')}</Button>}
        </Card>
      </Section>
      <Section title={t('cust.unpaid')}>
        {c.unpaid_invoices.length === 0 && c.opening_outstanding_paise === 0 && <EmptyState icon="check" title={t('cust.noUnpaid')} />}
        <ul className="divide-y divide-line rounded-2xl border border-line empty:hidden">
          {c.opening_outstanding_paise > 0 && (
            <li className="flex min-h-14 items-center justify-between gap-3 px-3 py-2"><span className="font-semibold">{t('entry.opening_balance')}</span><Money paise={c.opening_outstanding_paise} className="font-bold text-due" /></li>
          )}
          {c.unpaid_invoices.map((u) => (
            <li key={u.id}>
              <Link href={`/bills/${u.id}`} className="flex min-h-14 items-center justify-between gap-3 px-3 py-2 hover:bg-slate-50">
                <span><span className="font-semibold">{t('entry.invoice')} #{u.invoice_no}</span><span className="block text-sm text-muted">{formatDateTime(u.posted_at, locale, shop.timezone, false)} · {t('c.total')} <Money paise={u.total_paise} /></span></span>
                <Money paise={u.outstanding_paise} className="font-bold text-due" />
              </Link>
            </li>
          ))}
        </ul>
      </Section>
      {c.notes && <Section title={t('cust.notes')}><Card>{c.notes}</Card></Section>}
      <Dialog open={editing} title={t('cust.edit')} onClose={() => setEditing(false)}>
        <CustomerForm initial={{ id: c.id, name: c.name, mobile: c.mobile ?? '', notes: c.notes ?? '', is_active: c.is_active }}
          onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); toast(t('cust.updated')); void q.reload(); }} />
      </Dialog>
      <Dialog open={openingOpen} title={t('cust.setOpening')} onClose={() => setOpeningOpen(false)}
        actions={<><Button busy={busy} onClick={saveOpening}>{t('c.save')}</Button><Button variant="ghost" onClick={() => setOpeningOpen(false)}>{t('c.cancel')}</Button></>}>
        <Field label={t('cust.opening')} hint={t('cust.openingHint')}>{(fid, d) => <MoneyInput id={fid} aria-describedby={d} value={opening} onChange={(e) => setOpening(e.target.value)} />}</Field>
        <ErrorBox error={error} notSaved={typeof error !== 'string'} />
      </Dialog>
    </div>
  );
}
