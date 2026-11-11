'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Button, ErrorBox, Field, Input, Notice } from '@/components/ui';
import { AppError, authAdmin } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { consumeNotice, useSession } from '@/lib/session';

export default function LoginPage() {
  const { t } = useI18n();
  const { status, signIn } = useSession();
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => { if (status === 'ready') router.replace('/home'); }, [status, router]);
  useEffect(() => {
    setNotice(consumeNotice());
    authAdmin<{ needs_setup: boolean }>('setup-status').then((r) => setNeedsSetup(r.needs_setup), () => undefined);
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) { setError(new AppError('INVALID_CREDENTIALS', 'auth')); return; }
    setBusy(true); setError(null);
    try { await signIn(username.trim(), password); router.replace('/home'); }
    catch (err) { setError(err instanceof AppError ? err : new AppError('UNKNOWN', 'server')); setPassword(''); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} noValidate>
      <h1 className="mb-6 text-2xl font-bold">{t('login.title')}</h1>
      {notice === 'idle' && <Notice tone="warn">{t('account.idle')}</Notice>}
      <Field label={t('login.username')}>{(id) => (
        <Input id={id} name="username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username"
          autoCapitalize="none" autoCorrect="off" spellCheck={false} required />
      )}</Field>
      <Field label={t('login.password')}>{(id) => (
        <div className="relative">
          <Input id={id} name="password" type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password" required className="pr-28" />
          <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-1 top-1/2 min-h-10 -translate-y-1/2 rounded-lg px-2 text-sm font-semibold text-brand-700">
            {show ? t('login.hidePassword') : t('login.showPassword')}
          </button>
        </div>
      )}</Field>
      <ErrorBox error={error} />
      <Button type="submit" full busy={busy}>{busy ? t('login.signingIn') : t('login.submit')}</Button>
      <div className="mt-5 flex flex-col items-center gap-3">
        <Link href="/forgot" className="min-h-11 py-2 font-semibold text-brand-700 underline">{t('login.forgot')}</Link>
        {needsSetup && <Link href="/setup" className="min-h-11 py-2 font-semibold text-brand-700 underline">{t('login.setup')}</Link>}
      </div>
    </form>
  );
}
