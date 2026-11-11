'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';
import { CustomerForm } from '@/components/customer-form';
import { failedText, UnknownOutcome } from '@/components/outcome';
import { Button, Card, Dialog, DueTag, ErrorBox, Field, Icon, Input, Money, MoneyInput, Notice, PageHeader, Row, SearchBox, Segmented, Skeleton, useToast } from '@/components/ui';
import { newKey, type CustomerRow, type Method } from '@/lib/api';
import { matches, useOnline } from '@/lib/data';
import { useI18n } from '@/lib/i18n';
import { useCustomers } from '@/lib/lists';
import { formatPaise, parseRupees } from '@/lib/money';
import { send, type Pending } from '@/lib/mutations';
import { useShop } from '@/lib/session';

/**
 * The simple way to record credit: who, how much the bill was, what they paid now.
 * It posts a one-line bill through the same create_invoice function as an itemised bill.
 */
function UdhariScreen() {
  const { t } = useI18n();
  const { shop, scope } = useShop();
  const router = useRouter();
  const toast = useToast();
  const online = useOnline();
  const customers = useCustomers();
  const [customerId, setCustomerId] = useState<string | null>(useSearchParams().get('customer'));
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [amount, setAmount] = useState('');
  const [what, setWhat] = useState('');
  const [paid, setPaid] = useState('');
  const [method, setMethod] = useState<Method>('cash');
  const [showErrors, setShowErrors] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [key, setKey] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const customer: CustomerRow | null = useMemo(() => customers.data?.find((c) => c.id === customerId) ?? null, [customers.data, customerId]);
  const amt = parseRupees(amount);
  const pd = paid.trim() ? parseRupees(paid, { allowZero: true }) : ({ ok: true, value: 0 } as const);
  const prev = customer?.balance_paise ?? 0;
  const amountOk = amt.ok;
  const paidOk = pd.ok && amt.ok && pd.value <= amt.value + prev;
  const newTotal = amt.ok && pd.ok ? prev + amt.value - pd.value : prev;

  const done = (p: Pending) => { void customers.reload(); toast(t('bill.saved')); router.replace(`/bills/${String(p.result?.invoice_id)}`); };
  const onFailed = (p: Pending) => { setPending(null); setConfirming(false); setFailed(failedText(t, p)); setKey(newKey()); void customers.reload(); };

  async function submit() {
    if (!customer || !amt.ok || !pd.ok || !paidOk) return;
    setBusy(true); setFailed(null);
    const p = await send(scope, { key, fn: 'create_invoice', shopId: shop.id, label: customer.name, amountPaise: amt.value,
      args: { p_shop_id: shop.id, p_idempotency_key: key, p_customer_id: customer.id,
        p_items: [{ product_id: null, name: what.trim() || t('ud.defaultItem'), qty: '1', unit: 'piece', price_unit: 'piece', unit_price_paise: amt.value, discount_paise: 0 }],
        p_paid_paise: pd.value, p_payment_method: method, p_payment_reference: null, p_note: null, p_source: 'manual', p_ocr_job_id: null } });
    setBusy(false); setConfirming(false);
    if (p.state === 'confirmed') done(p); else if (p.state === 'failed') onFailed(p); else setPending(p);
  }

  // Step 1: choose the customer.
  if (!customer) {
    const list = (customers.data ?? []).filter((c) => c.is_active && matches(q, c.name, c.mobile));
    return (
      <div>
        <PageHeader title={t('ud.pick')} back="/home" />
        {adding ? (
          <Card><CustomerForm onCancel={() => setAdding(false)} onSaved={(id) => { void customers.reload(); setCustomerId(id); setAdding(false); }} /></Card>
        ) : (
          <>
            <Button full className="mb-3" onClick={() => setAdding(true)}><Icon name="plus" className="h-5 w-5" />{t('cust.new')}</Button>
            <SearchBox value={q} onChange={setQ} placeholder={t('home.search')} autoFocus />
            {!customers.data && (customers.loading ? <Skeleton lines={4} /> : <ErrorBox error={customers.error} onRetry={customers.reload} />)}
            {customers.data && list.length === 0 && <p className="py-6 text-center text-muted">{customers.data.length === 0 ? t('cust.none') : t('cust.noMatch')}</p>}
            <ul className="mt-2 divide-y divide-line">
              {list.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => setCustomerId(c.id)} className="flex min-h-16 w-full items-center justify-between gap-3 py-2 text-left hover:bg-slate-50">
                    <span className="min-w-0"><span className="block truncate font-semibold">{c.name}</span>{c.mobile && <span className="num block text-sm text-muted">{c.mobile}</span>}</span>
                    <DueTag paise={c.balance_paise} />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    );
  }

  // Step 2: amount and payment.
  return (
    <div>
      <PageHeader title={t('ud.title')} back="/home" />
      <button type="button" onClick={() => { setCustomerId(null); setPending(null); }} disabled={!!pending}
        className="mb-4 flex min-h-16 w-full items-center gap-3 rounded-2xl border border-line p-3 text-left hover:border-brand-600" data-testid="ud-customer">
        <span className="min-w-0 flex-1"><span className="block text-sm text-muted">{t('bill.customer')}</span><span className="block truncate text-lg font-bold">{customer.name}</span></span>
        <DueTag paise={customer.balance_paise} />
        <span className="text-sm font-semibold text-brand-700">{t('c.edit')}</span>
      </button>
      {pending && <UnknownOutcome pending={pending} scope={scope} onConfirmed={done} onFailed={onFailed} />}
      {!pending && (
        <>
          <Field label={t('ud.amount')} error={showErrors && !amountOk ? t('ud.amountNeeded') : null}>
            {(id, d) => <MoneyInput id={id} aria-describedby={d} value={amount} onChange={(e) => setAmount(e.target.value)} invalid={showErrors && !amountOk} autoFocus className="h-14 text-2xl" />}
          </Field>
          <Field label={t('ud.what')} optional>{(id) => <Input id={id} value={what} onChange={(e) => setWhat(e.target.value)} placeholder={t('ud.defaultItem')} maxLength={120} autoComplete="off" />}</Field>
          <Field label={t('ud.paidNow')} hint={t('ud.paidHint')} error={showErrors && !paidOk ? t('bill.overpay') : null}>
            {(id, d) => <MoneyInput id={id} aria-describedby={d} value={paid} onChange={(e) => setPaid(e.target.value)} invalid={showErrors && !paidOk} placeholder="0" />}
          </Field>
          {pd.ok && pd.value > 0 && (
            <div className="-mt-2 mb-4">
              <Segmented label={t('bill.method')} value={method} onChange={setMethod} options={(['cash', 'upi'] as const).map((m) => ({ value: m, label: t(`method.${m}`) }))} />
            </div>
          )}
          <Card className="mb-4">
            <Row label={t('bill.prevDue')}><Money paise={prev} /></Row>
            <Row label={t('bill.newBill')}><Money paise={amt.ok ? amt.value : 0} /></Row>
            <Row label={t('bill.paid')}><Money paise={pd.ok ? pd.value : 0} /></Row>
            <Row label={t('bill.totalDue')} strong><span data-testid="ud-total"><Money paise={Math.max(newTotal, 0)} /></span></Row>
          </Card>
          {failed && <ErrorBox error={failed} />}
          {!online && <Notice tone="warn" icon="offline">{t('bill.offlineBlock')}</Notice>}
          <Button full className="min-h-14 text-lg" disabled={!online}
            onClick={() => { setShowErrors(true); setFailed(null); if (amountOk && paidOk) { setKey(newKey()); setConfirming(true); } }}>{t('ud.save')}</Button>
          <Link href={`/bill?customer=${customer.id}`} className="mt-4 block min-h-11 py-2 text-center font-semibold text-brand-700 underline">{t('ud.items')}</Link>
        </>
      )}
      <Dialog open={confirming} title={t('ud.confirm')} onClose={() => !busy && setConfirming(false)}
        actions={<><Button busy={busy} onClick={submit}>{busy ? t('bill.saving') : t('ud.save')}</Button><Button variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>{t('c.edit')}</Button></>}>
        <p className="mb-2 text-lg font-bold">{customer.name}</p>
        <Row label={t('bill.prevDue')}><Money paise={prev} /></Row>
        <Row label={`${t('bill.newBill')} — ${what.trim() || t('ud.defaultItem')}`}><Money paise={amt.ok ? amt.value : 0} /></Row>
        <Row label={`${t('bill.paid')}${pd.ok && pd.value > 0 ? ` (${t(`method.${method}`)})` : ''}`}><Money paise={pd.ok ? pd.value : 0} /></Row>
        <Row label={t('bill.totalDue')} strong><Money paise={Math.max(newTotal, 0)} /></Row>
        {amt.ok && pd.ok && pd.value > amt.value && <Notice>{t('bill.split', { a: formatPaise(amt.value), b: formatPaise(pd.value - amt.value) })}</Notice>}
      </Dialog>
    </div>
  );
}

export default function UdhariPage() { return <Suspense fallback={<Skeleton lines={4} />}><UdhariScreen /></Suspense>; }
