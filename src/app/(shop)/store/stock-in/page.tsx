'use client';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Button, Card, Dialog, ErrorBox, Field, Icon, Input, Money, MoneyInput, Notice, PageHeader, Row, SearchBox, useToast } from '@/components/ui';
import { AppError, newKey, rpc } from '@/lib/api';
import { matches, useOnline } from '@/lib/data';
import { useI18n } from '@/lib/i18n';
import { paiseToInputText, parseQty, parseRupees, qtyToText, UNITS, type Unit } from '@/lib/money';
import { useShop } from '@/lib/session';
import { fmtQty, searchCatalog, useCatalog, useInventory, type CatalogItem, type InventoryRow } from '@/lib/store';
import { soundsLike } from '@/lib/translit';

interface Line {
  key: string;
  productId: string | null;            // an item already in the shop
  ref: string | null;                  // from the ready-made list
  name: string; name_mr: string | null; name_en: string | null; category: string | null;
  unit: Unit;
  isNew: boolean;                      // not in the shop yet: needs a selling price
  currentPrice: number | null;
  qty: string; cost: string; sell: string;
}

/** Goods received from a wholesaler: many items in one go; stock goes up, prices can be updated. */
export default function StockInPage() {
  const { t, locale } = useI18n();
  const { shop } = useShop();
  const router = useRouter();
  const toast = useToast();
  const online = useOnline();
  const inv = useInventory();
  const cat = useCatalog();
  const [q, setQ] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [supplier, setSupplier] = useState('');
  const [note, setNote] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(newKey);
  const [uncertain, setUncertain] = useState(false);   // sent, but no answer: only an identical re-send is allowed
  const [error, setError] = useState<AppError | string | null>(null);

  const mine = inv.data ?? [];
  const inShop = useMemo(() => new Set(mine.map((p) => p.catalog_ref).filter(Boolean) as string[]), [mine]);
  const nameOf = (i: CatalogItem) => (locale === 'mr-IN' ? i.name_mr : i.name_en);
  const query = q.trim();
  const mineHits = query ? mine.filter((p) => p.is_active && matches(query, p.name, p.name_mr, p.name_en)).slice(0, 6) : [];
  const listHits = query && cat.items ? searchCatalog(cat.items, query, null, soundsLike).filter((i) => !inShop.has(i.ref)).slice(0, 8) : [];

  const addMine = (p: InventoryRow) => {
    setLines((l) => [...l, { key: newKey(), productId: p.id, ref: null, name: p.name, name_mr: p.name_mr, name_en: p.name_en, category: p.category,
      unit: p.unit, isNew: false, currentPrice: p.default_price_paise, qty: '', cost: '', sell: paiseToInputText(p.default_price_paise) }]);
    setQ('');
  };
  const addFromList = (i: CatalogItem) => {
    setLines((l) => [...l, { key: newKey(), productId: null, ref: i.ref, name: nameOf(i), name_mr: i.name_mr, name_en: i.name_en, category: i.category,
      unit: i.unit, isNew: true, currentPrice: null, qty: '', cost: '', sell: paiseToInputText(i.price_paise) }]);
    setQ('');
  };
  const addNew = () => {
    setLines((l) => [...l, { key: newKey(), productId: null, ref: null, name: query.slice(0, 120), name_mr: null, name_en: null, category: null,
      unit: 'kg', isNew: true, currentPrice: null, qty: '', cost: '', sell: '' }]);
    setQ('');
  };
  const update = (k: string, patch: Partial<Line>) => setLines((l) => l.map((x) => (x.key === k ? { ...x, ...patch } : x)));
  const remove = (k: string) => setLines((l) => l.filter((x) => x.key !== k));

  const checked = lines.map((l) => {
    const qty = parseQty(l.qty);
    const cost = l.cost.trim() ? parseRupees(l.cost, { allowZero: true }) : ({ ok: true, value: null } as const);
    const sell = l.sell.trim() ? parseRupees(l.sell) : ({ ok: !l.isNew, value: null } as const);
    return { l, qty, cost, sell, ok: qty.ok && cost.ok && sell.ok && !!l.name.trim() };
  });
  const allOk = lines.length > 0 && checked.every((c) => c.ok);
  const totalCost = checked.reduce((s, c) => s + (c.cost.ok && c.cost.value ? c.cost.value : 0), 0);

  function payload() {
    return checked.map(({ l, qty, cost, sell }) => {
      const sellPaise = sell.ok ? sell.value : null;
      const line: Record<string, unknown> = {
        qty: qty.ok ? qtyToText(qty.value) : '0',
        cost_paise: cost.ok ? cost.value : null,
        // Existing items: only send a price when it actually changed.
        sell_price_paise: l.isNew || sellPaise !== l.currentPrice ? sellPaise : null,
      };
      if (l.productId) line.product_id = l.productId;
      else line.new = { ref: l.ref, name: l.name.trim(), name_mr: l.name_mr, name_en: l.name_en, category: l.category, unit: l.unit };
      return line;
    });
  }

  async function save() {
    setBusy(true); setError(null);
    try {
      await rpc('record_stock_in', { p_shop_id: shop.id, p_idempotency_key: key, p_supplier: supplier.trim() || null, p_note: note.trim() || null, p_lines: payload() });
      toast(t('si.saved'));
      setUncertain(false); setConfirming(false); setLines([]); setKey(newKey());
      void inv.reload();
      router.push('/store/inventory');
    } catch (e) {
      const err = e instanceof AppError ? e : new AppError('UNKNOWN', 'server');
      setConfirming(false);
      if (err.kind === 'network' || err.kind === 'server') { setUncertain(true); setError(t('si.retry')); }
      else { setUncertain(false); setKey(newKey()); setError(err); }
    } finally { setBusy(false); }
  }

  const locked = uncertain || busy;
  return (
    <div>
      <PageHeader title={t('si.title')} back="/store" />
      <Field label={t('si.supplier')} optional>{(id) => <Input id={id} value={supplier} disabled={locked} onChange={(e) => setSupplier(e.target.value)} maxLength={80} autoComplete="off" />}</Field>

      {!locked && (
        <div className="mb-4">
          <SearchBox value={q} onChange={setQ} placeholder={t('si.search')} />
          {query && (
            <ul className="mt-1 divide-y divide-line rounded-2xl border border-line bg-white" data-testid="si-results">
              {mineHits.map((p) => (
                <li key={p.id}><button type="button" onClick={() => addMine(p)} className="flex min-h-12 w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-slate-50">
                  <span className="min-w-0 truncate font-semibold">{p.name}</span>
                  <span className="shrink-0 text-xs text-brand-700">{t('si.mine')} · {fmtQty(p.stock)} {t(`unit.${p.unit}`)}</span>
                </button></li>
              ))}
              {listHits.map((i) => (
                <li key={i.ref}><button type="button" onClick={() => addFromList(i)} className="flex min-h-12 w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-slate-50">
                  <span className="min-w-0 truncate">{nameOf(i)}</span>
                  <span className="shrink-0 text-xs text-muted">{t('si.fromList')}</span>
                </button></li>
              ))}
              <li><button type="button" onClick={addNew} className="flex min-h-12 w-full items-center gap-2 px-3 py-2 text-left font-semibold text-brand-700 hover:bg-slate-50">
                <Icon name="plus" className="h-5 w-5" />{t('si.newItem', { n: query })}
              </button></li>
            </ul>
          )}
        </div>
      )}

      {lines.length === 0 && <p className="py-4 text-center text-muted">{t('si.empty')}</p>}
      <ul className="space-y-3" data-testid="si-lines">
        {checked.map(({ l, qty, cost, sell }) => {
          const u = t(`unit.${l.unit}`);
          const perUnit = qty.ok && cost.ok && cost.value ? Math.round(cost.value / (qty.value / 1000)) : null;
          return (
            <li key={l.key}>
              <Card>
                <div className="mb-2 flex items-start justify-between gap-2">
                  {l.isNew && !l.ref
                    ? <Input aria-label={t('bill.itemName')} value={l.name} disabled={locked} onChange={(e) => update(l.key, { name: e.target.value })} maxLength={120} invalid={showErrors && !l.name.trim()} />
                    : <p className="font-bold">{l.name}{l.isNew && <span className="ml-2 rounded-full bg-brand-50 px-2 text-xs text-brand-800">{t('si.fromList')}</span>}</p>}
                  <button type="button" disabled={locked} onClick={() => remove(l.key)} aria-label={t('si.remove')} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-slate-100"><Icon name="x" className="h-5 w-5" /></button>
                </div>
                {l.isNew && !l.ref && (
                  <label className="mb-3 flex items-center gap-2 text-sm font-semibold">{t('si.unit')}
                    <select value={l.unit} disabled={locked} onChange={(e) => update(l.key, { unit: e.target.value as Unit })} className="min-h-11 rounded-xl border border-line bg-white px-3">
                      {UNITS.map((x) => <option key={x} value={x}>{t(`unit.${x}`)}</option>)}
                    </select>
                  </label>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <label className="block text-sm font-semibold">{t('si.qty', { u })}
                    <Input inputMode="decimal" value={l.qty} disabled={locked} onChange={(e) => update(l.key, { qty: e.target.value })} invalid={showErrors && !qty.ok} className="mt-1" />
                  </label>
                  <label className="block text-sm font-semibold">{t('si.cost')}
                    <MoneyInput value={l.cost} disabled={locked} onChange={(e) => update(l.key, { cost: e.target.value })} invalid={showErrors && !cost.ok} placeholder="0" className="mt-1" />
                  </label>
                </div>
                <label className="mt-3 block text-sm font-semibold">{t('si.sell', { u })}
                  <MoneyInput value={l.sell} disabled={locked} onChange={(e) => update(l.key, { sell: e.target.value })} invalid={showErrors && !sell.ok} className="mt-1" />
                </label>
                {perUnit !== null && <p className="mt-1 text-xs text-muted">{t('si.perUnitCost', { a: `₹${paiseToInputText(perUnit)}`, u })}</p>}
                {(l.unit === 'packet' || l.unit === 'piece') && <p className="mt-1 text-xs text-muted">{t('si.qtyHint')}</p>}
              </Card>
            </li>
          );
        })}
      </ul>

      {lines.length > 0 && (
        <>
          <Field label={t('si.note')} optional>{(id) => <Input id={id} value={note} disabled={locked} onChange={(e) => setNote(e.target.value)} maxLength={300} autoComplete="off" />}</Field>
          <Card className="mb-4"><Row label={t('si.lines', { n: lines.length })}>{''}</Row><Row label={t('si.total')} strong><Money paise={totalCost} /></Row></Card>
        </>
      )}
      {showErrors && !allOk && lines.length > 0 && <Notice tone="warn">{t('si.fix')}</Notice>}
      {error && <ErrorBox error={error} notSaved={!uncertain} />}
      {!online && <Notice tone="warn" icon="offline">{t('sync.offlineBanner')}</Notice>}
      {lines.length > 0 && (
        <Button full className="min-h-14 text-lg" disabled={!online || busy} busy={busy && !confirming} data-testid="si-save"
          onClick={() => { setShowErrors(true); setError(null); if (allOk) { if (uncertain) void save(); else setConfirming(true); } }}>{t('si.save')}</Button>
      )}

      <Dialog open={confirming} title={t('si.confirm')} onClose={() => !busy && setConfirming(false)}
        actions={<><Button busy={busy} onClick={save}>{t('si.save')}</Button><Button variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>{t('c.edit')}</Button></>}>
        {supplier.trim() && <p className="mb-2 font-semibold">{supplier.trim()}</p>}
        <ul className="max-h-72 divide-y divide-line overflow-y-auto">
          {checked.map(({ l, qty, cost }) => (
            <li key={l.key} className="flex justify-between gap-2 py-2 text-sm">
              <span className="min-w-0 truncate">{l.name} — {qty.ok ? fmtQty(qty.value / 1000) : '?'} {t(`unit.${l.unit}`)}</span>
              <span className="num shrink-0 font-semibold">{cost.ok && cost.value ? <Money paise={cost.value} /> : '—'}</span>
            </li>
          ))}
        </ul>
        <Row label={t('si.total')} strong><Money paise={totalCost} /></Row>
      </Dialog>
    </div>
  );
}
