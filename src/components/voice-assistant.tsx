'use client';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { MicHelp, speechLabel } from './mic-help';
import { Button, DueTag, Icon, Input, Segmented, useToast } from './ui';
import type { CustomerRow } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useCustomers } from '@/lib/lists';
import { paiseToInputText } from '@/lib/money';
import { useSession } from '@/lib/session';
import { parseIntent, type Intent, type Screen } from '@/lib/voice/intent';
import { LANG_KEY, savedLang, useSpeech, type SpeechLang } from '@/lib/voice/useSpeech';

/** Event the bill screen listens to, so "साखर 52 रुपये" spoken from the global mic edits the open bill. */
export const BILL_EVENT = 'sk:bill-command';
export interface BillEventDetail { alternatives: string[]; handled: boolean; summary?: string }

const OWNER_ONLY: Screen[] = ['/store', '/store/summary', '/store/insights', '/store/inventory', '/store/stock-in', '/store/catalog', '/reports'];
// Words that clearly ask for a screen or a customer change, even while a bill is open.
const STRONG = /(कॅमेरा|camera|सारांश|summary|विश्लेषण|analysis|साठा|stock|ग्राहक|customer|बाकी\s*यादी|pending|सेटिंग|setting|होम|home|अहवाल|report|माल\s*आला|मोबाईल|mobile|नाव\s*बदल|खाते|khata)/i;

