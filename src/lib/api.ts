// Thin, typed access to the database functions and the auth-admin edge function.
// Every failure becomes an AppError whose `kind` tells the UI whether the request certainly did
// NOT happen ('app', 'auth') or whether its outcome is unknown ('network').
import { supabase, SUPABASE_KEY, SUPABASE_URL } from './supabase';

export type ErrorKind = 'app' | 'auth' | 'network' | 'server';

/** Short reference shown to the shopkeeper and written to the error log, e.g. "K7Q2MX". */
function makeRef(): string {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = new Uint8Array(6);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => a[x % a.length]).join('');
}

/**
 * Every failure in the app. `code` picks the plain-language message; `cause` is the actual reason
 * (which step failed, the HTTP status and what the server said), shown under the message and logged.
 */
export class AppError extends Error {
  readonly ref = makeRef();
  constructor(public code: string, public kind: ErrorKind, public detail?: string, public op?: string, public status?: number) {
    super(code);
    this.name = 'AppError';
  }
  /** One line: "save_customer · HTTP 500 · column x does not exist". Never contains secrets. */
  get reason(): string {
    return [this.op, this.status ? `HTTP ${this.status}` : '', this.detail && this.detail !== this.code ? this.detail : '']
      .filter(Boolean).join(' · ').slice(0, 300);
  }
}

// Codes that are normal answers ("wrong password", "not enough stock") are not logged; everything
// that means something broke is reported automatically, so nobody has to collect logs by hand.
const EXPECTED = /^(INVALID_|WRONG_|WEAK_|SAME_|NOT_AUTHENTICATED|FORBIDDEN|OWNER_ONLY|ADMIN_ONLY|DEMO_|TOO_MANY_ATTEMPTS|.*_NOT_FOUND|.*_EXISTS|.*_TAKEN|DUPLICATE|NO_ITEMS|INSUFFICIENT|NETWORK$)/;
const reported = new Set<string>();
const LOG_KEY = 'sk.errors';

export interface LoggedError { ref: string; at: string; code: string; cause: string; path: string }

/** Recent problems on this phone (newest first), for the "Problem log" screen. */
export function recentErrors(): LoggedError[] {
  try { const v = JSON.parse(localStorage.getItem(LOG_KEY) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
export function clearErrors() { try { localStorage.removeItem(LOG_KEY); } catch { /* private mode */ } }

/** Records the error on the phone and (fire-and-forget) in the server log. Safe to call twice. */
export function reportError(e: unknown, where?: string): void {
  if (typeof window === 'undefined') return;
  const err = e instanceof AppError ? e : new AppError('UNKNOWN', 'server', e instanceof Error ? `${e.name}: ${e.message}` : String(e), where);
  if (reported.has(err.ref)) return;
  reported.add(err.ref);
  const entry: LoggedError = { ref: err.ref, at: new Date().toISOString(), code: err.code, cause: err.reason, path: location.pathname };
  try { localStorage.setItem(LOG_KEY, JSON.stringify([entry, ...recentErrors()].slice(0, 40))); } catch { /* full / private */ }
  if (EXPECTED.test(err.code) && !(err.status && err.status >= 500)) return;
  try {
    void fetch('/api/report-error', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
      body: JSON.stringify({ ...entry, kind: err.kind, status: err.status ?? null, op: err.op ?? null }),
    }).catch(() => undefined);
  } catch { /* never let logging break the app */ }
}

/** Builds, logs and returns an AppError (use as `throw fail(...)`). */
export function fail(code: string, kind: ErrorKind, detail?: string, op?: string, status?: number): AppError {
  const e = new AppError(code, kind, detail, op, status);
  reportError(e);
  return e;
}

const TIMEOUT_MS = 20_000;

function isNetworkFailure(message: string): boolean {
  return /failed to fetch|networkerror|network request failed|load failed|aborted|timeout|timed out/i.test(message);
}
const clip = (s: unknown) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, 240) : '');

