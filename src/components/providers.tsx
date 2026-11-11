'use client';
import { useEffect, type ReactNode } from 'react';
import { I18nProvider } from '@/lib/i18n';
import { SessionProvider } from '@/lib/session';
import { ToastProvider } from './ui';

export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
  }, []);
  return <I18nProvider><SessionProvider><ToastProvider>{children}</ToastProvider></SessionProvider></I18nProvider>;
}
