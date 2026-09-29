/** Tiny async key-value store. IndexedDB in browsers; in-memory for tests / when IDB is unavailable. */
export interface KvStore {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
  keys(prefix: string): Promise<string[]>;
}

export class MemoryKv implements KvStore {
  private m = new Map<string, string>();
  async get<T>(k: string) { const v = this.m.get(k); return v === undefined ? undefined : (JSON.parse(v) as T); }
  async set(k: string, v: unknown) { this.m.set(k, JSON.stringify(v)); }
  async del(k: string) { this.m.delete(k); }
  async keys(prefix: string) { return [...this.m.keys()].filter((k) => k.startsWith(prefix)); }
}

const STORE = 'kv';
export class IdbKv implements KvStore {
  private dbp: Promise<IDBDatabase> | null = null;
  constructor(private name = 'yadbin', private idb: IDBFactory = indexedDB) {}
  private db(): Promise<IDBDatabase> {
    this.dbp ??= new Promise((resolve, reject) => {
      const req = this.idb.open(this.name, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.dbp;
  }
  private async tx<R>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<R>): Promise<R> {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const r = f(db.transaction(STORE, mode).objectStore(STORE));
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  async get<T>(k: string) { return (await this.tx('readonly', (s) => s.get(k))) as T | undefined; }
  async set(k: string, v: unknown) { await this.tx('readwrite', (s) => s.put(v, k)); }
  async del(k: string) { await this.tx('readwrite', (s) => s.delete(k)); }
  async keys(prefix: string) { return ((await this.tx('readonly', (s) => s.getAllKeys())) as string[]).filter((k) => String(k).startsWith(prefix)); }
}

/** IndexedDB if it works (private mode / old browsers can fail), otherwise memory so the game still runs. */
export async function openStore(): Promise<KvStore> {
  try {
    if (typeof indexedDB === 'undefined') throw new Error('no idb');
    const kv = new IdbKv();
    await kv.set('__probe', 1); await kv.del('__probe');
    return kv;
  } catch { return new MemoryKv(); }
}
