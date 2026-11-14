'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from './ui';
import { useI18n } from '@/lib/i18n';

// Main screens get the bottom tab bar; forms and detail screens keep the full height for their own buttons.
const TAB_SCREENS = [/^\/home$/, /^\/customers$/, /^\/products$/, /^\/reports$/, /^\/settings$/, /^\/store(\/(inventory|insights|summary))?$/];
export const showsTabs = (path: string) => TAB_SCREENS.some((r) => r.test(path));

/** Khata-style bottom navigation: always one thumb-tap away. */
export function BottomTabs({ onMore }: { onMore: () => void }) {
  const { t } = useI18n();
  const path = usePathname();
  if (!showsTabs(path)) return null;
  const home = path === '/home' || path === '/customers';
  const cell = 'flex h-14 flex-1 flex-col items-center justify-center rounded-full text-xs font-bold uppercase tracking-wide';
  // Two big tabs, khata style: Home (customers) and More (every other screen, in the menu).
  return (
    <nav aria-label={t('nav.main')} data-testid="bottom-tabs" className="no-print pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center pb-2"
      style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}>
      <div className="pointer-events-auto flex w-64 gap-1 rounded-full border border-line bg-white p-1 shadow-[0_2px_12px_rgba(16,24,40,.15)]">
        <Link href="/home" aria-current={home ? 'page' : undefined} className={`${cell} ${home ? 'bg-brand-50 text-brand-700' : 'text-muted'}`}>
          <Icon name="home" className="h-6 w-6" />{t('tab.home')}
        </Link>
        <button type="button" onClick={onMore} className={`${cell} text-muted`} data-testid="tab-more">
          <Icon name="grid" className="h-6 w-6" />{t('tab.more')}
        </button>
      </div>
    </nav>
  );
}
