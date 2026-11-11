'use client';
import Link from 'next/link';
import { ActivityList } from '@/components/activity';
import { EmptyState, ErrorBox, Icon, Money, Section, Skeleton, StaleNote } from '@/components/ui';
import { rpc, type Activity, type DailySummary } from '@/lib/api';
import { useQuery } from '@/lib/data';
import type { Key } from '@/lib/dictionary';
import { useI18n } from '@/lib/i18n';
import { useShop } from '@/lib/session';

const ACTIONS: { href: string; icon: string; label: Key }[] = [
  { href: '/bill', icon: 'plus', label: 'home.newBill' },
  { href: '/scan', icon: 'camera', label: 'home.scan' },
  { href: '/customers/new', icon: 'users', label: 'home.addCustomer' },
  { href: '/customers?pick=pay', icon: 'rupee', label: 'home.receive' },
];

export default function HomePage() {
  const { t, locale } = useI18n();
  const { shop, scope } = useShop();
  const summary = useQuery(() => rpc<DailySummary>('get_shop_daily_summary', { p_shop_id: shop.id }), [shop.id], `${scope}summary`);
  const recent = useQuery(() => rpc<Activity[]>('list_recent_activity', { p_shop_id: shop.id, p_limit: 12 }), [shop.id], `${scope}recent`);
  const s = summary.data;
  const tiles: { label: Key; hint?: Key; value: React.ReactNode; due?: boolean }[] = s ? [
    { label: 'home.todaySales', hint: 'home.salesHint', value: <Money paise={s.net_sales_paise} /> },
    { label: 'home.todayCollected', hint: 'home.collectedHint', value: <Money paise={s.net_collections_paise} /> },
    { label: 'home.totalDue', value: <Money paise={s.total_outstanding_paise} />, due: true },
    { label: 'home.customersDue', value: <span className="num">{s.customers_with_due}</span>, due: true },
  ] : [];
  return (
    <div>
      <h1 className="text-2xl font-bold">{locale === 'mr-IN' ? shop.name_mr : shop.name_en}</h1>
      <p className="text-muted">{t('home.greeting')}</p>
      <StaleNote show={summary.stale} />
      {!s && summary.loading && <Skeleton lines={2} />}
      {!s && <ErrorBox error={summary.error} onRetry={summary.reload} />}
      {s && (
        <dl className="mt-4 grid grid-cols-2 gap-3" data-testid="summary">
          {tiles.map((x) => (
            <div key={x.label} className={`rounded-2xl border p-3 ${x.due ? 'border-amber-200 bg-due-bg' : 'border-brand-100 bg-brand-50'}`}>
              <dt className={`text-sm font-semibold ${x.due ? 'text-due' : 'text-brand-800'}`}>{t(x.label)}</dt>
              <dd className="mt-1 text-xl font-bold" data-testid={x.label}>{x.value}</dd>
              {x.hint && <p className="mt-0.5 text-xs text-muted">{t(x.hint)}</p>}
            </div>
          ))}
        </dl>
      )}
      <Section title={t('home.quick')}>
        <div className="grid grid-cols-2 gap-3">
          {ACTIONS.map((a, i) => (
            <Link key={a.href} href={a.href}
              className={`flex min-h-20 flex-col items-start justify-between gap-2 rounded-2xl p-3 font-bold ${i < 2 ? 'bg-brand-600 text-white hover:bg-brand-700' : 'border border-brand-600 text-brand-700 hover:bg-brand-50'}`}>
              <Icon name={a.icon} className="h-7 w-7" /><span>{t(a.label)}</span>
            </Link>
          ))}
        </div>
      </Section>
      <Section title={t('home.recent')}>
        {!recent.data && recent.loading && <Skeleton />}
        {!recent.data && <ErrorBox error={recent.error} onRetry={recent.reload} />}
        {recent.data && recent.data.length === 0 && <EmptyState icon="clock" title={t('home.noActivity')} />}
        {recent.data && recent.data.length > 0 && <ActivityList rows={recent.data} timeZone={shop.timezone} />}
      </Section>
    </div>
  );
}
