'use client';
// Problem log: every error seen on this phone, with its actual cause and reference. The same
// entries are reported to the server log automatically; this screen is so nobody has to ask for logs.
import { useEffect, useState } from 'react';
import { Button, Card, EmptyState, PageHeader } from '@/components/ui';
import { clearErrors, recentErrors, type LoggedError } from '@/lib/api';
import { errorKey, formatDateTime, useI18n } from '@/lib/i18n';

export default function ProblemsPage() {
  const { t, locale } = useI18n();
  const [list, setList] = useState<LoggedError[]>([]);
  const [copied, setCopied] = useState(false);
  useEffect(() => { setList(recentErrors()); }, []);
  const text = list.map((e) => `${e.at} ${e.ref} ${e.code} ${e.path}\n  ${e.cause}`).join('\n');
  return (
    <div>
      <PageHeader title={t('err.logTitle')} back="/settings" />
      <p className="mb-3 text-sm text-muted">{t('err.logHint')}</p>
      {list.length === 0 ? <EmptyState icon="check" title={t('err.logEmpty')} /> : (
        <>
          <div className="mb-3 flex gap-2">
            <Button variant="secondary" onClick={() => { void navigator.clipboard?.writeText(text).then(() => setCopied(true), () => undefined); }}>
              {copied ? t('err.copied') : t('err.logCopy')}
            </Button>
            <Button variant="secondary" onClick={() => { clearErrors(); setList([]); }}>{t('err.logClear')}</Button>
          </div>
          <ul className="space-y-2" data-testid="problem-log">
            {list.map((e) => (
              <li key={e.ref}>
                <Card>
                  <p className="font-semibold">{t(errorKey(e.code))}</p>
                  {e.cause && <p className="mt-1 break-words text-sm"><span className="font-semibold">{t('err.reason')}:</span> {e.cause}</p>}
                  <p className="mt-1 text-xs text-muted">{formatDateTime(e.at, locale)} · {e.path} · {t('err.ref')} <span className="font-mono">{e.ref}</span></p>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
