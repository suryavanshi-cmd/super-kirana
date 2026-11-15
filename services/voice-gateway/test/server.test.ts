// Integration: real HTTP handling via fastify.inject, with Supabase, Sarvam and the JWT keys mocked.
import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';

process.env.SUPABASE_URL = 'https://demo.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
process.env.SARVAM_API_KEY = 'sarvam-key';
process.env.GATEWAY_TOKEN = 'gw-secret-token-123';

const { buildServer } = await import('../src/server');
const { setKeySet } = await import('../src/auth');
const { setSarvamFetch } = await import('../src/sarvam');
const { setContextFetch, clearContexts } = await import('../src/context');
const { resetRates } = await import('../src/ratelimit');

const SHOP = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const clip = (f: string) => readFileSync(new URL(`./audio/${f}`, import.meta.url));
let token = '', otherToken = '';
let sarvamCalls: { model: string; keyterms: string | null }[] = [];
let sarvamReply: (model: string) => Response = () => Response.json({ transcript: 'रमेश पाटील २५० रुपये साखर घेतले', request_id: 'sv1' });
let ctxCalls = 0;

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'ES256' };
  setKeySet(createLocalJWKSet({ keys: [jwk] }));
  const sign = (sub: string, exp = '1h') => new SignJWT({ role: 'authenticated' }).setProtectedHeader({ alg: 'ES256', kid: 'k1' })
    .setSubject(sub).setIssuer('https://demo.supabase.co/auth/v1').setAudience('authenticated').setIssuedAt().setExpirationTime(exp).sign(privateKey);
  token = await sign(USER);
  otherToken = await sign('33333333-3333-4333-8333-333333333333');
});

beforeEach(() => {
  clearContexts(); resetRates(); sarvamCalls = []; ctxCalls = 0;
  sarvamReply = () => Response.json({ transcript: 'रमेश पाटील २५० रुपये साखर घेतले', request_id: 'sv1' });
  setSarvamFetch((async (_url: unknown, init: { body: FormData }) => {
    sarvamCalls.push({ model: String(init.body.get('model')), keyterms: init.body.get('keyterms') as string | null });
    return sarvamReply(String(init.body.get('model')));
  }) as never);
  setContextFetch((async (_url: unknown, init: { body: string }) => {
    ctxCalls++;
    const b = JSON.parse(init.body);
    if (b.p_user_id !== USER) return Response.json({ code: 'P0001', message: 'FORBIDDEN' }, { status: 400 });
    return Response.json({ shop_id: SHOP, customers: [{ id: 'c1', name: 'Ramesh Patil' }, { id: 'c2', name: 'सुनीता जाधव' }, { id: 'c3', name: 'Suresh Patil' }], items: ['Parle-G 100 g'] });
  }) as never);
});
afterEach(() => { setSarvamFetch(null); });

