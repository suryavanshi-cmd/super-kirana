// Optional LIVE check against the real Sarvam API (costs a few paise). Run: SARVAM_LIVE=1 SARVAM_API_KEY=... npm test
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe.skipIf(process.env.SARVAM_LIVE !== '1')('live Sarvam', () => {
  it('transcribes a real clip with saaras:v4', async () => {
    const { transcribe } = await import('../src/sarvam');
    const file = process.env.SARVAM_LIVE_CLIP ?? new URL('./audio/mediarecorder.webm', import.meta.url).pathname;
    const r = await transcribe(readFileSync(file), file.endsWith('.ogg') ? 'audio/ogg' : 'audio/webm', ['रुपये', 'घेतले']);
    expect(r.model).toMatch(/saaras/);
    expect(typeof r.transcript).toBe('string');
  }, 20_000);
});
