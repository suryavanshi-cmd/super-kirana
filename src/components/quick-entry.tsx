'use client';
// Quick udhari entry: three fields (customer, amount, what they bought — optional) and ONE Save tap.
//
// The sheet is always mounted (hidden below the screen), so the button that opens it can put the
// cursor in the first box inside the same tap — the only way iPhone Safari opens the keyboard.
// A mic button fills all three fields from one sentence ("सुरेश 500 साखर").
import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { failedText, UnknownOutcome } from './outcome';
import { MicHelp, speechLabel } from './mic-help';
import { DueTag, ErrorBox, Icon, Input, MoneyInput, useToast } from './ui';
import { AppError, newKey, rpc, type CustomerRow } from '@/lib/api';
import { matches, refreshScreens, useOnline } from '@/lib/data';
import { useI18n } from '@/lib/i18n';
import { useCustomers } from '@/lib/lists';
import { formatPaise, paiseToInputText, parseRupees } from '@/lib/money';
import { send, type Pending } from '@/lib/mutations';
import { useShop } from '@/lib/session';
import { parseVoice } from '@/lib/voice/parse';
import { savedLang, useSpeech } from '@/lib/voice/useSpeech';

export type EntryMode = 'new' | 'existing' | 'update';
type Open = (mode: EntryMode, customerId?: string) => void;
const Ctx = createContext<Open>(() => undefined);
/** Opens the quick entry. Call it straight from a click handler so the keyboard can open. */
export const useQuickEntry = () => useContext(Ctx);

export function QuickEntryProvider({ children }: { children: ReactNode }) {
  const api = useRef<Open>(() => undefined);
  const open = useCallback<Open>((m, id) => api.current(m, id), []);
  return <Ctx.Provider value={open}>{children}<QuickEntrySheet register={(f) => { api.current = f; }} /></Ctx.Provider>;
}

