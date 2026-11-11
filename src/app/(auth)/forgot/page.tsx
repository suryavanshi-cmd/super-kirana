'use client';
import { Card, LinkButton } from '@/components/ui';
import { useI18n } from '@/lib/i18n';

export default function ForgotPage() {
  const { t } = useI18n();
  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">{t('forgot.title')}</h1>
      <Card className="space-y-3">
        <p>{t('forgot.staff')}</p>
        <p>{t('forgot.owner')}</p>
        <p className="text-sm text-muted">{t('forgot.safe')}</p>
      </Card>
      <LinkButton href="/login" variant="secondary" full className="mt-5">{t('forgot.backToLogin')}</LinkButton>
    </div>
  );
}
