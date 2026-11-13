'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BillVoice } from '@/components/bill-voice';
import { BILL_EVENT, type BillEventDetail } from '@/components/voice-assistant';
import { CustomerForm } from '@/components/customer-form';
import { failedText, UnknownOutcome } from '@/components/outcome';
import { Button, Card, Dialog, DueTag, EmptyState, ErrorBox, Field, Icon, Input, LinkButton, Money, MoneyInput, Notice, PageHeader, Row, SearchBox, Segmented, Select, Skeleton, useToast, errorLine } from '@/components/ui';
import { newKey, rpc, type CustomerRow, type Method, type Product } from '@/lib/api';
import { matches, useOnline } from '@/lib/data';
import { calcBill, calcLine, clearDraft, emptyDraft, invoiceItems, lineFromProduct, lineId, loadDraft, saveDraft, type Change, type Draft, type Line } from '@/lib/draft';
import { useI18n } from '@/lib/i18n';
import { useCustomers, useProducts } from '@/lib/lists';
import { compatibleUnits, formatPaise, paiseToInputText, type Unit } from '@/lib/money';
import { parseBillCommand, type BillOp } from '@/lib/voice/billcmd';
import { send, type Pending } from '@/lib/mutations';
import { useShop } from '@/lib/session';

function BillScreen() {
  const { t } = useI18n();
  const { shop, scope, isOwner } = useShop();
  const router = useRouter();
  const toast = useToast();
  const online = useOnline();
  const customerParam = useSearchParams().get('customer');
  const customers = useCustomers();
  const products = useProducts();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [search, setSearch] = useState('');
  const [picking, setPicking] = useState(false);
  const [custSearch, setCustSearch] = useState('');
  const [addingCustomer, setAddingCustomer] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [key, setKey] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [undo, setUndo] = useState<{ lines: Line[]; label: string } | null>(null);
  const [savingPrice, setSavingPrice] = useState<string | null>(null);
  const priceAtFocus = useRef<{ id: string; price: string } | null>(null);
  const fromGlobalMic = useRef<(d: BillEventDetail) => void>(() => undefined);
  useEffect(() => {
    const on = (e: Event) => fromGlobalMic.current((e as CustomEvent<BillEventDetail>).detail);
    window.addEventListener(BILL_EVENT, on);
    return () => window.removeEventListener(BILL_EVENT, on);
  }, []);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { void loadDraft(scope).then(setDraft); }, [scope]);

  // Every change is written to the device straight away, so a closed tab or dead battery loses nothing.
  const unsaved = useRef<Draft | null>(null);
  const update = useCallback((fn: (d: Draft) => Draft) => {
    setDraft((d) => {
      if (!d) return d;
      const next = fn(d);
      unsaved.current = next;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => { unsaved.current = null; void saveDraft(scope, next); }, 250);
      return next;
    });
  }, [scope]);
  /** Stops any pending write so a finished or discarded bill can never be written back. */
  const dropPendingSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null; unsaved.current = null;
  }, []);
  // Leaving the screen within the debounce window still keeps the last edit.
  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (unsaved.current) void saveDraft(scope, unsaved.current);
  }, [scope]);

  // Opening "New Bill" from a customer's page selects that customer.
  useEffect(() => {
    if (!draft || !customerParam || !customers.data || draft.customerId === customerParam) return;
    const c = customers.data.find((x) => x.id === customerParam && x.is_active);
    if (c) update((d) => ({ ...d, customerId: c.id, customerName: c.name, paid: '', paidTouched: false }));
  }, [draft, customerParam, customers.data, update]);

  const customer: CustomerRow | null = useMemo(
    () => (draft?.customerId ? customers.data?.find((c) => c.id === draft.customerId) ?? null : null), [draft?.customerId, customers.data]);
  const previous = customer?.balance_paise ?? 0;
  const calc = useMemo(() => (draft ? calcBill(draft, previous) : null), [draft, previous]);
  const found = useMemo(() => (search.trim() ? (products.data ?? []).filter((p) => p.is_active && matches(search, p.name, p.name_en, p.name_mr, p.sku, p.barcode)).slice(0, 8) : []), [search, products.data]);

  if (!draft || !calc) return <Skeleton lines={5} />;
  const walkIn = draft.customerId === null;

  // Editing a line by hand means the shopkeeper has looked at it: its photo warnings go away.
  const setLine = (id: string, patch: Partial<Line>) => update((d) => ({ ...d, lines: d.lines.map((l) => (l.id === id ? { ...l, flags: [], ...patch } : l)) }));
  const log = (d: Draft, how: Change['how'], text: string): Change[] => [...(d.changes ?? []), { at: Date.now(), how, text }].slice(-200);
  const unitText = (q: string, u: Unit) => `${q} ${t(`unit.${u}`)}`;
  const rupees = (paise: number) => formatPaise(paise).replace(/\.00$/, '');

  /** Applies spoken / typed changes; one tap on "Undo" brings the bill back exactly as it was. */
  function applyOps(ops: BillOp[], heard: string, how: 'voice' | 'typed') {
    if (!draft) return;
    const before = draft.lines;
    const notes: string[] = [];
    let lines = [...before];
    for (const op of ops) {
      if (op.kind === 'add') {
        const nl: Line = op.product ? { ...lineFromProduct(op.product), qty: op.qty, unit: op.unit } : { id: lineId(), productId: null, name: op.name, qty: op.qty, unit: op.unit, priceUnit: op.unit, price: '', discount: '' };
        if (op.pricePaise !== null) nl.price = paiseToInputText(op.pricePaise);
        if (op.pricePaise !== null && op.product && op.pricePaise !== op.product.default_price_paise) nl.priceVia = how;
        lines.push(nl);
        notes.push(t('ch.add', { n: nl.name, q: unitText(op.qty, op.unit) }));
        continue;
      }
      const l = lines.find((x) => x.id === op.lineId);
      if (!l) continue;
      if (op.kind === 'remove') { lines = lines.filter((x) => x.id !== l.id); notes.push(t('ch.remove', { n: l.name })); continue; }
      if (op.kind === 'price') {
        const old = calcLine(l).ok ? rupees(calcLine(l).pricePaise) : l.price || '—';
        lines = lines.map((x) => (x.id === l.id ? { ...x, price: paiseToInputText(op.pricePaise), priceVia: how, flags: [] } : x));
        notes.push(t('ch.price', { n: l.name, a: old, b: rupees(op.pricePaise) }));
      }
      if (op.kind === 'qty') {
        lines = lines.map((x) => (x.id === l.id ? { ...x, qty: op.qty, unit: op.unit, flags: [] } : x));
        notes.push(t('ch.qty', { n: l.name, a: unitText(l.qty, l.unit), b: unitText(op.qty, op.unit) }));
      }
    }
    update((d) => ({ ...d, lines, changes: log(d, how, `"${heard}" → ${notes.join('; ')}`) }));
    setUndo({ lines: before, label: t('bv.done', { n: notes.length }) });
  }
  // The mic at the bottom of every screen: on this screen it edits the open bill.
  fromGlobalMic.current = (detail) => {
    const lines = draft.lines.map((l) => ({ id: l.id, name: l.name, productId: l.productId, unit: l.unit, priceUnit: l.priceUnit }));
    let best: { text: string; ops: BillOp[] } = { text: '', ops: [] };
    for (const a of detail.alternatives) { const r = parseBillCommand(a, lines, products.data ?? []); if (r.ops.length > best.ops.length) best = { text: a, ops: r.ops }; }
    if (!best.ops.length) return;
    applyOps(best.ops, best.text, 'voice');
    detail.handled = true;
    detail.summary = t('bv.done', { n: best.ops.length });
  };
  function undoLast() {
    if (!undo) return;
    const prev = undo.lines;
    update((d) => ({ ...d, lines: prev, changes: log(d, 'typed', t('ch.undone')) }));
    setUndo(null);
  }
  /** Makes this line's rate the shop's price for future bills (owner only). Old bills keep their price. */
  async function makeShopPrice(l: Line, p: Product, pricePaise: number) {
    setSavingPrice(l.id);
    try {
      const source = l.priceVia === 'voice' ? 'voice' : l.priceVia === 'photo' ? 'photo' : 'manual';
      await rpc('change_product_price', { p_shop_id: shop.id, p_product_id: p.id, p_price_paise: pricePaise, p_source: source });
      update((d) => ({ ...d, changes: log(d, l.priceVia === 'voice' ? 'voice' : 'typed', t('ch.shopPrice', { n: p.name, a: rupees(p.default_price_paise), b: rupees(pricePaise) })) }));
      toast(t('bp.saved'));
      await products.reload();
    } catch (e) { toast(errorLine(t, e)); }
    finally { setSavingPrice(null); }
  }
  function addProduct(p: Product) {
    update((d) => {
      const same = d.lines.find((l) => l.productId === p.id && l.unit === p.unit && /^\d+$/.test(l.qty));
      if (same) return { ...d, lines: d.lines.map((l) => (l.id === same.id ? { ...l, qty: String(Number(l.qty) + 1) } : l)) };
      return { ...d, lines: [...d.lines, lineFromProduct(p)] };
    });
    setSearch('');
  }
  const addOther = () => update((d) => ({ ...d, lines: [...d.lines, { id: lineId(), productId: null, name: search.trim(), qty: '1', unit: 'piece', priceUnit: 'piece', price: '', discount: '' }] }));
  function choose(c: CustomerRow | null) {
    update((d) => ({ ...d, customerId: c?.id ?? null, customerName: c?.name ?? null, paid: '', paidTouched: false }));
    setPicking(false); setAddingCustomer(false); setCustSearch('');
  }
  const done = async (p: Pending) => {
    dropPendingSave();
    await clearDraft(scope);
    void customers.reload();
    toast(t('bill.saved'));
    router.replace(`/bills/${String(p.result?.invoice_id)}`);
  };
  const onFailed = (p: Pending) => { setPending(null); setConfirming(false); setFailed(failedText(t, p)); setKey(newKey()); void customers.reload(); };

  function review() {
    setFailed(null);
    if (!calc!.ok) { setShowErrors(true); return; }
    setKey(newKey());       // a fresh key for each reviewed version of the bill
    setConfirming(true);
  }
  async function submit() {
    if (!calc!.ok || calc!.paidPaise === null) return;
    setBusy(true);
    const p = await send(scope, { key, fn: 'create_invoice', shopId: shop.id, label: draft!.customerName ?? t('c.walkIn'), amountPaise: calc!.totalPaise,
      args: { p_shop_id: shop.id, p_idempotency_key: key, p_customer_id: draft!.customerId, p_items: invoiceItems(draft!, calc!), p_paid_paise: calc!.paidPaise,
        p_payment_method: draft!.method, p_payment_reference: draft!.reference.trim() || null, p_note: draft!.note.trim() || null,
        p_source: draft!.source, p_ocr_job_id: draft!.ocrJobId } });
    setBusy(false); setConfirming(false);
    if (p.state === 'confirmed') await done(p); else if (p.state === 'failed') onFailed(p); else setPending(p);
  }
  const problemText = calc.problem === 'walkin' ? t('bill.walkinMustPay') : calc.problem === 'overpay' ? t('bill.overpay')
    : calc.problem === 'paid' ? t('bill.checkAmount') : calc.problem === 'lines' ? t('bill.fixLines')
    : calc.problem === 'total' ? t('err.INVALID_TOTAL') : calc.problem === 'empty' ? t('err.EMPTY_BILL') : null;
  const paidText = walkIn && !draft.paidTouched ? paiseToInputText(calc.totalPaise) : draft.paid;
  const setPaid = (v: string) => update((d) => ({ ...d, paid: v, paidTouched: true }));
  const custRows = (customers.data ?? []).filter((c) => c.is_active && matches(custSearch, c.name, c.mobile)).slice(0, 30);

  return (
    <div>
      <PageHeader title={t('bill.title')} back="/home"
        action={draft.lines.length > 0 && !pending ? <Button variant="ghost" onClick={() => setClearing(true)}>{t('bill.clear')}</Button> : undefined} />
      {pending && <UnknownOutcome pending={pending} scope={scope} onConfirmed={done} onFailed={onFailed} />}
      {!pending && (
        <>
          {draft.source === 'ocr' && <Notice tone="warn" icon="camera">{t('bill.fromScan')}</Notice>}
          <button type="button" onClick={() => setPicking(true)} data-testid="pick-customer"
            className="flex min-h-16 w-full items-center gap-3 rounded-2xl border border-line p-3 text-left hover:border-brand-600">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-50 text-brand-700"><Icon name="users" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm text-muted">{t('bill.customer')}</span>
              <span className="block truncate font-bold">{draft.customerName ?? t('c.walkIn')}</span>
            </span>
            {customer && <DueTag paise={customer.balance_paise} />}
            <span className="text-sm font-semibold text-brand-700">{t('c.edit')}</span>
          </button>

          <div className="mt-4 flex gap-2">
            <div className="min-w-0 flex-1"><SearchBox value={search} onChange={setSearch} placeholder={t('bill.searchProduct')} /></div>
            <Button variant={voiceOpen ? 'primary' : 'secondary'} className="px-3" onClick={() => setVoiceOpen((v) => !v)} aria-expanded={voiceOpen} data-testid="bill-voice-open">
              <Icon name="mic" /><span className="sr-only sm:not-sr-only">{t('bv.open')}</span>
            </Button>
            <LinkButton href="/scan" variant="secondary" className="px-3"><Icon name="camera" /><span className="sr-only sm:not-sr-only">{t('home.scan')}</span></LinkButton>
          </div>
          {voiceOpen && (
            <BillVoice lines={draft.lines.map((l) => ({ id: l.id, name: l.name, productId: l.productId, unit: l.unit, priceUnit: l.priceUnit }))}
              products={products.data ?? []} onApply={applyOps} onClose={() => setVoiceOpen(false)} />
          )}
          {undo && (
            <div role="status" className="mt-2 flex items-center justify-between gap-2 rounded-xl bg-ink px-3 py-2 text-white" data-testid="undo-bar">
              <span className="text-sm font-semibold">{undo.label}</span>
              <button type="button" onClick={undoLast} className="min-h-10 rounded-lg px-3 font-bold text-brand-200 underline">{t('bv.undo')}</button>
            </div>
          )}
          {search.trim() && (
            <ul className="mt-2 divide-y divide-line rounded-2xl border border-line" data-testid="product-results">
              {found.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => addProduct(p)} className="flex min-h-14 w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-brand-50">
                    <span className="min-w-0 truncate font-semibold">{p.name}</span>
                    <span className="whitespace-nowrap text-sm text-muted"><Money paise={p.default_price_paise} /> / {t(`unit.${p.unit}`)}</span>
                  </button>
                </li>
              ))}
              <li><button type="button" onClick={() => { addOther(); setSearch(''); }} className="flex min-h-14 w-full items-center gap-2 px-3 py-2 text-left font-semibold text-brand-700 hover:bg-brand-50"><Icon name="plus" className="h-5 w-5" />{t('bill.otherItem')}</button></li>
            </ul>
          )}
          {!search.trim() && <Button variant="ghost" className="mt-1 px-0 text-brand-700" onClick={addOther}><Icon name="plus" className="h-5 w-5" />{t('bill.otherItem')}</Button>}

          <h2 className="mb-2 mt-4 font-bold">{t('bill.items')} {draft.lines.length > 0 && <span className="num text-muted">({draft.lines.length})</span>}</h2>
          {draft.lines.length === 0 && <EmptyState icon="list" title={t('bill.noItems')} hint={t('bill.noItemsHint')} />}
          <ul className="space-y-3">
            {draft.lines.map((l, i) => {
              const c = calc.lines[i];
              const bad = (showErrors || l.fromOcr) && !c.ok ? c.error : null;
              const flags = l.flags ?? [];
              const prod = l.productId ? products.data?.find((p) => p.id === l.productId) : undefined;
              const differs = !!prod && c.ok && l.priceUnit === prod.unit && c.pricePaise !== prod.default_price_paise;
              return (
                <li key={l.id} className={`rounded-2xl border p-3 ${bad ? 'border-red-400 bg-red-50' : flags.length ? 'border-amber-400 bg-due-bg' : 'border-line'}`} data-testid="bill-line">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      {l.productId
                        ? <p className="truncate pt-2 font-bold">{l.name}</p>
                        : <Input aria-label={t('bill.itemName')} placeholder={t('bill.itemName')} value={l.name} onChange={(e) => setLine(l.id, { name: e.target.value })} invalid={bad === 'name'} maxLength={120} />}
                    </div>
                    <button type="button" onClick={() => update((d) => ({ ...d, lines: d.lines.filter((x) => x.id !== l.id) }))} aria-label={`${t('c.remove')}: ${l.name}`}
                      className="flex h-11 w-11 items-center justify-center rounded-full text-muted hover:bg-slate-100"><Icon name="x" /></button>
                  </div>
                  <div className="mt-2 grid grid-cols-[1fr_1fr] gap-2 sm:grid-cols-4">
                    <label className="block text-xs font-semibold text-muted">{t('bill.qty')}
                      <Input value={l.qty} onChange={(e) => setLine(l.id, { qty: e.target.value })} inputMode="decimal" enterKeyHint="done" invalid={bad === 'qty'} className="num mt-0.5 font-semibold" />
                    </label>
                    <label className="block text-xs font-semibold text-muted">{t('prod.unit')}
                      <Select value={l.unit} onChange={(e) => setLine(l.id, l.productId ? { unit: e.target.value as Unit } : { unit: e.target.value as Unit, priceUnit: e.target.value as Unit })} className="mt-0.5">
                        {(l.productId ? compatibleUnits(l.priceUnit) : (['kg', 'g', 'litre', 'ml', 'packet', 'piece', 'dozen'] as Unit[])).map((u) => <option key={u} value={u}>{t(`unit.${u}`)}</option>)}
                      </Select>
                    </label>
                    <label className="block text-xs font-semibold text-muted">{t('bill.rate')} / {t(`unit.${l.priceUnit}`)}
                      <MoneyInput value={l.price} onChange={(e) => setLine(l.id, { price: e.target.value, priceVia: 'typed' })} invalid={bad === 'price'} className="mt-0.5"
                        onFocus={() => { priceAtFocus.current = { id: l.id, price: l.price }; }}
                        onBlur={() => {
                          const was = priceAtFocus.current; priceAtFocus.current = null;
                          if (was && was.id === l.id && was.price !== l.price) update((d) => ({ ...d, changes: log(d, 'typed', t('ch.price', { n: l.name, a: was.price ? `₹${was.price}` : '—', b: l.price ? `₹${l.price}` : '—' })) }));
                        }} />
                    </label>
                    <label className="block text-xs font-semibold text-muted">{t('bill.discount')}
                      <MoneyInput value={l.discount} onChange={(e) => setLine(l.id, { discount: e.target.value })} invalid={bad === 'discount'} placeholder="0" className="mt-0.5" />
                    </label>
                  </div>
                  {flags.length > 0 && (
                    <div className="mt-2 rounded-xl bg-white/70 p-2 text-sm" data-testid="line-flags">
                      {l.heard && <p className="text-muted">{t('pf.heard', { t: l.heard })}</p>}
                      {flags.map((f) => <p key={f} className="flex items-start gap-1 font-semibold text-due"><Icon name="alert" className="mt-0.5 h-4 w-4" />
                        {f === 'paper_price' ? t('pf.paper_price', { a: rupees(l.paperPrice ?? 0) }) : t((['qty', 'unit', 'price', 'unmatched', 'check'].includes(f) ? `pf.${f}` : 'pf.check') as 'pf.check')}</p>)}
                      <button type="button" onClick={() => setLine(l.id, {})} className="mt-1 min-h-10 font-semibold text-brand-700 underline">{t('pf.ok')}</button>
                    </div>
                  )}
                  {isOwner && differs && prod && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm" data-testid="shop-price">
                      <span className="text-muted">{t('bp.shopPrice', { a: rupees(prod.default_price_paise) })}</span>
                      <Button variant="secondary" className="min-h-10 px-3 py-1 text-sm" busy={savingPrice === l.id} onClick={() => void makeShopPrice(l, prod, c.pricePaise)}>
                        {t('bp.makeShop', { b: rupees(c.pricePaise) })}
                      </Button>
                      <a href={`/store/inventory/${prod.id}`} className="min-h-10 py-2 font-semibold text-brand-700 underline">{t('bp.history')}</a>
                    </div>
                  )}
                  <div className="mt-2 flex items-baseline justify-between">
                    <span className="text-sm text-red-800">{bad ? t(bad === 'qty' ? 'err.INVALID_QUANTITY' : bad === 'price' ? 'err.PRICE_REQUIRED' : bad === 'name' ? 'err.ITEM_NAME_REQUIRED' : bad === 'unit' ? 'err.UNIT_MISMATCH' : 'err.DISCOUNT_TOO_LARGE') : ''}</span>
                    <span className="font-bold">{c.ok ? <Money paise={c.totalPaise} /> : '—'}</span>
                  </div>
                </li>
              );
            })}
          </ul>

          {draft.lines.length > 0 && (
            <Card className="mt-4">
              <Row label={t('bill.billTotal')}><span className="text-xl" data-testid="bill-total"><Money paise={calc.totalPaise} /></span></Row>
              {!walkIn && <Row label={t('bill.prevDue')}><Money paise={previous} /></Row>}
              <div className="mt-3">
                <Field label={t('bill.received')}>{(id) => <MoneyInput id={id} value={paidText} onChange={(e) => setPaid(e.target.value)} invalid={showErrors && (calc.problem === 'paid' || calc.problem === 'walkin' || calc.problem === 'overpay')} words />}</Field>
                <div className="-mt-2 mb-3 grid grid-cols-2 gap-2">
                  <Button variant="secondary" onClick={() => setPaid(paiseToInputText(calc.totalPaise))}>{t('bill.fullPaid')}</Button>
                  <Button variant="secondary" disabled={walkIn} onClick={() => setPaid('0')}>{t('bill.onCredit')}</Button>
                </div>
                <p className="mb-1 text-sm font-semibold">{t('bill.method')}</p>
                <Segmented label={t('bill.method')} value={draft.method} onChange={(m: Method) => update((d) => ({ ...d, method: m }))}
                  options={(['cash', 'upi', 'other'] as const).map((m) => ({ value: m, label: t(`method.${m}`) }))} />
                {draft.method !== 'cash' && <div className="mt-3"><Field label={t('bill.reference')} optional>{(id) => <Input id={id} value={draft.reference} onChange={(e) => update((d) => ({ ...d, reference: e.target.value }))} maxLength={80} autoComplete="off" />}</Field></div>}
              </div>
              {calc.paidPaise !== null && !walkIn && (
                <div className="mt-3 border-t border-line pt-2">
                  <Row label={t('bill.newDue')}><Money paise={calc.billDuePaise} /></Row>
                  <Row label={t('bill.totalDue')} strong><Money paise={Math.max(calc.newBalancePaise, 0)} /></Row>
                </div>
              )}
              {calc.oldDuesPaidPaise > 0 && calc.ok && <Notice>{t('bill.split', { a: formatPaise(calc.billPaidPaise), b: formatPaise(calc.oldDuesPaidPaise) })}</Notice>}
            </Card>
          )}

          {draft.paperTotal != null && draft.lines.length > 0 && calc.lines.every((x) => x.ok) && draft.paperTotal !== calc.totalPaise && (
            <Notice tone="warn">{t('pf.totalDiff', { a: rupees(draft.paperTotal), b: rupees(calc.totalPaise) })}</Notice>
          )}
          {(draft.changes?.length ?? 0) > 0 && (
            <details className="mt-3 rounded-2xl border border-line p-3" data-testid="change-history">
              <summary className="min-h-10 cursor-pointer font-semibold">{t('ch.title', { n: draft.changes!.length })}</summary>
              <ol className="mt-2 space-y-2 text-sm">
                {[...draft.changes!].reverse().map((ch, i) => (
                  <li key={`${ch.at}-${i}`} className="flex gap-2">
                    <span className="num shrink-0 text-muted">{new Date(ch.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}</span>
                    <span className="shrink-0 rounded-full bg-slate-100 px-2 text-xs font-semibold leading-5">{t(`ch.how.${ch.how}`)}</span>
                    <span className="min-w-0 break-words">{ch.text}</span>
                  </li>
                ))}
              </ol>
            </details>
          )}
          <p className="mt-3 flex items-center gap-1 text-sm text-muted"><Icon name="clock" className="h-4 w-4" />{t('bill.draftSaved')}</p>
          {showErrors && problemText && <ErrorBox error={problemText} />}
          {failed && <ErrorBox error={failed} />}
          {!online && <Notice tone="warn" icon="offline">{t('bill.offlineBlock')}</Notice>}
          <Button full className="mt-2" disabled={draft.lines.length === 0 || !online} onClick={review}>{t('bill.preview')}</Button>
        </>
      )}

      <Dialog open={picking} title={t('cust.pick')} onClose={() => { setPicking(false); setAddingCustomer(false); }}>
        {addingCustomer
          ? <CustomerForm onCancel={() => setAddingCustomer(false)} onSaved={(id, name) => { void customers.reload(); choose({ id, name, mobile: null, is_active: true, balance_paise: 0 }); }} />
          : (
            <>
              <SearchBox value={custSearch} onChange={setCustSearch} placeholder={t('cust.searchPh')} />
              <ul className="mt-2 max-h-[50dvh] divide-y divide-line overflow-y-auto">
                <li><button type="button" onClick={() => choose(null)} className="flex min-h-14 w-full items-center gap-2 py-2 text-left font-semibold hover:bg-slate-50"><Icon name="users" className="h-5 w-5 text-muted" />{t('c.walkIn')}</button></li>
                {custRows.map((c) => (
                  <li key={c.id}><button type="button" onClick={() => choose(c)} className="flex min-h-14 w-full items-center justify-between gap-2 py-2 text-left hover:bg-slate-50">
                    <span className="min-w-0"><span className="block truncate font-semibold">{c.name}</span>{c.mobile && <span className="num block text-sm text-muted">{c.mobile}</span>}</span>
                    <DueTag paise={c.balance_paise} /></button></li>
                ))}
              </ul>
              <Button variant="secondary" full className="mt-3" onClick={() => setAddingCustomer(true)}><Icon name="plus" className="h-5 w-5" />{t('cust.new')}</Button>
            </>
          )}
      </Dialog>

      <Dialog open={confirming} title={t('bill.confirmTitle')} onClose={() => !busy && setConfirming(false)}
        actions={<><Button busy={busy} onClick={submit}>{busy ? t('bill.saving') : t('bill.confirmSave')}</Button><Button variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>{t('bill.edit')}</Button></>}>
        <p className="mb-2 font-bold">{draft.customerName ?? t('c.walkIn')}</p>
        <ul className="mb-3 divide-y divide-line text-sm">
          {draft.lines.map((l, i) => (
            <li key={l.id} className="flex justify-between gap-3 py-1.5">
              <span className="min-w-0"><span className="block truncate font-semibold">{l.name}</span>
                <span className="num text-muted">{l.qty} {t(`unit.${l.unit}`)} × {formatPaise(calc.lines[i].pricePaise)}/{t(`unit.${l.priceUnit}`)}</span></span>
              <Money paise={calc.lines[i].totalPaise} className="font-semibold" />
            </li>
          ))}
        </ul>
        {!walkIn && <Row label={t('bill.prevDue')}><Money paise={previous} /></Row>}
        <Row label={t('bill.newBill')}><Money paise={calc.totalPaise} /></Row>
        <Row label={`${t('bill.paid')} (${t(`method.${draft.method}`)})`}><Money paise={calc.paidPaise ?? 0} /></Row>
        {!walkIn && <Row label={t('bill.newDue')}><Money paise={calc.billDuePaise} /></Row>}
        {!walkIn && <Row label={t('bill.totalDue')} strong><Money paise={Math.max(calc.newBalancePaise, 0)} /></Row>}
        {calc.oldDuesPaidPaise > 0 && <Notice>{t('bill.split', { a: formatPaise(calc.billPaidPaise), b: formatPaise(calc.oldDuesPaidPaise) })}</Notice>}
      </Dialog>

      <Dialog open={clearing} title={t('bill.clear')} onClose={() => setClearing(false)}
        actions={<><Button variant="danger" onClick={() => { dropPendingSave(); void clearDraft(scope); setDraft(emptyDraft()); setShowErrors(false); setClearing(false); }}>{t('bill.clear')}</Button><Button variant="ghost" onClick={() => setClearing(false)}>{t('c.cancel')}</Button></>}>
        <p>{t('bill.clearConfirm')}</p>
      </Dialog>
    </div>
  );
}

export default function BillPage() { return <Suspense fallback={<Skeleton lines={5} />}><BillScreen /></Suspense>; }
