'use client';
import { Button, EmptyState } from '@/components/ui';
import { useI18n } from '@/lib/i18n';

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  const { t } = useI18n();
  return <main className="mx-auto max-w-md p-6"><EmptyState icon="alert" title={t('err.title')} hint={t('err.UNKNOWN')} action={<Button onClick={reset}>{t('c.retry')}</Button>} /></main>;
}
