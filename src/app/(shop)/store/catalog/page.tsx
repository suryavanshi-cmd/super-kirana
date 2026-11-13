'use client';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Button, Dialog, ErrorBox, Icon, MoneyInput, Money, Notice, PageHeader, SearchBox, Skeleton, useToast } from '@/components/ui';
import { AppError, rpc } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { paiseToInputText, parseRupees } from '@/lib/money';
import { useShop } from '@/lib/session';
import { searchCatalog, useCatalog, useInventory, type CatalogItem } from '@/lib/store';
import { soundsLike } from '@/lib/translit';

const PAGE = 40;

/**
 * Pick many everyday items at once from a ready-made Maharashtra kirana list. Each item's price is
 * prefilled with an approximate figure and must be checked by the owner before it is added.
 */
export default function CatalogPage() {
  const { t, locale } = useI18n();
  const { shop } = useShop();
  const router = useRouter();
  const toast = useToast();
  const cat = useCatalog();
  const inv = useInventory();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);
  const [picked, setPicked] = useState<Map<string, string>>(new Map());   // ref -> price text
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | string | null>(null);

  const added = useMemo(() => new Set((inv.data ?? []).map((p) => p.catalog_ref).filter(Boolean) as string[]), [inv.data]);
  const categories = useMemo(() => [...new Set((cat.items ?? []).map((i) => i.category))], [cat.items]);
  const results = useMemo(() => (cat.items ? searchCatalog(cat.items, q, category, soundsLike) : []), [cat.items, q, category]);
  const byRef = useMemo(() => new Map((cat.items ?? []).map((i) => [i.ref, i])), [cat.items]);
  const selected = [...picked.entries()].map(([ref, price]) => ({ item: byRef.get(ref)!, price })).filter((x) => x.item);
  const allPriced = selected.every((x) => parseRupees(x.price, { allowZero: false }).ok);

  const nameOf = (i: CatalogItem) => (locale === 'mr-IN' ? i.name_mr : i.name_en);
  function toggle(i: CatalogItem) {
    setPicked((m) => {
      const n = new Map(m);
      if (n.has(i.ref)) n.delete(i.ref); else n.set(i.ref, paiseToInputText(i.price_paise));
      return n;
    });
  }
  const setPrice = (ref: string, v: string) => setPicked((m) => new Map(m).set(ref, v));

  async function save() {
    setBusy(true); setError(null);
    try {
      let total = 0;
      for (let k = 0; k < selected.length; k += 300) {
        const chunk = selected.slice(k, k + 300).map(({ item, price }) => {
          const p = parseRupees(price);
          return { ref: item.ref, name: nameOf(item), name_mr: item.name_mr, name_en: item.name_en, category: item.category, unit: item.unit,
            price_paise: p.ok ? p.value : 0 };
        });
        const r = await rpc<{ added: number }>('add_catalog_products', { p_shop_id: shop.id, p_items: chunk });
        total += r.added;
      }
      toast(t('cat.done', { a: total }));
      setPicked(new Map()); setConfirming(false);
      await inv.reload();
      router.push('/store/inventory');
    } catch (e) {
      setError(e instanceof AppError ? e : String(e));
      setConfirming(false);
    } finally { setBusy(false); }
  }

  return (
    <div className="pb-24">
      <PageHeader title={t('cat.title')} back="/store" />
      <Notice tone="warn">{t('cat.priceNote')}</Notice>
      <SearchBox value={q} onChange={(v) => { setQ(v); setShown(PAGE); }} placeholder={t('cat.search')} />
      <div className="-mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pb-2" role="group" aria-label={t('cat.allCats')}>
        {[null, ...categories].map((c) => (
          <button key={c ?? 'all'} type="button" onClick={() => { setCategory(c); setShown(PAGE); }} aria-pressed={category === c}
            className={`min-h-10 shrink-0 rounded-full border px-3 text-sm font-semibold ${category === c ? 'border-brand-600 bg-brand-600 text-white' : 'border-line bg-white'}`}>
            {c ?? t('cat.allCats')}
          </button>
        ))}
      </div>
      {!cat.items && (cat.error ? <ErrorBox error={cat.error} onRetry={cat.retry} /> : <><p className="text-muted">{t('cat.loading')}</p><Skeleton lines={6} /></>)}
      {error && <ErrorBox error={error} notSaved />}
      <ul className="divide-y divide-line" data-testid="catalog-list">
        {results.slice(0, shown).map((i) => {
          const isAdded = added.has(i.ref);
          const on = picked.has(i.ref);
          const price = picked.get(i.ref) ?? '';
          const bad = on && !parseRupees(price).ok;
          return (
            <li key={i.ref} className="py-2">
              <button type="button" disabled={isAdded} onClick={() => toggle(i)} aria-pressed={on}
                className="flex min-h-14 w-full items-center gap-3 text-left disabled:opacity-60">
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 ${on || isAdded ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-400'}`}>
                  {(on || isAdded) && <Icon name="check" className="h-4 w-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{nameOf(i)}</span>
                  <span className="block truncate text-xs text-muted">{locale === 'mr-IN' ? i.name_en : i.name_mr} · {i.category}</span>
                </span>
                <span className="shrink-0 text-right text-sm">
                  {isAdded ? <span className="font-semibold text-brand-700">{t('cat.added')}</span>
                    : <><Money paise={i.price_paise} /><span className="block text-xs text-muted">/ {t(`unit.${i.unit}`)}</span></>}
                </span>
              </button>
              {on && (
                <div className="ml-9 mt-1 flex items-center gap-2">
                  <label className="shrink-0 text-sm font-semibold" htmlFor={`p-${i.ref}`}>{t('cat.priceFor', { u: t(`unit.${i.unit}`) })}</label>
                  <MoneyInput id={`p-${i.ref}`} value={price} onChange={(e) => setPrice(i.ref, e.target.value)} invalid={bad} className="h-11" />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {results.length > shown && <Button variant="ghost" full onClick={() => setShown((n) => n + PAGE)}>{t('cat.more')} ({results.length - shown})</Button>}

      {picked.size > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white p-3">
          <div className="mx-auto max-w-3xl">
            {!allPriced && <p className="mb-1 text-sm font-semibold text-due">{t('cat.badPrice')}</p>}
            <Button full className="min-h-14 text-lg" disabled={!allPriced} onClick={() => setConfirming(true)} data-testid="catalog-add">
              {t('cat.addN', { n: picked.size })}
            </Button>
          </div>
        </div>
      )}
      <Dialog open={confirming} title={t('cat.confirm')} onClose={() => !busy && setConfirming(false)}
        actions={<><Button busy={busy} onClick={save}>{t('cat.addN', { n: selected.length })}</Button><Button variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>{t('c.edit')}</Button></>}>
        <ul className="max-h-72 divide-y divide-line overflow-y-auto">
          {selected.map(({ item, price }) => (
            <li key={item.ref} className="flex justify-between gap-2 py-2 text-sm">
              <span className="min-w-0 truncate">{nameOf(item)}</span>
              <span className="num shrink-0 font-semibold">₹{price} / {t(`unit.${item.unit}`)}</span>
            </li>
          ))}
        </ul>
      </Dialog>
    </div>
  );
}
