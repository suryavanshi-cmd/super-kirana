'use client';
// Speech input for every mic in the app.
//
//   native  — the phone's own recogniser (Safari on iPhone, Chrome on Android/desktop): instant, free,
//             nothing uploaded by us.
//   cloud   — backup for browsers without one (Chrome/Firefox/Edge on iPhone, the iPhone home-screen
//             app, in-app browsers), or when the native one is switched off / lacks the language:
//             records one command on the phone, trims it, sends ~100–200 KB to our speech-to-text
//             function (Gemini). Typically 1–2 s.
//
// Microphone permission is handled for Android Chrome and iPhone Safari (see ../mic.ts).
import { useCallback, useEffect, useRef, useState } from 'react';
import { micState, platform, requestMic, type Platform } from '../mic';
import { useSession } from '../session';
import { cloudSpeechAvailable, transcribe } from './cloud';
import { canRecord, recordCommand, type Recording } from './recorder';

export type SpeechStatus = 'checking' | 'idle' | 'asking' | 'listening' | 'thinking' | 'unsupported' | 'denied' | 'siri' | 'insecure'
  | 'tapAgain' | 'nospeech' | 'busy' | 'lang' | 'error';
export type SpeechLang = 'mr-IN' | 'hi-IN' | 'en-IN';
export type SpeechMode = 'native' | 'cloud';

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

/** onFinal gets every alternative for the sentence, best first. */
export function useSpeech(lang: SpeechLang, onFinal: (alternatives: string[]) => void) {
  const { shop } = useSession();
  const shopId = shop?.id ?? null;
  const [status, setStatus] = useState<SpeechStatus>('checking');
  const [interim, setInterim] = useState('');
  const [level, setLevel] = useState(0);
  const [os, setOs] = useState<Platform>('other');
  const [mode, setMode] = useState<SpeechMode>('native');
  const rec = useRef<Rec | null>(null);
  const recording = useRef<Recording | null>(null);
  const micOk = useRef(false);
  const final = useRef(onFinal);
  final.current = onFinal;

  useEffect(() => {
    setOs(platform());
    if (ctor()) { setMode('native'); setStatus('idle'); }
    else if (canRecord() && shopId) {
      setMode('cloud'); setStatus('checking');
      void cloudSpeechAvailable(shopId).then((ok) => setStatus(ok ? 'idle' : 'unsupported'));
    } else setStatus('unsupported');
    void micState().then((m) => { micOk.current = m === 'granted'; if (m === 'denied') setStatus('denied'); });
    if (ctor() && canRecord() && shopId) void cloudSpeechAvailable(shopId);   // warm the backup too
    return () => { rec.current?.abort(); recording.current?.stop(); };
  }, [shopId]);

  /** The native recogniser cannot help here (off, language missing): use the backup from now on. */
  const switchToCloud = useCallback(async (): Promise<boolean> => {
    if (!canRecord() || !shopId || !(await cloudSpeechAvailable(shopId))) return false;
    setMode('cloud');
    return true;
  }, [shopId]);

  const startCloud = useCallback(() => {
    if (!shopId) return;
    setInterim(''); setLevel(0);
    setStatus('listening');
    const r = recordCommand((v) => setLevel(v));
    recording.current = r;
    void r.done.then(async (res) => {
      recording.current = null;
      setLevel(0);
      if (res.error === 'denied') { setStatus('denied'); return; }
      if (res.error) { setStatus('busy'); return; }
      if (!res.wav) { setStatus('nospeech'); return; }
      micOk.current = true;
      setStatus('thinking');
      try {
        const text = await transcribe(res.wav, lang, shopId);
        if (!text) { setStatus('nospeech'); return; }
        setStatus('idle');
        final.current([text]);
      } catch (e) {
        setStatus(e instanceof Error && e.message === 'TOO_MANY_ATTEMPTS' ? 'busy' : 'error');
      }
    });
  }, [lang, shopId]);

  const start = useCallback(async () => {
    if (mode === 'cloud') { startCloud(); return; }
    const C = ctor();
    if (!C) { if (await switchToCloud()) startCloud(); else setStatus('unsupported'); return; }
    rec.current?.abort();
    const ios = platform() === 'ios';
    // iPhone: Safari asks for the microphone itself, and start() must run right inside the tap.
    if (!micOk.current && !ios) {
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
    r.onerror = (e) => {
      if (e.error === 'service-not-allowed' || e.error === 'language-not-supported') {
        // Dictation switched off on the iPhone, or this language not available on the phone:
        // quietly use the backup; the next tap records with it.
        void switchToCloud().then((ok) => setStatus(ok ? 'tapAgain' : e.error === 'service-not-allowed' ? (ios ? 'siri' : 'denied') : 'lang'));
        return;
      }
      setStatus(e.error === 'not-allowed' ? (micOk.current && ios ? 'tapAgain' : 'denied')
        : e.error === 'no-speech' ? 'nospeech' : e.error === 'aborted' ? 'idle'
          : e.error === 'audio-capture' ? 'busy' : 'error');
    };
    r.onend = () => { setInterim(''); setStatus((s) => (s === 'listening' ? 'idle' : s)); };
    rec.current = r;
    setStatus('listening');
    try { r.start(); } catch { setStatus('tapAgain'); }
  }, [lang, mode, startCloud, switchToCloud]);

  /** Native: stop listening. Cloud: finish the recording now and send it. */
  const stop = useCallback(() => { rec.current?.stop(); recording.current?.stop(); }, []);
  const retry = useCallback(() => { micOk.current = false; void start(); }, [start]);
  return { status, interim, level, os, mode, start, stop, retry };
}
