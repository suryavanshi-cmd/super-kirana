// Receives problem reports from the app and writes them to the server log (Vercel → Logs), so a
// failure can be traced from its reference without anyone collecting logs by hand.
//
// Safe by design: only a few short, known fields are kept; anything that looks like a key, token,
// password, mobile number or email is masked; the body is size-capped; and it is rate-limited per IP.
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY = 4_000;
const hits = new Map<string, { n: number; at: number }>();

function allowed(ip: string): boolean {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.at > 60_000) { hits.set(ip, { n: 1, at: now }); if (hits.size > 5000) hits.clear(); return true; }
  h.n += 1;
  return h.n <= 30;
}

function scrub(v: unknown, max = 300): string {
  if (typeof v !== 'string' && typeof v !== 'number') return '';
  return String(v)
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[key]')
    .replace(/eyJ[0-9A-Za-z_-]{10,}\.[0-9A-Za-z_-]+\.[0-9A-Za-z_-]+/g, '[token]')
    .replace(/\b(sk|pk|sb)_[0-9A-Za-z_-]{16,}/g, '[key]')
    .replace(/(password|passwd|pwd|secret|token|apikey|api_key)\s*[=:]\s*\S+/gi, '$1=[hidden]')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]')
    .replace(/(?<!\d)[6-9]\d{9}(?!\d)/g, '[mobile]')
    .replace(/[\u0000-\u001f]+/g, ' ')
    .slice(0, max);
}

export async function POST(req: Request) {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  if (!allowed(ip)) return new NextResponse(null, { status: 429 });
  const raw = await req.text().catch(() => '');
  if (!raw || raw.length > MAX_BODY) return new NextResponse(null, { status: 413 });
  let b: Record<string, unknown>;
  try { b = JSON.parse(raw); } catch { return new NextResponse(null, { status: 400 }); }
  const entry = {
    ref: scrub(b.ref, 12), code: scrub(b.code, 40), kind: scrub(b.kind, 10), status: typeof b.status === 'number' ? b.status : null,
    op: scrub(b.op, 80), cause: scrub(b.cause), path: scrub(b.path, 120), at: scrub(b.at, 30),
    agent: scrub(req.headers.get('user-agent'), 160),
  };
  if (!/^[A-Z0-9]{4,12}$/.test(entry.ref)) return new NextResponse(null, { status: 400 });
  console.error(`[app-error] ${JSON.stringify(entry)}`);
  return new NextResponse(null, { status: 204 });
}
