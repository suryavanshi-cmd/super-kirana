// Per-shop limits, in memory (per instance; max-instances=2 bounds the total): 20/min, 500/day.
import { config } from './config';
import { E } from './errors';

const minute = new Map<string, { start: number; n: number }>();
const day = new Map<string, { day: string; n: number }>();
const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);   // India date

export function checkRate(shopId: string, now = Date.now()): void {
  const m = minute.get(shopId);
  if (!m || now - m.start >= 60_000) minute.set(shopId, { start: now, n: 1 });
  else if (++m.n > config.perMinute) throw E.rateMinute(config.perMinute);
  const d = day.get(shopId), t = today();
  if (!d || d.day !== t) day.set(shopId, { day: t, n: 1 });
  else if (++d.n > config.perDay) throw E.rateDay(config.perDay);
  if (minute.size > 5000) minute.clear();
  if (day.size > 5000) day.clear();
}
export function resetRates() { minute.clear(); day.clear(); }
