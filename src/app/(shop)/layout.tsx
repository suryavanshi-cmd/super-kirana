'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { NavDrawer } from '@/components/nav-drawer';
import { QuickAdd } from '@/components/quick-add';
import { VoiceAssistant } from '@/components/voice-assistant';
import { Icon, Skeleton } from '@/components/ui';
import { useOnline } from '@/lib/data';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';

export default function ShopLayout({ children }: { children: ReactNode }) {
  const { status, ctx, shop } = useSession();
  const { t, locale } = useI18n();
  const router = useRouter();
  const online = useOnline();
  const [menu, setMenu] = useState(false);
  const closeMenu = useCallback(() => setMenu(false), []);

  useEffect(() => {
    if (status === 'signedOut') router.replace('/login');
    else if (status === 'ready' && ctx?.must_change_password) router.replace('/change-password');
    else if (status === 'ready' && !shop) router.replace('/select-shop');
  }, [status, ctx, shop, router]);

  if (status !== 'ready' || !ctx || !shop || ctx.must_change_password) {
    return <main className="mx-auto max-w-3xl p-4"><Skeleton lines={5} /></main>;
  }
  return (
    <div className="mx-auto min-h-dvh max-w-3xl">
      <header className="no-print sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-white px-2 py-2">
        <button type="button" onClick={() => setMenu(true)} aria-label={t('nav.menu')} aria-expanded={menu} data-testid="menu-button"
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full hover:bg-slate-100"><Icon name="menu" className="h-7 w-7" /></button>
        <Link href="/home" className="flex min-w-0 flex-1 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white"><Icon name="shop" className="h-5 w-5" /></span>
          <span className="min-w-0">
            <span className="block truncate font-bold leading-tight" data-testid="shop-name">{locale === 'mr-IN' ? shop.name_mr : shop.name_en}</span>
            <span className="block truncate text-xs text-muted">{ctx.display_name} · {t(`role.${shop.role}`)}</span>
          </span>
        </Link>
        <Link href="/settings" aria-label={t('nav.settings')} className="flex h-12 w-12 items-center justify-center rounded-full hover:bg-slate-100"><Icon name="cog" /></Link>
      </header>
      {!online && (
        <div role="status" className="no-print flex items-start gap-2 bg-due-bg px-4 py-2 text-sm font-semibold text-due">
          <Icon name="offline" className="h-5 w-5" />{t('sync.offlineBanner')}
        </div>
      )}
      <main className="px-4 pb-28 pt-4">{children}</main>
      <QuickAdd />
      <VoiceAssistant />
      <NavDrawer open={menu} onClose={closeMenu} />
    </div>
  );
}
