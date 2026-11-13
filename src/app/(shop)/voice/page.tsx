'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { CustomerForm } from '@/components/customer-form';
import { MicHelp } from '@/components/mic-help';
import { Button, Card, DueTag, ErrorBox, Icon, Money, Notice, PageHeader, Row, Segmented, Skeleton } from '@/components/ui';
import type { CustomerRow } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useCustomers } from '@/lib/lists';
import { paiseToInputText } from '@/lib/money';
import { savedLang, LANG_KEY, useSpeech, type SpeechLang } from '@/lib/voice/useSpeech';
import { speechLabel } from '@/components/mic-help';
import { parseVoice, type Intent, type VoiceDraft } from '@/lib/voice/parse';

/**
 * Speak (or type) one sentence — "सुरेश भट 2000 चा किराणा घेतला, नो पेमेंट" — and the app fills in the
 * उधारी or पैसे जमा screen. Nothing is saved here: the normal screen shows the numbers for a final check.
 */
type Lang = SpeechLang;

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

function VoiceScreen() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const customers = useCustomers();
  const [lang, setLang] = useState<Lang>(locale === 'en-IN' ? 'en-IN' : 'mr-IN');
  const said = useSearchParams().get('text');     // a sentence spoken from the mic on another screen
  const [text, setText] = useState((said ?? '').slice(0, 300));
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [intentOverride, setIntentOverride] = useState<Intent | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => { setLang(savedLang(locale === 'en-IN' ? 'en-IN' : 'mr-IN')); }, [locale]);

  const all = customers.data ?? [];
  const draft: VoiceDraft | null = useMemo(() => (text.trim() ? parseVoice(text, all) : null), [text, all]);
  const intent: Intent = intentOverride ?? draft?.intent ?? 'credit';
  const top = draft?.matches ?? [];
  // A single clear match is chosen for the shopkeeper; otherwise they tap the right one.
  const auto = top.length > 0 && top[0].score >= 0.85 && (top.length === 1 || top[0].score - top[1].score >= 0.15) ? top[0].customer : null;
  const chosen: CustomerRow | null = (pickedId && all.find((c) => c.id === pickedId)) || auto;

  const speech = useSpeech(lang, (alts) => {
    const finalText = bestOf(alts, all);
    if (finalText) { setText(finalText); setPickedId(null); setIntentOverride(null); setAdding(false); }
  });
  const { status, interim } = speech;
  const listening = status === 'listening';

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
          <button type="button" onClick={listening ? speech.stop : () => void speech.start()} disabled={status === 'asking' || status === 'thinking'} data-testid="mic"
            aria-label={listening ? t('vo.stop') : t('vo.tap')}
            style={listening && speech.mode === 'cloud' ? { boxShadow: `0 0 0 ${4 + Math.round(speech.level * 22)}px rgba(220,38,38,0.25)` } : undefined}
            className={`flex h-28 w-28 items-center justify-center rounded-full text-white shadow-lg ${listening ? 'bg-red-600' : status === 'thinking' ? 'animate-pulse bg-brand-700' : 'bg-brand-600 hover:bg-brand-700'} ${listening && speech.mode === 'native' ? 'animate-pulse' : ''}`}>
            <Icon name={listening ? 'x' : 'mic'} className="h-12 w-12" />
          </button>
          <p className="text-lg font-semibold" aria-live="polite">{speechLabel(t, speech, text ? t('vo.again') : t('vo.tap'))}</p>
          {interim && <p className="text-center text-muted">{interim}</p>}
        </div>
      )}
      <MicHelp status={status} os={speech.os} onRetry={speech.retry} />
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
