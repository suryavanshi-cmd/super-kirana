'use client';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Button, Card, ErrorBox, Field, Input, Money, MoneyInput, Notice, PageHeader, Row, Section, Skeleton, useToast } from '@/components/ui';
import { AppError, newKey, rpc } from '@/lib/api';
import { useQuery } from '@/lib/data';
import { formatDateTime, useI18n } from '@/lib/i18n';
import { paiseToInputText, parseQty, parseRupees, qtyToText } from '@/lib/money';
import { useShop } from '@/lib/session';
import { fmtQty, isLow, num, type ProductStock } from '@/lib/store';

interface PriceChange { id: number; old_price_paise: number | null; new_price_paise: number; unit: string; source: string; changed_at: string; changed_by_name: string | null }

export default function ProductStockPage() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useI18n();
  const { shop } = useShop();
  const toast = useToast();
  const q = useQuery(() => rpc<ProductStock>('get_product_stock', { p_shop_id: shop.id, p_product_id: id }), [shop.id, id]);
  const p = q.data;
  const hist = useQuery(() => rpc<PriceChange[]>('get_price_history', { p_shop_id: shop.id, p_product_id: id }), [shop.id, id]);
  const [price, setPrice] = useState<string | null>(null);
  const [level, setLevel] = useState<string | null>(null);
  const [counted, setCounted] = useState('');
  const [countKey, setCountKey] = useState(newKey);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<AppError | null>(null);

  if (!p) return <div><PageHeader title={t('inv.title')} back="/store/inventory" />{q.loading ? <Skeleton lines={6} /> : <ErrorBox error={q.error} onRetry={q.reload} />}</div>;
  const u = t(`unit.${p.unit}`);
  const priceText = price ?? paiseToInputText(p.default_price_paise);
  const levelText = level ?? (num(p.reorder_level) !== null ? fmtQty(p.reorder_level).replace(/,/g, '') : '');
  const priceParsed = parseRupees(priceText);
  const countParsed = counted.trim() === '0' ? ({ ok: true, value: 0 } as const) : parseQty(counted);
  const levelParsed = levelText.trim() === '' ? ({ ok: true, value: null } as const) : levelText.trim() === '0' ? ({ ok: true, value: 0 } as const) : parseQty(levelText);

  async function run(what: string, fn: () => Promise<unknown>) {
    setBusy(what); setError(null);
    try { await fn(); toast(t('inv.saved')); await Promise.all([q.reload(), hist.reload()]); return true; }
    catch (e) { setError(e instanceof AppError ? e : new AppError('UNKNOWN', 'server')); return false; }
    finally { setBusy(null); }
  }

  return (
    <div>
      <PageHeader title={p.name} back="/store/inventory" />
      <Card className={isLow(p) ? 'border-amber-200 bg-due-bg' : ''}>
        <p className="text-sm font-semibold text-muted">{t('inv.stock')}</p>
        <p className="text-3xl font-bold" data-testid="stock-now">{num(p.stock) !== null ? `${fmtQty(p.stock)} ${u}` : t('inv.notTracked')}</p>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
          <div><p className="text-muted">{t('inv.soldToday')}</p><p className="font-bold">{fmtQty(p.sold_today)} {u}</p></div>
          <div><p className="text-muted">{t('inv.sold7d')}</p><p className="font-bold">{fmtQty(p.sold_7d)} {u}</p></div>
          <div><p className="text-muted">{t('inv.sold30d')}</p><p className="font-bold">{fmtQty(p.sold_30d)} {u}</p></div>
        </div>
      </Card>
      {error && <ErrorBox error={error} notSaved />}

      <Section title={t('inv.changePrice')}>
        <Row label={t('inv.cost')}>{p.purchase_cost_paise !== null ? <><Money paise={p.purchase_cost_paise} /> / {u}</> : '—'}</Row>
        <Field label={`${t('inv.price')} (${t('inv.perUnit', { u })})`} hint={t('inv.priceNote')} error={!priceParsed.ok ? t('bill.checkAmount') : null}>
          {(fid, d) => <MoneyInput id={fid} aria-describedby={d} value={priceText} onChange={(e) => setPrice(e.target.value)} invalid={!priceParsed.ok} />}
        </Field>
        <Button variant="secondary" disabled={!priceParsed.ok || priceParsed.value === p.default_price_paise} busy={busy === 'price'}
          onClick={() => priceParsed.ok && void run('price', () => rpc('set_product_price', { p_shop_id: shop.id, p_product_id: p.id, p_price_paise: priceParsed.value }).then(() => setPrice(null)))}>
          {t('c.save')}
        </Button>
      </Section>

      <Section title={t('ph.title')}>
        {!hist.data && (hist.loading ? <Skeleton lines={2} /> : <ErrorBox error={hist.error} onRetry={hist.reload} />)}
        {hist.data && hist.data.length === 0 && <p className="text-muted">{t('ph.empty')}</p>}
        <ol className="relative ml-2 border-l-2 border-brand-200" data-testid="price-history">
          {(hist.data ?? []).map((h) => (
            <li key={h.id} className="mb-3 ml-4">
              <span className="absolute -left-[7px] mt-1.5 h-3 w-3 rounded-full bg-brand-600" aria-hidden="true" />
              <p className="font-bold">
                {h.old_price_paise !== null && <><span className="text-muted line-through"><Money paise={h.old_price_paise} /></span> → </>}
                <Money paise={h.new_price_paise} /> <span className="text-sm font-normal text-muted">/ {t(`unit.${h.unit}` as 'unit.kg')}</span>
              </p>
              <p className="text-xs text-muted">
                {formatDateTime(h.changed_at, locale, shop.timezone)} · {t(`ph.src.${h.source}` as 'ph.src.manual')}{h.changed_by_name ? ` · ${t('ph.by', { n: h.changed_by_name })}` : ''}
              </p>
            </li>
          ))}
        </ol>
      </Section>

      <Section title={t('inv.count')}>
        <p className="mb-2 text-sm text-muted">{t('inv.countHint')}</p>
        <div className="flex items-end gap-2">
          <label className="block flex-1 text-sm font-semibold">{t('inv.counted')} ({u})
            <Input inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} invalid={counted !== '' && !countParsed.ok} className="mt-1" />
          </label>
          <Button disabled={counted === '' || !countParsed.ok} busy={busy === 'count'}
            onClick={() => countParsed.ok && void run('count', () => rpc('count_stock', { p_shop_id: shop.id, p_idempotency_key: countKey, p_product_id: p.id,
              p_counted: countParsed.value === 0 ? '0' : qtyToText(countParsed.value), p_note: null })).then((ok) => { if (ok) { setCounted(''); setCountKey(newKey()); } })}>
            {t('c.save')}
          </Button>
        </div>
      </Section>

      <Section title={t('inv.reorder')}>
        <p className="mb-2 text-sm text-muted">{t('inv.reorderHint')}</p>
        <div className="flex items-end gap-2">
          <label className="block flex-1 text-sm font-semibold">({u})
            <Input inputMode="decimal" value={levelText} onChange={(e) => setLevel(e.target.value)} invalid={!levelParsed.ok} className="mt-1" />
          </label>
          <Button variant="secondary" disabled={!levelParsed.ok || level === null} busy={busy === 'level'}
            onClick={() => levelParsed.ok && void run('level', () => rpc('set_reorder_level', { p_shop_id: shop.id, p_product_id: p.id,
              p_level: levelParsed.value === null ? '' : levelParsed.value === 0 ? '0' : qtyToText(levelParsed.value) }).then(() => setLevel(null)))}>
            {t('c.save')}
          </Button>
        </div>
      </Section>

      <Section title={t('inv.history')}>
        {p.entries.length === 0 && <Notice>{t('inv.notTracked')}</Notice>}
        <ul className="divide-y divide-line">
          {p.entries.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <span className="min-w-0">
                <span className="block font-semibold">{t(`inv.kind.${e.kind}`)}{e.supplier ? ` · ${e.supplier}` : ''}</span>
                <span className="block text-xs text-muted">{formatDateTime(e.created_at, locale, shop.timezone)}</span>
              </span>
              <span className="shrink-0 text-right">
                <span className={`block font-bold ${Number(e.qty) < 0 ? 'text-due' : ''}`}>{Number(e.qty) > 0 ? '+' : ''}{fmtQty(e.qty)} {u}</span>
                {e.cost_paise !== null && <span className="block text-xs text-muted"><Money paise={e.cost_paise} /></span>}
              </span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
