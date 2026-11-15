// Verifies the Supabase user JWT. Asymmetric keys (ES256/RS256) via the project's JWKS, cached by jose;
// HS256 only if SUPABASE_JWT_SECRET is set (older projects). The user id comes ONLY from the token.
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { config } from './config';
import { E } from './errors';

let jwks: JWTVerifyGetKey | null = null;
const getJwks = () => (jwks ??= createRemoteJWKSet(new URL(config.jwksUrl), { cacheMaxAge: 60 * 60_000, cooldownDuration: 30_000, timeoutDuration: 3000 }));
/** Test hook: use a local key set instead of the network. */
export function setKeySet(k: JWTVerifyGetKey | null) { jwks = k; }

export async function verifyUser(authorization: string | undefined): Promise<string> {
  const m = /^Bearer\s+(.+)$/i.exec(authorization ?? '');
  if (!m) throw E.noAuth();
  const token = m[1].trim();
  try {
    const alg = decodeProtectedHeader(token).alg;
    const opts = { issuer: `${config.supabaseUrl}/auth/v1`, audience: 'authenticated', clockTolerance: 30 };
    const { payload } = alg === 'HS256'
      ? await jwtVerify(token, new TextEncoder().encode(config.jwtSecret || '\0no-secret'), opts)
      : await jwtVerify(token, getJwks(), opts);
    if (!payload.sub || payload.role !== 'authenticated') throw new Error('not a signed-in user token');
    return payload.sub;
  } catch (e) {
    const why = e instanceof Error ? (e as { code?: string }).code ?? e.message : 'invalid token';
    throw E.badToken(why.slice(0, 120));
  }
}

/** Starts fetching the key set early (called by /healthz warm-up), errors ignored. */
export function warmJwks() {
  if (!config.jwksUrl) return;
  const k = getJwks() as JWTVerifyGetKey & { fresh?: boolean; reload?: () => Promise<void> };
  if (k.reload && !k.fresh) void k.reload().catch(() => undefined);
}
