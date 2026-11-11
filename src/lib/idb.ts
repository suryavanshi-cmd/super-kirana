// Minimal IndexedDB key-value stores. `cache` = last synchronised lists, `drafts` = unfinished
// bills, `pending` = financial requests whose outcome is being tracked. Everything is keyed by
// user + shop, and wiped on logout or when a different user signs in on the same device.
const DB_NAME = 'super-kirana';
export type Store = 'cache' | 'drafts' | 'pending';
const STORES: Store[] = ['cache', 'drafts', 'pending'];

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('indexedDB unavailable'));
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function run<T>(store: Store, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return open().then((db) => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req.result as T);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

export const idbGet = <T>(store: Store, key: string) => run<T | undefined>(store, 'readonly', (s) => s.get(key)).catch(() => undefined);
export const idbSet = (store: Store, key: string, value: unknown) => run<IDBValidKey>(store, 'readwrite', (s) => s.put(value, key)).then(() => true, () => false);
export const idbDel = (store: Store, key: string) => run<undefined>(store, 'readwrite', (s) => s.delete(key)).then(() => true, () => false);

export async function idbEntries<T>(store: Store, prefix: string): Promise<[string, T][]> {
  try {
    const range = IDBKeyRange.bound(prefix, prefix + '￿');
    const [keys, values] = await Promise.all([
      run<IDBValidKey[]>(store, 'readonly', (s) => s.getAllKeys(range)),
      run<T[]>(store, 'readonly', (s) => s.getAll(range)),
    ]);
    return keys.map((k, i) => [String(k), values[i]]);
  } catch { return []; }
}

export async function idbClearAll(): Promise<void> {
  for (const s of STORES) await run(s, 'readwrite', (o) => o.clear()).catch(() => undefined);
}
