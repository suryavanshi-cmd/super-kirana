// auth-admin — the only place the service-role key is used. It never reaches the browser.
//
// Public actions:   login, setup-status, setup, demo-login
// Signed-in actions: change-password, create-shop, add-member, reset-password
//
// Passwords are verified and stored only by Supabase Auth. This function never logs request
// bodies and never returns an auth email / identifier to the caller.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? '';
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SECRET_KEY') ?? '';
const ALLOWED_ORIGIN = Deno.env.get('APP_ORIGIN') ?? '*';
// Sign-in identities are opaque. `.invalid` is a reserved TLD: no mail can ever be sent to them.
const LOGIN_DOMAIN = 'login.superkirana.invalid';

const cors = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

class Fail extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

const svc: SupabaseClient = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

async function db<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await svc.rpc(fn, args);
  if (error) {
    // Application errors arrive as P0001 with the code in `message`; anything else is internal.
    if (error.code === 'P0001' && /^[A-Z_]+$/.test(error.message)) throw new Fail(400, error.message);
    console.error('db error', fn, error.code);
    throw new Fail(500, 'SERVER_ERROR');
  }
  return data as T;
}

async function sha(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function clientIp(req: Request): string {
  return (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
}

async function limit(key: string, max: number, windowSeconds: number) {
  const ok = await db<boolean>('svc_rate_limit', { p_key: key, p_max: max, p_window_seconds: windowSeconds });
  if (!ok) throw new Fail(429, 'TOO_MANY_ATTEMPTS');
}

const str = (v: unknown, max = 200): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function checkPassword(password: unknown, username: string): string {
  if (typeof password !== 'string' || password.length < 8 || password.length > 72) throw new Fail(400, 'WEAK_PASSWORD');
  if (!/[A-Za-zऀ-ॿ]/.test(password) || !/[0-9०-९]/.test(password)) throw new Fail(400, 'WEAK_PASSWORD');
  if (username && password.toLowerCase().includes(username.toLowerCase())) throw new Fail(400, 'WEAK_PASSWORD');
  return password;
}

async function passwordGrant(email: string, password: string): Promise<{ access_token: string; refresh_token: string } | null> {
  const res = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) { await res.body?.cancel(); return null; }
  const body = await res.json();
  return body?.access_token ? { access_token: body.access_token, refresh_token: body.refresh_token } : null;
}

async function emailOf(userId: string): Promise<string | null> {
  const { data, error } = await svc.auth.admin.getUserById(userId);
  return error ? null : data.user?.email ?? null;
}

async function createIdentity(password: string): Promise<string> {
  const { data, error } = await svc.auth.admin.createUser({
    email: `${crypto.randomUUID()}@${LOGIN_DOMAIN}`, password, email_confirm: true,
  });
  if (error || !data.user) { console.error('createUser failed', error?.status); throw new Fail(500, 'SERVER_ERROR'); }
  return data.user.id;
}

async function actor(req: Request): Promise<string> {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token || token === ANON) throw new Fail(401, 'NOT_AUTHENTICATED');
  const { data, error } = await svc.auth.getUser(token);
  if (error || !data.user) throw new Fail(401, 'NOT_AUTHENTICATED');
  // The demo account may use the shop, but never change passwords, add staff or create shops.
  if (await db<boolean>('svc_is_demo_user', { p_user_id: data.user.id })) throw new Fail(403, 'DEMO_READONLY');
  return data.user.id;
}

// ------------------------------------------------------------------ actions
async function login(req: Request, b: Record<string, unknown>) {
  const username = str(b.username, 64).toLowerCase();
  const password = typeof b.password === 'string' ? b.password : '';
  if (!username || !password) throw new Fail(401, 'INVALID_CREDENTIALS');
  // Counted per submitted username (whether or not it exists) and per IP: no enumeration signal.
  await limit(`login:u:${await sha(username)}`, 8, 900);
  await limit(`login:ip:${clientIp(req)}`, 40, 900);
  const userId = await db<string | null>('svc_resolve_login', { p_username: username });
  const email = (userId && (await emailOf(userId))) || `unknown-${await sha(username)}@${LOGIN_DOMAIN}`;
  const session = await passwordGrant(email, password);   // also runs for unknown users (timing)
  if (!userId || !session) throw new Fail(401, 'INVALID_CREDENTIALS');
  await db('svc_log_auth', { p_user: userId, p_action: 'auth.login', p_details: {} });
  return session;
}

