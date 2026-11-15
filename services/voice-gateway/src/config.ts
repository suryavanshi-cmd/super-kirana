// All settings come from the environment (Cloud Run env vars + Secret Manager). Nothing secret in code.
const env = (k: string, d = '') => (process.env[k] ?? d).trim();
const num = (k: string, d: number) => { const v = Number(process.env[k]); return Number.isFinite(v) && v > 0 ? v : d; };

const supabaseUrl = env('SUPABASE_URL').replace(/\/+$/, '');

export const config = {
  port: num('PORT', 8080),
  version: env('K_REVISION', env('APP_VERSION', 'dev')),
  supabaseUrl,
  serviceKey: env('SUPABASE_SERVICE_ROLE_KEY'),
  jwksUrl: env('SUPABASE_JWKS_URL', supabaseUrl ? `${supabaseUrl}/auth/v1/.well-known/jwks.json` : ''),
  jwtSecret: env('SUPABASE_JWT_SECRET'),            // only for projects still on HS256 tokens
  sarvamKey: env('SARVAM_API_KEY'),
  sarvamUrl: env('SARVAM_URL', 'https://api.sarvam.ai/speech-to-text'),
  sarvamTimeoutMs: num('SARVAM_TIMEOUT_MS', 6000),
  sarvamLanguage: env('SARVAM_LANGUAGE', 'mr-IN'),
  gatewayToken: env('GATEWAY_TOKEN'),
  publishableKey: env('SUPABASE_PUBLISHABLE_KEY'),   // public key, only for the /try demo page sign-in
  tryPage: env('TRY_PAGE', '1') === '1',
  allowedOrigins: env('ALLOWED_ORIGINS', 'https://super-kirana-niphad.vercel.app').split(',').map((s) => s.trim()).filter(Boolean),
  maxAudioBytes: num('MAX_AUDIO_BYTES', 300 * 1024),
  maxAudioSeconds: num('MAX_AUDIO_SECONDS', 10),
  minAudioSeconds: num('MIN_AUDIO_SECONDS', 0.6),
  perMinute: num('RATE_PER_MINUTE', 20),
  perDay: num('RATE_PER_DAY', 500),
  cacheTtlMs: num('CACHE_TTL_MS', 10 * 60_000),
  llmFallback: env('FEATURE_LLM_FALLBACK') === '1',   // reserved for v2; nothing uses an LLM today
};

/** Names of required settings that are missing (reported, never their values). */
export function missingSettings(): string[] {
  const need: [string, string][] = [['SUPABASE_URL', config.supabaseUrl], ['SUPABASE_SERVICE_ROLE_KEY', config.serviceKey], ['SARVAM_API_KEY', config.sarvamKey]];
  return need.filter(([, v]) => !v).map(([k]) => k);
}
