'use client';
import { useState } from 'react';
import { AppError, authAdmin, rpc, type Member, type Role } from '@/lib/api';
import { useQuery } from '@/lib/data';
import { dictionaries, type Key } from '@/lib/dictionary';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { Button, Dialog, EmptyState, ErrorBox, Field, Input, Notice, Segmented, Skeleton, useToast } from './ui';

/** Staff of one shop. Owners manage cashiers; the platform admin can also manage owners. */
export function StaffManager({ shopId }: { shopId: string }) {
  const { t } = useI18n();
  const { ctx } = useSession();
  const toast = useToast();
  const isAdmin = !!ctx?.is_platform_admin;
  const q = useQuery(() => rpc<Member[]>('list_members', { p_shop_id: shopId }), [shopId]);
  const [adding, setAdding] = useState(false);
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [role, setRole] = useState<Role>('cashier');
  const [f, setF] = useState({ username: '', display_name: '', password: '' });
  const [reset, setReset] = useState<Member | null>(null);
  const [disable, setDisable] = useState<Member | null>(null);
  const [newPw, setNewPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  async function run(fn: () => Promise<unknown>, okText: string, after: () => void) {
    setBusy(true); setError(null);
    try { await fn(); after(); toast(okText); await q.reload(); }
    catch (e) { setError(e instanceof AppError ? e : new AppError('UNKNOWN', 'server')); }
    finally { setBusy(false); }
  }
  const add = () => run(() => authAdmin('add-member', { shop_id: shopId, role, mode, username: f.username.trim().toLowerCase(), display_name: f.display_name.trim(), password: f.password }),
    t('set.staffAdded'), () => { setAdding(false); setF({ username: '', display_name: '', password: '' }); });
  const setMember = (m: Member, r: Role, status: 'active' | 'disabled') =>
    run(() => rpc('set_member', { p_shop_id: shopId, p_user_id: m.user_id, p_role: r, p_status: status }), t('set.saved'), () => setDisable(null));
  const canManage = (m: Member) => m.user_id !== ctx?.user_id && (isAdmin || m.role === 'cashier');

  return (
    <div>
      {!q.data && (q.loading ? <Skeleton lines={2} /> : <ErrorBox error={q.error} onRetry={q.reload} />)}
      {q.data && q.data.length === 0 && <EmptyState icon="users" title={t('set.noStaff')} />}
      <ul className="divide-y divide-line rounded-2xl border border-line empty:hidden">
        {q.data?.map((m) => (
          <li key={m.user_id} className="p-3" data-testid="member">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-semibold">{m.display_name} <span className="font-normal text-muted">@{m.username}</span></p>
                <p className="text-sm text-muted">{t(`role.${m.role}`)} · {m.status === 'active' ? t('c.active') : t('c.inactive')}{m.must_change_password ? ` · ${t('set.mustChange')}` : ''}</p>
              </div>
            </div>
            {canManage(m) && (
              <div className="mt-2 flex flex-wrap gap-2">
                {m.status === 'active'
                  ? <Button variant="danger" className="min-h-11 px-3 text-sm" onClick={() => { setError(null); setDisable(m); }}>{t('set.disable')}</Button>
                  : <Button variant="secondary" className="min-h-11 px-3 text-sm" busy={busy} onClick={() => setMember(m, m.role, 'active')}>{t('set.enable')}</Button>}
                <Button variant="secondary" className="min-h-11 px-3 text-sm" onClick={() => { setError(null); setNewPw(''); setReset(m); }}>{t('set.resetPw')}</Button>
                {isAdmin && m.status === 'active' && <Button variant="ghost" className="min-h-11 px-3 text-sm" busy={busy} onClick={() => setMember(m, m.role === 'owner' ? 'cashier' : 'owner', 'active')}>{m.role === 'owner' ? t('set.makeCashier') : t('set.makeOwner')}</Button>}
              </div>
            )}
          </li>
        ))}
      </ul>
      {!adding && !reset && !disable && <ErrorBox error={error} notSaved />}
      <Button variant="secondary" full className="mt-3" onClick={() => { setError(null); setAdding(true); }}>{t('set.addStaff')}</Button>

      <Dialog open={adding} title={t('set.addStaff')} onClose={() => setAdding(false)}
        actions={<><Button busy={busy} onClick={add}>{t('c.save')}</Button><Button variant="ghost" onClick={() => setAdding(false)}>{t('c.cancel')}</Button></>}>
        {isAdmin && (
          <div className="mb-4 space-y-3">
            <Segmented label={t('set.role')} value={role} onChange={setRole} options={[{ value: 'cashier', label: t('role.cashier') }, { value: 'owner', label: t('role.owner') }]} />
            <Segmented label={t('set.newUser')} value={mode} onChange={setMode} options={[{ value: 'new', label: t('set.newUser') }, { value: 'existing', label: t('set.existingUser') }]} />
          </div>
        )}
        <Field label={t('set.staffUsername')} hint={mode === 'new' ? t('err.INVALID_USERNAME') : undefined}>{(id, d) => <Input id={id} aria-describedby={d} value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} autoCapitalize="none" spellCheck={false} autoComplete="off" />}</Field>
        {mode === 'new' && (<>
          <Field label={t('set.staffName')}>{(id) => <Input id={id} value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} autoComplete="off" />}</Field>
          <Field label={t('set.tempPassword')} hint={t('pw.rule')}>{(id, d) => <Input id={id} aria-describedby={d} type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" />}</Field>
          <Notice tone="warn">{t('set.tempHint')}</Notice>
        </>)}
        <ErrorBox error={error} notSaved />
      </Dialog>

      <Dialog open={!!reset} title={`${t('set.resetPw')}: ${reset?.display_name ?? ''}`} onClose={() => setReset(null)}
        actions={<><Button busy={busy} onClick={() => run(() => authAdmin('reset-password', { shop_id: shopId, user_id: reset!.user_id, new_password: newPw }), t('set.pwReset'), () => setReset(null))}>{t('c.save')}</Button><Button variant="ghost" onClick={() => setReset(null)}>{t('c.cancel')}</Button></>}>
        <Field label={t('set.tempPassword')} hint={t('pw.rule')}>{(id, d) => <Input id={id} aria-describedby={d} type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} autoComplete="new-password" />}</Field>
        <Notice tone="warn">{t('set.tempHint')}</Notice>
        <ErrorBox error={error} notSaved />
      </Dialog>

      <Dialog open={!!disable} title={`${t('set.disable')}: ${disable?.display_name ?? ''}`} onClose={() => setDisable(null)}
        actions={<><Button variant="danger" busy={busy} onClick={() => setMember(disable!, disable!.role, 'disabled')}>{t('set.disable')}</Button><Button variant="ghost" onClick={() => setDisable(null)}>{t('c.cancel')}</Button></>}>
        <p>{t('set.disableConfirm')}</p>
        <ErrorBox error={error} notSaved />
      </Dialog>
    </div>
  );
}

export function AuditList({ rows, timeZone }: { rows: import('@/lib/api').AuditRow[]; timeZone: string }) {
  const { t, locale } = useI18n();
  if (rows.length === 0) return <EmptyState icon="list" title={t('audit.none')} />;
  return (
    <ul className="divide-y divide-line rounded-2xl border border-line text-sm">
      {rows.map((a) => (
        <li key={a.id} className="px-3 py-2">
          <p className="font-semibold">{`audit.a.${a.action}` in dictionaries['mr-IN'] ? t(`audit.a.${a.action}` as Key) : a.action}{a.shop_name ? ` · ${a.shop_name}` : ''}</p>
          <p className="text-muted">{a.actor_name ?? '—'} · {new Intl.DateTimeFormat(locale === 'mr-IN' ? 'mr-IN-u-nu-latn' : 'en-IN', { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(a.created_at))}</p>
        </li>
      ))}
    </ul>
  );
}
