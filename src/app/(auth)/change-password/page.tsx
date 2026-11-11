'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Button, ErrorBox, Field, Input, Notice, useToast } from '@/components/ui';
import { AppError, authAdmin } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';

export default function ChangePasswordPage() {
  const { t } = useI18n();
  const { status, ctx, refresh, signOut } = useSession();
  const router = useRouter();
  const toast = useToast();
  const [f, setF] = useState({ current: '', next: '', repeat: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | string | null>(null);
  useEffect(() => { if (status === 'signedOut') router.replace('/login'); }, [status, router]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (f.next !== f.repeat) { setError(t('pw.mismatch')); return; }
    setBusy(true); setError(null);
    try {
      await authAdmin('change-password', { current_password: f.current, new_password: f.next });
      await refresh();
      toast(t('pw.changed'));
      router.replace('/home');
    } catch (err) { setError(err instanceof AppError ? err : new AppError('UNKNOWN', 'server')); }
    finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} noValidate>
      <h1 className="mb-2 text-2xl font-bold">{t('pw.title')}</h1>
      {ctx?.must_change_password && <Notice tone="warn">{t('pw.forced')}</Notice>}
      <Field label={t('pw.current')}>{(id) => <Input id={id} type="password" value={f.current} onChange={set('current')} autoComplete="current-password" />}</Field>
      <Field label={t('pw.new')} hint={t('pw.rule')}>{(id, d) => <Input id={id} aria-describedby={d} type="password" value={f.next} onChange={set('next')} autoComplete="new-password" />}</Field>
      <Field label={t('pw.repeat')}>{(id) => <Input id={id} type="password" value={f.repeat} onChange={set('repeat')} autoComplete="new-password" />}</Field>
      <ErrorBox error={error} />
      <Button type="submit" full busy={busy}>{t('pw.submit')}</Button>
      <Button variant="ghost" full className="mt-2" onClick={() => (ctx?.must_change_password ? void signOut() : router.back())}>
        {ctx?.must_change_password ? t('account.logout') : t('c.cancel')}
      </Button>
    </form>
  );
}
