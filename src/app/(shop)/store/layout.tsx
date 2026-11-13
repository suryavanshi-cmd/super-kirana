'use client';
import type { ReactNode } from 'react';
import { LinkButton, Notice, PageHeader } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { useShop } from '@/lib/session';

/** Shop accounts are for the owner. The database checks this too; this only avoids a confusing screen. */
export default function StoreLayout({ children }: { children: ReactNode }) {
  const { isOwner } = useShop();
  const { t } = useI18n();
  if (!isOwner) {
    return (
      <div>
        <PageHeader title={t('st.title')} back="/home" />
        <Notice tone="warn">{t('st.ownerOnly')}</Notice>
        <LinkButton href="/home" variant="secondary" full>{t('nav.back')}</LinkButton>
      </div>
    );
  }
  return <>{children}</>;
}