/**
 * Demo: the right code opens the demo shop without a username or password.
 * The code is compared as a SHA-256 hash; attempts are rate-limited per IP and overall. The demo
 * account gets a fresh random password for each sign-in (never stored or shown), so nobody can
 * sign in to it any other way.
 */
async function demoLogin(req: Request, b: Record<string, unknown>) {
  await limit(`demo:ip:${clientIp(req)}`, 10, 900);
  await limit('demo:all', 300, 3600);
  const code = str(b.code, 64).toUpperCase().replace(/\s+/g, '');
  if (!code) throw new Fail(401, 'INVALID_DEMO_CODE');
  const check = await db<{ ok: boolean; user_id: string | null; shop_id: string | null } | null>('svc_demo_check', { p_code_hash: await sha(code) });
  if (!check?.ok) throw new Fail(401, 'INVALID_DEMO_CODE');
  let userId = check.user_id;
  if (!userId) {
    userId = await createIdentity(`D${crypto.randomUUID()}x9`);
    try { await db('svc_demo_bootstrap', { p_user_id: userId }); }
    catch (e) { await svc.auth.admin.deleteUser(userId); throw e; }
  }
  const email = await emailOf(userId);
  if (!email) throw new Fail(500, 'SERVER_ERROR');
  for (let attempt = 0; attempt < 3; attempt++) {
    const password = `D${crypto.randomUUID()}x9`;
    const { error } = await svc.auth.admin.updateUserById(userId, { password });
    if (error) throw new Fail(500, 'SERVER_ERROR');
    const session = await passwordGrant(email, password);   // another demo sign-in at the same moment can win the race: retry
    if (session) { await db('svc_log_auth', { p_user: userId, p_action: 'auth.demo_login', p_details: {} }); return session; }
  }
  throw new Fail(503, 'SERVER_ERROR');
}

async function setupStatus() {
  return { needs_setup: await db<boolean>('svc_needs_setup', {}) };
}

async function setup(req: Request, b: Record<string, unknown>) {
  await limit(`setup:ip:${clientIp(req)}`, 5, 3600);
  await limit('setup:all', 30, 3600);
  const code = str(b.code, 100);
  const username = str(b.username, 64).toLowerCase();
  const display = str(b.display_name, 80) || username;
  await db('svc_check_setup', { p_code: code, p_username: username });
  const password = checkPassword(b.password, username);
  const userId = await createIdentity(password);
  try {
    return await db('svc_complete_setup', { p_code: code, p_user_id: userId, p_username: username, p_display_name: display });
  } catch (e) {
    await svc.auth.admin.deleteUser(userId);
    throw e;
  }
}

async function changePassword(req: Request, b: Record<string, unknown>) {
  const uid = await actor(req);
  await limit(`chpw:${uid}`, 10, 900);
  const email = await emailOf(uid);
  const current = typeof b.current_password === 'string' ? b.current_password : '';
  if (!email || !(await passwordGrant(email, current))) throw new Fail(400, 'WRONG_PASSWORD');
  const next = checkPassword(b.new_password, (await db<string | null>('svc_username_of', { p_user_id: uid })) ?? '');
  if (next === current) throw new Fail(400, 'SAME_PASSWORD');
  const { error } = await svc.auth.admin.updateUserById(uid, { password: next });
  if (error) throw new Fail(500, 'SERVER_ERROR');
  await db('svc_password_changed', { p_user_id: uid });
  return { ok: true };
}

