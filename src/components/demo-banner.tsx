'use client';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { rpc } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useShop } from '@/lib/session';

/** In the demo shop: a thin bar with today's remaining demo actions. Nothing for real shops. */
export function DemoBanner() {
  const { t } = useI18n();
  const { shop } = useShop();
  const path = usePathname();
  const [s, setS] = useState<{ is_demo: boolean; used?: number; limit?: number } | null>(null);
  useEffect(() => {
    let live = true;
    rpc<{ is_demo: boolean; used?: number; limit?: number }>('get_demo_status', { p_shop_id: shop.id }).then((r) => { if (live) setS(r); }, () => undefined);
    return () => { live = false; };
  }, [shop.id, path]);
  if (!s?.is_demo) return null;
  const left = Math.max(0, (s.limit ?? 0) - (s.used ?? 0));
  return (
    <div role="status" data-testid="demo-banner"
      className={`no-print px-4 py-1.5 text-center text-sm font-semibold ${left === 0 ? 'bg-due-bg text-due' : 'bg-brand-50 text-brand-800'}`}>
      {left === 0 ? t('demo.none') : t('demo.left', { n: left, m: s.limit ?? 0 })}
    </div>
  );
}
