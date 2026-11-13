'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, EmptyState, ErrorBox, Icon, Input, MoneyInput, Notice, PageHeader, Select } from '@/components/ui';
import { rpc } from '@/lib/api';
import { useOnline } from '@/lib/data';
import type { Key } from '@/lib/dictionary';
import { lineId, loadDraft, saveDraft, type Line } from '@/lib/draft';
import { useI18n } from '@/lib/i18n';
import { useProducts } from '@/lib/lists';
import { formatPaise, paiseToInputText, parseQty, parseRupees, UNITS, unitRatio, type Unit } from '@/lib/money';
import { recognizeBest } from '@/lib/ocr/adapters';
import { applyCatalogue, matchProducts } from '@/lib/ocr/match';
import { isResolved, parseText } from '@/lib/ocr/parse';
import type { DraftItem, Flag } from '@/lib/ocr/types';
import { useShop } from '@/lib/session';
import { prepare, readBillPhoto, toDraftLines, visionAvailable } from '@/lib/vision';

type Stage = 'capture' | 'preview' | 'reading' | 'review' | 'unclear';
const MIN_CONFIDENCE = 45;

export default function ScanPage() {
  const { t } = useI18n();
  const { shop, scope } = useShop();
  const router = useRouter();
  const online = useOnline();
  const products = useProducts();
  const [stage, setStage] = useState<Stage>('capture');
  const [image, setImage] = useState<Blob | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [items, setItems] = useState<DraftItem[]>([]);
  const [meta, setMeta] = useState<{ provider: string; text: string; confidence: number | null }>({ provider: '', text: '', confidence: null });
  const [typed, setTyped] = useState('');
  const [typing, setTyping] = useState(false);
  const [idx, setIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const catalogue = useMemo(() => products.data ?? [], [products.data]);
  const [fast, setFast] = useState<boolean | null>(null);    // Gemini photo reader configured?
  const [elapsed, setElapsed] = useState(0);
  const [note, setNote] = useState<string | null>(null);

  // Ask once on opening (this also wakes the server so the first photo is quick).
  useEffect(() => { let live = true; void visionAvailable(shop.id).then((ok) => { if (live) setFast(ok); }); return () => { live = false; }; }, [shop.id]);
  useEffect(() => {
    if (stage !== 'reading') return;
    const t0 = Date.now(); setElapsed(0);
    const id = setInterval(() => setElapsed((Date.now() - t0) / 1000), 100);
    return () => clearInterval(id);
  }, [stage]);

  useEffect(() => () => { if (imageUrl) URL.revokeObjectURL(imageUrl); }, [imageUrl]);

  function pick(file: File | undefined) {
    if (!file) return;
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    setImage(file); setImageUrl(URL.createObjectURL(file)); setError(null); setNote(null);
    // Fast path: straight from the camera to a ready bill, no extra tap.
    void (async () => { if (online && fast !== false && await visionAvailable(shop.id)) void readFast(file); else setStage('preview'); })();
  }

  /** Photo → Gemini → bill lines with the shop's prices → bill screen (where the shopkeeper confirms). */
  async function readFast(file: Blob) {
    setStage('reading'); setProgress(0.1);
    const t0 = Date.now();
    try {
      const prepared = await prepare(file);
      setProgress(0.4);
      const r = await readBillPhoto(prepared, shop.id);
      if (r.lines.length === 0) { setItems([]); setStage('unclear'); return; }
      const lines = toDraftLines(r).map((l) => (l.price && !(l.flags ?? []).includes('price') && !l.productId ? { ...l, priceVia: 'photo' as const } : l));
      const seconds = ((Date.now() - t0) / 1000).toFixed(1);
      const d = await loadDraft(scope);
      await saveDraft(scope, { ...d, lines: [...d.lines, ...lines], source: 'ocr', ocrJobId: null, paperTotal: r.total_paise,
        changes: [...(d.changes ?? []), { at: Date.now(), how: 'photo' as const, text: t('ch.photo', { n: lines.length, s: seconds }) }] });
      // Keep a short-lived record of what was read (30 days), without slowing the shopkeeper down.
      void rpc('log_ocr_job', { p_shop_id: shop.id, p_provider: `gemini:${r.model}`.slice(0, 40), p_status: 'recognized', p_raw_text: r.lines.map((x) => x.heard).join('\n'),
        p_items: r.lines, p_mean_confidence: null }).catch(() => undefined);
      router.push('/bill');
    } catch {
      // Gemini not reachable / not configured / over its limit: fall back to the older reader.
      setNote(t('scan.aiFailed'));
      setFast(false);
      try {
        const r = await recognizeBest(file, shop.id, setProgress);
        toReview(r.text, r.lines, r.provider, r.confidence);
      } catch { setError(t('scan.unclear')); setStage('unclear'); }
    }
  }
  function toReview(text: string, lines: { text: string; confidence: number | null }[] | undefined, provider: string, confidence: number | null) {
    const parsed = parseText(text, lines).map((i) => applyCatalogue(i, catalogue));
    setItems(parsed); setIdx(0); setMeta({ provider, text, confidence });
    setStage(parsed.length === 0 || (confidence !== null && confidence < MIN_CONFIDENCE) ? 'unclear' : 'review');
  }
  async function read() {
    if (!image) return;
    setStage('reading'); setProgress(0); setError(null);
    try {
      const r = await recognizeBest(image, shop.id, setProgress);
      toReview(r.text, r.lines, r.provider, r.confidence);
    } catch { setError(t('scan.unclear')); setStage('unclear'); }
  }

  const patch = (id: string, p: Partial<DraftItem>, clear: Flag[] = []) =>
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...p, reviewed: p.reviewed ?? false, flags: x.flags.filter((f) => !clear.includes(f)) } : x)));
  function resolveAmbiguous(it: DraftItem, as: 'rate' | 'total') {
    const amount = it.ambiguousAmountPaise!;
    if (as === 'rate') { patch(it.id, { unitPricePaise: amount, ambiguousAmountPaise: null }, ['ambiguous_amount']); return; }
    const q = parseQty(it.qtyText);
    const exact = q.ok && (amount * 1000) % q.value === 0 ? (amount * 1000) / q.value : null;
    // A line total only gives a rate when it divides exactly; otherwise the shopkeeper types the rate.
    patch(it.id, { lineTotalPaise: amount, ambiguousAmountPaise: null, unitPricePaise: exact }, ['ambiguous_amount']);
    if (exact === null) setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, flags: [...new Set<Flag>([...x.flags, 'price_missing'])] } : x)));
  }
  const complete = (it: DraftItem) => isResolved({ ...it, reviewed: true });
  const unresolved = items.filter((i) => !isResolved(i)).length;

  async function addToBill() {
    if (items.length === 0 || unresolved > 0) return;
    setBusy(true);
    let jobId: string | null = null;
    try {
      jobId = await rpc<string>('log_ocr_job', { p_shop_id: shop.id, p_provider: meta.provider, p_status: 'recognized', p_raw_text: meta.text,
        p_items: items.map((i) => ({ raw: i.raw, name: i.name, qty: i.qtyText, unit: i.unit, unit_price_paise: i.unitPricePaise, line_total_paise: i.lineTotalPaise, matched_product_id: i.productId, flags: i.flags })),
        p_mean_confidence: meta.confidence });
    } catch { jobId = null; }       // the log is optional; the draft itself stays on this phone
    const lines: Line[] = items.map((i) => ({ id: lineId(), productId: i.productId, name: i.name.trim(), qty: i.qtyText, unit: i.unit!, priceUnit: i.priceUnit ?? i.unit!,
      price: paiseToInputText(i.unitPricePaise!), discount: '', fromOcr: true }));
    const d = await loadDraft(scope);
    await saveDraft(scope, { ...d, lines: [...d.lines, ...lines], source: 'ocr', ocrJobId: jobId });
    router.push('/bill');
  }

  function ItemCard({ it }: { it: DraftItem }) {
    const matches = matchProducts(it.name, catalogue, 5).map((m) => m.product);
    const current = it.productId ? catalogue.find((p) => p.id === it.productId) : undefined;
    const options = current && !matches.some((p) => p.id === current.id) ? [current, ...matches] : matches;
    const qtyOk = parseQty(it.qtyText).ok;
    const ready = complete(it);
    return (
      <div className={`rounded-2xl border p-3 ${isResolved(it) ? 'border-brand-200 bg-brand-50' : 'border-amber-300 bg-white'}`} data-testid="ocr-item">
        <p className="text-xs text-muted">{t('scan.raw')}: <span className="font-mono">{it.raw}</span></p>
        <label className="mt-2 block text-xs font-semibold text-muted">{t('bill.itemName')}
          <Input value={it.name} onChange={(e) => patch(it.id, { name: e.target.value })} className="mt-0.5 font-semibold" maxLength={120} />
        </label>
        <label className="mt-2 block text-xs font-semibold text-muted">{t('scan.match')}
          <Select className="mt-0.5" value={it.productId ?? ''} onChange={(e) => {
            const p = catalogue.find((x) => x.id === e.target.value);
            if (!p) { patch(it.id, { productId: null }); return; }
            const usePrice = it.unitPricePaise === null && it.ambiguousAmountPaise === null && unitRatio(it.unit ?? p.unit, p.unit);
            patch(it.id, { productId: p.id, name: p.name, unit: it.unit ?? p.unit, priceUnit: usePrice ? p.unit : it.priceUnit ?? it.unit ?? p.unit,
              unitPricePaise: usePrice ? p.default_price_paise : it.unitPricePaise }, ['unmatched', ...(usePrice ? ['price_missing' as Flag] : [])]);
            if (usePrice) setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, flags: [...new Set<Flag>([...x.flags, 'price_from_catalogue'])] } : x)));
          }}>
            <option value="">{t('scan.noMatch')}</option>
            {options.map((p) => <option key={p.id} value={p.id}>{p.name} — {formatPaise(p.default_price_paise)}/{t(`unit.${p.unit}`)}</option>)}
          </Select>
        </label>
        <div className="mt-2 grid grid-cols-3 gap-2">
          <label className="block text-xs font-semibold text-muted">{t('bill.qty')}
            <Input value={it.qtyText} onChange={(e) => patch(it.id, { qtyText: e.target.value }, ['qty_missing'])} inputMode="decimal" invalid={!qtyOk} className="num mt-0.5" />
          </label>
          <label className="block text-xs font-semibold text-muted">{t('prod.unit')}
            <Select className="mt-0.5" value={it.unit ?? ''} onChange={(e) => { const u = e.target.value as Unit; patch(it.id, { unit: u, priceUnit: it.priceUnit && unitRatio(u, it.priceUnit) ? it.priceUnit : u }, ['unit_missing']); }}>
              <option value="" disabled>—</option>
              {UNITS.map((u) => <option key={u} value={u}>{t(`unit.${u}`)}</option>)}
            </Select>
          </label>
          <label className="block text-xs font-semibold text-muted">{t('bill.rate')}{it.priceUnit ? ` / ${t(`unit.${it.priceUnit}`)}` : ''}
            <MoneyInput className="mt-0.5" value={it.unitPricePaise === null ? '' : paiseToInputText(it.unitPricePaise)} invalid={it.unitPricePaise === null}
              onChange={(e) => { const p = parseRupees(e.target.value, { allowZero: true }); patch(it.id, { unitPricePaise: p.ok ? p.value : null, ambiguousAmountPaise: null }, ['price_missing', 'price_from_catalogue', 'ambiguous_amount', 'total_mismatch']); }} />
          </label>
        </div>
        {it.ambiguousAmountPaise !== null && (
          <div className="mt-2 rounded-xl bg-due-bg p-2">
            <p className="text-sm font-semibold text-due">{formatPaise(it.ambiguousAmountPaise)} — {t('scan.flag.ambiguous_amount')}</p>
            <div className="mt-1 grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => resolveAmbiguous(it, 'rate')}>{t('scan.isRate')}</Button>
              <Button variant="secondary" onClick={() => resolveAmbiguous(it, 'total')}>{t('scan.isTotal')}</Button>
            </div>
          </div>
        )}
        <ul className="mt-2 space-y-0.5">
          {it.flags.filter((f) => f !== 'ambiguous_amount').map((f) => (
            <li key={f} className="flex items-start gap-1 text-sm font-medium text-due"><Icon name="alert" className="mt-0.5 h-4 w-4" />{t(`scan.flag.${f}` as Key)}</li>
          ))}
        </ul>
        <div className="mt-2 flex items-center justify-between gap-2">
          <label className={`flex min-h-11 items-center gap-2 font-semibold ${ready ? '' : 'text-muted'}`}>
            <input type="checkbox" className="h-6 w-6 accent-[var(--color-brand-600)]" disabled={!ready} checked={it.reviewed && ready} onChange={(e) => patch(it.id, { reviewed: e.target.checked })} />
            {t('scan.markChecked')}
          </label>
          <Button variant="ghost" onClick={() => { setItems((xs) => xs.filter((x) => x.id !== it.id)); setIdx((i) => Math.max(0, Math.min(i, items.length - 2))); }}>{t('scan.removeLine')}</Button>
        </div>
      </div>
    );
  }

  const typedPanel = (
    <Card className="mt-3">
      <label className="block text-sm font-semibold">{t('scan.typeInstead')}
        <textarea value={typed} onChange={(e) => setTyped(e.target.value)} rows={6} placeholder={t('scan.typePh')}
          className="mt-1 block w-full rounded-xl border border-slate-400 p-3" />
      </label>
      <Button full className="mt-2" disabled={!typed.trim()} onClick={() => { setTyping(false); toReview(typed, undefined, 'typed', null); }}>{t('scan.useTyped')}</Button>
    </Card>
  );
  const photo = imageUrl && (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={imageUrl} alt={t('scan.photo')} className="max-h-[70dvh] w-full rounded-2xl border border-line object-contain" />
  );

  return (
    <div>
      <PageHeader title={t('scan.title')} back="/home" />
      <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" data-testid="camera-input" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
      <input ref={gallery} type="file" accept="image/*" className="hidden" data-testid="gallery-input" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />

      {stage === 'capture' && (
        <div>
          <p>{fast ? t('scan.fastIntro') : t('scan.intro')}</p>
          {!fast && <Notice tone="warn">{t('scan.honest')}</Notice>}
          <div className="mt-4 grid gap-3">
            <Button onClick={() => camera.current?.click()} className="min-h-16 text-lg"><Icon name="camera" className="h-7 w-7" />{t('scan.take')}</Button>
            <Button variant="secondary" onClick={() => gallery.current?.click()}>{t('scan.choose')}</Button>
            <Button variant="ghost" onClick={() => setTyping((v) => !v)}>{t('scan.typeInstead')}</Button>
          </div>
          {typing && typedPanel}
          <p className="mt-4 text-sm text-muted">{t('scan.privacy')}</p>
        </div>
      )}

      {stage === 'preview' && (
        <div>
          {photo}
          {!online && <Notice tone="warn" icon="offline">{t('sync.offline')} — {t('scan.device')}</Notice>}
          <div className="mt-4 grid gap-3">
            <Button onClick={read} className="min-h-14 text-lg">{t('scan.read')}</Button>
            <Button variant="secondary" onClick={() => setStage('capture')}>{t('scan.retake')}</Button>
          </div>
        </div>
      )}

      {stage === 'reading' && (
        <div role="status" className="py-10 text-center">
          <p className="text-lg font-semibold">{fast !== false ? t('scan.fast') : t('scan.reading')}</p>
          <p className="num mt-1 text-muted">{t('scan.seconds', { s: elapsed.toFixed(1) })}</p>
          {note && <p className="mt-2 text-sm text-due">{note}</p>}
          <div className="mx-auto mt-4 h-3 max-w-xs overflow-hidden rounded-full bg-slate-200"><div className="h-full bg-brand-600" style={{ width: `${Math.max(5, Math.round(progress * 100))}%` }} /></div>
        </div>
      )}

      {stage === 'unclear' && (
        <div>
          <EmptyState icon="alert" title={t('scan.unclear')} hint={items.length === 0 && !error ? t('scan.nothing') : t('scan.unclearHint')}
            action={<Button onClick={() => setStage('capture')}>{t('scan.retake')}</Button>} />
          <p className="mt-4 text-sm font-semibold">{t('scan.unclearHint')}</p>
          {typedPanel}
        </div>
      )}

      {stage === 'review' && (
        <div>
          <Notice tone="warn">{t('scan.draftOnly')}</Notice>
          <p className="text-sm text-muted">{meta.provider === 'ocr-space' ? t('scan.cloud') : meta.provider === 'typed' ? t('scan.typeInstead') : t('scan.device')}</p>
          <div className="md:grid md:grid-cols-2 md:gap-4">
            {photo && (
              <div className="md:sticky md:top-20 md:self-start">
                <details className="md:hidden"><summary className="min-h-11 cursor-pointer py-2 font-semibold text-brand-700">{t('scan.photo')}</summary>{photo}</details>
                <div className="hidden md:block">{photo}</div>
              </div>
            )}
            <div className={photo ? '' : 'md:col-span-2'}>
              {/* Phones: one line at a time. */}
              {items.length > 0 && (
                <div className="md:hidden" data-testid="ocr-stepper">
                  <div className="mb-2 flex items-center justify-between">
                    <Button variant="secondary" disabled={idx === 0} onClick={() => setIdx(idx - 1)}>{t('c.prev')}</Button>
                    <span className="num font-semibold">{t('scan.itemOf', { i: Math.min(idx, items.length - 1) + 1, n: items.length })}</span>
                    <Button variant="secondary" disabled={idx >= items.length - 1} onClick={() => setIdx(idx + 1)}>{t('c.next')}</Button>
                  </div>
                  {ItemCard({ it: items[Math.min(idx, items.length - 1)] })}
                  <ol className="mt-3 flex flex-wrap gap-2" aria-label={t('scan.review')}>
                    {items.map((x, i) => (
                      <li key={x.id}><button type="button" onClick={() => setIdx(i)} aria-current={i === idx ? 'step' : undefined} aria-label={`${t('scan.itemOf', { i: i + 1, n: items.length })}: ${isResolved(x) ? t('scan.ok') : t('scan.needsReview')}`}
                        className={`num flex h-11 w-11 items-center justify-center rounded-full border-2 text-sm font-bold ${isResolved(x) ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-amber-500 bg-due-bg text-due'} ${i === idx ? 'ring-2 ring-ink ring-offset-2' : ''}`}>
                        {isResolved(x) ? <Icon name="check" className="h-5 w-5" /> : i + 1}</button></li>
                    ))}
                  </ol>
                </div>
              )}
              {/* Larger screens: photo and the whole list side by side. */}
              <div className="hidden space-y-3 md:block">{items.map((x) => <div key={x.id}>{ItemCard({ it: x })}</div>)}</div>
              {items.length === 0 && <EmptyState icon="list" title={t('scan.nothing')} />}
            </div>
          </div>
          {error && <ErrorBox error={error} />}
          <div className="mt-4 grid gap-2">
            {unresolved > 0 && <p role="status" className="text-center font-semibold text-due">{t('scan.fixFirst', { n: unresolved })}</p>}
            <Button busy={busy} disabled={items.length === 0 || unresolved > 0} onClick={addToBill} className="min-h-14 text-lg">{t('scan.addToBill')}</Button>
            <Button variant="secondary" onClick={() => setStage('capture')}>{t('scan.retake')}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
