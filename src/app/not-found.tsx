'use client';
import { EmptyState, LinkButton } from '@/components/ui';
import { useI18n } from '@/lib/i18n';

export default function NotFound() {
  const { t } = useI18n();
  return <main className="mx-auto max-w-md p-6"><EmptyState icon="alert" title={t('err.notFound')} action={<LinkButton href="/home">{t('err.goHome')}</LinkButton>} /></main>;
}
