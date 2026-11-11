'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AuditList, StaffManager } from '@/components/staff';
import { Button, Card, Dialog, ErrorBox, Field, Icon, Input, LanguageSwitch, LinkButton, Notice, PageHeader, Row, Section, Skeleton, useToast } from '@/components/ui';
import { AppError, rpc, type AuditRow } from '@/lib/api';
import { useQuery } from '@/lib/data';
import { useI18n } from '@/lib/i18n';
import { listPending } from '@/lib/mutations';
import { useSession, useShop } from '@/lib/session';

export default function SettingsPage() {
  const { t, locale } = useI18n();
  const { ctx, signOut, refresh, selectShop } = useSession();
  const { shop, isOwner, scope } = useShop();
  const router = useRouter();
  const toast = useToast();
  const [names, setNames] = useState({ mr: shop.name_mr, en: shop.name_en });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [logout, setLogout] = useState(false);
  const [unchecked, setUnchecked] = useState(0);
  const [check, setCheck] = useState<{ ok: boolean; customers_checked: number; mismatches: unknown[] } | null>(null);
  const [showAudit, setShowAudit] = useState(false);
  const audit = useQuery(showAudit ? () => rpc<AuditRow[]>('list_audit', { p_shop_id: shop.id, p_limit: 100 }) : null, [shop.id, showAudit]);

  // The language is saved on this device immediately and on the account for other devices.
  useEffect(() => { if (ctx && ctx.preferred_language !== locale) void rpc('set_preferred_language', { p_language: locale }).then(refresh, () => undefined); }, [locale]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void listPending(scope).then((p) => setUnchecked(p.filter((x) => x.state === 'unknown' || x.state === 'sending').length)); }, [scope]);

  async function saveShop() {
    setBusy(true); setError(null);
    try { await rpc('update_shop', { p_shop_id: shop.id, p_name_mr: names.mr.trim(), p_name_en: names.en.trim() }); await refresh(); toast(t('set.saved')); }
    catch (e) { setError(e instanceof AppError ? e : new AppError('UNKNOWN', 'server')); }
    finally { setBusy(false); }
  }
  async function runCheck() {
    setBusy(true); setError(null);
    try { setCheck(await rpc('reconcile_shop', { p_shop_id: shop.id })); }
    catch (e) { setError(e instanceof AppError ? e : new AppError('UNKNOWN', 'server')); }
    finally { setBusy(false); }
  }
  return (
    <div>
      <PageHeader title={t('set.title')} back="/home" />
      <Section title={t('c.language')}><LanguageSwitch /></Section>

      <Section title={t('set.account')}>
        <Card>
          <Row label={t('login.username')}>{ctx?.username}</Row>
          <Row label={t('set.role')}>{t(ctx?.is_platform_admin ? 'role.admin' : `role.${shop.role}`)}</Row>
          <div className="mt-3 grid gap-2">
            <LinkButton href="/change-password" variant="secondary">{t('pw.title')}</LinkButton>
            {(ctx?.shops.length ?? 0) > 1 && <Button variant="secondary" onClick={() => { selectShop(null); router.push('/select-shop'); }}>{t('shopSelect.switch')}</Button>}
            {ctx?.is_platform_admin && <LinkButton href="/admin" variant="secondary"><Icon name="shop" className="h-5 w-5" />{t('set.admin')}</LinkButton>}
            <LinkButton href="/sync" variant="secondary">{t('set.sync')}</LinkButton>
            <Button variant="danger" onClick={() => setLogout(true)}>{t('account.logout')}</Button>
          </div>
        </Card>
      </Section>

      <Section title={t('set.shop')}>
        <Card>
          <Row label={t('set.shopId')}><span className="font-mono text-sm">{shop.shop_username}</span></Row>
          {isOwner ? (
            <div className="mt-2">
              <Field label={t('set.shopNameMr')}>{(id) => <Input id={id} lang="mr" value={names.mr} onChange={(e) => setNames({ ...names, mr: e.target.value })} maxLength={120} />}</Field>
              <Field label={t('set.shopNameEn')}>{(id) => <Input id={id} lang="en" value={names.en} onChange={(e) => setNames({ ...names, en: e.target.value })} maxLength={120} />}</Field>
              <Button variant="secondary" busy={busy} onClick={saveShop} disabled={names.mr === shop.name_mr && names.en === shop.name_en}>{t('c.save')}</Button>
            </div>
          ) : (<><Row label={t('set.shopNameMr')}>{shop.name_mr}</Row><Row label={t('set.shopNameEn')}>{shop.name_en}</Row></>)}
        </Card>
      </Section>
      <ErrorBox error={error} />

      {isOwner && (
        <>
          <Section title={t('set.staff')}><StaffManager shopId={shop.id} /></Section>
          <Section title={t('set.check')}>
            <Card>
              <Button variant="secondary" busy={busy} onClick={runCheck}>{t('set.check')}</Button>
              {check && <Notice tone={check.ok ? 'ok' : 'warn'}>{check.ok ? t('set.checkOk', { n: check.customers_checked }) : t('set.checkBad', { n: check.mismatches.length })}</Notice>}
            </Card>
          </Section>
          <Section title={t('set.audit')}>
            {!showAudit ? <Button variant="secondary" onClick={() => setShowAudit(true)}>{t('c.open')}</Button>
              : audit.data ? <AuditList rows={audit.data} timeZone={shop.timezone} /> : audit.loading ? <Skeleton /> : <ErrorBox error={audit.error} onRetry={audit.reload} />}
          </Section>
        </>
      )}
      <Section title={t('set.backup')}><Card><p className="text-sm">{t('set.backupText')}</p><LinkButton href="/reports" variant="secondary" className="mt-3">{t('c.csv')}</LinkButton></Card></Section>
      <Section title={t('set.tax')}><Card><p className="text-sm">{t('set.taxText')}</p></Card></Section>

      <Dialog open={logout} title={t('account.logout')} onClose={() => setLogout(false)}
        actions={<><Button variant="danger" onClick={() => void signOut()}>{t('account.logout')}</Button><Button variant="ghost" onClick={() => setLogout(false)}>{t('c.cancel')}</Button></>}>
        <p>{t('account.logoutConfirm')}</p>
        {unchecked > 0 && <Notice tone="warn">{t('account.logoutPending')}</Notice>}
      </Dialog>
    </div>
  );
}
