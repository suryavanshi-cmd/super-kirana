// Thin, typed access to the database functions and the auth-admin edge function.
// Every failure becomes an AppError whose `kind` tells the UI whether the request certainly did
// NOT happen ('app', 'auth') or whether its outcome is unknown ('network').
import { supabase, SUPABASE_KEY, SUPABASE_URL } from './supabase';

export type ErrorKind = 'app' | 'auth' | 'network' | 'server';

export class AppError extends Error {
  constructor(public code: string, public kind: ErrorKind, public detail?: string) {
    super(code);
    this.name = 'AppError';
  }
}

const TIMEOUT_MS = 20_000;

function isNetworkFailure(message: string): boolean {
  return /failed to fetch|networkerror|network request failed|load failed|aborted|timeout|timed out/i.test(message);
}

export async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new AppError('NETWORK', 'network');
  let res;
  try {
    res = await supabase().rpc(fn, args).abortSignal(AbortSignal.timeout(TIMEOUT_MS));
  } catch (e) {
    throw new AppError('NETWORK', 'network', e instanceof Error ? e.message : undefined);
  }
  const { data, error, status } = res;
  if (!error) return data as T;
  if (error.code === 'P0001' && /^[A-Z_]+$/.test(error.message)) {
    const kind: ErrorKind = error.message === 'NOT_AUTHENTICATED' ? 'auth' : 'app';
    throw new AppError(error.message, kind, error.details || undefined);
  }
  if (status === 401 || error.code === 'PGRST301' || error.code === 'PGRST303') throw new AppError('NOT_AUTHENTICATED', 'auth');
  if (status === 0 || !status || isNetworkFailure(error.message ?? '')) throw new AppError('NETWORK', 'network', error.message);
  if (status === 403 || error.code === '42501') throw new AppError('FORBIDDEN', 'app');
  if (status >= 500) throw new AppError('SERVER_ERROR', 'network', error.message);   // outcome not known
  // Any other 4xx means the database refused the input before doing anything.
  throw new AppError(error.code === '22P02' || error.code === '22003' ? 'INVALID_AMOUNT' : 'UNKNOWN', 'app', error.message);
}

/** Calls the auth-admin edge function. Passwords travel only inside this HTTPS request body. */
export async function authAdmin<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const { data } = await supabase().auth.getSession();
  const token = data.session?.access_token ?? SUPABASE_KEY;
  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/auth-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, ...body }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new AppError('NETWORK', 'network');
  }
  const out = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (res.ok) return out;
  const code = typeof out.error === 'string' && /^[A-Z_]+$/.test(out.error) ? out.error : 'SERVER_ERROR';
  throw new AppError(code, res.status === 401 ? 'auth' : res.status >= 500 ? 'server' : 'app');
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
