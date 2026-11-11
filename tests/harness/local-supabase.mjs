// A small local stand-in for the Supabase gateway, for end-to-end tests without Docker.
//   /rest/v1/rpc/<fn>   -> the real SQL functions in local Postgres, with the caller's role + JWT claims
//   /auth/v1/*          -> a minimal password-auth service (users live in auth.users of the test DB)
//   /functions/v1/<fn>  -> the real edge functions, run by Deno
// It exists only for tests. Production uses real Supabase.
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

const PORT = Number(process.env.LOCAL_SUPABASE_PORT ?? 54400);
const SECRET = 'local-test-jwt-secret';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pool = new pg.Pool({ host: process.env.PGHOST ?? '127.0.0.1', port: Number(process.env.PGPORT ?? 54329), user: 'postgres', database: process.env.TEST_DB ?? 'kirana_test', max: 20 });

const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
function sign(claims) {
  const head = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claims)}`;
  return `${head}.${crypto.createHmac('sha256', SECRET).update(head).digest('base64url')}`;
}
function verify(token) {
  const [h, p, s] = String(token ?? '').split('.');
  if (!h || !p || !s) return null;
  if (crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url') !== s) return null;
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
  return claims.exp && claims.exp < Date.now() / 1000 ? null : claims;
}
const far = Math.floor(Date.now() / 1000) + 10 * 365 * 86400;
export const ANON_KEY = sign({ role: 'anon', iss: 'local', exp: far });
export const SERVICE_KEY = sign({ role: 'service_role', iss: 'local', exp: far });

const hash = (pw, salt = crypto.randomBytes(8).toString('hex')) => `${salt}:${crypto.scryptSync(pw, salt, 32).toString('hex')}`;
const check = (pw, stored) => !!stored && hash(pw, stored.split(':')[0]) === stored;
const refreshTokens = new Map();
const userJson = (u) => ({ id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, app_metadata: {}, user_metadata: {}, created_at: u.created_at });
function session(u) {
  const now = Math.floor(Date.now() / 1000);
  const refresh = crypto.randomBytes(12).toString('hex');
  refreshTokens.set(refresh, u.id);
  return { access_token: sign({ sub: u.id, role: 'authenticated', aud: 'authenticated', email: u.email, iat: now, exp: now + 3600, session_id: crypto.randomUUID() }),
    token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: refresh, user: userJson(u) };
}

const send = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Expose-Headers': '*' });
  res.end(body === undefined ? '' : JSON.stringify(body));
};
const readBody = (req) => new Promise((ok) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => { try { ok(d ? JSON.parse(d) : {}); } catch { ok({}); } }); });
const bearer = (req) => (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '') || req.headers.apikey;

async function rest(req, res, fn) {
  const claims = verify(bearer(req));
  if (!claims) return send(res, 401, { code: 'PGRST301', message: 'JWT invalid' });
  const args = await readBody(req);
  const keys = Object.keys(args);
  const sql = `select public.${fn.replace(/[^a-z0-9_]/g, '')}(${keys.map((k, i) => `${k.replace(/[^a-z0-9_]/g, '')} => $${i + 1}`).join(', ')}) as r`;
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
    await c.query(`set local role ${['anon', 'authenticated', 'service_role'].includes(claims.role) ? claims.role : 'anon'}`);
    const r = await c.query(sql, keys.map((k) => (args[k] !== null && typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k])));
    await c.query('commit');
    send(res, 200, r.rows[0].r);
  } catch (e) {
    await c.query('rollback').catch(() => {});
    send(res, e.code === '42501' ? 403 : e.code === '42883' ? 404 : 400, { code: e.code, message: e.message, details: e.detail ?? null, hint: e.hint ?? null });
  } finally { c.release(); }
}

async function auth(req, res, url) {
  const p = url.pathname.replace('/auth/v1', '');
  const body = req.method === 'GET' || req.method === 'DELETE' ? {} : await readBody(req);
  const caller = verify(bearer(req));
  if (p === '/token' && url.searchParams.get('grant_type') === 'password') {
    const u = (await pool.query('select * from auth.users where email = $1', [body.email])).rows[0];
    if (!u || !check(body.password ?? '', u.shim_password_hash)) return send(res, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
    return send(res, 200, session(u));
  }
  if (p === '/token' && url.searchParams.get('grant_type') === 'refresh_token') {
    const id = refreshTokens.get(body.refresh_token);
    const u = id && (await pool.query('select * from auth.users where id = $1', [id])).rows[0];
    if (!u) return send(res, 400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' });
    refreshTokens.delete(body.refresh_token);
    return send(res, 200, session(u));
  }
  if (p === '/user' && req.method === 'GET') {
    const u = caller?.sub && (await pool.query('select * from auth.users where id = $1', [caller.sub])).rows[0];
    return u ? send(res, 200, userJson(u)) : send(res, 401, { code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' });
  }
  if (p === '/logout') return send(res, 204);
  if (p.startsWith('/admin/users')) {
    if (caller?.role !== 'service_role') return send(res, 403, { code: 403, error_code: 'not_admin', msg: 'forbidden' });
    const id = p.split('/')[3];
    if (req.method === 'POST') {
      const u = (await pool.query('insert into auth.users(email, shim_password_hash) values ($1, $2) returning *', [body.email, hash(body.password)])).rows[0];
      return send(res, 200, userJson(u));
    }
    if (req.method === 'GET') {
      const u = (await pool.query('select * from auth.users where id = $1', [id])).rows[0];
      return u ? send(res, 200, userJson(u)) : send(res, 404, { code: 404, error_code: 'user_not_found', msg: 'User not found' });
    }
    if (req.method === 'PUT') {
      const u = (await pool.query('update auth.users set shim_password_hash = coalesce($2, shim_password_hash) where id = $1 returning *', [id, body.password ? hash(body.password) : null])).rows[0];
      return u ? send(res, 200, userJson(u)) : send(res, 404, { code: 404, msg: 'User not found' });
    }
    if (req.method === 'DELETE') { await pool.query('delete from auth.users where id = $1', [id]); return send(res, 200, {}); }
  }
  send(res, 404, { msg: 'not found' });
}

const FUNCTIONS = { 'auth-admin': PORT + 10, 'ocr-vision': PORT + 11 };
function proxyFunction(req, res, name) {
  if (req.method === 'OPTIONS') return send(res, 200, {});
  const out = http.request({ host: '127.0.0.1', port: FUNCTIONS[name], path: '/', method: req.method,
    headers: { ...req.headers, 'x-forwarded-for': req.headers['x-test-ip'] ?? '127.0.0.1' } }, (r) => {
    res.writeHead(r.statusCode ?? 500, { ...r.headers, 'access-control-allow-origin': '*' });
    r.pipe(res);
  });
  out.on('error', () => send(res, 502, { error: 'FUNCTION_UNAVAILABLE' }));
  req.pipe(out);
}

export function start() {
  const deno = process.env.DENO_BIN ?? 'deno';
  const children = Object.entries(FUNCTIONS).map(([name, port]) => spawn(deno,
    ['run', '--allow-net', '--allow-env', '--quiet', path.join(root, 'supabase/functions', name, 'index.ts')],
    { env: { ...process.env, SUPABASE_URL: `http://127.0.0.1:${PORT}`, SUPABASE_ANON_KEY: ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
        DENO_SERVE_ADDRESS: `tcp:127.0.0.1:${port}`, NO_PROXY: '127.0.0.1,localhost,registry.npmjs.org', GOOGLE_VISION_API_KEY: '' }, stdio: ['ignore', 'inherit', 'inherit'] }));
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    if (req.method === 'OPTIONS' && !url.pathname.startsWith('/functions/')) return send(res, 200, {});
    const fnMatch = /^\/functions\/v1\/([a-z-]+)/.exec(url.pathname);
    if (fnMatch && FUNCTIONS[fnMatch[1]]) return proxyFunction(req, res, fnMatch[1]);
    const rpcMatch = /^\/rest\/v1\/rpc\/([a-z0-9_]+)$/.exec(url.pathname);
    if (rpcMatch) return rest(req, res, rpcMatch[1]).catch((e) => send(res, 500, { message: String(e) }));
    if (url.pathname.startsWith('/auth/v1')) return auth(req, res, url).catch((e) => send(res, 500, { msg: String(e) }));
    if (url.pathname === '/health') return send(res, 200, { ok: true });
    send(res, 404, { message: 'not found' });
  });
  server.listen(PORT, '127.0.0.1');
  const stop = () => { children.forEach((c) => c.kill()); server.close(); pool.end(); };
  process.on('SIGTERM', () => { stop(); process.exit(0); });
  process.on('SIGINT', () => { stop(); process.exit(0); });
  return { stop, url: `http://127.0.0.1:${PORT}` };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === 'keys') { console.log(JSON.stringify({ url: `http://127.0.0.1:${PORT}`, anon: ANON_KEY })); process.exit(0); }
  start();
  console.log(`local supabase stand-in on http://127.0.0.1:${PORT}`);
}
