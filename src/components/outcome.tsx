'use client';
import { useState } from 'react';
import { AppError } from '@/lib/api';
import { errorKey, useI18n } from '@/lib/i18n';
import { checkStatus, resend, type Pending } from '@/lib/mutations';
import { Button, ErrorBox, Icon, Notice } from './ui';

/**
 * Shown when a bill/payment request ended without a clear answer from the server.
 * It never tells the user to "just try again": first the status is looked up with the original
 * idempotency key; only if the server has no record is a re-send (same key) offered.
 */
export function UnknownOutcome({ pending, scope, onConfirmed, onFailed }: { pending: Pending; scope: string; onConfirmed: (p: Pending) => void; onFailed: (p: Pending) => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [notOnServer, setNotOnServer] = useState(pending.errorCode === 'NOT_ON_SERVER');
  const [error, setError] = useState<AppError | null>(null);

  async function run(action: 'check' | 'resend') {
    setBusy(true); setError(null);
    try {
      const p = action === 'check' ? await checkStatus(scope, pending.key) : await resend(scope, pending.key);
      if (!p) return;
      if (p.state === 'confirmed') onConfirmed(p);
      else if (p.state === 'failed') onFailed(p);
      else if (action === 'check') setNotOnServer(true);
      else setError(new AppError('NETWORK', 'network'));
    } catch (e) { setError(e instanceof AppError ? e : new AppError('NETWORK', 'network')); }
    finally { setBusy(false); }
  }
  return (
    <div role="alert" className="my-4 rounded-2xl border-2 border-amber-400 bg-due-bg p-4 text-due" data-testid="unknown-outcome">
      <p className="flex items-center gap-2 text-lg font-bold"><Icon name="alert" />{t('sync.unknownTitle')}</p>
      <p className="mt-1">{t('sync.unknownText')}</p>
      {notOnServer && <Notice tone="info">{t('sync.notFound')}</Notice>}
      <ErrorBox error={error} />
      <div className="mt-3 flex flex-col gap-2">
        <Button busy={busy} onClick={() => run('check')}>{t('sync.checkStatus')}</Button>
        {notOnServer && <Button variant="secondary" busy={busy} onClick={() => run('resend')}>{t('sync.resend')}</Button>}
      </div>
    </div>
  );
}

export function failedText(t: ReturnType<typeof useI18n>['t'], p: Pending): string {
  return `${t(errorKey(p.errorCode ?? 'UNKNOWN'))} ${t('err.notSaved')}`;
}
