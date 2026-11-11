'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { Icon, Skeleton } from '@/components/ui';
import { useOnline } from '@/lib/data';
import type { Key } from '@/lib/dictionary';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';

const NAV: { href: string; icon: string; label: Key; primary?: boolean }[] = [
  { href: '/home', icon: 'home', label: 'nav.home' },
  { href: '/customers', icon: 'users', label: 'nav.customers' },
  { href: '/bill', icon: 'plus', label: 'nav.newBill', primary: true },
  { href: '/products', icon: 'box', label: 'nav.products' },
  { href: '/reports', icon: 'chart', label: 'nav.reports' },
];

export default function ShopLayout({ children }: { children: ReactNode }) {
  const { status, ctx, shop } = useSession();
  const { t, locale } = useI18n();
  const router = useRouter();
  const path = usePathname();
  const online = useOnline();

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
      <header className="no-print sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-white px-4 py-2">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-white"><Icon name="shop" className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold leading-tight" data-testid="shop-name">{locale === 'mr-IN' ? shop.name_mr : shop.name_en}</p>
          <p className="truncate text-xs text-muted">{ctx.display_name} · {t(ctx.is_platform_admin ? 'role.admin' : `role.${shop.role}`)}</p>
        </div>
        <Link href="/settings" aria-label={t('nav.settings')} className="flex h-12 w-12 items-center justify-center rounded-full hover:bg-slate-100"><Icon name="cog" /></Link>
      </header>
      {!online && (
        <div role="status" className="no-print flex items-start gap-2 bg-due-bg px-4 py-2 text-sm font-semibold text-due">
          <Icon name="offline" className="h-5 w-5" />{t('sync.offlineBanner')}
        </div>
      )}
      <main className="px-4 pb-32 pt-4">{children}</main>
      <nav aria-label={t('nav.main')} className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white pb-[env(safe-area-inset-bottom)]">
        <ul className="mx-auto grid max-w-3xl grid-cols-5">
          {NAV.map((n) => {
            const active = path === n.href || path.startsWith(`${n.href}/`);
            return (
              <li key={n.href}>
                <Link href={n.href} aria-current={active ? 'page' : undefined}
                  className={`flex min-h-16 flex-col items-center justify-center gap-0.5 px-1 text-center text-[0.72rem] font-semibold leading-tight ${active ? 'text-brand-700' : 'text-muted'}`}>
                  {n.primary
                    ? <span className="-mt-5 flex h-12 w-12 items-center justify-center rounded-full bg-brand-600 text-white shadow-md ring-4 ring-white"><Icon name={n.icon} /></span>
                    : <Icon name={n.icon} />}
                  <span>{t(n.label)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
