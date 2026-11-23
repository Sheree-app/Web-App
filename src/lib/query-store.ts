/**
 * The web app's data cache: stale-while-revalidate, de-duplicated, persisted.
 *
 * - Every entry has a value and a time after which it is *stale*. Stale values
 *   are still shown (that is what makes navigation instant); a stale entry is
 *   simply refetched in the background the next time something reads it.
 * - Concurrent reads of the same key share one request.
 * - Entries survive a reload: the store is written to localStorage (debounced)
 *   for the signed-in person and read back synchronously on start, so the
 *   first paint after a reload already has data. Persisted values come back
 *   stale, so they are refreshed as soon as a page uses them.
 * - Subscribers (the `useQuery` hook) are told about every change, so an edit
 *   that updates or invalidates a key updates every place it is shown.
 *
 * This file is framework-free so it can be tested in Node; `query-cache.ts`
 * wires the singleton to the browser and the session, and `use-query.ts` is
 * the React side.
 */

export type Entry<T = unknown> = {
  value: T | undefined;
  /** When the value was fetched (ms). 0 = never. */
  updatedAt: number;
  /** After this the value is stale: still shown, refetched on next use. */
  staleAt: number;
  error: unknown;
  fetching: boolean;
};

export type KeyValueStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export type QueryStoreOptions = {
  now?: () => number;
  /** Where to persist; null = memory only. */
  storage?: KeyValueStorage | null;
  storageKey?: string;
  /** Persisted entries older than this are dropped on load. Default 7 days. */
  maxAgeMs?: number;
  /** At most this many entries are persisted (newest first). Default 250. */
  maxPersisted?: number;
  /** Roughly this many characters at most in storage. Default 1.5M. */
  maxPersistedChars?: number;
  /** Debounce for writes to storage. Default 400 ms; 0 = write at once. */
  persistDelayMs?: number;
  /** Keys that must never be written to storage. */
  shouldPersist?: (key: string) => boolean;
};

type Persisted = {
  v: 1;
  scope: string | null;
  entries: Array<[key: string, value: unknown, updatedAt: number]>;
};

const DAY = 24 * 60 * 60 * 1000;

export type QueryStore = ReturnType<typeof createQueryStore>;

