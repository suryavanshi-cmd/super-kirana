'use client';
import { useState, type FormEvent } from 'react';
import { AppError, newKey, rpc } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { parseRupees } from '@/lib/money';
import { useShop } from '@/lib/session';
import { useCustomers } from '@/lib/lists';
import { sameName } from '@/lib/translit';
import type { CustomerRow } from '@/lib/api';
import { Button, ErrorBox, Field, Input, MoneyInput } from './ui';

export interface CustomerFormValue { id?: string; name: string; mobile: string; notes: string; is_active?: boolean }

/** Add or edit a customer. Editing never touches bills already posted (they keep their snapshot). */
export function CustomerForm({ initial, initialOpening, onSaved, onCancel }: { initial?: CustomerFormValue; initialOpening?: string; onSaved: (id: string, name: string) => void; onCancel?: () => void }) {
  const { t } = useI18n();
  const { shop, isOwner } = useShop();
  const [f, setF] = useState<CustomerFormValue>(initial ?? { name: '', mobile: '', notes: '' });
  const [opening, setOpening] = useState(initialOpening ?? '');
  const [newId] = useState(newKey);     // stable id: a retry after a lost response cannot create a second customer
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [fieldError, setFieldError] = useState<{ name?: string; mobile?: string; opening?: string }>({});
  const isEdit = !!initial?.id;
  const customers = useCustomers();
  const [warnedName, setWarnedName] = useState('');
  const [dupOf, setDupOf] = useState<CustomerRow | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const errs: typeof fieldError = {};
    if (!f.name.trim()) errs.name = t('err.NAME_REQUIRED');
    if (f.mobile.trim() && !/^[0-9+][0-9 -]{5,14}$/.test(f.mobile.trim())) errs.mobile = t('err.INVALID_MOBILE');
    let openingPaise = 0;
    if (!isEdit && opening.trim()) {
      const p = parseRupees(opening, { allowZero: true });
      if (!p.ok) errs.opening = t('bill.checkAmount'); else openingPaise = p.value;
    }
    // Duplicates split one person's dues across two accounts, so they are caught before saving.
    const others = (customers.data ?? []).filter((c) => c.id !== initial?.id);
    const digits = (s: string) => s.replace(/\D/g, '').slice(-10);
    const sameMobile = f.mobile.trim() ? others.find((c) => c.mobile && digits(c.mobile) === digits(f.mobile)) : undefined;
    if (sameMobile) { errs.mobile = t('cust.dupMobile', { n: sameMobile.name }); setDupOf(sameMobile); }
    setFieldError(errs);
    if (Object.keys(errs).length) return;
    const similar = !isEdit && others.find((c) => sameName(c.name, f.name));
    if (similar && warnedName !== f.name.trim()) {
      setWarnedName(f.name.trim()); setDupOf(similar);
      setFieldError({ name: t('cust.dupName', { n: similar.name }) });
      return;
    }
    setBusy(true); setError(null);
    try {
      const r = await rpc<{ id: string }>('save_customer', { p_shop_id: shop.id, p_customer: {
        ...(isEdit ? { id: initial!.id, is_active: f.is_active } : { new_id: newId, opening_balance_paise: openingPaise }),
        name: f.name.trim(), mobile: f.mobile.trim(), notes: f.notes.trim() } });
      onSaved(r.id, f.name.trim());
    } catch (err) { setError(err instanceof AppError ? err : new AppError('UNKNOWN', 'server')); }
    finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} noValidate>
      <Field label={t('cust.name')} error={fieldError.name}>{(id, d) => <Input id={id} aria-describedby={d} value={f.name} onChange={(e) => { setF({ ...f, name: e.target.value }); setDupOf(null); setFieldError({}); }} invalid={!!fieldError.name} autoComplete="off" maxLength={120} autoFocus={!isEdit} />}</Field>
      <Field label={t('cust.mobile')} optional error={fieldError.mobile}>{(id, d) => <Input id={id} aria-describedby={d} value={f.mobile} onChange={(e) => { setF({ ...f, mobile: e.target.value }); setDupOf(null); setFieldError({}); }} invalid={!!fieldError.mobile} inputMode="tel" autoComplete="off" maxLength={15} className="num" />}</Field>
      <Field label={t('cust.notes')} optional>{(id) => <Input id={id} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} maxLength={500} autoComplete="off" />}</Field>
      {!isEdit && isOwner && (
        <Field label={t('cust.opening')} optional hint={t('cust.openingHint')} error={fieldError.opening}>{(id, d) => <MoneyInput id={id} aria-describedby={d} value={opening} onChange={(e) => setOpening(e.target.value)} invalid={!!fieldError.opening} placeholder="0" />}</Field>
      )}
      {isEdit && (
        <label className="mb-4 flex min-h-11 items-center gap-2 font-semibold">
          <input type="checkbox" className="h-5 w-5 accent-[var(--color-brand-600)]" checked={f.is_active ?? true} onChange={(e) => setF({ ...f, is_active: e.target.checked })} />{t('c.active')}
        </label>
      )}
      {dupOf && !isEdit && (fieldError.name || fieldError.mobile) && (
        <Button variant="secondary" full className="mb-3" onClick={() => onSaved(dupOf.id, dupOf.name)}>{t('cust.useExisting')}: {dupOf.name}</Button>
      )}
      <ErrorBox error={error} notSaved />
      <div className="flex flex-col gap-2 sm:flex-row-reverse">
        <Button type="submit" full busy={busy}>{t('c.save')}</Button>
        {onCancel && <Button variant="ghost" full onClick={onCancel}>{t('c.cancel')}</Button>}
      </div>
    </form>
  );
}