function QuickEntrySheet({ register }: { register: (f: Open) => void }) {
  const { t, locale } = useI18n();
  const { shop, scope } = useShop();
  const router = useRouter();
  const toast = useToast();
  const online = useOnline();
  const customers = useCustomers();
  const sheet = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const amountBox = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<EntryMode>('existing');
  const [name, setName] = useState('');
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [what, setWhat] = useState('');
  const [key, setKey] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);

  const all = useMemo(() => (customers.data ?? []).filter((c) => c.is_active), [customers.data]);
  const customer: CustomerRow | null = all.find((c) => c.id === customerId) ?? null;
  const amt = parseRupees(amount);
  const sameName = mode === 'new' && name.trim() ? all.find((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase()) : undefined;
  const suggestions = mode !== 'new' && !customer ? (name.trim() ? all.filter((c) => matches(name, c.name, c.mobile)) : all).slice(0, 6) : [];

  const reset = useCallback(() => {
    setName(''); setCustomerId(null); setAmount(''); setWhat(''); setError(null); setShowErrors(false); setPending(null); setKey(newKey());
  }, []);

  useEffect(() => {
    register((m, id) => {
      // Inside the tap: un-hide and focus first, then render — iPhone opens the keyboard only here.
      if (sheet.current) sheet.current.inert = false;
      if (amountBox.current) { amountBox.current.inert = m === 'update'; if (m !== 'update') amountBox.current.classList.remove('hidden'); }   // the amount box is always in the page, so it can take focus now
      (id ? amountRef.current : nameRef.current)?.focus({ preventScroll: true });
      reset();
      setMode(m); setCustomerId(id ?? null); setOpen(true);
    });
  }, [register, reset]);
  useEffect(() => { if (sheet.current) sheet.current.inert = !open; }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) close(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  function close() { (document.activeElement as HTMLElement | null)?.blur(); setOpen(false); }

  function pick(c: CustomerRow) {
    if (mode === 'update') { close(); router.push(`/customers/${c.id}`); return; }
    setCustomerId(c.id); setMode('existing'); setName('');
    amountRef.current?.focus();
  }

  // ---- mic: one sentence fills customer, amount and item
  const [lang] = useState(() => savedLang(locale === 'en-IN' ? 'en-IN' : 'mr-IN'));
  const speech = useSpeech(lang, (alts) => {
    const d = parseVoice(alts[0] ?? '', all);
    if (d.amountPaise) setAmount(paiseToInputText(d.amountPaise));
    if (d.what) setWhat(d.what);
    const best = d.matches[0];
    if (best && best.score >= 0.75 && mode !== 'new') { setCustomerId(best.customer.id); setMode('existing'); setName(''); }
    else if (d.name) setName(d.name);
  });

  async function save() {
    setShowErrors(true); setError(null);
    const nm = name.trim();
    if (mode === 'new' ? !nm : !customer) { (mode === 'new' || !customer ? nameRef : amountRef).current?.focus(); return; }
    if (!amt.ok) { amountRef.current?.focus(); return; }
    setBusy(true);
    try {
      let id = customer?.id ?? null, label = customer?.name ?? nm;
      if (!id) {
        const r = await rpc<{ id: string }>('save_customer', { p_shop_id: shop.id, p_customer: { new_id: crypto.randomUUID(), name: nm, mobile: null, notes: null } });
        id = r.id; label = nm;
        // If the bill below fails, the customer already exists: keep them selected for the retry.
        setCustomerId(id); setMode('existing'); void customers.reload();
      }
      const p = await send(scope, { key, fn: 'create_invoice', shopId: shop.id, label, amountPaise: amt.value,
        args: { p_shop_id: shop.id, p_idempotency_key: key, p_customer_id: id,
          p_items: [{ product_id: null, name: what.trim() || t('ud.defaultItem'), qty: '1', unit: 'piece', price_unit: 'piece', unit_price_paise: amt.value, discount_paise: 0 }],
          p_paid_paise: 0, p_payment_method: 'cash', p_payment_reference: null, p_note: null, p_source: 'manual', p_ocr_job_id: null } });
      if (p.state === 'confirmed') done(p, label);
      else if (p.state === 'failed') { setError(failedText(t, p)); setKey(newKey()); }
      else setPending(p);
    } catch (e) {
      setError(e instanceof AppError ? e : new AppError('UNKNOWN', 'server', String(e)));
    } finally { setBusy(false); }
  }
  function done(p: Pending, label: string) {
    const total = Number((p.result as { new_balance_paise?: number } | undefined)?.new_balance_paise ?? 0);
    toast(t('qe.saved', { n: label, a: formatPaise(amt.ok ? amt.value : 0), b: formatPaise(total) }));
    refreshScreens();
    close();
  }

  const title = mode === 'new' ? t('qe.newTitle') : mode === 'update' ? t('qe.updateTitle') : t('qe.existingTitle');
  const listening = speech.status === 'listening';
  return (
    <div className="no-print">
      {open && <div className="fixed inset-0 z-[55] bg-black/40" onClick={() => !busy && close()} aria-hidden="true" />}
      <div ref={sheet} role="dialog" aria-modal="true" aria-label={title} data-testid="quick-entry"
        className={`fixed inset-x-0 bottom-0 z-[56] mx-auto max-h-[92dvh] max-w-3xl overflow-y-auto rounded-t-3xl bg-white px-4 pb-6 pt-3 shadow-2xl transition-transform duration-200 ease-out ${open ? 'translate-y-0' : 'pointer-events-none translate-y-full'}`}
        style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}>
        <div className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-slate-300" aria-hidden="true" />
        <div className="mb-3 flex items-center gap-2">
          <h2 className="min-w-0 flex-1 truncate text-lg font-bold">{title}</h2>
          <button type="button" onClick={close} disabled={busy} aria-label={t('c.cancel')} className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-slate-100"><Icon name="x" /></button>
        </div>

        {pending ? (
          <UnknownOutcome pending={pending} scope={scope} onConfirmed={(p) => done(p, customer?.name ?? name)} onFailed={(p) => { setPending(null); setError(failedText(t, p)); setKey(newKey()); }} />
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); void save(); }} noValidate>
            {/* 1. Customer */}
            {customer ? (
              <button type="button" onClick={() => { setCustomerId(null); setName(''); nameRef.current?.focus(); }} data-testid="qe-customer"
                className="mb-3 flex min-h-14 w-full items-center gap-3 rounded-2xl bg-brand-50 p-3 text-left">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-600 font-bold text-white" aria-hidden="true">{[...customer.name][0]}</span>
                <span className="min-w-0 flex-1 truncate text-lg font-bold">{customer.name}</span>
                <DueTag paise={customer.balance_paise} />
                <span className="text-sm font-semibold text-brand-700">{t('qe.change')}</span>
              </button>
            ) : null}
            <div className={customer ? 'sr-only' : 'mb-3'}>
              <label htmlFor="qe-name" className="mb-1 block text-sm font-semibold">{mode === 'new' ? t('qe.name') : t('qe.search')}</label>
              <div className="flex gap-2">
                <Input id="qe-name" ref={nameRef} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" autoCapitalize="words" enterKeyHint="next" maxLength={120}
                  invalid={showErrors && (mode === 'new' ? !name.trim() : !customer)} className="h-14 text-lg" data-testid="qe-name"
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (suggestions.length === 1) pick(suggestions[0]); else amountRef.current?.focus(); } }} />
                <button type="button" onClick={() => (listening ? speech.stop() : void speech.start())} aria-label={t('qe.speak')} data-testid="qe-mic"
                  className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-xl text-white ${listening ? 'animate-pulse bg-red-600' : 'bg-brand-600'}`}><Icon name="mic" /></button>
              </div>
              {(listening || speech.status === 'thinking') && <p className="mt-1 text-sm text-muted">{speechLabel(t, speech, '')}</p>}
              <MicHelp status={speech.status} os={speech.os} onRetry={speech.retry} cause={speech.cause} />
              {showErrors && mode === 'new' && !name.trim() && <p role="alert" className="mt-1 text-sm font-medium text-red-800">{t('qe.nameNeeded')}</p>}
              {showErrors && mode !== 'new' && !customer && <p role="alert" className="mt-1 text-sm font-medium text-red-800">{t('qe.pickOne')}</p>}
              {sameName && (
                <button type="button" onClick={() => pick(sameName)} className="mt-2 w-full rounded-xl bg-due-bg p-2 text-left text-sm font-semibold text-due">{t('qe.exists')}</button>
              )}
              {suggestions.length > 0 && (
                <ul className="mt-2 max-h-64 divide-y divide-line overflow-y-auto rounded-2xl border border-line bg-white" data-testid="qe-suggestions">
                  {suggestions.map((c) => (
                    <li key={c.id}>
                      <button type="button" onClick={() => pick(c)} className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left hover:bg-slate-50">
                        <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{c.name}</span>{c.mobile && <span className="num block text-xs text-muted">{c.mobile}</span>}</span>
                        <DueTag paise={c.balance_paise} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {mode === 'existing' && name.trim() && suggestions.length === 0 && customers.data && (
                <button type="button" onClick={() => { setMode('new'); nameRef.current?.focus(); }} className="mt-2 w-full rounded-xl border border-dashed border-brand-600 p-3 text-left font-semibold text-brand-700">
                  + {t('qe.addNamed', { n: name.trim() })}
                </button>
              )}
            </div>

            <div ref={amountBox} className={mode === 'update' ? 'hidden' : ''}>
              {(
              <>
                {/* 2. Amount */}
                <label htmlFor="qe-amount" className="mb-1 block text-sm font-semibold">{t('qe.amount')}</label>
                <MoneyInput id="qe-amount" ref={amountRef} value={amount} onChange={(e) => setAmount(e.target.value)} words enterKeyHint="next" data-testid="qe-amount"
                  invalid={showErrors && !amt.ok} className="h-14 text-2xl"
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (document.getElementById('qe-what') as HTMLInputElement | null)?.focus(); } }} />
                {showErrors && !amt.ok && <p role="alert" className="mt-1 text-sm font-medium text-red-800">{t('ud.amountNeeded')}</p>}
                {/* 3. What they bought (optional) */}
                <label htmlFor="qe-what" className="mb-1 mt-3 block text-sm font-semibold">{t('qe.what')} <span className="font-normal text-muted">({t('c.optional')})</span></label>
                <Input id="qe-what" value={what} onChange={(e) => setWhat(e.target.value)} maxLength={120} autoComplete="off" enterKeyHint="done" placeholder={t('ud.defaultItem')} data-testid="qe-what" />
                <ErrorBox error={error} notSaved />
                <button type="submit" disabled={busy || !online} data-testid="qe-save"
                  className="mt-4 flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 text-lg font-bold text-white disabled:bg-brand-200">
                  {busy && <span className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" aria-hidden="true" />}
                  {busy ? t('bill.saving') : amt.ok ? `${t('qe.save')} · ${formatPaise(amt.value)}` : t('qe.save')}
                </button>
                {!online && <p className="mt-2 text-sm font-semibold text-due">{t('bill.offlineBlock')}</p>}
              </>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