export function createQueryStore(options: QueryStoreOptions = {}) {
  const now = options.now ?? Date.now;
  const storage = options.storage ?? null;
  const storageKey = options.storageKey ?? "sheree:query-cache:v1";
  const maxAgeMs = options.maxAgeMs ?? 7 * DAY;
  const maxPersisted = options.maxPersisted ?? 250;
  const maxPersistedChars = options.maxPersistedChars ?? 1_500_000;
  const persistDelayMs = options.persistDelayMs ?? 400;
  const shouldPersist = options.shouldPersist ?? (() => true);

  const entries = new Map<string, Entry>();
  const inflight = new Map<string, Promise<unknown>>();
  const listeners = new Map<string, Set<() => void>>();
  const invalidateListeners = new Set<(keys: string[]) => void>();
  /** Whose data this is; persisted data from another scope is never loaded. */
  let scope: string | null = null;
  /** Bumped by `clear`, so a request that started before it can't write back. */
  let epoch = 0;
  let persistTimer: ReturnType<typeof setTimeout> | null = null;

  const notify = (key: string) => {
    for (const listener of listeners.get(key) ?? []) listener();
  };

  /** Entries are replaced, never mutated, so React can compare snapshots by identity. */
  const put = (key: string, next: Entry) => {
    entries.set(key, next);
    notify(key);
  };

  const blank = (): Entry => ({ value: undefined, updatedAt: 0, staleAt: 0, error: undefined, fetching: false });

  function get<T>(key: string): Entry<T> | undefined {
    return entries.get(key) as Entry<T> | undefined;
  }

  const isFresh = (entry: Entry | undefined) =>
    Boolean(entry && entry.updatedAt > 0 && entry.staleAt > now());

  function set<T>(key: string, value: T, ttlMs: number) {
    const at = now();
    put(key, { value, updatedAt: at, staleAt: at + ttlMs, error: undefined, fetching: inflight.has(key) });
    schedulePersist();
    return value;
  }

  function update<T>(key: string, change: (value: T) => T) {
    const entry = get<T>(key);
    if (!entry || entry.value === undefined) return;
    put(key, { ...entry, value: change(entry.value) });
    schedulePersist();
  }

  /**
   * Fetches `key` unless a fresh value exists (or `force`). Shares a running
   * request. Resolves to the new value; rejects with the fetch error (the old
   * value, if any, stays in the store).
   */
  function fetch<T>(key: string, ttlMs: number, fetcher: () => Promise<T>, opts: { force?: boolean } = {}): Promise<T> {
    const entry = get<T>(key);
    if (!opts.force && isFresh(entry)) return Promise.resolve(entry!.value as T);
    const running = inflight.get(key) as Promise<T> | undefined;
    if (running) return running;
    const startedEpoch = epoch;
    put(key, { ...(entry ?? blank()), fetching: true });
    const request = (async () => {
      try {
        const value = await fetcher();
        if (startedEpoch === epoch) set(key, value, ttlMs);
        return value;
      } catch (error) {
        if (startedEpoch === epoch) {
          const current = get(key) ?? blank();
          put(key, { ...current, error, fetching: false });
        }
        throw error;
      } finally {
        inflight.delete(key);
        const current = get(key);
        if (current?.fetching && startedEpoch === epoch) put(key, { ...current, fetching: false });
      }
    })();
    inflight.set(key, request);
    return request;
  }

  /** Marks matching entries stale (they keep showing) and tells subscribers. */
  function invalidate(match: (key: string) => boolean) {
    const hit: string[] = [];
    for (const [key, entry] of entries) {
      if (!match(key)) continue;
      hit.push(key);
      put(key, { ...entry, staleAt: 0 });
    }
    schedulePersist();
    if (hit.length > 0) for (const listener of invalidateListeners) listener(hit);
  }

  /** Drops matching entries entirely. */
  function remove(match: (key: string) => boolean) {
    for (const key of [...entries.keys()]) {
      if (!match(key)) continue;
      entries.delete(key);
      notify(key);
    }
    schedulePersist();
  }

  /** Forgets everything, in memory and in storage (sign-out, account switch). */
  function clear(nextScope: string | null = null) {
    epoch += 1;
    scope = nextScope;
    inflight.clear();
    const keys = [...entries.keys()];
    entries.clear();
    for (const key of keys) notify(key);
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = null;
    try {
      storage?.removeItem(storageKey);
    } catch {
      /* storage blocked: nothing to remove */
    }
  }

  function subscribe(key: string, listener: () => void) {
    let set = listeners.get(key);
    if (!set) listeners.set(key, (set = new Set()));
    set.add(listener);
    return () => {
      set!.delete(listener);
      if (set!.size === 0) listeners.delete(key);
    };
  }

  /** Told which keys an `invalidate` hit (so on-screen ones can refetch). */
  function onInvalidate(listener: (keys: string[]) => void) {
    invalidateListeners.add(listener);
    return () => {
      invalidateListeners.delete(listener);
    };
  }

  function snapshot(): Persisted {
    const rows: Persisted["entries"] = [];
    for (const [key, entry] of entries) {
      if (entry.value === undefined || entry.updatedAt === 0 || !shouldPersist(key)) continue;
      rows.push([key, entry.value, entry.updatedAt]);
    }
    rows.sort((a, b) => b[2] - a[2]);
    return { v: 1, scope, entries: rows.slice(0, maxPersisted) };
  }

  function persistNow() {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = null;
    if (!storage) return;
    const data = snapshot();
    try {
      let text = JSON.stringify(data);
      // Too big: drop the oldest half until it fits (rare; feeds are the bulk).
      while (text.length > maxPersistedChars && data.entries.length > 0) {
        data.entries = data.entries.slice(0, Math.floor(data.entries.length / 2));
        text = JSON.stringify(data);
      }
      storage.setItem(storageKey, text);
    } catch {
      // Quota or private mode: the cache still works in memory.
    }
  }

  function schedulePersist() {
    if (!storage) return;
    if (persistDelayMs === 0) {
      persistNow();
      return;
    }
    if (persistTimer) return;
    persistTimer = setTimeout(persistNow, persistDelayMs);
  }

  /**
   * Reads storage for `forScope`. Entries come back stale, so whatever uses
   * them refetches in the background. Data saved for anyone else is dropped.
   */
  function restore(forScope: string | null) {
    scope = forScope;
    if (!storage) return;
    let data: Persisted | null = null;
    try {
      const raw = storage.getItem(storageKey);
      data = raw ? (JSON.parse(raw) as Persisted) : null;
    } catch {
      data = null;
    }
    if (!data || data.v !== 1 || !Array.isArray(data.entries)) return;
    if (data.scope !== forScope) {
      try {
        storage.removeItem(storageKey);
      } catch {
        /* ignore */
      }
      return;
    }
    const oldest = now() - maxAgeMs;
    for (const [key, value, updatedAt] of data.entries) {
      if (typeof key !== "string" || typeof updatedAt !== "number" || updatedAt < oldest) continue;
      if (entries.has(key)) continue;
      entries.set(key, { value, updatedAt, staleAt: 0, error: undefined, fetching: false });
    }
  }

  return {
    get,
    isFresh: (key: string) => isFresh(entries.get(key)),
    set,
    update,
    fetch,
    invalidate,
    remove,
    clear,
    subscribe,
    onInvalidate,
    restore,
    persistNow,
    scope: () => scope,
    keys: () => [...entries.keys()],
  };
}
