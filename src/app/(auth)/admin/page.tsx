'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button, Card, Dialog, EmptyState, ErrorBox, Field, Input, LinkButton, Notice, Section, Segmented, Skeleton, useToast } from '@/components/ui';
import { AppError, authAdmin, newKey, rpc, type Member, type Role } from '@/lib/api';
import { useQuery } from '@/lib/data';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';

interface AdminShop { id: string; shop_username: string; name_mr: string; name_en: string; status: 'active' | 'suspended'; created_at: string; members: Member[] }
type Edit =
  | { kind: 'newShop' }
  | { kind: 'shop'; shop: AdminShop }
  | { kind: 'person'; shop: AdminShop; member: Member }
  | { kind: 'addPerson'; shop: AdminShop };

/** Admin: add and update shops and their people. No deleting, and no access to any shop's money. */
export default function AdminPage() {
  const { t, locale } = useI18n();
  const { status, ctx, refresh } = useSession();
  const router = useRouter();
  const toast = useToast();
  const isAdmin = status === 'ready' && !!ctx?.is_platform_admin && !ctx.must_change_password;
  const shops = useQuery(isAdmin ? () => rpc<AdminShop[]>('admin_list_shops') : null, [isAdmin]);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [f, setF] = useState<Record<string, string>>({});
  const [role, setRole] = useState<Role>('owner');
  const [active, setActive] = useState(true);
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [requestId, setRequestId] = useState(newKey);    // a repeated "create shop" never makes a second shop
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | string | null>(null);
  useEffect(() => { if (status === 'signedOut') router.replace('/login'); }, [status, router]);
  const set = (k: string) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const name = (s: AdminShop) => (locale === 'mr-IN' ? s.name_mr : s.name_en);

  function open(e: Edit) {
    setError(null); setMode('new');
    if (e.kind === 'shop') { setF({ name_mr: e.shop.name_mr, name_en: e.shop.name_en }); setActive(e.shop.status === 'active'); }
    else if (e.kind === 'person') { setF({ display_name: e.member.display_name, password: '' }); setRole(e.member.role); setActive(e.member.status === 'active'); }
    else { setF({}); setRole('owner'); }
    setEdit(e);
  }
  async function save() {
    if (!edit) return;
    setBusy(true); setError(null);
    try {
      if (edit.kind === 'newShop') {
        const r = await authAdmin<{ existing: boolean }>('create-shop', { request_id: requestId, shop_username: (f.shop_username ?? '').trim().toLowerCase(),
          name_mr: (f.name_mr ?? '').trim(), name_en: (f.name_en ?? '').trim(),
          owner: { mode, username: (f.username ?? '').trim().toLowerCase(), display_name: (f.display_name ?? '').trim(), password: f.password ?? '' } });
        setRequestId(newKey());
        toast(r.existing ? t('adm.exists') : t('adm.created'));
      } else if (edit.kind === 'shop') {
        await rpc('admin_update_shop', { p_shop_id: edit.shop.id, p_name_mr: (f.name_mr ?? '').trim(), p_name_en: (f.name_en ?? '').trim(), p_status: active ? 'active' : 'suspended' });
        toast(t('set.saved'));
      } else if (edit.kind === 'person') {
        await rpc('admin_update_member', { p_shop_id: edit.shop.id, p_user_id: edit.member.user_id, p_display_name: (f.display_name ?? '').trim(), p_role: role, p_status: active ? 'active' : 'disabled' });
        if (f.password) await authAdmin('reset-password', { shop_id: edit.shop.id, user_id: edit.member.user_id, new_password: f.password });
        toast(f.password ? t('set.pwReset') : t('set.saved'));
      } else {
        await authAdmin('add-member', { shop_id: edit.shop.id, role, mode, username: (f.username ?? '').trim().toLowerCase(), display_name: (f.display_name ?? '').trim(), password: f.password ?? '' });
        toast(t('set.staffAdded'));
      }
      setEdit(null);
      await Promise.all([shops.reload(), refresh()]);
    } catch (e) { setError(e instanceof AppError ? e : new AppError('UNKNOWN', 'server')); }
    finally { setBusy(false); }
  }

  if (status !== 'ready') return <Skeleton lines={4} />;
  if (!isAdmin) return <EmptyState icon="alert" title={t('adm.only')} action={<LinkButton href="/home">{t('err.goHome')}</LinkButton>} />;
  const newPerson = edit?.kind === 'newShop' || edit?.kind === 'addPerson';
  return (
    <div>
      <h1 className="text-2xl font-bold">{t('adm.title')}</h1>
      <p className="mt-1 text-sm text-muted">{t('adm.noMoney')}</p>
      <div className="mt-4 grid gap-2">
        <Button full onClick={() => open({ kind: 'newShop' })}>{t('adm.newShop')}</Button>
        {(ctx?.shops.length ?? 0) > 0 && <LinkButton href="/home" variant="secondary" full>{t('adm.myShop')}</LinkButton>}
      </div>
      <Section title={t('adm.shops')}>
        {!shops.data && (shops.loading ? <Skeleton /> : <ErrorBox error={shops.error} onRetry={shops.reload} />)}
        <ul className="space-y-3">
          {shops.data?.map((s) => (
            <li key={s.id} data-testid="admin-shop">
              <Card>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-bold">{name(s)}</p>
                    <p className="text-sm text-muted"><span className="font-mono">{s.shop_username}</span> · {s.status === 'active' ? t('c.active') : t('adm.suspended')}</p>
                  </div>
                  <Button variant="secondary" className="min-h-11 px-3 text-sm" onClick={() => open({ kind: 'shop', shop: s })}>{t('adm.edit')}</Button>
                </div>
                <p className="mt-3 text-sm font-semibold">{t('adm.people')}</p>
                <ul className="mt-1 divide-y divide-line">
                  {s.members.map((m) => (
                    <li key={m.user_id}>
                      <button type="button" onClick={() => open({ kind: 'person', shop: s, member: m })} data-testid="admin-member"
                        className="flex min-h-14 w-full items-center justify-between gap-2 py-2 text-left hover:bg-slate-50">
                        <span className="min-w-0"><span className="block truncate font-semibold">{m.display_name} <span className="font-normal text-muted">@{m.username}</span></span>
                          <span className="block text-sm text-muted">{t(`role.${m.role}`)} · {m.status === 'active' ? t('c.active') : t('c.inactive')}{m.must_change_password ? ` · ${t('set.mustChange')}` : ''}</span></span>
                        <span className="text-sm font-semibold text-brand-700">{t('c.edit')}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                <Button variant="ghost" className="mt-1 px-0 text-brand-700" onClick={() => open({ kind: 'addPerson', shop: s })}>+ {t('adm.addPerson')}</Button>
              </Card>
            </li>
          ))}
        </ul>
      </Section>

      <Dialog open={!!edit} onClose={() => !busy && setEdit(null)}
        title={edit?.kind === 'newShop' ? t('adm.newShop') : edit?.kind === 'shop' ? `${t('adm.edit')}: ${name(edit.shop)}` : edit?.kind === 'person' ? `${t('adm.edit')}: ${edit.member.display_name}` : edit ? `${t('adm.addPerson')}: ${name(edit.shop)}` : ''}
        actions={<><Button busy={busy} onClick={save}>{edit?.kind === 'newShop' ? t('adm.create') : t('c.save')}</Button><Button variant="ghost" disabled={busy} onClick={() => setEdit(null)}>{t('c.cancel')}</Button></>}>
        {(edit?.kind === 'newShop' || edit?.kind === 'shop') && (<>
          <Field label={t('set.shopNameMr')}>{(id) => <Input id={id} lang="mr" value={f.name_mr ?? ''} onChange={set('name_mr')} maxLength={120} />}</Field>
          <Field label={t('set.shopNameEn')}>{(id) => <Input id={id} lang="en" value={f.name_en ?? ''} onChange={set('name_en')} maxLength={120} />}</Field>
        </>)}
        {edit?.kind === 'newShop' && (<>
          <Field label={t('adm.shopUsername')} hint={t('err.INVALID_SHOP_USERNAME')}>{(id, d) => <Input id={id} aria-describedby={d} value={f.shop_username ?? ''} onChange={set('shop_username')} autoCapitalize="none" spellCheck={false} autoComplete="off" />}</Field>
          <p className="mb-1 text-sm font-semibold">{t('adm.owner')}</p>
        </>)}
        {edit?.kind === 'shop' && (
          <label className="mb-2 flex min-h-11 items-center gap-2 font-semibold"><input type="checkbox" className="h-5 w-5 accent-[var(--color-brand-600)]" checked={active} onChange={(e) => setActive(e.target.checked)} />{t('adm.shopActive')}</label>
        )}
        {edit?.kind === 'addPerson' && <div className="mb-3"><Segmented label={t('set.role')} value={role} onChange={setRole} options={[{ value: 'owner', label: t('role.owner') }, { value: 'cashier', label: t('role.cashier') }]} /></div>}
        {newPerson && (<>
          <div className="mb-3"><Segmented label={t('set.newUser')} value={mode} onChange={setMode} options={[{ value: 'new', label: t('set.newUser') }, { value: 'existing', label: t('set.existingUser') }]} /></div>
          <Field label={edit?.kind === 'newShop' ? t('adm.ownerUsername') : t('set.staffUsername')} hint={mode === 'new' ? t('err.INVALID_USERNAME') : undefined}>{(id, d) => <Input id={id} aria-describedby={d} value={f.username ?? ''} onChange={set('username')} autoCapitalize="none" spellCheck={false} autoComplete="off" />}</Field>
          {mode === 'new' && (<>
            <Field label={edit?.kind === 'newShop' ? t('adm.ownerName') : t('set.staffName')}>{(id) => <Input id={id} value={f.display_name ?? ''} onChange={set('display_name')} autoComplete="off" />}</Field>
            <Field label={t('set.tempPassword')} hint={t('pw.rule')}>{(id, d) => <Input id={id} aria-describedby={d} type="password" value={f.password ?? ''} onChange={set('password')} autoComplete="new-password" />}</Field>
            <Notice tone="warn">{t('set.tempHint')}</Notice>
          </>)}
        </>)}
        {edit?.kind === 'person' && (<>
          <Field label={t('set.staffName')}>{(id) => <Input id={id} value={f.display_name ?? ''} onChange={set('display_name')} maxLength={80} autoComplete="off" />}</Field>
          <div className="mb-3"><Segmented label={t('set.role')} value={role} onChange={setRole} options={[{ value: 'owner', label: t('role.owner') }, { value: 'cashier', label: t('role.cashier') }]} /></div>
          <label className="mb-3 flex min-h-11 items-center gap-2 font-semibold"><input type="checkbox" className="h-5 w-5 accent-[var(--color-brand-600)]" checked={active} onChange={(e) => setActive(e.target.checked)} />{t('adm.personActive')}</label>
          <Field label={t('set.resetPw')} optional hint={t('pw.rule')}>{(id, d) => <Input id={id} aria-describedby={d} type="password" value={f.password ?? ''} onChange={set('password')} autoComplete="new-password" />}</Field>
          {f.password && <Notice tone="warn">{t('set.tempHint')}</Notice>}
        </>)}
        <ErrorBox error={error} notSaved />
      </Dialog>
    </div>
  );
}
