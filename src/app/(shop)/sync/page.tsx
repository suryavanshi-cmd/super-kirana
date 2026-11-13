'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Button, Card, EmptyState, ErrorBox, Icon, LinkButton, Money, Notice, PageHeader, Section, useToast } from '@/components/ui';
import { AppError } from '@/lib/api';
import { useOnline } from '@/lib/data';
import { loadDraft, type Draft } from '@/lib/draft';
import { errorKey, formatDateTime, useI18n } from '@/lib/i18n';
import { idbClearAll } from '@/lib/idb';
import { checkStatus, dismissPending, listPending, resend, type Pending } from '@/lib/mutations';
import { useShop } from '@/lib/session';

const TONE: Record<Pending['state'], string> = { confirmed: 'bg-brand-50 text-brand-800', failed: 'bg-red-50 text-red-900', unknown: 'bg-due-bg text-due', sending: 'bg-slate-100 text-ink' };
const ICON: Record<Pending['state'], string> = { confirmed: 'check', failed: 'x', unknown: 'alert', sending: 'clock' };

export default function SyncPage() {
  const { t, locale } = useI18n();
  const { shop, scope } = useShop();
  const online = useOnline();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [rows, setRows] = useState<Pending[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const load = useCallback(async () => { setDraft(await loadDraft(scope)); setRows(await listPending(scope)); }, [scope]);
  useEffect(() => { void load(); }, [load]);

  async function act(p: Pending, action: 'check' | 'resend' | 'dismiss') {
    setBusy(p.key); setError(null);
    try {
      if (action === 'check') { const r = await checkStatus(scope, p.key); toast(r?.state === 'confirmed' ? t('sync.foundSaved') : t('sync.notFound')); }
      else if (action === 'resend') await resend(scope, p.key);
      else await dismissPending(scope, p.key);
    } catch (e) { setError(e instanceof AppError ? e : new AppError('NETWORK', 'network')); }
    finally { setBusy(null); await load(); }
  }
  const stateLabel = (p: Pending) => t(p.state === 'confirmed' ? 'sync.confirmed' : p.state === 'failed' ? 'sync.failed' : p.state === 'sending' ? 'sync.sending' : 'sync.waiting');
  const href = (p: Pending) => (p.result?.invoice_id ? `/bills/${String(p.result.invoice_id)}` : p.result?.payment_id ? `/payments/${String(p.result.payment_id)}` : null);

  return (
    <div>
      <PageHeader title={t('sync.title')} back="/settings" />
      <Notice tone={online ? 'ok' : 'warn'} icon={online ? 'check' : 'offline'}><b>{online ? t('sync.online') : t('sync.offline')}</b></Notice>
      <ErrorBox error={error} />

      <Section title={t('sync.draft')}>
        {draft && draft.lines.length > 0 ? (
          <Card className="flex items-center justify-between gap-3">
            <div><p className="font-semibold">{draft.customerName ?? t('c.walkIn')} · <span className="num">{draft.lines.length}</span> {t('bill.items')}</p>
              <p className="flex items-center gap-1 text-sm text-due"><Icon name="clock" className="h-4 w-4" />{t('sync.local')} — {t('bill.draftSaved')}</p></div>
            <LinkButton href="/bill" variant="secondary">{t('c.open')}</LinkButton>
          </Card>
        ) : <EmptyState icon="check" title={t('sync.noDraft')} />}
      </Section>

      <Section title={t('sync.pending')}>
        {rows.length === 0 && <EmptyState icon="check" title={t('sync.none')} />}
        <ul className="space-y-3">
          {rows.map((p) => (
            <li key={p.key} className="rounded-2xl border border-line bg-white p-3" data-testid="pending-row">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{t(`sync.kind.${p.fn}`)} · {p.label}</p>
                  <p className="text-sm text-muted">{formatDateTime(new Date(p.createdAt).toISOString(), locale, shop.timezone)}</p>
                </div>
                <Money paise={p.amountPaise} className="font-bold" />
              </div>
              <p className={`mt-2 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-sm font-semibold ${TONE[p.state]}`}><Icon name={ICON[p.state]} className="h-4 w-4" />{stateLabel(p)}</p>
              {p.state === 'failed' && <p className="mt-1 text-sm text-red-900">{t(errorKey(p.errorCode ?? 'UNKNOWN'))} {t('err.notSaved')}</p>}
              {p.state === 'unknown' && <p className="mt-1 text-sm">{p.errorCode === 'NOT_ON_SERVER' ? t('sync.notFound') : t('sync.unknownText')}</p>}
              <div className="mt-2 flex flex-wrap gap-2">
                {(p.state === 'unknown' || p.state === 'sending') && <Button className="min-h-11 px-3 text-sm" busy={busy === p.key} disabled={!online} onClick={() => act(p, 'check')}>{t('sync.checkStatus')}</Button>}
                {p.state === 'unknown' && p.errorCode === 'NOT_ON_SERVER' && <Button variant="secondary" className="min-h-11 px-3 text-sm" busy={busy === p.key} disabled={!online} onClick={() => act(p, 'resend')}>{t('sync.resend')}</Button>}
                {p.state === 'confirmed' && href(p) && <Link href={href(p)!} className="inline-flex min-h-11 items-center px-1 font-semibold text-brand-700 underline">{t('c.open')}</Link>}
                {(p.state === 'confirmed' || p.state === 'failed') && <Button variant="ghost" className="min-h-11 px-3 text-sm" onClick={() => act(p, 'dismiss')}>{t('sync.dismiss')}</Button>}
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={t('sync.local')}>
        <Card>
          <p className="text-sm">{t('sync.cacheNote')}</p>
          <Button variant="secondary" className="mt-3" disabled={rows.some((r) => r.state === 'unknown' || r.state === 'sending')}
            onClick={async () => { await idbClearAll(); await load(); toast(t('sync.cleared')); }}>{t('sync.clear')}</Button>
        </Card>
      </Section>
    </div>
  );
}