/** A mic on every screen: say what you want, the app opens the right screen already filled in. */
export function VoiceAssistant() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const path = usePathname();
  const toast = useToast();
  const { isOwner } = useSession();
  const customers = useCustomers();
  const [open, setOpen] = useState(false);
  const [lang, setLang] = useState<SpeechLang>('mr-IN');
  const [heard, setHeard] = useState('');
  const [typed, setTyped] = useState('');
  const [result, setResult] = useState<Intent | null>(null);

  useEffect(() => { setLang(savedLang(locale === 'en-IN' ? 'en-IN' : 'mr-IN')); }, [locale]);
  useEffect(() => { setOpen(false); }, [path]);

  const screenName = (to: Screen): string => ({
    '/home': t('nav.home'), '/scan': t('nav.scan'), '/bill': t('nav.bill'), '/udhari': t('nav.udhari'), '/collect': t('nav.collect'),
    '/customers': t('nav.customers'), '/store': t('nav.store'), '/store/summary': t('st.summary'), '/store/insights': t('st.insights'),
    '/store/inventory': t('st.inventory'), '/store/stock-in': t('st.stockIn'), '/store/catalog': t('st.catalog'), '/reports': t('nav.reports'),
    '/settings': t('nav.settings'), '/voice': t('nav.voice'), '/customers/new': t('fab.newCustomer'), '/sync': t('nav.sync'),
  } as Record<Screen, string>)[to];

  const go = useCallback((href: string, label: string) => { toast(t('va.opening', { n: label })); setOpen(false); router.push(href); }, [router, t, toast]);

  const editHref = (c: CustomerRow, i: Extract<Intent, { kind: 'editCustomer' }>) => {
    const q = new URLSearchParams({ edit: '1' });
    if (i.newName) q.set('name', i.newName);
    if (i.newMobile) q.set('mobile', i.newMobile);
    return `/customers/${c.id}?${q.toString()}`;
  };

  const act = useCallback((alternatives: string[]) => {
    const list = alternatives.filter(Boolean);
    if (!list.length) return;
    setHeard(list[0]);
    // On the bill screen, item changes go to the open bill unless a screen / customer was clearly asked for.
    if (path === '/bill' && !list.some((a) => STRONG.test(a))) {
      const detail: BillEventDetail = { alternatives: list, handled: false };
      window.dispatchEvent(new CustomEvent<BillEventDetail>(BILL_EVENT, { detail }));
      if (detail.handled) { toast(detail.summary ?? t('bv.done', { n: 1 })); setOpen(false); return; }
    }
    // Choose the alternative the app understands best.
    const all = customers.data ?? [];
    const rank = (i: Intent) => (i.kind === 'unknown' ? 0 : i.kind === 'openCustomer' && !i.customer ? 1 : 2);
    let best: Intent = { kind: 'unknown' };
    for (const a of list) { const i = parseIntent(a, all); if (rank(i) > rank(best)) best = i; }
    setResult(best);

    if (best.kind === 'nav') {
      if (OWNER_ONLY.includes(best.to) && !isOwner) { toast(t('st.ownerOnly')); return; }
      go(best.to, screenName(best.to));
    } else if (best.kind === 'newCustomer') {
      const q = new URLSearchParams();
      if (best.name) q.set('name', best.name);
      if (best.mobile) q.set('mobile', best.mobile);
      if (best.openingPaise) q.set('opening', paiseToInputText(best.openingPaise));
      go(`/customers/new?${q.toString()}`, t('fab.newCustomer'));
    } else if (best.kind === 'editCustomer' && best.customer) {
      if (!isOwner) { toast(t('st.ownerOnly')); return; }
      go(editHref(best.customer, best), best.customer.name);
    } else if (best.kind === 'openCustomer' && best.customer) {
      go(`/customers/${best.customer.id}`, best.customer.name);
    } else if (best.kind === 'entry') {
      go(`/voice?text=${encodeURIComponent(best.draft.text)}`, t('nav.voice'));
    }
    // Otherwise the sheet stays open: pick a customer, or say / type it again.
  }, [path, customers.data, isOwner, go, t, toast]); // eslint-disable-line react-hooks/exhaustive-deps

  const speech = useSpeech(lang, act);
  const listening = speech.status === 'listening';
  if (path === '/voice') return null;      // that screen has its own big mic

  function openAndListen() {
    setOpen(true); setHeard(''); setResult(null);
    void speech.start();                   // inside the tap, as phones require
  }

  const pickList = result && (result.kind === 'editCustomer' || result.kind === 'openCustomer') && !result.customer ? result.candidates : [];
  return (
    <div className="no-print">
      <button type="button" onClick={open ? () => setOpen(false) : openAndListen} aria-label={t('va.open')} data-testid="voice-anywhere"
        className={`fixed ${path === '/store/catalog' ? 'bottom-24' : 'bottom-[calc(var(--fab-offset,0px)+1.25rem)]'} left-4 z-50 flex h-16 w-16 items-center justify-center rounded-full text-white shadow-xl ${listening ? 'animate-pulse bg-red-600' : 'bg-ink hover:bg-slate-800'}`}
        style={{ marginBottom: 'env(safe-area-inset-bottom)' }}>
        <Icon name="mic" className="h-8 w-8" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40" onClick={() => { speech.stop(); setOpen(false); }} aria-hidden="true" />
          <div role="dialog" aria-modal="true" aria-label={t('va.title')} data-testid="voice-sheet"
            className="fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[85dvh] max-w-3xl overflow-y-auto rounded-t-3xl bg-white p-4 pb-24 shadow-2xl">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-lg font-bold">{t('va.title')}</h2>
              <button type="button" onClick={() => { speech.stop(); setOpen(false); }} aria-label={t('c.close')} className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-slate-100"><Icon name="x" /></button>
            </div>
            <Segmented label={t('vo.lang')} value={lang} onChange={(v: SpeechLang) => { setLang(v); try { localStorage.setItem(LANG_KEY, v); } catch { /* ignore */ } }}
              options={[{ value: 'mr-IN', label: 'मराठी' }, { value: 'hi-IN', label: 'हिंदी' }, { value: 'en-IN', label: 'English' }]} />
            <div className="my-4 flex items-center gap-3">
              {speech.status !== 'unsupported' && speech.status !== 'checking' && (
                <button type="button" onClick={listening ? speech.stop : () => { setHeard(''); setResult(null); void speech.start(); }} disabled={speech.status === 'asking' || speech.status === 'thinking'}
                  aria-label={listening ? t('vo.stop') : t('vo.tap')}
                  style={listening && speech.mode === 'cloud' ? { boxShadow: `0 0 0 ${4 + Math.round(speech.level * 20)}px rgba(220,38,38,0.25)` } : undefined}
                  className={`flex h-20 w-20 shrink-0 items-center justify-center rounded-full text-white shadow-lg ${listening ? 'bg-red-600' : speech.status === 'thinking' ? 'animate-pulse bg-brand-700' : 'bg-brand-600 hover:bg-brand-700'} ${listening && speech.mode === 'native' ? 'animate-pulse' : ''}`}>
                  <Icon name={listening ? 'x' : 'mic'} className="h-10 w-10" />
                </button>
              )}
              <p className="text-lg font-semibold" aria-live="polite">
                {speechLabel(t, speech, heard ? `“${heard}”` : t('va.say'))}
              </p>
            </div>
            <MicHelp status={speech.status} os={speech.os} onRetry={speech.retry} cause={speech.cause} />

            {result?.kind === 'unknown' && heard && <p className="mb-2 font-semibold text-due">{t('va.notUnderstood')}</p>}
            {pickList.length > 0 && result && (result.kind === 'editCustomer' || result.kind === 'openCustomer') && (
              <div className="mb-3">
                <p className="mb-1 font-semibold">{t('vo.pickOne')}</p>
                <ul className="space-y-2">
                  {pickList.map((c) => (
                    <li key={c.id}>
                      <button type="button" className="flex min-h-14 w-full items-center justify-between gap-2 rounded-2xl border border-line bg-white p-3 text-left hover:border-brand-600"
                        onClick={() => (result.kind === 'editCustomer' ? (isOwner ? go(editHref(c, result), c.name) : toast(t('st.ownerOnly'))) : go(`/customers/${c.id}`, c.name))}>
                        <span className="min-w-0"><span className="block truncate font-semibold">{c.name}</span>{c.mobile && <span className="num block text-sm text-muted">{c.mobile}</span>}</span>
                        <DueTag paise={c.balance_paise} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (typed.trim()) { act([typed.trim()]); setTyped(''); } }}>
              <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={t('bv.type')} aria-label={t('bv.type')} maxLength={200} data-testid="voice-anywhere-text" />
              <Button type="submit" variant="secondary" disabled={!typed.trim()}>{t('bv.apply')}</Button>
            </form>
            <p className="mt-3 text-sm font-semibold">{t('va.examplesTitle')}</p>
            <ul className="mt-1 space-y-1 text-sm text-muted">
              {[t('va.ex1'), t('va.ex2'), t('va.ex3'), t('va.ex4'), t('va.ex5'), t('va.ex6')].map((x) => <li key={x}>• {x}</li>)}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
