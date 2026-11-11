'use client';
import { useState } from 'react';
import { AppError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { parseRupees } from '@/lib/money';
import { Button, Dialog, ErrorBox, Field, Input, MoneyInput } from './ui';

/** Confirmation dialog for owner-only corrections. A reason is always required and audited. */
export function ReasonDialog({ open, title, hint, confirmLabel, withAmount, maxPaise, onClose, onSubmit }: {
  open: boolean; title: string; hint: string; confirmLabel: string; withAmount?: string; maxPaise?: number;
  onClose: () => void; onSubmit: (reason: string, amountPaise: number) => Promise<void>;
}) {
  const { t } = useI18n();
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | string | null>(null);
  async function go() {
    if (reason.trim().length < 3) { setError(t('err.REASON_REQUIRED')); return; }
    let paise = 0;
    if (withAmount) {
      const p = parseRupees(amount);
      if (!p.ok || (maxPaise !== undefined && p.value > maxPaise)) { setError(t('bill.checkAmount')); return; }
      paise = p.value;
    }
    setBusy(true); setError(null);
    try { await onSubmit(reason.trim(), paise); setReason(''); setAmount(''); onClose(); }
    catch (e) { setError(e instanceof AppError ? e : new AppError('UNKNOWN', 'server')); }
    finally { setBusy(false); }
  }
  return (
    <Dialog open={open} title={title} onClose={onClose}
      actions={<><Button variant="danger" busy={busy} onClick={go}>{confirmLabel}</Button><Button variant="ghost" onClick={onClose}>{t('c.cancel')}</Button></>}>
      <p className="mb-3 text-sm text-muted">{hint}</p>
      {withAmount && <Field label={withAmount}>{(id) => <MoneyInput id={id} value={amount} onChange={(e) => setAmount(e.target.value)} />}</Field>}
      <Field label={t('c.reason')}>{(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} autoComplete="off" />}</Field>
      <ErrorBox error={error} notSaved={typeof error !== 'string'} />
    </Dialog>
  );
}
