'use client';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Button, ErrorBox, Field, Input, MoneyInput, Notice, PageHeader, Select, Skeleton, useToast } from '@/components/ui';
import { AppError, newKey, rpc } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useProducts } from '@/lib/lists';
import { paiseToInputText, parseRupees, UNITS, type Unit } from '@/lib/money';
import { useShop } from '@/lib/session';

const blank = { name: '', name_mr: '', name_en: '', unit: 'kg' as Unit, price: '', cost: '', stock: '', sku: '', barcode: '', category: '', is_active: true };

export default function ProductEditPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === 'new';
  const { t } = useI18n();
  const { shop, isOwner } = useShop();
  const router = useRouter();
  const toast = useToast();
  const list = useProducts();
  const [f, setF] = useState(blank);
  const [loaded, setLoaded] = useState(isNew);
  const [newId] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [errs, setErrs] = useState<{ name?: string; price?: string; cost?: string; stock?: string }>({});

  useEffect(() => {
    if (isNew || loaded || !list.data) return;
    const p = list.data.find((x) => x.id === id);
    if (p) {
      setF({ name: p.name, name_mr: p.name_mr ?? '', name_en: p.name_en ?? '', unit: p.unit, price: paiseToInputText(p.default_price_paise),
        cost: p.purchase_cost_paise === null ? '' : paiseToInputText(p.purchase_cost_paise), stock: p.stock_qty === null ? '' : String(p.stock_qty),
        sku: p.sku ?? '', barcode: p.barcode ?? '', category: p.category ?? '', is_active: p.is_active });
      setLoaded(true);
    }
  }, [isNew, loaded, list.data, id]);
  const set = <K extends keyof typeof blank>(k: K) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const er: typeof errs = {};
    if (!f.name.trim()) er.name = t('err.NAME_REQUIRED');
    const price = parseRupees(f.price, { allowZero: true });
    if (!price.ok || price.value > 1_000_000_000) er.price = t('bill.checkAmount');
    const cost = f.cost.trim() ? parseRupees(f.cost, { allowZero: true }) : null;
    if (cost && !cost.ok) er.cost = t('bill.checkAmount');
    if (f.stock.trim() && !/^\d{1,9}(\.\d{1,3})?$/.test(f.stock.trim())) er.stock = t('err.INVALID_QUANTITY');
    setErrs(er);
    if (Object.keys(er).length) return;
    setBusy(true); setError(null);
    try {
      await rpc('save_product', { p_shop_id: shop.id, p_product: {
        ...(isNew ? { new_id: newId } : { id, is_active: f.is_active }), name: f.name.trim(), name_mr: f.name_mr.trim(), name_en: f.name_en.trim(),
        unit: f.unit, default_price_paise: price.ok ? price.value : 0, purchase_cost_paise: cost && cost.ok ? cost.value : null,
        stock_qty: f.stock.trim(), sku: f.sku.trim(), barcode: f.barcode.trim(), category: f.category.trim() } });
      await list.reload();
      toast(t('prod.saved'));
      router.replace('/products');
    } catch (err) { setError(err instanceof AppError ? err : new AppError('UNKNOWN', 'server')); }
    finally { setBusy(false); }
  }

  if (!isOwner) return <div><PageHeader title={t('prod.edit')} back="/products" /><Notice tone="warn">{t('c.ownerOnly')}</Notice></div>;
  if (!loaded) return <div><PageHeader title={t('prod.edit')} back="/products" />{list.loading ? <Skeleton /> : <ErrorBox error={list.error ?? new AppError('PRODUCT_NOT_FOUND', 'app')} onRetry={list.reload} />}</div>;
  return (
    <form onSubmit={submit} noValidate>
      <PageHeader title={isNew ? t('prod.new') : t('prod.edit')} back="/products" />
      <Field label={t('prod.name')} error={errs.name}>{(i, d) => <Input id={i} aria-describedby={d} value={f.name} onChange={set('name')} invalid={!!errs.name} maxLength={120} autoComplete="off" autoFocus={isNew} />}</Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('prod.unit')}>{(i) => <Select id={i} value={f.unit} onChange={(e) => setF((s) => ({ ...s, unit: e.target.value as Unit }))}>{UNITS.map((u) => <option key={u} value={u}>{t(`unit.${u}`)}</option>)}</Select>}</Field>
        <Field label={`${t('prod.pricePer')} ${t(`unit.${f.unit}`)}`} error={errs.price}>{(i, d) => <MoneyInput id={i} aria-describedby={d} value={f.price} onChange={set('price')} invalid={!!errs.price} />}</Field>
      </div>
      {!isNew && <Notice>{t('prod.priceNote')}</Notice>}
      <details className="mb-4 rounded-2xl border border-line p-3">
        <summary className="min-h-11 cursor-pointer py-2 font-semibold">{t('prod.moreFields')}</summary>
        <div className="mt-2">
          <Field label={t('prod.nameMr')} optional>{(i) => <Input id={i} value={f.name_mr} onChange={set('name_mr')} maxLength={120} lang="mr" autoComplete="off" />}</Field>
          <Field label={t('prod.nameEn')} optional>{(i) => <Input id={i} value={f.name_en} onChange={set('name_en')} maxLength={120} lang="en" autoComplete="off" />}</Field>
          <Field label={t('prod.category')} optional>{(i) => <Input id={i} value={f.category} onChange={set('category')} maxLength={60} autoComplete="off" />}</Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('prod.cost')} optional error={errs.cost}>{(i, d) => <MoneyInput id={i} aria-describedby={d} value={f.cost} onChange={set('cost')} invalid={!!errs.cost} />}</Field>
            <Field label={t('prod.stock')} optional error={errs.stock} hint={t('prod.stockNote')}>{(i, d) => <Input id={i} aria-describedby={d} value={f.stock} onChange={set('stock')} inputMode="decimal" className="num" invalid={!!errs.stock} />}</Field>
            <Field label={t('prod.sku')} optional>{(i) => <Input id={i} value={f.sku} onChange={set('sku')} maxLength={64} autoComplete="off" />}</Field>
            <Field label={t('prod.barcode')} optional>{(i) => <Input id={i} value={f.barcode} onChange={set('barcode')} maxLength={64} inputMode="numeric" autoComplete="off" />}</Field>
          </div>
        </div>
      </details>
      {!isNew && (
        <label className="mb-4 flex min-h-11 items-center gap-2 font-semibold">
          <input type="checkbox" className="h-5 w-5 accent-[var(--color-brand-600)]" checked={f.is_active} onChange={(e) => setF((s) => ({ ...s, is_active: e.target.checked }))} />{t('c.active')}
        </label>
      )}
      <ErrorBox error={error} notSaved />
      <Button type="submit" full busy={busy}>{t('c.save')}</Button>
    </form>
  );
}