export async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new AppError('NETWORK', 'network', 'phone is offline', fn);
  let res;
  try {
    res = await supabase().rpc(fn, args).abortSignal(AbortSignal.timeout(TIMEOUT_MS));
  } catch (e) {
    throw fail('NETWORK', 'network', e instanceof Error ? e.message : undefined, fn);
  }
  const { data, error, status } = res;
  if (!error) return data as T;
  if (error.code === 'P0001' && /^[A-Z_]+$/.test(error.message)) {
    const kind: ErrorKind = error.message === 'NOT_AUTHENTICATED' ? 'auth' : 'app';
    throw fail(error.message, kind, error.details || undefined, fn, status);
  }
  // What the database actually said, e.g. "PGRST202 Could not find the function …" or "42703 column … does not exist".
  const said = [error.code, clip(error.message), clip(error.hint)].filter(Boolean).join(' ');
  if (status === 401 || error.code === 'PGRST301' || error.code === 'PGRST303') throw fail('NOT_AUTHENTICATED', 'auth', said, fn, status);
  if (status === 0 || !status || isNetworkFailure(error.message ?? '')) throw fail('NETWORK', 'network', said, fn, status || undefined);
  if (status === 403 || error.code === '42501') throw fail('FORBIDDEN', 'app', said, fn, status);
  if (error.code === 'PGRST202' || status === 404) throw fail('APP_OUTDATED', 'app', said, fn, status);
  if (status >= 500) throw fail('SERVER_ERROR', 'network', said, fn, status);   // outcome not known
  // Any other 4xx means the database refused the input before doing anything.
  throw fail(error.code === '22P02' || error.code === '22003' ? 'INVALID_AMOUNT' : 'UNKNOWN', 'app', said, fn, status);
}

/**
 * Calls one of our edge functions. Errors keep the function's own code and reason
 * ({ error, detail }) plus the HTTP status, so the screen can say what actually went wrong.
 */
