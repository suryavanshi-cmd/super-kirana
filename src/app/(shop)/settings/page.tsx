'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button, Card, Dialog, Icon, LanguageSwitch, LinkButton, Notice, PageHeader, Row, Section } from '@/components/ui';
import { rpc } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { listPending } from '@/lib/mutations';
import { useSession, useShop } from '@/lib/session';

export default function SettingsPage() {
  const { t, locale } = useI18n();
  const { ctx, signOut, refresh, selectShop } = useSession();
  const { shop, scope } = useShop();
  const router = useRouter();
  const [logout, setLogout] = useState(false);
  const [unchecked, setUnchecked] = useState(0);

  // The language is saved on this device immediately and on the account for other devices.
  useEffect(() => { if (ctx && ctx.preferred_language !== locale) void rpc('set_preferred_language', { p_language: locale }).then(refresh, () => undefined); }, [locale]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void listPending(scope).then((p) => setUnchecked(p.filter((x) => x.state === 'unknown' || x.state === 'sending').length)); }, [scope]);

  return (
    <div>
      <PageHeader title={t('set.title')} back="/home" />
      <Section title={t('c.language')}><LanguageSwitch /></Section>
      <Section title={t('set.account')}>
        <Card>
          <Row label={t('login.username')}>{ctx?.username}</Row>
          <Row label={t('set.shop')}>{locale === 'mr-IN' ? shop.name_mr : shop.name_en}</Row>
          <div className="mt-3 grid gap-2">
            <LinkButton href="/change-password" variant="secondary">{t('pw.title')}</LinkButton>
            {(ctx?.shops.length ?? 0) > 1 && <Button variant="secondary" onClick={() => { selectShop(null); router.push('/select-shop'); }}>{t('shopSelect.switch')}</Button>}
            {ctx?.is_platform_admin && <LinkButton href="/admin" variant="secondary"><Icon name="shop" className="h-5 w-5" />{t('set.admin')}</LinkButton>}
            {unchecked > 0 && <LinkButton href="/sync" variant="secondary">{t('set.sync')}</LinkButton>}
            <Button variant="danger" onClick={() => setLogout(true)}>{t('account.logout')}</Button>
          </div>
        </Card>
      </Section>
      <Dialog open={logout} title={t('account.logout')} onClose={() => setLogout(false)}
        actions={<><Button variant="danger" onClick={() => void signOut()}>{t('account.logout')}</Button><Button variant="ghost" onClick={() => setLogout(false)}>{t('c.cancel')}</Button></>}>
        <p>{t('account.logoutConfirm')}</p>
        {unchecked > 0 && <Notice tone="warn">{t('account.logoutPending')}</Notice>}
      </Dialog>
    </div>
  );
}
