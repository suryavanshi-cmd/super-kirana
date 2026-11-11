'use client';
import type { ReactNode } from 'react';
import { Icon, LanguageSwitch } from '@/components/ui';
import { useI18n } from '@/lib/i18n';

export default function AuthLayout({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-10 pt-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-brand-700">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-600 text-white"><Icon name="shop" /></span>
          <span className="text-lg font-bold">{t('brand')}</span>
        </div>
        <LanguageSwitch compact />
      </div>
      <div className="mt-8 flex-1">{children}</div>
    </main>
  );
}
