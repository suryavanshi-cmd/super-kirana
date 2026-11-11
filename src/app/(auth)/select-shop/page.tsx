'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Button, EmptyState, Icon, LinkButton, Skeleton } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';

export default function SelectShopPage() {
  const { t, locale } = useI18n();
  const { status, ctx, selectShop, signOut } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (status === 'signedOut') router.replace('/login');
    // An admin who is not a member of any shop goes straight to the admin page.
    if (status === 'ready' && ctx?.is_platform_admin && !ctx.must_change_password && ctx.shops.length === 0) router.replace('/admin');
  }, [status, ctx, router]);
  if (status !== 'ready' || !ctx) return <Skeleton />;
  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">{t('shopSelect.title')}</h1>
      {ctx.shops.length === 0 && <EmptyState icon="shop" title={t('shopSelect.none')} />}
      <ul className="space-y-3">
        {ctx.shops.map((s) => (
          <li key={s.id}>
            <button type="button" onClick={() => { selectShop(s.id); router.replace('/home'); }}
              className="flex min-h-16 w-full items-center gap-3 rounded-2xl border border-line p-4 text-left hover:border-brand-600 hover:bg-brand-50">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-700"><Icon name="shop" /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-bold">{locale === 'mr-IN' ? s.name_mr : s.name_en}</span>
                <span className="block text-sm text-muted">{t(`role.${s.role}`)}{s.status === 'suspended' ? ` · ${t('shopSelect.suspended')}` : ''}</span>
              </span>
              <Icon name="chevron" className="text-muted" />
            </button>
          </li>
        ))}
      </ul>
      {ctx.is_platform_admin && <LinkButton href="/admin" variant="secondary" full className="mt-5">{t('set.admin')}</LinkButton>}
      <Button variant="ghost" full className="mt-2" onClick={() => void signOut()}>{t('account.logout')}</Button>
    </div>
  );
}
