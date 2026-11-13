'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from './ui';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';

// Main screens get the bottom tab bar; forms and detail screens keep the full height for their own buttons.
const TAB_SCREENS = [/^\/home$/, /^\/customers$/, /^\/products$/, /^\/reports$/, /^\/settings$/, /^\/store(\/(inventory|insights|summary))?$/];
export const showsTabs = (path: string) => TAB_SCREENS.some((r) => r.test(path));

/** Khata-style bottom navigation: always one thumb-tap away. */
export function BottomTabs({ onMore }: { onMore: () => void }) {
  const { t } = useI18n();
  const { isOwner } = useSession();
  const path = usePathname();
  if (!showsTabs(path)) return null;
  const tabs = [
    { href: '/home', icon: 'users', label: t('tab.khata'), on: path === '/home' || path === '/customers' },
    { href: '/bill', icon: 'list', label: t('tab.bill'), on: false },
    { href: isOwner ? '/store/inventory' : '/products', icon: 'box', label: t('tab.items'), on: path === '/store/inventory' || path === '/products' },
    { href: isOwner ? '/store' : '/reports', icon: 'chart', label: t('tab.reports'), on: path === '/store' || path === '/reports' || path === '/store/insights' || path === '/store/summary' },
  ];
  const cell = 'flex min-h-16 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-semibold';
  return (
    <nav aria-label={t('nav.main')} data-testid="bottom-tabs"
      className="no-print fixed inset-x-0 bottom-0 z-40 mx-auto flex max-w-3xl border-t border-line bg-white shadow-[0_-2px_8px_rgba(16,24,40,.06)]"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      {tabs.map((x) => (
        <Link key={x.href} href={x.href} aria-current={x.on ? 'page' : undefined} className={`${cell} ${x.on ? 'text-brand-700' : 'text-muted'}`}>
          <span className={`flex h-8 w-14 items-center justify-center rounded-full ${x.on ? 'bg-brand-50' : ''}`}><Icon name={x.icon} className="h-6 w-6" /></span>{x.label}
        </Link>
      ))}
      <button type="button" onClick={onMore} className={`${cell} text-muted`}>
        <span className="flex h-8 w-14 items-center justify-center"><Icon name="menu" className="h-6 w-6" /></span>{t('tab.more')}
      </button>
    </nav>
  );
}
