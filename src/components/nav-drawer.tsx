'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Button, Dialog, Icon } from './ui';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';

interface Item { href: string; icon: string; label: string }

/** Left side menu with every screen of the app, grouped. Opened from the ☰ button in the header. */
export function NavDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, locale } = useI18n();
  const { ctx, shop, isOwner, signOut } = useSession();
  const path = usePathname();
  const panel = useRef<HTMLDivElement>(null);
  const [logout, setLogout] = useState(false);

  useEffect(() => { onClose(); /* close after navigating */ }, [path]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.focus();
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);

  const groups: { title: string; items: Item[] }[] = [
    { title: t('nav.daily'), items: [
      { href: '/home', icon: 'home', label: t('nav.home') },
      { href: '/customers', icon: 'users', label: t('nav.customers') },
      { href: '/udhari', icon: 'plus', label: t('nav.udhari') },
      { href: '/collect', icon: 'rupee', label: t('nav.collect') },
      { href: '/voice', icon: 'mic', label: t('nav.voice') },
      { href: '/scan', icon: 'camera', label: t('nav.scan') },
      { href: '/bill', icon: 'list', label: t('nav.bill') },
    ] },
    ...(isOwner ? [{ title: t('nav.business'), items: [
      { href: '/store', icon: 'chart', label: t('nav.store') },
      { href: '/store/summary', icon: 'list', label: t('st.summary') },
      { href: '/store/insights', icon: 'chart', label: t('st.insights') },
      { href: '/store/stock-in', icon: 'download', label: t('st.stockIn') },
      { href: '/store/inventory', icon: 'box', label: t('st.inventory') },
      { href: '/store/catalog', icon: 'plus', label: t('st.catalog') },
      { href: '/reports', icon: 'print', label: t('nav.reports') },
    ] }] : []),
    { title: t('nav.more'), items: [
      { href: '/sync', icon: 'clock', label: t('nav.sync') },
      { href: '/settings', icon: 'cog', label: t('nav.settings') },
      ...(ctx?.is_platform_admin ? [{ href: '/admin', icon: 'shop', label: t('nav.admin') }] : []),
    ] },
  ];
  const active = (href: string) => (href === '/home' ? path === '/home' : path === href || (href !== '/store' && path.startsWith(`${href}/`)));

  return (
    <>
      <div className={`no-print fixed inset-0 z-40 bg-black/50 transition-opacity ${open ? 'opacity-100' : 'pointer-events-none opacity-0'}`} onClick={onClose} aria-hidden="true" />
      <nav ref={panel} tabIndex={-1} aria-label={t('nav.main')} aria-hidden={!open} inert={!open || undefined}
        className={`no-print fixed inset-y-0 left-0 z-50 flex w-[82vw] max-w-xs flex-col bg-white shadow-xl outline-none transition-transform duration-200 ${open ? 'translate-x-0' : '-translate-x-full'}`}
        data-testid="nav-drawer">
        <div className="flex items-center gap-3 border-b border-line p-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white"><Icon name="shop" className="h-5 w-5" /></span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-bold">{shop ? (locale === 'mr-IN' ? shop.name_mr : shop.name_en) : ''}</span>
            <span className="block truncate text-xs text-muted">{ctx?.display_name}{shop ? ` · ${t(`role.${shop.role}`)}` : ''}</span>
          </span>
          <button type="button" onClick={onClose} aria-label={t('nav.close')} className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-slate-100"><Icon name="x" /></button>
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          {groups.map((g) => (
            <div key={g.title} className="py-1">
              <p className="px-4 pb-1 pt-2 text-xs font-bold uppercase tracking-wide text-muted">{g.title}</p>
              <ul>
                {g.items.map((it) => (
                  <li key={it.href}>
                    <Link href={it.href} aria-current={active(it.href) ? 'page' : undefined}
                      className={`mx-2 flex min-h-12 items-center gap-3 rounded-xl px-3 font-semibold ${active(it.href) ? 'bg-brand-50 text-brand-800' : 'hover:bg-slate-50'}`}>
                      <Icon name={it.icon} className="h-5 w-5" />{it.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="border-t border-line p-2">
          <button type="button" onClick={() => setLogout(true)} className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 font-semibold text-red-800 hover:bg-red-50">
            <Icon name="logout" className="h-5 w-5" />{t('nav.logout')}
          </button>
        </div>
      </nav>
      <Dialog open={logout} title={t('account.logout')} onClose={() => setLogout(false)}
        actions={<><Button variant="danger" onClick={() => void signOut()}>{t('account.logout')}</Button><Button variant="ghost" onClick={() => setLogout(false)}>{t('c.cancel')}</Button></>}>
        <p>{t('account.logoutConfirm')}</p>
      </Dialog>
    </>
  );
}
