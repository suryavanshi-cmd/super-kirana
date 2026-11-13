'use client';
import { useState } from 'react';
import { MicHelp, speechLabel } from './mic-help';
import { Button, Icon, Input, Segmented } from './ui';
import type { Product } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { parseBillCommand, type BillOp, type CmdLine } from '@/lib/voice/billcmd';
import { LANG_KEY, savedLang, useSpeech, type SpeechLang } from '@/lib/voice/useSpeech';

/** Mic (or typed) changes to the open bill. Picks the recogniser's alternative that makes the most sense. */
export function BillVoice({ lines, products, onApply, onClose }: {
  lines: CmdLine[]; products: Product[];
  onApply: (ops: BillOp[], heard: string, how: 'voice' | 'typed') => void; onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const [lang, setLang] = useState<SpeechLang>(() => savedLang(locale === 'en-IN' ? 'en-IN' : 'mr-IN'));
  const [typed, setTyped] = useState('');
  const [missed, setMissed] = useState<string[]>([]);

  function run(alternatives: string[], how: 'voice' | 'typed') {
    let best = { text: alternatives[0] ?? '', ops: [] as BillOp[], unknown: [] as string[] };
    for (const a of alternatives) {
      const r = parseBillCommand(a, lines, products);
      if (r.ops.length > best.ops.length || (r.ops.length === best.ops.length && r.unknown.length < best.unknown.length)) best = { text: a, ...r };
    }
    setMissed(best.unknown);
    if (best.ops.length) onApply(best.ops, best.text, how);
  }
  const speech = useSpeech(lang, (alts) => run(alts, 'voice'));
  const listening = speech.status === 'listening';

  return (
    <div className="mt-3 rounded-2xl border-2 border-brand-600 bg-brand-50 p-3" data-testid="bill-voice">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="font-bold">{t('bv.title')}</h2>
        <button type="button" onClick={onClose} aria-label={t('bv.close')} className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-white"><Icon name="x" className="h-5 w-5" /></button>
      </div>
      <Segmented label={t('vo.lang')} value={lang} onChange={(v: SpeechLang) => { setLang(v); try { localStorage.setItem(LANG_KEY, v); } catch { /* ignore */ } }}
        options={[{ value: 'mr-IN', label: 'मराठी' }, { value: 'hi-IN', label: 'हिंदी' }, { value: 'en-IN', label: 'English' }]} />
      {speech.status !== 'unsupported' && speech.status !== 'checking' && (
        <div className="my-3 flex items-center gap-3">
          <button type="button" onClick={listening ? speech.stop : () => void speech.start()} disabled={speech.status === 'asking' || speech.status === 'thinking'} data-testid="bill-mic"
            aria-label={listening ? t('vo.stop') : t('bv.tap')}
            className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-full text-white shadow-md ${listening ? 'animate-pulse bg-red-600' : 'bg-brand-600 hover:bg-brand-700'}`}>
            <Icon name={listening ? 'x' : 'mic'} className="h-8 w-8" />
          </button>
          <p className="text-sm font-semibold" aria-live="polite">
            {speechLabel(t, speech, t('bv.tap'))}
          </p>
        </div>
      )}
      <MicHelp status={speech.status} os={speech.os} onRetry={speech.retry} />
      <p className="mb-2 text-xs text-muted">{t('bv.hint')}</p>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (typed.trim()) { run([typed.trim()], 'typed'); setTyped(''); } }}>
        <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={t('bv.type')} aria-label={t('bv.type')} maxLength={200} data-testid="bill-cmd" />
        <Button type="submit" variant="secondary" disabled={!typed.trim()}>{t('bv.apply')}</Button>
      </form>
      {missed.map((m) => <p key={m} className="mt-2 text-sm font-semibold text-due">{t('bv.notUnderstood', { t: m })}</p>)}
    </div>
  );
}