function multipart(file: Buffer | null, mime = 'audio/webm', fields: Record<string, string> = {}) {
  const boundary = '----kirana' + Math.random().toString(16).slice(2);
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  if (file) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="clip"\r\nContent-Type: ${mime}\r\n\r\n`), file, Buffer.from('\r\n'));
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}
async function post(file: Buffer | null, opts: { auth?: string | null; mime?: string; fields?: Record<string, string> } = {}) {
  const app = buildServer();
  const m = multipart(file, opts.mime, opts.fields);
  const headers: Record<string, string> = { ...m.headers };
  if (opts.auth !== null) headers.authorization = `Bearer ${opts.auth ?? token}`;
  const res = await app.inject({ method: 'POST', url: '/v1/voice-entry', payload: m.payload, headers });
  await app.close();
  return { status: res.statusCode, body: res.json(), headers: res.headers };
}

describe('POST /v1/voice-entry', () => {
  it('returns a draft with customer, amount, items, type and timings', async () => {
    const r = await post(clip('mediarecorder.webm'));
    expect(r.status).toBe(200);
    expect(r.body.customer).toMatchObject({ id: 'c1', name: 'Ramesh Patil' });
    expect(r.body).toMatchObject({ amount: 250, type: 'credit', items: ['sakhar'], needs_confirmation: true, missing: [] });
    expect(r.body.timings_ms.parse).toBeLessThan(10);
    expect(r.body.request_id).toBeTruthy();
    expect(r.headers['x-request-id']).toBe(r.body.request_id);
    expect(sarvamCalls).toHaveLength(1);
    expect(sarvamCalls[0].model).toBe('saaras:v4');
    const terms = JSON.parse(sarvamCalls[0].keyterms!);
    expect(terms.length).toBeLessThanOrEqual(50);
    expect(terms).toEqual(expect.arrayContaining(['Ramesh Patil', 'सुनीता जाधव', 'sunita jadhav', 'घेतले']));
  });
  it('caches the shop: the second entry does not query Supabase again', async () => {
    await post(clip('speech.ogg'), { mime: 'audio/ogg' });
    await post(clip('speech.ogg'), { mime: 'audio/ogg' });
    expect(ctxCalls).toBe(1);
  });
  it('retries once with saaras:v3 codemix when v4 fails', async () => {
    sarvamReply = (model) => (model === 'saaras:v4' ? new Response('model overloaded', { status: 503 }) : Response.json({ transcript: 'Sunita 50 dile' }));
    const r = await post(clip('speech.m4a'), { mime: 'audio/mp4' });
    expect(r.status).toBe(200);
    expect(r.body.model).toBe('saaras:v3');
    expect(sarvamCalls.map((c) => c.model)).toEqual(['saaras:v4', 'saaras:v3']);
    expect(r.body).toMatchObject({ amount: 50, type: 'payment' });
    expect(r.body.customer.id).toBe('c2');
  });
  it('names the real Sarvam cause when both attempts fail', async () => {
    sarvamReply = () => new Response(JSON.stringify({ error: { message: 'Invalid audio' } }), { status: 422 });
    const r = await post(clip('speech.webm'));
    expect(r.status).toBe(502);
    expect(r.body.error.code).toBe('SARVAM_ERROR');
    expect(r.body.error.message).toBe('Sarvam 422: Invalid audio');
    expect(r.body.error.message_mr).toBeTruthy();
    expect(r.body.request_id).toBeTruthy();
  });
  it('does not retry an invalid Sarvam key', async () => {
    sarvamReply = () => new Response('{"error":{"message":"Invalid API key"}}', { status: 403 });
    const r = await post(clip('speech.webm'));
    expect(r.body.error.code).toBe('SARVAM_AUTH');
    expect(sarvamCalls).toHaveLength(1);
  });
  it('rejects silent, too short and too long audio BEFORE calling Sarvam', async () => {
    for (const [f, code, status] of [['silent.wav', 'AUDIO_SILENT', 400], ['short.ogg', 'AUDIO_TOO_SHORT', 400], ['long.webm', 'AUDIO_TOO_LONG', 413], ['silent.webm', 'AUDIO_SILENT', 400]] as const) {
      const r = await post(clip(f));
      expect(r.status, f).toBe(status);
      expect(r.body.error.code, f).toBe(code);
    }
    expect(sarvamCalls).toHaveLength(0);
  });
  it('rejects files over 300 KB with 413', async () => {
    const big = Buffer.concat([clip('speech.webm'), Buffer.alloc(320 * 1024)]);
    const r = await post(big);
    expect(r.status).toBe(413);
    expect(r.body.error.code).toBe('AUDIO_TOO_LARGE');
  });
  it('requires a valid sign-in token', async () => {
    expect((await post(clip('speech.webm'), { auth: null })).body.error.code).toBe('NO_AUTH');
    const bad = await post(clip('speech.webm'), { auth: 'abc.def.ghi' });
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe('BAD_TOKEN');
  });
  it('a user who is not a member of the shop gets 403 (shop taken from the server, not the client)', async () => {
    const r = await post(clip('speech.webm'), { auth: otherToken, fields: { shop_id: SHOP } });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('FORBIDDEN');
    expect(sarvamCalls).toHaveLength(0);
  });
  it('limits each shop to 20 entries a minute', async () => {
    for (let i = 0; i < 20; i++) expect((await post(clip('speech.ogg'))).status).toBe(200);
    const r = await post(clip('speech.ogg'));
    expect(r.status).toBe(429);
    expect(r.body.error.code).toBe('RATE_LIMIT_MINUTE');
    expect(r.body.error.message_mr).toMatch(/मिनिटात/);
  });
  it('missing audio part is a clear 400', async () => {
    const r = await post(null);
    expect(r.body.error.code).toBe('NO_AUDIO');
  });
});

describe('other routes', () => {
  it('GET /healthz needs no auth and never calls Sarvam', async () => {
    const app = buildServer();
    const r = await app.inject({ method: 'GET', url: '/healthz' });
    await app.close();
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true });
    expect(sarvamCalls).toHaveLength(0);
  });
  it('POST /v1/cache/invalidate accepts the gateway token and refuses a wrong one', async () => {
    const app = buildServer();
    const ok = await app.inject({ method: 'POST', url: '/v1/cache/invalidate', headers: { 'x-gateway-token': 'gw-secret-token-123' }, payload: { shop_id: SHOP } });
    const bad = await app.inject({ method: 'POST', url: '/v1/cache/invalidate', headers: { 'x-gateway-token': 'nope' }, payload: { shop_id: SHOP } });
    await app.close();
    expect(ok.statusCode).toBe(200);
    expect(bad.statusCode).toBe(401);
  });
  it('CORS allows the app and localhost only', async () => {
    const app = buildServer();
    const ok = await app.inject({ method: 'OPTIONS', url: '/v1/voice-entry', headers: { origin: 'https://super-kirana-niphad.vercel.app', 'access-control-request-method': 'POST' } });
    const local = await app.inject({ method: 'OPTIONS', url: '/v1/voice-entry', headers: { origin: 'http://localhost:3000', 'access-control-request-method': 'POST' } });
    const evil = await app.inject({ method: 'OPTIONS', url: '/v1/voice-entry', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } });
    await app.close();
    expect(ok.headers['access-control-allow-origin']).toBe('https://super-kirana-niphad.vercel.app');
    expect(local.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });
});
