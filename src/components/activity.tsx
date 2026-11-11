'use client';
import Link from 'next/link';
import type { Activity, EntryType } from '@/lib/api';
import { formatDateTime, useI18n } from '@/lib/i18n';
import { Icon, Money } from './ui';

/** Money in (payments) reads "+", bills read as plain amounts; reversals are labelled in words. */
export const entryHref = (e: { invoice_id: string | null; payment_id: string | null; customer_id?: string | null }): string | null =>
  e.payment_id ? `/payments/${e.payment_id}` : e.invoice_id ? `/bills/${e.invoice_id}` : e.customer_id ? `/customers/${e.customer_id}/ledger` : null;

const ICON: Record<EntryType, string> = { opening_balance: 'clock', invoice: 'list', payment: 'rupee', credit: 'back', invoice_reversal: 'x', payment_reversal: 'x', credit_reversal: 'x' };

export function ActivityList({ rows, timeZone }: { rows: Activity[]; timeZone: string }) {
  const { t, locale } = useI18n();
  return (
    <ul className="divide-y divide-line rounded-2xl border border-line">
      {rows.map((e) => {
        const href = entryHref(e);
        const body = (
          <div className="flex min-h-16 items-center gap-3 px-3 py-2">
            <span className={`flex h-10 w-10 items-center justify-center rounded-full ${e.entry_type === 'payment' ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-ink'}`}><Icon name={ICON[e.entry_type]} className="h-5 w-5" /></span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{e.customer_name ?? t('c.walkIn')}</p>
              <p className="truncate text-sm text-muted">
                {t(`entry.${e.entry_type}`)}{e.invoice_no ? ` #${e.invoice_no}` : ''}{e.method ? ` · ${t(`method.${e.method}`)}` : ''} · {formatDateTime(e.posted_at, locale, timeZone)}
              </p>
            </div>
            <Money paise={Math.abs(e.amount_paise)} className="font-bold" />
          </div>
        );
        return <li key={e.id}>{href ? <Link href={href} className="block hover:bg-slate-50">{body}</Link> : body}</li>;
      })}
    </ul>
  );
}
