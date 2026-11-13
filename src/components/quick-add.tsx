'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Icon } from './ui';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';

// Screens where the round + button helps. Forms with their own bottom buttons are left alone.
const SHOW_ON = [/^\/home$/, /^\/customers$/, /^\/customers\/[^/]+\/ledger$/, /^\/store(\/(summary|insights|inventory(\/[^/]+)?))?$/, /^\/reports$/, /^\/bills\/[^/]+$/, /^\/payments\/[^/]+$/];

/** Round "+" button at the bottom right (in thumb reach) that opens the everyday actions. */
export function QuickAdd() {
  const { t } = useI18n();
  const { isOwner } = useSession();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  if (!SHOW_ON.some((r) => r.test(path))) return null;

  const actions = [
    { href: '/udhari', icon: 'plus', label: t('fab.udhari'), hint: t('fab.udhariHint'), primary: true },
    { href: '/collect', icon: 'rupee', label: t('fab.collect'), hint: t('fab.collectHint') },
    { href: '/voice', icon: 'mic', label: t('fab.voice'), hint: t('fab.voiceHint') },
    { href: '/customers/new', icon: 'userPlus', label: t('fab.newCustomer'), hint: t('fab.newCustomerHint') },
    ...(isOwner ? [{ href: '/customers', icon: 'edit', label: t('fab.editCustomer'), hint: t('fab.editCustomerHint') }] : []),
    { href: '/scan', icon: 'camera', label: t('fab.scan'), hint: t('fab.scanHint') },
  ];

  return (
    <div className="no-print">
      {open && <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setOpen(false)} aria-hidden="true" />}
      {open && (
        <div role="menu" aria-label={t('fab.title')} data-testid="quick-menu"
          className="fixed bottom-[calc(var(--fab-offset,0px)+6rem)] right-4 z-50 w-[min(20rem,calc(100vw-2rem))] rounded-3xl bg-white p-2 shadow-2xl"
          style={{ marginBottom: 'env(safe-area-inset-bottom)' }}>
          <p className="px-3 pb-1 pt-2 text-sm font-bold text-muted">{t('fab.title')}</p>
          {actions.map((a) => (
            <Link key={a.href + a.label} href={a.href} role="menuitem"
              className={`flex min-h-14 items-center gap-3 rounded-2xl px-3 py-2 ${a.primary ? 'bg-brand-50' : ''} hover:bg-brand-50`}>
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${a.primary ? 'bg-brand-600 text-white' : 'bg-slate-100 text-brand-800'}`}><Icon name={a.icon} className="h-5 w-5" /></span>
              <span className="min-w-0"><span className="block font-bold">{a.label}</span><span className="block truncate text-xs text-muted">{a.hint}</span></span>
            </Link>
          ))}
        </div>
      )}
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu"
        aria-label={open ? t('fab.close') : t('fab.open')} data-testid="quick-add"
        className={`fixed bottom-[calc(var(--fab-offset,0px)+1.25rem)] right-4 z-50 flex h-16 w-16 items-center justify-center rounded-full text-white shadow-xl transition-transform ${open ? 'rotate-45 bg-slate-700' : 'bg-brand-600 hover:bg-brand-700'}`}
        style={{ marginBottom: 'env(safe-area-inset-bottom)' }}>
        <Icon name="plus" className="h-8 w-8" />
      </button>
    </div>
  );
}
