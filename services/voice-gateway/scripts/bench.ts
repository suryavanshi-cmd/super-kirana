// End-to-end latency against a running service (local or Cloud Run).
//   GATEWAY_URL=https://... USER_JWT=<supabase access token> CLIPS=./clips npm run bench
// CLIPS: a folder of up to 20 short recordings (.webm/.ogg/.m4a/.wav), e.g. "रमेश पाटील 250 रुपये साखर घेतले".
// Each clip is one real Sarvam call (≈ ₹0.03 for a 3 s clip). Prints p50/p95 of server total and STT.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const url = (process.env.GATEWAY_URL ?? 'http://localhost:8080').replace(/\/$/, '');
const jwt = process.env.USER_JWT ?? '';
const dir = process.env.CLIPS ?? 'test/audio';
const files = readdirSync(dir).filter((f) => /\.(webm|ogg|m4a|wav)$/.test(f) && !/silent|short|long/.test(f)).slice(0, 20);
const mime = (f: string) => (f.endsWith('.ogg') ? 'audio/ogg' : f.endsWith('.m4a') ? 'audio/mp4' : f.endsWith('.wav') ? 'audio/wav' : 'audio/webm');
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

const h0 = performance.now();
const health = await fetch(`${url}/healthz`).then((r) => r.json());
console.log(`healthz ${Math.round(performance.now() - h0)} ms (first call may include a cold start)`, health);
const client: number[] = [], total: number[] = [], stt: number[] = [], parse: number[] = [];
for (const f of files) {
  const form = new FormData();
  form.append('audio', new Blob([readFileSync(join(dir, f))], { type: mime(f) }), f);
  const t = performance.now();
  const res = await fetch(`${url}/v1/voice-entry`, { method: 'POST', body: form, headers: { Authorization: `Bearer ${jwt}` } });
  const ms = performance.now() - t;
  const body = await res.json() as { timings_ms?: { total: number; stt: number; parse: number }; transcript?: string; error?: { message: string } };
  if (!res.ok) { console.log(`${f}: ${res.status} ${body.error?.message}`); continue; }
  client.push(ms); total.push(body.timings_ms!.total); stt.push(body.timings_ms!.stt); parse.push(body.timings_ms!.parse);
  console.log(`${f}: ${Math.round(ms)} ms round trip, server ${body.timings_ms!.total} ms (stt ${body.timings_ms!.stt}) → ${body.transcript}`);
}
if (total.length) {
  console.log(`\n${total.length} clips · server total p50 ${pct(total, 0.5)} / p95 ${pct(total, 0.95)} ms · STT p50 ${pct(stt, 0.5)} / p95 ${pct(stt, 0.95)} ms · parse p50 ${pct(parse, 0.5)} ms · round trip p50 ${Math.round(pct(client, 0.5))} ms`);
}
