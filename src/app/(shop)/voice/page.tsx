'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { CustomerForm } from '@/components/customer-form';
import { MicHelp } from '@/components/mic-help';
import { Button, Card, DueTag, ErrorBox, Icon, Money, Notice, PageHeader, Row, Segmented, Skeleton } from '@/components/ui';
import type { CustomerRow } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useCustomers } from '@/lib/lists';
import { paiseToInputText } from '@/lib/money';
import { isStandalone, micState, platform, requestMic } from '@/lib/mic';
import { parseVoice, type Intent, type VoiceDraft } from '@/lib/voice/parse';

/**
 * Speak (or type) one sentence — "सुरेश भट 2000 चा किराणा घेतला, नो पेमेंट" — and the app fills in the
 * उधारी or पैसे जमा screen. Nothing is saved here: the normal screen shows the numbers for a final check.
 */
type Lang = 'mr-IN' | 'hi-IN' | 'en-IN';
type Status = 'checking' | 'idle' | 'asking' | 'listening' | 'unsupported' | 'denied' | 'siri' | 'insecure' | 'tapAgain' | 'nospeech' | 'busy' | 'lang' | 'error';

interface Recognition {
  lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string; confidence: number }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
}
type RecognitionCtor = new () => Recognition;
const recognitionCtor = (): RecognitionCtor | null => {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

/** Of the recogniser's alternatives, the one that makes the most sense: has an amount and a known customer. */
function bestOf(alternatives: string[], customers: CustomerRow[]): string {
  let best = alternatives[0] ?? '', bestScore = -1;
  for (const a of alternatives) {
    const d = parseVoice(a, customers);
    const score = (d.amountPaise !== null ? 2 : 0) + (d.name ? 1 : 0) + (d.matches[0]?.score ?? 0);
    if (score > bestScore) { best = a; bestScore = score; }
  }
  return best;
}

const LANG_KEY = 'sk.voiceLang';

function VoiceScreen() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const customers = useCustomers();
  const [lang, setLang] = useState<Lang>(locale === 'en-IN' ? 'en-IN' : 'mr-IN');
  const [status, setStatus] = useState<Status>('checking');
  const said = useSearchParams().get('text');     // a sentence spoken from the mic on another screen
  const [text, setText] = useState((said ?? '').slice(0, 300));
  const [interim, setInterim] = useState('');
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [intentOverride, setIntentOverride] = useState<Intent | null>(null);
  const [adding, setAdding] = useState(false);
  const rec = useRef<Recognition | null>(null);
  const micOk = useRef(false);
  const os = typeof window === 'undefined' ? 'other' : platform();

  useEffect(() => {
    try { const v = localStorage.getItem(LANG_KEY); if (v === 'mr-IN' || v === 'hi-IN' || v === 'en-IN') setLang(v); } catch { /* private mode */ }
    setStatus(recognitionCtor() ? 'idle' : 'unsupported');     // known only in the browser
    // If the phone already said "no" earlier, show how to allow it before the first tap.
    void micState().then((m) => { micOk.current = m === 'granted'; if (m === 'denied' && recognitionCtor()) setStatus('denied'); });
    return () => rec.current?.abort();
  }, []);

  const all = customers.data ?? [];
  const draft: VoiceDraft | null = useMemo(() => (text.trim() ? parseVoice(text, all) : null), [text, all]);
  const intent: Intent = intentOverride ?? draft?.intent ?? 'credit';
  const top = draft?.matches ?? [];
  // A single clear match is chosen for the shopkeeper; otherwise they tap the right one.
  const auto = top.length > 0 && top[0].score >= 0.85 && (top.length === 1 || top[0].score - top[1].score >= 0.15) ? top[0].customer : null;
  const chosen: CustomerRow | null = (pickedId && all.find((c) => c.id === pickedId)) || auto;

  async function listen() {
    const Ctor = recognitionCtor();
    if (!Ctor) { setStatus('unsupported'); return; }
    rec.current?.abort();
    // iPhone: start straight from the tap; Safari shows its own microphone prompt.
    if (!micOk.current && os !== 'ios') {
      // First use: this tap shows the phone's own "allow microphone" prompt.
      setStatus('asking');
      const r = await requestMic();
      if (r === 'denied') { setStatus('denied'); return; }
      if (r === 'insecure') { setStatus('insecure'); return; }
      micOk.current = true;
    }
    const r = new Ctor();
    r.lang = lang; r.interimResults = true; r.continuous = false; r.maxAlternatives = 5;
    let finalText = '';
    r.onresult = (e) => {
      let live = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) {
          const alts = Array.from({ length: res.length }, (_, k) => res[k].transcript.trim()).filter(Boolean);
          finalText = `${finalText} ${bestOf(alts, all)}`.trim();
        } else live += res[0].transcript;
      }
      setInterim(live);
      if (finalText) { setText(finalText); setPickedId(null); setIntentOverride(null); setAdding(false); }
    };
    r.onerror = (e) => setStatus(
      e.error === 'not-allowed' ? (micOk.current && os === 'ios' ? 'tapAgain' : 'denied')
        : e.error === 'service-not-allowed' ? (os === 'ios' ? 'siri' : 'denied')
          : e.error === 'no-speech' ? 'nospeech' : e.error === 'aborted' ? 'idle'
            : e.error === 'audio-capture' ? 'busy' : e.error === 'language-not-supported' ? 'lang' : 'error');
    r.onend = () => { setInterim(''); setStatus((s) => (s === 'listening' ? 'idle' : s)); };
    rec.current = r;
    setStatus('listening');
    // iOS sometimes needs a fresh tap after the permission prompt; ask for one instead of failing.
    try { r.start(); } catch { setStatus('tapAgain'); }
  }
  const stop = () => rec.current?.stop();

  function go(customerId: string) {
    if (!draft || draft.amountPaise === null) return;
    const amount = paiseToInputText(draft.amountPaise);
    if (intent === 'payment') { router.push(`/customers/${customerId}/pay?amount=${amount}`); return; }
    const qs = new URLSearchParams({ customer: customerId, amount });
    if (draft.paidPaise) qs.set('paid', paiseToInputText(draft.paidPaise));
    if (draft.what) qs.set('what', draft.what);
    router.push(`/udhari?${qs.toString()}`);
  }

  const supported = status !== 'unsupported' && status !== 'checking';
  return (
    <div>
      <PageHeader title={t('vo.title')} back="/home" />
      <div className="mb-3">
        <p className="mb-1 text-sm font-semibold">{t('vo.lang')}</p>
        <Segmented label={t('vo.lang')} value={lang} onChange={(v: Lang) => { setLang(v); try { localStorage.setItem(LANG_KEY, v); } catch { /* ignore */ } }}
          options={[{ value: 'mr-IN', label: 'मराठी' }, { value: 'hi-IN', label: 'हिंदी' }, { value: 'en-IN', label: 'English' }]} />
      </div>

      {supported && (
        <div className="my-4 flex flex-col items-center gap-2">
          <button type="button" onClick={status === 'listening' ? stop : () => void listen()} disabled={status === 'asking'} data-testid="mic"
            aria-label={status === 'listening' ? t('vo.stop') : t('vo.tap')}
            className={`flex h-28 w-28 items-center justify-center rounded-full text-white shadow-lg ${status === 'listening' ? 'animate-pulse bg-red-600' : 'bg-brand-600 hover:bg-brand-700'}`}>
            <Icon name={status === 'listening' ? 'x' : 'mic'} className="h-12 w-12" />
          </button>
          <p className="text-lg font-semibold" aria-live="polite">{status === 'listening' ? t('vo.listening') : status === 'asking' ? t('vo.asking') : status === 'tapAgain' ? t('vo.tapAgain') : text ? t('vo.again') : t('vo.tap')}</p>
          {interim && <p className="text-center text-muted">{interim}</p>}
        </div>
      )}
      <MicHelp status={status} os={os} onRetry={() => { micOk.current = false; void listen(); }} />
      {!text && <p className="mb-3 text-sm text-muted">{t('vo.example')}</p>}

      <label className="mb-1 block text-sm font-semibold" htmlFor="vo-text">{t('vo.heard')}</label>
      <textarea id="vo-text" data-testid="vo-text" value={text} rows={2} placeholder={t('vo.typeHere')} maxLength={300}
        onChange={(e) => { setText(e.target.value); setPickedId(null); setIntentOverride(null); setAdding(false); }}
        className="mb-4 w-full rounded-xl border border-line p-3 text-lg focus:border-brand-600 focus:outline-none" />

      {draft && (
        <Card className="mb-4" data-testid="vo-result">
          <h2 className="mb-2 font-bold">{t('vo.understood')}</h2>
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className={`rounded-full px-3 py-1 text-sm font-bold ${intent === 'credit' ? 'bg-due-bg text-due' : 'bg-brand-50 text-brand-800'}`} data-testid="vo-intent">
              {intent === 'credit' ? t('vo.credit') : t('vo.payment')}
            </span>
            <button type="button" className="min-h-11 px-2 text-sm font-semibold text-brand-700 underline" onClick={() => setIntentOverride(intent === 'credit' ? 'payment' : 'credit')}>{t('vo.switchIntent')}</button>
          </div>
          <Row label={t('vo.amount')}><span data-testid="vo-amount">{draft.amountPaise !== null ? <Money paise={draft.amountPaise} /> : '—'}</span></Row>
          {intent === 'credit' && <Row label={t('vo.paidNow')}><span data-testid="vo-paid"><Money paise={draft.paidPaise ?? 0} /></span></Row>}
          {intent === 'credit' && draft.what && <Row label={t('ud.what')}>{draft.what}</Row>}
          {draft.problems.includes('no_amount') && <Notice tone="warn">{t('vo.noAmount')}</Notice>}
          {draft.problems.includes('no_name') && <Notice tone="warn">{t('vo.noName')}</Notice>}
        </Card>
      )}

      {draft && draft.name && (
        <section className="mb-4">
          <h2 className="mb-2 font-bold">{chosen ? t('vo.who') : t('vo.pickOne')}</h2>
          {!customers.data && (customers.loading ? <Skeleton lines={2} /> : <ErrorBox error={customers.error} onRetry={customers.reload} />)}
          {customers.data && top.length === 0 && !adding && <p className="mb-2 text-muted">{t('vo.noMatch', { n: draft.name })}</p>}
          <ul className="space-y-2" data-testid="vo-matches">
            {top.map(({ customer: c }) => {
              const on = chosen?.id === c.id;
              return (
                <li key={c.id}>
                  <button type="button" onClick={() => setPickedId(c.id)} aria-pressed={on}
                    className={`flex min-h-14 w-full items-center gap-3 rounded-2xl border-2 p-3 text-left ${on ? 'border-brand-600 bg-brand-50' : 'border-line hover:border-brand-600'}`}>
                    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${on ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-400'}`}>{on && <Icon name="check" className="h-4 w-4" />}</span>
                    <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{c.name}</span>{c.mobile && <span className="num block text-sm text-muted">{c.mobile}</span>}</span>
                    <DueTag paise={c.balance_paise} />
                  </button>
                </li>
              );
            })}
          </ul>
          {intent === 'credit' && !adding && (
            <Button variant="ghost" full className="mt-2" onClick={() => setAdding(true)}><Icon name="plus" className="h-5 w-5" />{t('vo.newCustomer', { n: draft.name })}</Button>
          )}
          {adding && (
            <Card className="mt-2">
              <CustomerForm initial={{ name: draft.name, mobile: '', notes: '' }} onCancel={() => setAdding(false)}
                onSaved={(id) => { void customers.reload(); go(id); }} />
            </Card>
          )}
        </section>
      )}

      {draft && !adding && (
        <>
          <Button full className="min-h-14 text-lg" disabled={!chosen || draft.amountPaise === null} onClick={() => chosen && go(chosen.id)} data-testid="vo-continue">
            {t('vo.continue')}
          </Button>
          <p className="mt-2 text-center text-sm text-muted">{t('vo.noSave')}</p>
        </>
      )}
    </div>
  );
}

export default function VoicePage() { return <Suspense fallback={<Skeleton lines={4} />}><VoiceScreen /></Suspense>; }
