'use client';
import { useEffect, useMemo, useState } from 'react';
import { Button, Card, ErrorBox, Icon, Notice, PageHeader, Segmented, Skeleton, useToast } from '@/components/ui';
import { formatDateTime, todayIn, useI18n } from '@/lib/i18n';
import { useShop } from '@/lib/session';
import { AppError } from '@/lib/api';
import { aiSummary, fmtQty, rupeesShort, useInsights, type Insights } from '@/lib/store';

type Which = 'today' | 'yesterday' | 'week';

/** Plain summary from the exact figures. Always available, needs no AI. */
function basicLines(d: Insights, t: ReturnType<typeof useI18n>['t']): string[] {
  const s = d.totals;
  const lines: string[] = [];
  if (s.bills === 0) lines.push(t('sum.line.none'));
  else lines.push(t('sum.line.sales', { a: rupeesShort(s.net_sales_paise), n: s.bills }));
  lines.push(t('sum.line.collected', { a: rupeesShort(s.net_collections_paise), c: rupeesShort(s.cash_paise), u: rupeesShort(s.upi_paise) }));
  lines.push(t('sum.line.dues', { a: rupeesShort(d.dues.total_paise), n: d.dues.customers }));
  const c = d.customers[0];
  if (c) lines.push(t('sum.line.topCustomer', { n: c.name ?? t('in.walkIn'), a: rupeesShort(c.amount_paise) }));
  const p = d.products[0];
  if (p) lines.push(t('sum.line.topProduct', { n: p.name, q: `${fmtQty(p.qty)} ${t(`unit.${p.unit}`)}`, a: rupeesShort(p.amount_paise) }));
  const due = d.dues.top[0];
  if (due) lines.push(t('sum.line.topDue', { n: due.name, a: rupeesShort(due.due_paise) }));
  if (d.low_stock.length) lines.push(t('sum.line.low', { n: d.low_stock.slice(0, 6).map((x) => x.name).join(', ') }));
  return lines;
}

export default function SummaryPage() {
  const { t, locale } = useI18n();
  const { shop } = useShop();
  const toast = useToast();
  const [which, setWhich] = useState<Which>('today');
  const today = todayIn(shop.timezone);
  const from = which === 'today' ? today : which === 'yesterday' ? todayIn(shop.timezone, -1) : todayIn(shop.timezone, -6);
  const to = which === 'yesterday' ? from : today;
  const q = useInsights(from, to);
  const [ai, setAi] = useState<{ text?: string; error?: AppError; busy?: boolean }>({});
  const [aiOn, setAiOn] = useState<boolean | null>(null);

  useEffect(() => { setAi({}); }, [from, to]);
  useEffect(() => {
    let live = true;
    void aiSummary({ shop_id: shop.id, probe: true }).then((r) => { if (live) setAiOn(!('error' in r)); });
    return () => { live = false; };
  }, [shop.id]);

  const lines = useMemo(() => (q.data ? basicLines(q.data, t) : []), [q.data, t]);
  const dateText = from === to ? formatDateTime(from, locale, shop.timezone, false)
    : `${formatDateTime(from, locale, shop.timezone, false)} – ${formatDateTime(to, locale, shop.timezone, false)}`;
  const shopName = locale === 'mr-IN' ? shop.name_mr : shop.name_en;
  const shareText = [t('sum.head', { s: shopName, d: dateText }), ...(ai.text ? [ai.text] : lines.map((l) => `• ${l}`))].join('\n');

  async function runAi() {
    setAi({ busy: true });
    const r = await aiSummary({ shop_id: shop.id, from, to, language: locale === 'en-IN' ? 'en' : 'mr' });
    setAi('error' in r ? { error: r.err ?? new AppError(r.error, 'server') } : { text: r.text });
  }
  async function copy() {
    try { await navigator.clipboard.writeText(shareText); toast(t('sum.copied')); } catch { /* clipboard blocked */ }
  }

  return (
    <div>
      <PageHeader title={t('sum.title')} back="/store" />
      <Segmented label={t('in.period')} value={which} onChange={setWhich}
        options={[{ value: 'today', label: t('in.day') }, { value: 'yesterday', label: t('sum.yesterday') }, { value: 'week', label: t('in.week') }]} />
      {!q.data && (q.loading ? <div className="mt-4"><Skeleton lines={6} /></div> : <ErrorBox error={q.error} onRetry={q.reload} />)}
      {q.data && (
        <>
          {aiOn === false && <Notice>{t('sum.aiOff')}</Notice>}
          {aiOn && !ai.text && (
            <Button full variant="secondary" className="mt-4" busy={ai.busy} onClick={runAi} data-testid="ai-button">
              {ai.busy ? t('sum.aiWorking') : t('sum.aiButton')}
            </Button>
          )}
          {ai.error && <ErrorBox error={ai.error} />}
          {ai.text && (
            <Card className="mt-4 border-brand-200 bg-brand-50">
              <h2 className="mb-2 font-bold">{t('sum.ai')}</h2>
              <p className="whitespace-pre-line text-lg leading-relaxed" data-testid="ai-text">{ai.text}</p>
              <p className="mt-2 text-xs text-muted">{t('sum.aiNote')}</p>
            </Card>
          )}
          <Card className="mt-4">
            <h2 className="mb-1 font-bold">{t('sum.basic')}</h2>
            <p className="mb-3 text-sm text-muted">{dateText}</p>
            <ul className="space-y-2 text-lg" data-testid="summary-lines">
              {lines.map((l, i) => <li key={i} className="flex gap-2"><span aria-hidden="true">•</span><span>{l}</span></li>)}
            </ul>
          </Card>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <a href={`https://wa.me/?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noopener noreferrer"
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-2 font-semibold text-white hover:bg-brand-700">
              <Icon name="share" className="h-5 w-5" />{t('sum.share')}
            </a>
            <Button variant="secondary" onClick={copy}>{t('sum.copy')}</Button>
          </div>
        </>
      )}
    </div>
  );
}
