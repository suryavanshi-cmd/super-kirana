'use client';
import Link from 'next/link';
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type Ref, type SelectHTMLAttributes } from 'react';
import { AppError, reportError } from '@/lib/api';
import type { Key } from '@/lib/dictionary';
import { errorKey, useI18n } from '@/lib/i18n';
import { formatPaise, parseRupees } from '@/lib/money';
import { paiseInWords } from '@/lib/words';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// ------------------------------------------------------------------ icons
const PATHS: Record<string, string> = {
  home: 'M3 11.5 12 4l9 7.5M5.5 10v9.5h13V10',
  users: 'M16 19v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V19M9.5 9.5a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5ZM21 19v-1.5a4 4 0 0 0-3-3.85M15.5 3.2a3.25 3.25 0 0 1 0 6.2',
  plus: 'M12 5v14M5 12h14',
  box: 'M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5v-9ZM3.5 7.5 12 12l8.5-4.5M12 12v9',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  sort: 'M7 4v16M7 4 4 7M7 4l3 3M7 20l-3-3M7 20l3-3M13 7h8M13 12h6M13 17h4',
  book: 'M2 5.5C4 4.5 7 4.3 12 6c5-1.7 8-1.5 10-.5V19c-2-1-5-1.2-10 .5-5-1.7-8-1.5-10-.5ZM12 6v13.5',
  camera: 'M4 8h3l1.5-2.5h7L17 8h3v11H4V8ZM12 16.5a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5Z',
  cog: 'M12 15.25a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5ZM19.4 13.5a1.5 1.5 0 0 0 .3 1.65l.05.05a1.8 1.8 0 1 1-2.55 2.55l-.05-.05a1.5 1.5 0 0 0-2.55 1.06V19a1.8 1.8 0 0 1-3.6 0v-.08a1.5 1.5 0 0 0-2.55-1.02l-.05.05a1.8 1.8 0 1 1-2.55-2.55l.05-.05A1.5 1.5 0 0 0 4.84 12.8H4.8a1.8 1.8 0 0 1 0-3.6h.08A1.5 1.5 0 0 0 5.9 6.65l-.05-.05A1.8 1.8 0 1 1 8.4 4.05l.05.05a1.5 1.5 0 0 0 1.65.3h.02a1.5 1.5 0 0 0 .9-1.37V3a1.8 1.8 0 0 1 3.6 0v.08a1.5 1.5 0 0 0 2.55 1.02l.05-.05a1.8 1.8 0 1 1 2.55 2.55l-.05.05a1.5 1.5 0 0 0-.3 1.65v.02a1.5 1.5 0 0 0 1.37.9H21a1.8 1.8 0 0 1 0 3.6h-.08a1.5 1.5 0 0 0-1.52.68Z',
  back: 'M15 5l-7 7 7 7',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-3.9-3.9',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  alert: 'M12 8.5v4.5M12 16.5h.01M10.3 3.9 2.6 17.2A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0Z',
  offline: 'M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 3.3-2.2M19 13a10 10 0 0 0-5.5-2.8M2 9.5A15 15 0 0 1 6 7M22 9.5A15 15 0 0 0 10.5 5.1M12 20h.01',
  x: 'M6 6l12 12M18 6 6 18',
  rupee: 'M7 5h10M7 9h10M7 5c4.5 0 6 1.5 6 4s-1.5 4-6 4l7 6',
  print: 'M7 8V4h10v4M7 17H5a1.5 1.5 0 0 1-1.5-1.5v-6A1.5 1.5 0 0 1 5 8h14a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 19 17h-2M7 14h10v6H7v-6Z',
  share: 'M12 15V3.5M8 7l4-3.5L16 7M5 12v7.5h14V12',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5.2l3.3 2',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  shop: 'M4 10v10h16V10M3 10l1.5-6h15L21 10a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0ZM9.5 20v-5.5h5V20',
  chevron: 'M9 5l7 7-7 7',
  download: 'M12 3.5V15M8 11.5l4 3.5 4-3.5M5 20h14',
  menu: 'M4 6.5h16M4 12h16M4 17.5h16',
  logout: 'M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10',
  edit: 'M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4',
  userPlus: 'M15 19v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V19M9 9.5a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5ZM19 8v6M16 11h6',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3ZM5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7',
};
export function Icon({ name, className }: { name: keyof typeof PATHS | string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" className={cx('h-6 w-6 shrink-0', className)}><path d={PATHS[name] ?? PATHS.alert} /></svg>
  );
}

