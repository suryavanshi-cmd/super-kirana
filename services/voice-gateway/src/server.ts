// Super Kirana voice-entry gateway.
//   GET  /healthz              no auth, no Sarvam call (warm-up)
//   POST /v1/voice-entry       multipart "audio" + Supabase user JWT → draft khata entry (never saved here)
//   POST /v1/cache/invalidate  GATEWAY_TOKEN (server-to-server) or the shop member's own JWT
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import Fastify, { type FastifyInstance } from 'fastify';
import type { IncomingMessage } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { inspect } from './audio';
import { verifyUser, warmJwks } from './auth';
import { cacheSize, getContext, invalidate } from './context';
import { config, missingSettings } from './config';
import { E, GatewayError } from './errors';
import { log } from './log';
import { parse } from './parser/parse';
import { checkRate } from './ratelimit';
import { preconnectSarvam, transcribe } from './sarvam';
import { TRY_PAGE } from './try-page';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const startedAt = Date.now();

function requestId(req: IncomingMessage): string {
  const trace = req.headers['x-cloud-trace-context'];
  const t = typeof trace === 'string' ? trace.split('/')[0] : '';
  return t ? t.slice(0, 16) : randomUUID().slice(0, 18);
}

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

export function buildServer(): FastifyInstance {
  const app = Fastify({ logger: false, trustProxy: true, bodyLimit: config.maxAudioBytes + 64 * 1024, genReqId: requestId });

  void app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);                                  // curl / server-to-server
      const ok = config.allowedOrigins.includes(origin) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
      cb(null, ok);
    },
    methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['authorization', 'content-type', 'x-gateway-token'],
    exposedHeaders: ['x-request-id'], maxAge: 86400,
  });
  void app.register(multipart, { limits: { fileSize: config.maxAudioBytes, files: 1, fields: 4, fieldSize: 200, parts: 6 } });

  app.addHook('onSend', async (req, reply) => { reply.header('x-request-id', req.id); reply.header('cache-control', 'no-store'); });

  app.setErrorHandler((raw: unknown, req, reply) => {
    const err = raw instanceof Error ? raw : new Error(String(raw));
    let ge: GatewayError;
    if (err instanceof GatewayError) ge = err;
    else if ((err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') ge = E.tooLarge(config.maxAudioBytes + 1, config.maxAudioBytes);
    else if (((err as unknown as { statusCode?: number }).statusCode ?? 500) < 500) {
      ge = new GatewayError((err as unknown as { statusCode: number }).statusCode, 'BAD_REQUEST', err.message, 'विनंती चुकीची आहे.');
    } else ge = new GatewayError(500, 'INTERNAL', `Unexpected error: ${err.message}`, `अनपेक्षित अडचण: ${err.message}`);
    if (ge.status >= 500) log.error(err, { request_id: req.id, path: req.url, code: ge.code });
    else log.warn(ge.en, { request_id: req.id, path: req.url, code: ge.code, status: ge.status });
    void reply.status(ge.status).send({ error: { code: ge.code, message: ge.en, message_mr: ge.mr, detail: ge.detail ?? null }, request_id: req.id });
  });

  // Warm-up. Call it when the khata screen opens. With the user's token it also pre-loads that shop's
  // customers + keyterms, so the first spoken entry only waits for Sarvam. Never calls Sarvam STT.
  app.get('/healthz', async (req) => {
    warmJwks();
    preconnectSarvam();
    if (req.headers.authorization && missingSettings().length === 0) {
      const shop = (req.query as { shop_id?: string }).shop_id;
      void verifyUser(req.headers.authorization)
        .then((uid) => getContext(uid, shop && UUID.test(shop) ? shop : null))
        .catch(() => undefined);                                            // warm-up never fails the health check
    }
    return { ok: missingSettings().length === 0, version: config.version, uptime_s: Math.round((Date.now() - startedAt) / 1000), shops_cached: cacheSize(), missing: missingSettings() };
  });

  app.post('/v1/voice-entry', async (req) => {
    const t0 = performance.now();
    const missing = missingSettings();
    if (missing.length) throw E.notConfigured(missing);
    const userId = await verifyUser(req.headers.authorization);

    // Read the single audio part (fields may come before or after it).
    let audio: Buffer | null = null, declared = '', shopField = '';
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        if (part.fieldname !== 'audio' && part.fieldname !== 'file') { await part.toBuffer().catch(() => null); continue; }
        declared = part.mimetype;
        audio = await part.toBuffer();
      } else if (part.fieldname === 'shop_id') shopField = String(part.value ?? '');
    }
    const shopReq = shopField || (req.query as { shop_id?: string }).shop_id || '';
    if (shopReq && !UUID.test(shopReq)) throw E.badShopId();
    if (!audio || !audio.length) throw E.noAudio();
    const info = inspect(audio, declared);                                    // too long / short / silent → no Sarvam call
    const tAuth = performance.now();

    let { ctx, cached } = await getContext(userId, shopReq || null);
    checkRate(ctx.shopId);
    const tCtx = performance.now();

    const stt = await transcribe(audio, info.mime, ctx.keyterms);
    const tStt = performance.now();
    let draft = parse(stt.transcript, ctx.customers, ctx.items);
    // A name we do not know + a cache older than a minute: maybe the customer was just added. Reload once.
    if (cached && !draft.customer.id && draft.transcript && Date.now() - ctx.at > 60_000) {
      ({ ctx, cached } = await getContext(userId, shopReq || null, { maxAgeMs: 60_000 }));
      draft = parse(stt.transcript, ctx.customers, ctx.items);
    }
    const tParse = performance.now();

    const timings = {
      checks: Math.round(tAuth - t0), context: Math.round(tCtx - tAuth), stt: Math.round(tStt - tCtx),
      parse: Math.round((tParse - tStt) * 100) / 100, total: Math.round(tParse - t0),
    };
    log.info('voice-entry', {
      request_id: req.id, shop_id: ctx.shopId, duration_s: info.seconds, bytes: info.bytes, format: info.format, model: stt.model, retried: stt.retried,
      context_cached: cached, timings_ms: timings, transcript: draft.transcript, amount: draft.amount, type: draft.type, items: draft.items,
      customer_id: draft.customer.id, customer_confidence: draft.customer.confidence, missing: draft.missing,
    });
    return { ...draft, model: stt.model, timings_ms: timings, request_id: req.id };
  });

  // Phone test page (demo shop only): GET /try, and a demo-code sign-in proxied server-side.
  if (config.tryPage) {
    const tries = new Map<string, { at: number; n: number }>();
    app.get('/try', async (_req, reply) => reply.type('text/html; charset=utf-8').header('content-security-policy', "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; media-src 'self' blob:").send(TRY_PAGE));
    app.post('/try/demo-login', async (req) => {
      const ip = req.ip, now = Date.now(), t = tries.get(ip);
      if (t && now - t.at < 60_000 && ++t.n > 5) throw new GatewayError(429, 'RATE_LIMIT_LOGIN', 'Too many demo sign-ins from this phone; wait a minute', 'खूप वेळा प्रयत्न झाला; एक मिनिट थांबा.');
      if (!t || now - t.at >= 60_000) tries.set(ip, { at: now, n: 1 });
      const code = String((req.body as { code?: string } | null)?.code ?? '').slice(0, 64);
      if (!config.publishableKey) throw E.notConfigured(['SUPABASE_PUBLISHABLE_KEY']);
      const r = await fetch(`${config.supabaseUrl}/functions/v1/auth-admin`, {
        method: 'POST', signal: AbortSignal.timeout(15_000),
        headers: { apikey: config.publishableKey, Authorization: `Bearer ${config.publishableKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'demo-login', code }),
      });
      const j = await r.json().catch(() => ({})) as { access_token?: string; error?: string; detail?: string };
      if (!r.ok || !j.access_token) throw new GatewayError(r.status === 401 ? 401 : 502, j.error ?? 'DEMO_LOGIN_FAILED', `Demo sign-in failed: ${j.error ?? r.status}${j.detail ? ` (${j.detail})` : ''}`, 'डेमो लॉगिन झाले नाही. कोड तपासा.');
      return { access_token: j.access_token };
    });
  }

  app.post('/v1/cache/invalidate', async (req) => {
    const body = (req.body ?? {}) as { shop_id?: string };
    const shopId = body.shop_id ?? '';
    if (!UUID.test(shopId)) throw E.badShopId();
    const token = (req.headers['x-gateway-token'] as string | undefined) ?? '';
    if (config.gatewayToken && sameSecret(token, config.gatewayToken)) return { ok: true, cleared: invalidate(shopId) };
    if (token) throw E.badGatewayToken();
    const userId = await verifyUser(req.headers.authorization);              // a member may refresh their own shop
    const { ctx } = await getContext(userId, shopId, { maxAgeMs: 0 });
    return { ok: true, cleared: true, customers: ctx.customers.length };
  });

  return app;
}

// Start when run directly (not when imported by tests).
if (process.env.VITEST === undefined) {
  const app = buildServer();
  const t0 = performance.now();
  preconnectSarvam();                                                      // a fresh instance opens its Sarvam connection at once
  app.listen({ port: config.port, host: '0.0.0.0' }).then(() => {
    log.info('started', { port: config.port, version: config.version, boot_ms: Math.round(performance.now() - t0), process_uptime_ms: Math.round(process.uptime() * 1000), missing: missingSettings() });
  }).catch((e) => { log.error(e, { phase: 'listen' }); process.exit(1); });
  const stop = () => { void app.close().then(() => process.exit(0)); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
