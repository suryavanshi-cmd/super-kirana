// Tracking of financial requests (bills, payments) from this device.
//
//   sending   -> request is in flight
//   confirmed -> the server answered: it is posted (the only state shown as "saved")
//   failed    -> the server refused it: certainly NOT posted
//   unknown   -> the connection broke: we do not know. The user must check the status with the
//                original idempotency key; re-sending with the SAME key can never post twice.
import { AppError, rpc } from './api';
import { idbDel, idbEntries, idbGet, idbSet } from './idb';

export type PendingState = 'sending' | 'confirmed' | 'failed' | 'unknown';
export interface Pending {
  key: string;                     // idempotency key
  fn: 'create_invoice' | 'receive_payment';
  args: Record<string, unknown>;   // exact arguments, so a re-send is byte-for-byte the same request
  shopId: string;
  label: string;                   // customer name or walk-in
  amountPaise: number;
  state: PendingState;
  errorCode?: string;
  result?: Record<string, unknown>;
  createdAt: number;
}

const id = (scope: string, key: string) => `${scope}${key}`;

export async function listPending(scope: string): Promise<Pending[]> {
  const rows = (await idbEntries<Pending>('pending', scope)).map(([, v]) => v);
  // A request still marked "sending" after a reload was interrupted: its outcome is unknown.
  return rows.map((p) => (p.state === 'sending' && Date.now() - p.createdAt > 30_000 ? { ...p, state: 'unknown' as const } : p))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function dismissPending(scope: string, key: string): Promise<void> { await idbDel('pending', id(scope, key)); }

async function save(scope: string, p: Pending): Promise<Pending> { await idbSet('pending', id(scope, p.key), p); return p; }

async function trim(scope: string): Promise<void> {
  const done = (await listPending(scope)).filter((p) => p.state === 'confirmed');
  for (const p of done.slice(15)) await dismissPending(scope, p.key);
}

/** Sends a tracked request. Resolves with the record in its final state; never throws. */
export async function send(scope: string, p: Omit<Pending, 'state' | 'createdAt'> & Partial<Pick<Pending, 'createdAt'>>): Promise<Pending> {
  const rec: Pending = { ...p, state: 'sending', createdAt: p.createdAt ?? Date.now(), errorCode: undefined };
  await save(scope, rec);
  try {
    const result = await rpc<Record<string, unknown>>(rec.fn, rec.args);
    const out = await save(scope, { ...rec, state: 'confirmed', result });
    void trim(scope);
    return out;
  } catch (e) {
    const err = e instanceof AppError ? e : new AppError('UNKNOWN', 'network');
    // Only an explicit refusal from the server proves that nothing was posted.
    if (err.kind === 'app' || err.kind === 'auth') return save(scope, { ...rec, state: 'failed', errorCode: err.code });
    return save(scope, { ...rec, state: 'unknown', errorCode: err.code });
  }
}

/** Asks the server whether the request with this key was posted. */
export async function checkStatus(scope: string, key: string): Promise<Pending | null> {
  const rec = await idbGet<Pending>('pending', id(scope, key));
  if (!rec) return null;
  const status = await rpc<{ found: boolean; result?: Record<string, unknown> }>('get_mutation_status',
    { p_shop_id: rec.shopId, p_idempotency_key: rec.key });
  if (status.found) return save(scope, { ...rec, state: 'confirmed', result: status.result, errorCode: undefined });
  return save(scope, { ...rec, state: 'unknown', errorCode: 'NOT_ON_SERVER' });
}

export async function resend(scope: string, key: string): Promise<Pending | null> {
  const rec = await idbGet<Pending>('pending', id(scope, key));
  return rec ? send(scope, rec) : null;
}