// ------------------------------------------------------------------ buttons
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const VARIANT: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 disabled:bg-brand-200',
  secondary: 'bg-white text-brand-700 border border-brand-600 hover:bg-brand-50 disabled:text-muted disabled:border-line',
  ghost: 'bg-transparent text-ink hover:bg-slate-100 disabled:text-muted',
  danger: 'bg-white text-red-800 border border-red-700 hover:bg-red-50 disabled:text-muted disabled:border-line',
};
const BTN = 'inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 py-2 text-base font-semibold disabled:cursor-not-allowed';

export function Button({ variant = 'primary', busy, full, className, children, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean; full?: boolean }) {
  return (
    <button type="button" {...rest} disabled={rest.disabled || busy} aria-busy={busy || undefined}
      className={cx(BTN, VARIANT[variant], full && 'w-full', className)}>
      {busy && <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />}
      {children}
    </button>
  );
}
export function LinkButton({ href, variant = 'primary', full, className, children }:
  { href: string; variant?: Variant; full?: boolean; className?: string; children: ReactNode }) {
  return <Link href={href} className={cx(BTN, VARIANT[variant], full && 'w-full', className)}>{children}</Link>;
}

// ------------------------------------------------------------------ layout bits
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('rounded-2xl border border-transparent bg-white p-4 shadow-[0_1px_3px_rgba(16,24,40,.08)]', className)}>{children}</div>;
}
export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-6">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-base font-bold text-ink">{title}</h2>{action}
      </div>
      {children}
    </section>
  );
}
export function PageHeader({ title, back, action }: { title: string; back?: string; action?: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="no-print mb-4 flex items-center gap-2">
      {back && <Link href={back} aria-label={t('nav.back')} className="-ml-2 flex h-12 w-12 items-center justify-center rounded-full hover:bg-slate-100"><Icon name="back" /></Link>}
      <h1 className="min-w-0 flex-1 truncate text-xl font-bold">{title}</h1>
      {action}
    </div>
  );
}

// ------------------------------------------------------------------ form fields
export function Field({ label, hint, error, optional, children }: { label: string; hint?: string; error?: string | null; optional?: boolean; children: (id: string, describedBy: string | undefined) => ReactNode }) {
  const id = useId();
  const { t } = useI18n();
  const desc = error ? `${id}-e` : hint ? `${id}-h` : undefined;
  return (
    <div className="mb-4">
      <label htmlFor={id} className="mb-1 block text-sm font-semibold text-ink">
        {label}{optional && <span className="ml-1 font-normal text-muted">({t('c.optional')})</span>}
      </label>
      {children(id, desc)}
      {error ? <p id={`${id}-e`} role="alert" className="mt-1 flex items-start gap-1 text-sm font-medium text-red-800"><Icon name="alert" className="mt-0.5 h-4 w-4" />{error}</p>
        : hint ? <p id={`${id}-h`} className="mt-1 text-sm text-muted">{hint}</p> : null}
    </div>
  );
}
const INPUT = 'block min-h-12 w-full rounded-xl border border-slate-400 bg-white px-3 text-base text-ink placeholder:text-slate-500 focus:border-brand-600 disabled:bg-slate-100';
export function Input({ invalid, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; ref?: Ref<HTMLInputElement> }) {
  return <input {...rest} aria-invalid={invalid || undefined} className={cx(INPUT, invalid && 'border-red-700', className)} />;
}
/** Money input: decimal keypad on phones, ₹ prefix, text value (parsed with parseRupees).
 *  With `words`, the typed amount is spelled out below so an extra zero is easy to spot. */
