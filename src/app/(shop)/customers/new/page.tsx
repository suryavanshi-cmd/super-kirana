'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { CustomerForm } from '@/components/customer-form';
import { PageHeader, Skeleton, useToast } from '@/components/ui';
import { useI18n } from '@/lib/i18n';

function NewCustomer() {
  const { t } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const sp = useSearchParams();       // filled in when the shopkeeper said it with the mic
  const name = (sp.get('name') ?? '').slice(0, 120);
  const mobile = (sp.get('mobile') ?? '').replace(/[^0-9+ -]/g, '').slice(0, 15);
  const opening = /^\d{1,9}(\.\d{1,2})?$/.test(sp.get('opening') ?? '') ? sp.get('opening')! : '';
  return (
    <div>
      <PageHeader title={t('cust.new')} back="/home" />
      <CustomerForm initial={name || mobile ? { name, mobile, notes: '' } : undefined} initialOpening={opening}
        onSaved={(id) => { toast(t('cust.created')); router.replace(`/customers/${id}`); }} />
    </div>
  );
}

export default function NewCustomerPage() { return <Suspense fallback={<Skeleton lines={3} />}><NewCustomer /></Suspense>; }
