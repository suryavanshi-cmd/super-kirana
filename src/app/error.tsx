'use client';
import { useEffect, useState } from 'react';
import { Button, EmptyState } from '@/components/ui';
import { AppError, reportError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useI18n();
  const [err] = useState(() => new AppError('UNKNOWN', 'server', `${error.name}: ${error.message}${error.digest ? ` (digest ${error.digest})` : ''}`, 'screen'));
  useEffect(() => { reportError(err); }, [err]);
  return (
    <main className="mx-auto max-w-md p-6">
      <EmptyState icon="alert" title={t('err.title')} hint={t('err.UNKNOWN')} action={<Button onClick={reset}>{t('c.retry')}</Button>} />
      <p className="mt-3 break-words text-sm text-red-900"><span className="font-semibold">{t('err.reason')}:</span> {err.reason}</p>
      <p className="mt-1 text-xs">{t('err.ref')}: <span className="font-mono">{err.ref}</span></p>
    </main>
  );
}