async function createShop(req: Request, b: Record<string, unknown>) {
  const uid = await actor(req);
  const o = (b.owner ?? {}) as Record<string, unknown>;
  const isNew = o.mode !== 'existing';
  const ownerUsername = str(o.username, 64).toLowerCase();
  const args = {
    p_actor: uid, p_request_id: str(b.request_id, 40), p_shop_username: str(b.shop_username, 64).toLowerCase(),
    p_name_mr: str(b.name_mr, 120), p_name_en: str(b.name_en, 120), p_owner_username: ownerUsername, p_owner_is_new: isNew,
  };
  const pre = await db<{ existing_shop_id: string | null; owner_user_id: string | null }>('svc_precheck_create_shop', args);
  if (pre.existing_shop_id) return { shop_id: pre.existing_shop_id, existing: true };
  let ownerId = pre.owner_user_id;
  if (isNew) ownerId = await createIdentity(checkPassword(o.password, ownerUsername));
  try {
    const r = await db<{ shop_id: string }>('svc_create_shop', {
      p_actor: uid, p_request_id: args.p_request_id, p_shop_username: args.p_shop_username, p_name_mr: args.p_name_mr,
      p_name_en: args.p_name_en, p_owner_user_id: ownerId, p_owner_username: ownerUsername,
      p_owner_display_name: str(o.display_name, 80) || ownerUsername, p_owner_is_new: isNew,
    });
    return { ...r, existing: false };
  } catch (e) {
    if (isNew && ownerId) await svc.auth.admin.deleteUser(ownerId);
    throw e;
  }
}

async function addMember(req: Request, b: Record<string, unknown>) {
  const uid = await actor(req);
  const isNew = b.mode !== 'existing';
  const username = str(b.username, 64).toLowerCase();
  const role = str(b.role, 10);
  const shopId = str(b.shop_id, 40);
  const pre = await db<{ user_id: string | null }>('svc_precheck_add_member',
    { p_actor: uid, p_shop_id: shopId, p_username: username, p_role: role, p_is_new: isNew });
  let userId = pre.user_id;
  if (isNew) userId = await createIdentity(checkPassword(b.password, username));
  try {
    return await db('svc_add_member', { p_actor: uid, p_shop_id: shopId, p_user_id: userId, p_username: username,
      p_display_name: str(b.display_name, 80) || username, p_role: role, p_is_new: isNew });
  } catch (e) {
    if (isNew && userId) await svc.auth.admin.deleteUser(userId);
    throw e;
  }
}

async function resetPassword(req: Request, b: Record<string, unknown>) {
  const uid = await actor(req);
  await limit(`reset:${uid}`, 20, 3600);
  const target = str(b.user_id, 40);
  const next = checkPassword(b.new_password, (await db<string | null>('svc_username_of', { p_user_id: target || null })) ?? '');
  // Authorizes the actor, forces a password change at next login and revokes sessions.
  await db('svc_begin_password_reset', { p_actor: uid, p_shop_id: str(b.shop_id, 40) || null, p_user_id: target });
  const { error } = await svc.auth.admin.updateUserById(target, { password: next });
  if (error) throw new Fail(500, 'SERVER_ERROR');
  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });
  try {
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    switch (b.action) {
      case 'login': return json(200, await login(req, b));
      case 'setup-status': return json(200, await setupStatus());
      case 'demo-login': return json(200, await demoLogin(req, b));
      case 'setup': return json(200, await setup(req, b));
      case 'change-password': return json(200, await changePassword(req, b));
      case 'create-shop': return json(200, await createShop(req, b));
      case 'add-member': return json(200, await addMember(req, b));
      case 'reset-password': return json(200, await resetPassword(req, b));
      default: return json(400, { error: 'UNKNOWN_ACTION' });
    }
  } catch (e) {
    if (e instanceof Fail) return json(e.status, { error: e.code });
    console.error('unhandled', e instanceof Error ? e.name : 'error');
    return json(500, { error: 'SERVER_ERROR' });
  }
});
