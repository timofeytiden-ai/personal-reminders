/**
 * Minimal key-value persistence on IndexedDB with a localStorage fallback.
 * Survives reloads and works offline; the cloud copy (Supabase) is optional.
 */

const DB_NAME = 'reminders-app';
const STORE = 'kv';

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function lsGet<T>(key: string): T | undefined {
  try {
    const v = localStorage.getItem('rem:' + key);
    return v ? (JSON.parse(v) as T) : undefined;
  } catch {
    return undefined;
  }
}

function lsSet(key: string, value: unknown) {
  try {
    if (value === undefined) localStorage.removeItem('rem:' + key);
    else localStorage.setItem('rem:' + key, JSON.stringify(value));
  } catch {
    /* quota or private mode */
  }
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  if (!db) return lsGet<T>(key);
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result === undefined ? lsGet<T>(key) : (req.result as T));
      req.onerror = () => resolve(lsGet<T>(key));
    } catch {
      resolve(lsGet<T>(key));
    }
  });
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  if (!db) return lsSet(key, value);
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      if (value === undefined) tx.objectStore(STORE).delete(key);
      else tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => {
        lsSet(key, value);
        resolve();
      };
    } catch {
      lsSet(key, value);
      resolve();
    }
  });
}

/** Debounced writer so rapid mutations produce one write. */
const pending = new Map<string, unknown>();
let timer: ReturnType<typeof setTimeout> | null = null;

export function kvSetSoon(key: string, value: unknown) {
  pending.set(key, value);
  if (timer) return;
  timer = setTimeout(flushPending, 60);
}

export async function flushPending() {
  if (timer) clearTimeout(timer);
  timer = null;
  const entries = [...pending.entries()];
  pending.clear();
  await Promise.all(entries.map(([k, v]) => kvSet(k, v)));
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => void flushPending());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushPending();
  });
}
