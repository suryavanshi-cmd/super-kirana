'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { Button, ErrorBox, Field, Input, LinkButton, Notice } from '@/components/ui';
import { AppError, authAdmin } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

export default function SetupPage() {
  const { t } = useI18n();
  const [f, setF] = useState({ code: '', username: '', display_name: '', password: '', repeat: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | string | null>(null);
  const [done, setDone] = useState(false);
  const [needed, setNeeded] = useState<boolean | null>(null);
  useEffect(() => { authAdmin<{ needs_setup: boolean }>('setup-status').then((r) => setNeeded(r.needs_setup), () => setNeeded(true)); }, []);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (f.password !== f.repeat) { setError(t('pw.mismatch')); return; }
    setBusy(true); setError(null);
    try {
      await authAdmin('setup', { code: f.code.trim(), username: f.username.trim().toLowerCase(), display_name: f.display_name.trim(), password: f.password });
      setDone(true);
    } catch (err) { setError(err instanceof AppError ? err : new AppError('UNKNOWN', 'server')); }
    finally { setBusy(false); }
  }

  if (done || needed === false) {
    return (<div><h1 className="mb-4 text-2xl font-bold">{t('setup.title')}</h1>
      <Notice tone="ok">{done ? t('setup.done') : t('setup.notNeeded')}</Notice>
      <LinkButton href="/login" full>{t('login.submit')}</LinkButton></div>);
  }
  return (
    <form onSubmit={submit} noValidate>
      <h1 className="mb-2 text-2xl font-bold">{t('setup.title')}</h1>
      <p className="mb-5 text-muted">{t('setup.intro')}</p>
      <Field label={t('setup.code')}>{(id) => <Input id={id} value={f.code} onChange={set('code')} autoComplete="off" autoCapitalize="none" spellCheck={false} />}</Field>
      <Field label={t('setup.displayName')}>{(id) => <Input id={id} value={f.display_name} onChange={set('display_name')} autoComplete="name" />}</Field>
      <Field label={t('login.username')} hint={t('err.INVALID_USERNAME')}>{(id, d) => <Input id={id} aria-describedby={d} value={f.username} onChange={set('username')} autoComplete="username" autoCapitalize="none" spellCheck={false} />}</Field>
      <Field label={t('setup.newPassword')} hint={t('pw.rule')}>{(id, d) => <Input id={id} aria-describedby={d} type="password" value={f.password} onChange={set('password')} autoComplete="new-password" />}</Field>
      <Field label={t('pw.repeat')}>{(id) => <Input id={id} type="password" value={f.repeat} onChange={set('repeat')} autoComplete="new-password" />}</Field>
      <ErrorBox error={error} />
      <Button type="submit" full busy={busy}>{t('setup.submit')}</Button>
    </form>
  );
}
