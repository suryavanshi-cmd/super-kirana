'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Button, ErrorBox, Field, Input, Notice } from '@/components/ui';
import { AppError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';

/** Opens the demo shop with a demo code — no username or password. */
export default function DemoPage() {
  const { t, setLocale } = useI18n();
  const { status, demoSignIn } = useSession();
  const router = useRouter();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  useEffect(() => { setLocale('en-IN'); }, [setLocale]);              // the demo is in English
  useEffect(() => { if (status === 'ready') router.replace('/home'); }, [status, router]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!code.trim()) { setError(new AppError('INVALID_DEMO_CODE', 'auth')); return; }
    setBusy(true); setError(null);
    try { await demoSignIn(code.trim()); router.replace('/home'); }
    catch (err) { setError(err instanceof AppError ? err : new AppError('UNKNOWN', 'server')); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} noValidate>
      <h1 className="mb-2 text-2xl font-bold">{t('demo.title')}</h1>
      <p className="mb-4 text-muted">{t('demo.intro')}</p>
      <Notice>{t('demo.limitNote')}</Notice>
      <Field label={t('demo.code')}>{(id) => (
        <Input id={id} value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" autoCapitalize="characters"
          spellCheck={false} maxLength={64} placeholder="GAURAV1234" className="num text-lg tracking-wider" data-testid="demo-code" />
      )}</Field>
      <ErrorBox error={error} />
      <Button type="submit" full busy={busy}>{busy ? t('demo.opening') : t('demo.open')}</Button>
      <div className="mt-5 text-center">
        <Link href="/login" className="min-h-11 py-2 font-semibold text-brand-700 underline">{t('demo.back')}</Link>
      </div>
    </form>
  );
}
