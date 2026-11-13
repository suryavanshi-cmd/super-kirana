'use client';
// The phone's own speech recogniser (instant, no upload), with the microphone permission handled
// for Android Chrome and iPhone Safari. Used by the bill screen for spoken changes.
import { useCallback, useEffect, useRef, useState } from 'react';
import { micState, platform, requestMic, type Platform } from '../mic';

export type SpeechStatus = 'checking' | 'idle' | 'asking' | 'listening' | 'unsupported' | 'denied' | 'siri' | 'insecure' | 'tapAgain' | 'nospeech' | 'error';
export type SpeechLang = 'mr-IN' | 'hi-IN' | 'en-IN';

interface Rec {
  lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
}
const ctor = (): (new () => Rec) | null => {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};
export const LANG_KEY = 'sk.voiceLang';
export function savedLang(fallback: SpeechLang): SpeechLang {
  try { const v = localStorage.getItem(LANG_KEY); if (v === 'mr-IN' || v === 'hi-IN' || v === 'en-IN') return v; } catch { /* private mode */ }
  return fallback;
}

/** onFinal gets every alternative the recogniser offers for the sentence, best first. */
export function useSpeech(lang: SpeechLang, onFinal: (alternatives: string[]) => void) {
  const [status, setStatus] = useState<SpeechStatus>('checking');
  const [interim, setInterim] = useState('');
  const [os, setOs] = useState<Platform>('other');
  const rec = useRef<Rec | null>(null);
  const micOk = useRef(false);
  const final = useRef(onFinal);
  final.current = onFinal;

  useEffect(() => {
    setOs(platform());
    setStatus(ctor() ? 'idle' : 'unsupported');
    void micState().then((m) => { micOk.current = m === 'granted'; if (m === 'denied' && ctor()) setStatus('denied'); });
    return () => rec.current?.abort();
  }, []);

  const start = useCallback(async () => {
    const C = ctor();
    if (!C) { setStatus('unsupported'); return; }
    rec.current?.abort();
    const ios = platform() === 'ios';
    if (!micOk.current) {
      setStatus('asking');
      const r = await requestMic();
      if (r === 'denied') { setStatus('denied'); return; }
      if (r === 'insecure') { setStatus('insecure'); return; }
      micOk.current = true;
    }
    const r = new C();
    r.lang = lang; r.interimResults = true; r.continuous = false; r.maxAlternatives = 3;
    r.onresult = (e) => {
      let live = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) final.current(Array.from({ length: res.length }, (_, k) => res[k].transcript.trim()).filter(Boolean));
        else live += res[0].transcript;
      }
      setInterim(live);
    };
    r.onerror = (e) => setStatus(
      e.error === 'not-allowed' ? (micOk.current && ios ? 'tapAgain' : 'denied')
        : e.error === 'service-not-allowed' ? (ios ? 'siri' : 'denied')
          : e.error === 'no-speech' ? 'nospeech' : e.error === 'aborted' ? 'idle' : 'error');
    r.onend = () => { setInterim(''); setStatus((s) => (s === 'listening' ? 'idle' : s)); };
    rec.current = r;
    setStatus('listening');
    try { r.start(); } catch { setStatus('tapAgain'); }
  }, [lang]);

  const stop = useCallback(() => rec.current?.stop(), []);
  const retry = useCallback(() => { micOk.current = false; void start(); }, [start]);
  return { status, interim, os, start, stop, retry };
}
