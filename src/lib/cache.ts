// In-memory answers shared by all screens (see useQuery in ./data).
// ---- instant screens ----------------------------------------------------------------------------
// Every screen's last answer is kept in memory (and, for lists, on the device). Opening a screen
// shows it at once; the fresh answer replaces it a moment later. Identical requests made at the same
// time share one network call. Keys always start with the user+shop scope, so nothing crosses users.
export const mem = new Map<string, { data: unknown; at: number }>();
export const inflight = new Map<string, Promise<unknown>>();
export const FRESH_MS = 4_000;   // answers younger than this are not fetched again (e.g. back-and-forth taps)

export function load<T>(key: string | undefined, fetcher: () => Promise<T>): Promise<T> {
  if (!key) return fetcher();
  const running = inflight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const p = fetcher().then((data) => { mem.set(key, { data, at: Date.now() }); return data; })
    .finally(() => { inflight.delete(key); });
  inflight.set(key, p);
  return p;
}

/** Marks cached answers as old (after a save), so the next visit refetches. Prefix match; '' = all. */
export function invalidate(prefix = ''): void {
  for (const [k, v] of mem) if (k.startsWith(prefix)) mem.set(k, { data: v.data, at: 0 });
}
/** Forget everything (logout / switching user or shop). */
export function clearMemoryCache(): void { mem.clear(); inflight.clear(); }
