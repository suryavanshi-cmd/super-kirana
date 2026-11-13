'use client';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { failedText, UnknownOutcome } from '@/components/outcome';
import { Button, Card, Dialog, ErrorBox, Field, Input, LinkButton, Money, MoneyInput, Notice, PageHeader, Row, Segmented, Skeleton, useToast } from '@/components/ui';
import { newKey, rpc, type CustomerDetail, type Method } from '@/lib/api';
import { useOnline, useQuery } from '@/lib/data';
import { useI18n } from '@/lib/i18n';
import { formatPaise, paiseToInputText, parseRupees } from '@/lib/money';
import { send, type Pending } from '@/lib/mutations';
import { useShop } from '@/lib/session';

function ReceivePayment() {
  const { id } = useParams<{ id: string }>();
  const { t } = useI18n();
  const { shop, scope } = useShop();
  const router = useRouter();
  const toast = useToast();
  const online = useOnline();
  const q = useQuery(() => rpc<CustomerDetail>('get_customer', { p_shop_id: shop.id, p_customer_id: id }), [shop.id, id], `${scope}customer:${id}`);
  const spoken = useSearchParams().get('amount');     // from the voice screen
  const [amount, setAmount] = useState(() => (spoken && /^\d{1,9}(\.\d{1,2})?$/.test(spoken) ? spoken : ''));
  const [method, setMethod] = useState<Method>('cash');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [key, setKey] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const c = q.data;
  const parsed = parseRupees(amount);
  const paise = parsed.ok ? parsed.value : 0;
  const tooMuch = !!c && parsed.ok && paise > c.balance_paise;
  const invalid = amount !== '' && (!parsed.ok || tooMuch);

  const done = (p: Pending) => { toast(t('pay.saved')); router.replace(`/payments/${String(p.result?.payment_id)}`); };
  const onFailed = (p: Pending) => { setPending(null); setConfirming(false); setFailed(failedText(t, p)); setKey(newKey()); void q.reload(); };

  async function submit() {
    if (!c || !parsed.ok || tooMuch) return;
    setBusy(true); setFailed(null);
    const p = await send(scope, { key, fn: 'receive_payment', shopId: shop.id, label: c.name, amountPaise: paise,
      args: { p_shop_id: shop.id, p_idempotency_key: key, p_customer_id: id, p_amount_paise: paise, p_method: method,
        p_reference: reference.trim() || null, p_note: note.trim() || null } });
    setBusy(false); setConfirming(false);
    if (p.state === 'confirmed') done(p); else if (p.state === 'failed') onFailed(p); else setPending(p);
  }

  if (!c) return <div><PageHeader title={t('pay.title')} back={`/customers/${id}`} />{q.loading ? <Skeleton /> : <ErrorBox error={q.error} onRetry={q.reload} />}</div>;
  return (
    <div>
      <PageHeader title={t('pay.title')} back={`/customers/${id}`} />
      <Card className="border-amber-200 bg-due-bg">
        <p className="font-semibold">{c.name}</p>
        <p className="text-sm font-semibold text-due">{t('cust.balance')}</p>
        <p className="text-2xl font-bold"><Money paise={c.balance_paise} /></p>
      </Card>
      {pending && <UnknownOutcome pending={pending} scope={scope} onConfirmed={done} onFailed={onFailed} />}
      {c.balance_paise === 0 && <><Notice tone="ok">{t('pay.nothingDue')}</Notice><LinkButton href={`/customers/${id}`} variant="secondary" full>{t('nav.back')}</LinkButton></>}
      {c.balance_paise > 0 && !pending && (
        <div className="mt-4">
          <Notice>{t('pay.oldDuesNote')}</Notice>
          {failed && <ErrorBox error={failed} />}
          <Field label={t('pay.amount')} error={invalid ? (tooMuch ? t('pay.tooMuch', { a: formatPaise(c.balance_paise) }) : t('bill.checkAmount')) : null}>
            {(fid, d) => <MoneyInput id={fid} aria-describedby={d} value={amount} onChange={(e) => setAmount(e.target.value)} invalid={invalid} autoFocus words />}
          </Field>
          <Button variant="secondary" className="mb-4" onClick={() => setAmount(paiseToInputText(c.balance_paise))}>{t('pay.fullDue')} · <Money paise={c.balance_paise} /></Button>
          <p className="mb-1 text-sm font-semibold">{t('bill.method')}</p>
          <Segmented label={t('bill.method')} value={method} onChange={setMethod} options={(['cash', 'upi', 'other'] as const).map((m) => ({ value: m, label: t(`method.${m}`) }))} />
          <p className="mb-4 mt-1 text-xs text-muted">{t('method.note')}</p>
          {method !== 'cash' && <Field label={t('bill.reference')} optional>{(fid) => <Input id={fid} value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} autoComplete="off" />}</Field>}
          <Field label={t('c.note')} optional>{(fid) => <Input id={fid} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} autoComplete="off" />}</Field>
          {!online && <Notice tone="warn" icon="offline">{t('sync.offlineBanner')}</Notice>}
          <Button full disabled={!parsed.ok || tooMuch || !online} onClick={() => setConfirming(true)}>{t('pay.confirm')}</Button>
        </div>
      )}
      <Dialog open={confirming} title={t('pay.confirmTitle')} onClose={() => !busy && setConfirming(false)}
        actions={<><Button busy={busy} onClick={submit}>{t('pay.confirm')}</Button><Button variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>{t('c.cancel')}</Button></>}>
        <Row label={t('bill.customer')}>{c.name}</Row>
        <Row label={t('bill.prevDue')}><Money paise={c.balance_paise} /></Row>
        <Row label={`${t('pay.amount')} (${t(`method.${method}`)})`}><Money paise={paise} /></Row>
        <Row label={t('pay.afterDue')} strong><Money paise={c.balance_paise - paise} /></Row>
      </Dialog>
    </div>
  );
}

export default function ReceivePaymentPage() { return <Suspense fallback={<Skeleton />}><ReceivePayment /></Suspense>; }
