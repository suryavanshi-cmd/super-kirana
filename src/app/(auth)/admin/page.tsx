'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AuditList, StaffManager } from '@/components/staff';
import { Button, Card, Dialog, EmptyState, ErrorBox, Field, Input, LinkButton, Notice, Section, Segmented, Skeleton, useToast } from '@/components/ui';
import { AppError, authAdmin, newKey, rpc, type AdminShop, type AuditRow } from '@/lib/api';
import { useQuery } from '@/lib/data';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';

const blank = { shop_username: '', name_mr: '', name_en: '', owner_username: '', owner_name: '', owner_password: '' };

export default function AdminPage() {
  const { t, locale } = useI18n();
  const { status, ctx, selectShop, refresh } = useSession();
  const router = useRouter();
  const toast = useToast();
  const isAdmin = status === 'ready' && !!ctx?.is_platform_admin && !ctx.must_change_password;
  const shops = useQuery(isAdmin ? () => rpc<AdminShop[]>('admin_list_shops') : null, [isAdmin]);
  const [creating, setCreating] = useState(false);
  const [f, setF] = useState(blank);
  const [ownerMode, setOwnerMode] = useState<'new' | 'existing'>('new');
  const [requestId, setRequestId] = useState(newKey);   // repeat submissions of this form never create a second shop
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [manage, setManage] = useState<AdminShop | null>(null);
  const [suspend, setSuspend] = useState<AdminShop | null>(null);
  const [showAudit, setShowAudit] = useState(false);
  const audit = useQuery(isAdmin && showAudit ? () => rpc<AuditRow[]>('admin_list_audit', { p_limit: 100 }) : null, [isAdmin, showAudit]);
  useEffect(() => { if (status === 'signedOut') router.replace('/login'); }, [status, router]);
  const set = (k: keyof typeof blank) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));

  async function create() {
    setBusy(true); setError(null);
    try {
      const r = await authAdmin<{ existing: boolean }>('create-shop', { request_id: requestId, shop_username: f.shop_username.trim().toLowerCase(), name_mr: f.name_mr.trim(), name_en: f.name_en.trim(),
        owner: { mode: ownerMode, username: f.owner_username.trim().toLowerCase(), display_name: f.owner_name.trim(), password: f.owner_password } });
      toast(r.existing ? t('adm.exists') : t('adm.created'));
      setCreating(false); setF(blank); setRequestId(newKey());
      await Promise.all([shops.reload(), refresh()]);
    } catch (e) { setError(e instanceof AppError ? e : new AppError('UNKNOWN', 'server')); }
    finally { setBusy(false); }
  }
  async function setStatus(s: AdminShop, next: 'active' | 'suspended') {
    setBusy(true); setError(null);
    try { await rpc('admin_set_shop_status', { p_shop_id: s.id, p_status: next }); setSuspend(null); toast(t('set.saved')); await Promise.all([shops.reload(), refresh()]); }
    catch (e) { setError(e instanceof AppError ? e : new AppError('UNKNOWN', 'server')); }
    finally { setBusy(false); }
  }

  if (status !== 'ready') return <Skeleton lines={4} />;
  if (!isAdmin) return <EmptyState icon="alert" title={t('adm.only')} action={<LinkButton href="/home">{t('err.goHome')}</LinkButton>} />;
  return (
    <div>
      <h1 className="text-2xl font-bold">{t('adm.title')}</h1>
      <p className="mt-1 text-sm text-muted">{t('adm.separate')}</p>
      <Button full className="mt-4" onClick={() => { setError(null); setCreating(true); }}>{t('adm.newShop')}</Button>
      <Section title={t('adm.shops')}>
        {!shops.data && (shops.loading ? <Skeleton /> : <ErrorBox error={shops.error} onRetry={shops.reload} />)}
        <ul className="space-y-3">
          {shops.data?.map((s) => (
            <li key={s.id} className="rounded-2xl border border-line p-3" data-testid="admin-shop">
              <p className="font-bold">{locale === 'mr-IN' ? s.name_mr : s.name_en}</p>
              <p className="text-sm text-muted"><span className="font-mono">{s.shop_username}</span> · {s.status === 'active' ? t('c.active') : t('adm.suspended')}</p>
              <p className="num text-sm text-muted">{t('adm.members')}: {s.members} · {t('adm.customers')}: {s.customers} · {t('adm.billsMade')}: {s.bills}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button className="min-h-11 px-3 text-sm" onClick={() => { selectShop(s.id); router.push('/home'); }}>{t('adm.openShop')}</Button>
                <Button variant="secondary" className="min-h-11 px-3 text-sm" onClick={() => setManage(s)}>{t('adm.manageStaff')}</Button>
                {s.status === 'active'
                  ? <Button variant="danger" className="min-h-11 px-3 text-sm" onClick={() => { setError(null); setSuspend(s); }}>{t('adm.suspend')}</Button>
                  : <Button variant="secondary" className="min-h-11 px-3 text-sm" busy={busy} onClick={() => setStatus(s, 'active')}>{t('adm.activate')}</Button>}
              </div>
            </li>
          ))}
        </ul>
      </Section>
      {!creating && !suspend && <ErrorBox error={error} notSaved />}
      <Section title={t('adm.audit')}>
        {!showAudit ? <Button variant="secondary" onClick={() => setShowAudit(true)}>{t('c.open')}</Button>
          : audit.data ? <AuditList rows={audit.data} timeZone="Asia/Kolkata" /> : audit.loading ? <Skeleton /> : <ErrorBox error={audit.error} onRetry={audit.reload} />}
      </Section>
      <LinkButton href="/select-shop" variant="ghost" full className="mt-6">{t('shopSelect.title')}</LinkButton>

      <Dialog open={creating} title={t('adm.newShop')} onClose={() => setCreating(false)}
        actions={<><Button busy={busy} onClick={create}>{t('adm.create')}</Button><Button variant="ghost" onClick={() => setCreating(false)}>{t('c.cancel')}</Button></>}>
        <Field label={t('set.shopNameMr')}>{(id) => <Input id={id} lang="mr" value={f.name_mr} onChange={set('name_mr')} maxLength={120} />}</Field>
        <Field label={t('set.shopNameEn')}>{(id) => <Input id={id} lang="en" value={f.name_en} onChange={set('name_en')} maxLength={120} />}</Field>
        <Field label={t('adm.shopUsername')} hint={t('err.INVALID_SHOP_USERNAME')}>{(id, d) => <Input id={id} aria-describedby={d} value={f.shop_username} onChange={set('shop_username')} autoCapitalize="none" spellCheck={false} autoComplete="off" />}</Field>
        <p className="mb-1 text-sm font-semibold">{t('adm.owner')}</p>
        <Segmented label={t('adm.owner')} value={ownerMode} onChange={setOwnerMode} options={[{ value: 'new', label: t('set.newUser') }, { value: 'existing', label: t('set.existingUser') }]} />
        <div className="mt-3">
          <Field label={t('adm.ownerUsername')}>{(id) => <Input id={id} value={f.owner_username} onChange={set('owner_username')} autoCapitalize="none" spellCheck={false} autoComplete="off" />}</Field>
          {ownerMode === 'new' && (<>
            <Field label={t('adm.ownerName')}>{(id) => <Input id={id} value={f.owner_name} onChange={set('owner_name')} autoComplete="off" />}</Field>
            <Field label={t('set.tempPassword')} hint={t('pw.rule')}>{(id, d) => <Input id={id} aria-describedby={d} type="password" value={f.owner_password} onChange={set('owner_password')} autoComplete="new-password" />}</Field>
            <Notice tone="warn">{t('set.tempHint')}</Notice>
          </>)}
        </div>
        <ErrorBox error={error} notSaved />
      </Dialog>
      <Dialog open={!!manage} title={`${t('adm.manageStaff')}: ${manage ? (locale === 'mr-IN' ? manage.name_mr : manage.name_en) : ''}`} onClose={() => { setManage(null); void shops.reload(); }}>
        {manage && <StaffManager shopId={manage.id} />}
      </Dialog>
      <Dialog open={!!suspend} title={t('adm.suspend')} onClose={() => setSuspend(null)}
        actions={<><Button variant="danger" busy={busy} onClick={() => setStatus(suspend!, 'suspended')}>{t('adm.suspend')}</Button><Button variant="ghost" onClick={() => setSuspend(null)}>{t('c.cancel')}</Button></>}>
        <p>{t('adm.suspendConfirm')}</p>
        <ErrorBox error={error} notSaved />
      </Dialog>
    </div>
  );
}