export async function callFunction<T>(name: string, body: Record<string, unknown>, timeoutMs = TIMEOUT_MS, op = name): Promise<T> {
  const { data } = await supabase().auth.getSession();
  const token = data.session?.access_token ?? SUPABASE_KEY;
  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` },
      body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const timedOut = e instanceof Error && /timeout|abort/i.test(`${e.name} ${e.message}`);
    throw fail(timedOut ? 'TIMEOUT' : 'NETWORK', 'network', e instanceof Error ? `${e.name}: ${e.message}` : undefined, op);
  }
  const raw = await res.text().catch(() => '');
  let out: Record<string, unknown> = {};
  try { out = raw ? JSON.parse(raw) : {}; } catch { /* not JSON: keep the text as the reason */ }
  if (res.ok) return out as T;
  const code = typeof out.error === 'string' && /^[A-Z_]+$/.test(out.error) ? out.error
    : res.status === 401 ? 'NOT_AUTHENTICATED' : res.status === 504 || res.status === 546 ? 'TIMEOUT' : 'SERVER_ERROR';
  // Our functions send `detail`; the Supabase gateway sends { code, message } (e.g. WORKER_LIMIT, BOOT_ERROR).
  const detail = clip(out.detail) || [clip(out.code), clip(out.message ?? out.msg)].filter(Boolean).join(' ') || clip(raw) || res.statusText;
  const step = typeof out.step === 'string' ? `${op}/${out.step}` : op;
  throw fail(code, res.status === 401 ? 'auth' : res.status >= 500 ? 'server' : 'app', detail, step, res.status);
}

/** Calls the auth-admin edge function. Passwords travel only inside this HTTPS request body. */
export function authAdmin<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  return callFunction<T>('auth-admin', { action, ...body }, TIMEOUT_MS, action);
}

export const newKey = (): string => crypto.randomUUID();

// ---- shapes returned by the database functions ------------------------------------------------
export type Role = 'owner' | 'cashier';
export interface ShopRef { id: string; shop_username: string; name_mr: string; name_en: string; status: 'active' | 'suspended'; timezone: string; role: Role; is_member: boolean }
export interface Context { user_id: string; username: string; display_name: string; preferred_language: 'mr-IN' | 'en-IN'; must_change_password: boolean; is_platform_admin: boolean; shops: ShopRef[] }
export interface CustomerRow { id: string; name: string; mobile: string | null; is_active: boolean; balance_paise: number; last_at?: string | null }
export interface UnpaidInvoice { id: string; invoice_no: number; posted_at: string; total_paise: number; outstanding_paise: number }
export interface CustomerDetail extends CustomerRow { notes: string | null; created_at: string; opening_balance_paise: number; purchases_paise: number; payments_paise: number; credits_paise: number; reconciled: boolean; opening_outstanding_paise: number; unpaid_invoices: UnpaidInvoice[] }
export interface Product { id: string; name: string; name_en: string | null; name_mr: string | null; unit: import('./money').Unit; default_price_paise: number; is_active: boolean; barcode: string | null; category: string | null; purchase_cost_paise: number | null; stock_qty: number | null; sku: string | null }
export type EntryType = 'opening_balance' | 'invoice' | 'payment' | 'credit' | 'invoice_reversal' | 'payment_reversal' | 'credit_reversal';
export interface Allocation { target: 'invoice' | 'opening'; invoice_no: number | null; amount_paise: number }
export interface LedgerEntry { id: string; seq: number; entry_type: EntryType; amount_paise: number; business_date: string; posted_at: string; note: string | null; invoice_id: string | null; payment_id: string | null; credit_note_id: string | null; invoice_no: number | null; payment_no: number | null; method: Method | null; payment_kind: string | null; reference: string | null; running_paise: number; allocations: Allocation[] | null }
export interface Ledger { customer_id: string; from: string | null; to: string | null; balance_before_paise: number; entries: LedgerEntry[]; balance_paise: number }
export type Method = 'cash' | 'upi' | 'other';
export interface InvoiceItem { line_no: number; name: string; qty: number; unit: import('./money').Unit; price_unit: import('./money').Unit; unit_price_paise: number; gross_paise: number; discount_paise: number; line_total_paise: number }
export interface PaymentRef { id: string; payment_no: number; kind: 'bill_payment' | 'collection'; amount_paise: number; method: Method; reference: string | null; status: 'posted' | 'reversed' }
export interface ShopNames { name_mr: string; name_en: string; timezone: string }
export interface Invoice { id: string; invoice_no: number; status: 'posted' | 'reversed'; customer_id: string | null; customer_name: string | null; subtotal_paise: number; discount_paise: number; total_paise: number; paid_at_posting_paise: number; old_dues_paid_paise: number; bill_due_at_posting_paise: number; previous_balance_paise: number; balance_after_paise: number; outstanding_paise: number; source: 'manual' | 'ocr'; note: string | null; business_date: string; posted_at: string; created_by_name: string | null; reversed_at: string | null; reversal_reason: string | null; shop: ShopNames; items: InvoiceItem[]; payments: PaymentRef[] }
export interface Payment { id: string; payment_no: number; kind: 'bill_payment' | 'collection'; status: 'posted' | 'reversed'; customer_id: string | null; customer_name: string | null; invoice_id: string | null; amount_paise: number; method: Method; reference: string | null; note: string | null; previous_balance_paise: number; balance_after_paise: number; business_date: string; posted_at: string; created_by_name: string | null; reversed_at: string | null; reversal_reason: string | null; shop: ShopNames; allocations: Allocation[] }
export interface Activity { id: string; seq: number; entry_type: EntryType; amount_paise: number; posted_at: string; customer_id: string | null; invoice_id: string | null; payment_id: string | null; credit_note_id: string | null; customer_name: string | null; invoice_no: number | null; payment_no: number | null; method: Method | null }
export interface DayTotals { sales_gross_paise: number; sales_reversed_paise: number; credits_paise: number; net_sales_paise: number; collections_gross_paise: number; collections_reversed_paise: number; net_collections_paise: number; cash_paise: number; upi_paise: number; other_paise: number; bills: number }
export interface DailySummary extends DayTotals { date: string; total_outstanding_paise: number; customers_with_due: number }
export interface Report { from: string; to: string; totals: DayTotals; days: (DayTotals & { date: string })[]; bills: { id: string; invoice_no: number; business_date: string; posted_at: string; customer_name: string | null; total_paise: number; paid_at_posting_paise: number; status: string; outstanding_paise: number }[]; payments: { id: string; payment_no: number; business_date: string; posted_at: string; customer_name: string | null; kind: string; method: Method; amount_paise: number; reference: string | null; status: string }[] }
export interface OutstandingRow { customer_id: string; name: string; mobile: string | null; balance_paise: number; oldest_unpaid_date: string | null }
export interface Member { user_id: string; username: string; display_name: string; role: Role; status: 'active' | 'disabled'; must_change_password: boolean }
export interface AuditRow { id: number; action: string; entity_type: string | null; entity_id: string | null; details: Record<string, unknown>; created_at: string; actor_name: string | null; shop_name?: string | null }
export interface AdminShop { id: string; shop_username: string; name_mr: string; name_en: string; status: 'active' | 'suspended'; created_at: string; members: number; customers: number; bills: number }
export interface InvoiceResult { invoice_id: string; invoice_no: number; total_paise: number; paid_paise: number; bill_paid_paise: number; old_dues_paid_paise: number; bill_due_paise: number; previous_balance_paise: number; new_balance_paise: number; payment_ids: string[]; replayed: boolean }
export interface PaymentResult { payment_id: string; payment_no: number; amount_paise: number; previous_balance_paise: number; new_balance_paise: number; replayed: boolean }
