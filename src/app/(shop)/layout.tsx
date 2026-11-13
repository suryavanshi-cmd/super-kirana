'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { BottomTabs, showsTabs } from '@/components/bottom-tabs';
import { DemoBanner } from '@/components/demo-banner';
import { NavDrawer } from '@/components/nav-drawer';
import { QuickAdd } from '@/components/quick-add';
import { QuickEntryProvider } from '@/components/quick-entry';
import { VoiceAssistant } from '@/components/voice-assistant';
import { Icon, Skeleton } from '@/components/ui';
import { prefetch, useOnline } from '@/lib/data';
import { rpc } from '@/lib/api';
import { todayIn } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';

export default function ShopLayout({ children }: { children: ReactNode }) {
  const { status, ctx, shop } = useSession();
  const { t, locale } = useI18n();
  const router = useRouter();
  const path = usePathname();
  const tabs = showsTabs(path);
  // Screens with a bar fixed at the bottom (tabs, or a customer's You gave / You got buttons).
  const bar = tabs || (/^\/customers\/[^/]+$/.test(path) && path !== '/customers/new');
  const online = useOnline();
  const [menu, setMenu] = useState(false);
  const closeMenu = useCallback(() => setMenu(false), []);

  useEffect(() => {
    if (status === 'signedOut') router.replace('/login');
    else if (status === 'ready' && ctx?.must_change_password) router.replace('/change-password');
    else if (status === 'ready' && !shop) router.replace('/select-shop');
  }, [status, ctx, shop, router]);

  // Warm the most-used screens right after the app opens, so tapping them is instant.
  useEffect(() => {
    if (status !== 'ready' || !ctx || !shop || ctx.must_change_password) return;
    const scope = `${ctx.user_id}:${shop.id}:`;
    const id = setTimeout(() => {
      prefetch(`${scope}customers`, () => rpc('list_customers', { p_shop_id: shop.id }), true);
      prefetch(`${scope}products`, () => rpc('list_products', { p_shop_id: shop.id }), true);
      if (shop.role === 'owner') {
        const d = todayIn(shop.timezone);
        prefetch(`${scope}insights:${d}:${d}`, () => rpc('get_insights', { p_shop_id: shop.id, p_from: d, p_to: d }));
      }
    }, 300);
    return () => clearTimeout(id);
  }, [status, ctx, shop]);

  if (status !== 'ready' || !ctx || !shop || ctx.must_change_password) {
    return <main className="mx-auto max-w-3xl p-4"><Skeleton lines={5} /></main>;
  }
  return (
    <QuickEntryProvider>
    <div className="mx-auto min-h-dvh max-w-3xl bg-surface" style={{ '--fab-offset': bar ? '4.5rem' : '0px' } as CSSProperties}>
      <header className="no-print sticky top-0 z-30 flex items-center gap-1 bg-brand-700 px-2 py-2 text-white shadow-md" style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}>
        <button type="button" onClick={() => setMenu(true)} aria-label={t('nav.menu')} aria-expanded={menu} data-testid="menu-button"
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full hover:bg-white/10"><Icon name="menu" className="h-7 w-7" /></button>
        <Link href="/home" className="flex min-w-0 flex-1 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-brand-700"><Icon name="shop" className="h-5 w-5" /></span>
          <span className="min-w-0">
            <span className="block truncate text-lg font-bold leading-tight" data-testid="shop-name">{locale === 'mr-IN' ? shop.name_mr : shop.name_en}</span>
            <span className="block truncate text-xs text-white/80">{ctx.display_name} · {t(`role.${shop.role}`)}</span>
          </span>
        </Link>
        <Link href="/settings" aria-label={t('nav.settings')} className="flex h-12 w-12 items-center justify-center rounded-full hover:bg-white/10"><Icon name="cog" /></Link>
      </header>
      {!online && (
        <div role="status" className="no-print flex items-start gap-2 bg-due-bg px-4 py-2 text-sm font-semibold text-due">
          <Icon name="offline" className="h-5 w-5" />{t('sync.offlineBanner')}
        </div>
      )}
      <DemoBanner />
      <main className={`px-4 pt-4 ${bar ? 'pb-44' : 'pb-28'}`}>{children}</main>
      <QuickAdd />
      <VoiceAssistant />
      <BottomTabs onMore={() => setMenu(true)} />
      <NavDrawer open={menu} onClose={closeMenu} />
    </div>
    </QuickEntryProvider>
  );
}
