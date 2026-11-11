'use client';
import { useRouter } from 'next/navigation';
import { CustomerForm } from '@/components/customer-form';
import { PageHeader, useToast } from '@/components/ui';
import { useI18n } from '@/lib/i18n';

export default function NewCustomerPage() {
  const { t } = useI18n();
  const router = useRouter();
  const toast = useToast();
  return (
    <div>
      <PageHeader title={t('cust.new')} back="/home" />
      <CustomerForm onSaved={(id) => { toast(t('cust.created')); router.replace(`/customers/${id}`); }} />
    </div>
  );
}
