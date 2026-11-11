'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Skeleton } from '@/components/ui';
import { useSession } from '@/lib/session';

export default function Index() {
  const { status } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (status === 'signedOut') router.replace('/login');
    if (status === 'ready') router.replace('/home');
  }, [status, router]);
  return <main className="mx-auto max-w-md p-4"><Skeleton lines={4} /></main>;
}