export function MoneyInput({ invalid, className, words, ...rest }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; words?: boolean; ref?: Ref<HTMLInputElement> }) {
  const { locale } = useI18n();
  const parsed = words && typeof rest.value === 'string' && rest.value.trim() ? parseRupees(rest.value, { allowZero: true }) : null;
  return (
    <div>
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-lg font-semibold text-muted" aria-hidden="true">₹</span>
      <input {...rest} inputMode="decimal" autoComplete="off" enterKeyHint="done" aria-invalid={invalid || undefined}
        className={cx(INPUT, 'num pl-8 text-lg font-semibold', invalid && 'border-red-700', className)} />
    </div>
    {parsed?.ok && parsed.value > 0 && <p className="mt-1 text-sm font-medium text-brand-800" data-testid="amount-words">{paiseInWords(parsed.value, locale)}</p>}
    </div>
  );
}
export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...rest} className={cx(INPUT, 'pr-8', className)}>{children}</select>;
}
export function SearchBox({ value, onChange, placeholder, autoFocus }: { value: string; onChange: (v: string) => void; placeholder: string; autoFocus?: boolean }) {
  return (
    <div className="relative">
      <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" />
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder}
        autoFocus={autoFocus} autoComplete="off" enterKeyHint="search" className={cx(INPUT, 'pl-10')} />
    </div>
  );
}
export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid auto-cols-fr grid-flow-col gap-1 rounded-xl bg-slate-100 p-1">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
          className={cx('min-h-11 rounded-lg px-2 text-sm font-semibold', value === o.value ? 'bg-white text-brand-700 shadow-sm ring-1 ring-brand-600' : 'text-ink')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ money display
export function Money({ paise, className, short }: { paise: number; className?: string; short?: boolean }) {
  // short: whole rupees without ".00" (₹5,000), paise kept when there are any (₹45.50).
  const s = formatPaise(paise);
  return <span className={cx('num whitespace-nowrap', className)}>{short && s.endsWith('.00') ? s.slice(0, -3) : s}</span>;
}
/** Pending balance: always a word + an icon + colour, never colour alone. */
export function DueTag({ paise }: { paise: number }) {
  const { t } = useI18n();
  // Khata style: the amount in colour, with what it means underneath.
  if (paise === 0) return <span className="text-right text-sm font-semibold text-muted">{t('cust.noDue')}</span>;
  const get = paise > 0;
  return (
    <span className="text-right leading-tight">
      <span className={`block text-lg font-bold ${get ? 'text-due' : 'text-got'}`}><Money paise={Math.abs(paise)} /></span>
      <span className="block text-xs text-muted">{get ? t('home.youGet') : t('home.youGive')}</span>
    </span>
  );
}
export function Row({ label, children, strong }: { label: string; children: ReactNode; strong?: boolean }) {
  return (
    <div className={cx('flex items-baseline justify-between gap-3 py-1.5', strong && 'border-t border-line pt-2.5 text-lg font-bold')}>
      <span className={strong ? '' : 'text-muted'}>{label}</span><span className="text-right font-semibold">{children}</span>
    </div>
  );
}

// ------------------------------------------------------------------ states
export function Skeleton({ lines = 3 }: { lines?: number }) {
  const { t } = useI18n();
  return (
    <div role="status" aria-label={t('c.loading')} className="space-y-3 py-2">
      {Array.from({ length: lines }, (_, i) => <div key={i} className="h-14 animate-pulse rounded-2xl bg-slate-100" />)}
    </div>
  );
}
export function EmptyState({ icon = 'list', title, hint, action }: { icon?: string; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-300 px-4 py-10 text-center">
      <Icon name={icon} className="h-10 w-10 text-muted" />
      <p className="mt-3 text-base font-semibold">{title}</p>
      {hint && <p className="mt-1 max-w-xs text-sm text-muted">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
/** Explains what happened, the actual reason (step, status, what the server said) and a reference. */
export function ErrorBox({ error, onRetry, notSaved }: { error: AppError | string | null; onRetry?: () => void; notSaved?: boolean }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (error && typeof error !== 'string') reportError(error); }, [error]);
  if (!error) return null;
  const text = typeof error === 'string' ? error : t(errorKey(error.code));
  const cause = typeof error === 'string' ? '' : error.reason || (errorKey(error.code) === 'err.UNKNOWN' ? error.code : '');
  const ref = typeof error === 'string' ? '' : error.ref;
  const copy = () => { void navigator.clipboard?.writeText(`${text}\n${t('err.reason')}: ${cause || '-'}\n${t('err.ref')}: ${ref}`).then(() => setCopied(true), () => undefined); };
  return (
    <div role="alert" data-testid="error" className="my-3 flex items-start gap-3 rounded-2xl border border-red-300 bg-red-50 p-3 text-red-900">
      <Icon name="alert" className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{text}</p>
        {notSaved && <p className="text-sm">{t('err.notSaved')}</p>}
        {cause && <p data-testid="error-cause" className="mt-1 break-words text-sm"><span className="font-semibold">{t('err.reason')}:</span> {cause}</p>}
        {ref && (
          <p className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-red-800">
            <span>{t('err.ref')}: <span className="font-mono">{ref}</span></span>
            <button type="button" onClick={copy} className="min-h-9 font-semibold underline">{copied ? t('err.copied') : t('err.copy')}</button>
          </p>
        )}
        {onRetry && <button type="button" onClick={onRetry} className="mt-1 min-h-11 font-semibold underline">{t('c.retry')}</button>}
      </div>
    </div>
  );
}
/** One line for toasts: the message plus the actual reason. */
export function errorLine(t: (k: Key) => string, e: unknown): string {
  if (e instanceof AppError) return [t(errorKey(e.code)), e.reason].filter(Boolean).join(' — ');
  return `${t('err.UNKNOWN')} — ${e instanceof Error ? e.message : String(e)}`.slice(0, 300);
}
export function Notice({ tone = 'info', icon, children }: { tone?: 'info' | 'warn' | 'ok'; icon?: string; children: ReactNode }) {
  const tones = { info: 'border-slate-300 bg-slate-50 text-ink', warn: 'border-amber-300 bg-due-bg text-due', ok: 'border-brand-200 bg-brand-50 text-brand-800' };
  return (
    <div className={cx('my-3 flex items-start gap-2 rounded-2xl border p-3 text-sm', tones[tone])}>
      <Icon name={icon ?? (tone === 'ok' ? 'check' : tone === 'warn' ? 'alert' : 'clock')} className="mt-0.5 h-5 w-5" /><div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
export function StaleNote({ show }: { show: boolean }) {
  const { t } = useI18n();
  return show ? <Notice tone="warn" icon="offline">{t('sync.staleData')}</Notice> : null;
}

// ------------------------------------------------------------------ dialog
export function Dialog({ open, title, onClose, children, actions }: { open: boolean; title: string; onClose: () => void; children: ReactNode; actions?: ReactNode }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="no-print fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-5 outline-none sm:rounded-3xl">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 id={titleId} className="text-lg font-bold">{title}</h2>
          <button type="button" onClick={onClose} aria-label={t('c.close')} className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-slate-100"><Icon name="x" /></button>
        </div>
        {children}
        {actions && <div className="mt-5 flex flex-col gap-2 sm:flex-row-reverse">{actions}</div>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ toast
const ToastCtx = createContext<(text: string) => void>(() => undefined);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [text, setText] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((s: string) => {
    setText(s);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setText(null), 3500);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div aria-live="polite" className="no-print pointer-events-none fixed inset-x-0 bottom-[calc(var(--fab-offset,0px)+6rem)] z-[60] flex justify-center px-4">
        {text && <div className="flex items-center gap-2 rounded-full bg-ink px-4 py-3 text-sm font-semibold text-white shadow-lg"><Icon name="check" className="h-5 w-5" />{text}</div>}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

export function LanguageSwitch({ compact }: { compact?: boolean }) {
  const { locale, setLocale, t } = useI18n();
  return (
    <div className={compact ? 'w-40' : ''}>
      <Segmented label={t('c.language')} value={locale} onChange={setLocale}
        options={[{ value: 'mr-IN', label: t('c.marathi') }, { value: 'en-IN', label: t('c.english') }]} />
    </div>
  );
}
