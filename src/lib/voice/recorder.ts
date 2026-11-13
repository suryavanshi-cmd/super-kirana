'use client';
// Records ONE spoken command as a small 16 kHz mono WAV, for browsers without built-in speech
// recognition. Optimised for speed:
//  - stops by itself ~0.9 s after the speaker goes quiet (no second tap needed);
//  - trims silence before and after the speech;
//  - 16 kHz mono 16-bit PCM (what speech models use): ~32 KB per second, ~100–200 KB per command;
//  - WAV needs no encoder library and every speech service accepts it.
// The microphone is released as soon as recording ends.

export interface RecordResult { wav: Blob | null; error?: 'denied' | 'unavailable' }   // wav null = nothing was said
export interface Recording { stop: () => void; done: Promise<RecordResult> }
const TARGET_RATE = 16_000;
const MAX_MS = 15_000;          // a command is short
const NO_SPEECH_MS = 6_000;     // give up if nothing is said
const END_SILENCE_MS = 900;     // this much quiet after speech ends the recording
const PAD_MS = 250;             // keep a little audio around the speech so the first/last sound is not cut

type AC = typeof AudioContext;
export function canRecord(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as { AudioContext?: AC; webkitAudioContext?: AC };
  return !!navigator.mediaDevices?.getUserMedia && !!(w.AudioContext ?? w.webkitAudioContext);
}

/**
 * Must be called from a tap: the AudioContext is created synchronously so iOS lets it play/record.
 * onLevel receives 0–1 loudness for a live meter; onSpeech fires once when speech is first heard.
 */
export function recordCommand(onLevel?: (v: number) => void, onSpeech?: () => void): Recording {
  const w = window as unknown as { AudioContext?: AC; webkitAudioContext?: AC };
  const Ctx = (w.AudioContext ?? w.webkitAudioContext)!;
  const ctx = new Ctx();
  void ctx.resume();
  let stopRequested = false;
  let finish: (r: RecordResult) => void = () => undefined;
  const done = new Promise<RecordResult>((ok) => { finish = ok; });

  void (async () => {
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
      void ctx.close();
      const name = e instanceof DOMException ? e.name : '';
      finish({ wav: null, error: name === 'NotFoundError' || name === 'OverconstrainedError' ? 'unavailable' : 'denied' });
      return;
    }
    const src = ctx.createMediaStreamSource(stream);
    const node = ctx.createScriptProcessor(4096, 1, 1);
    const rate = ctx.sampleRate;
    const chunks: Float32Array[] = [];
    let noise = 0, n = 0, speechStart = -1, lastVoice = -1, elapsed = 0;
    const chunkMs = (4096 / rate) * 1000;

    const end = () => {
      node.disconnect(); src.disconnect();
      stream?.getTracks().forEach((t) => t.stop());
      void ctx.close();
      if (speechStart < 0) { finish({ wav: null }); return; }
      // Trim to the spoken part (with padding), downsample, encode.
      const pad = Math.ceil(PAD_MS / chunkMs);
      const from = Math.max(0, speechStart - pad);
      const to = Math.min(chunks.length, lastVoice + 1 + pad);
      finish({ wav: toWav(downsample(concat(chunks.slice(from, to)), rate, TARGET_RATE), TARGET_RATE) });
    };

    node.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      chunks.push(new Float32Array(input));
      let sum = 0;
      for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
      const rms = Math.sqrt(sum / input.length);
      elapsed += chunkMs;
      // Learn the room's noise from the first ~300 ms, then call it speech when clearly louder.
      if (n < 4) { noise = (noise * n + rms) / (n + 1); n++; }
      const voice = rms > Math.max(0.012, noise * 3);
      const idx = chunks.length - 1;
      if (voice) { if (speechStart < 0) { speechStart = idx; onSpeech?.(); } lastVoice = idx; }
      onLevel?.(Math.min(1, rms * 12));
      const quietFor = lastVoice >= 0 ? (idx - lastVoice) * chunkMs : 0;
      if (stopRequested || elapsed >= MAX_MS || (speechStart < 0 && elapsed >= NO_SPEECH_MS) || (speechStart >= 0 && quietFor >= END_SILENCE_MS)) {
        node.onaudioprocess = null;
        end();
      }
    };
    src.connect(node);
    node.connect(ctx.destination);       // required for ScriptProcessor to run (outputs silence)
  })().catch(() => finish({ wav: null, error: 'unavailable' }));

  return { stop: () => { stopRequested = true; }, done };
}

function concat(parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** Box-filter downsampling (averaging) — enough for speech, no aliasing worth worrying about. */
function downsample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const a = Math.floor(i * ratio), b = Math.min(input.length, Math.floor((i + 1) * ratio));
    let s = 0;
    for (let k = a; k < b; k++) s += input[k];
    out[i] = s / Math.max(1, b - a);
  }
  return out;
}

function toWav(samples: Float32Array, rate: number): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const x = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}
