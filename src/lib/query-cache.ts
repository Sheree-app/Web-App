/**
 * Tiny in-memory response cache, ported from the mobile app's
 * `src/lib/query-cache.ts`. It de-duplicates in-flight requests and keeps hot
 * results (explore rails, categories, professionals) between route changes
 * without pulling a data-fetching library into the bundle.
 */
type Entry<T> = { value: T; expiresAt: number };

const values = new Map<string, Entry<unknown>>();
const requests = new Map<string, Promise<unknown>>();

export function getCached<T>(key: string) {
  const entry = values.get(key) as Entry<T> | undefined;
  if (!entry || entry.expiresAt <= Date.now()) {
    values.delete(key);
    return undefined;
  }
  return entry.value;
}

export function setCached<T>(key: string, value: T, ttlMs: number) {
  values.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

export async function cachedQuery<T>(key: string, ttlMs: number, query: () => Promise<T>): Promise<T> {
  const cached = getCached<T>(key);
  if (cached !== undefined) return cached;
  const pending = requests.get(key) as Promise<T> | undefined;
  if (pending) return pending;
  const request = query()
    .then((value) => setCached(key, value, ttlMs))
    .finally(() => requests.delete(key));
  requests.set(key, request);
  return request;
}

export function updateCached<T>(key: string, update: (value: T) => T) {
  const entry = values.get(key) as Entry<T> | undefined;
  if (entry) entry.value = update(entry.value);
}

export function invalidateCached(key: string) {
  values.delete(key);
}

/** Drops every entry whose key starts with `prefix` (e.g. all feed pages). */
export function invalidateCachedPrefix(prefix: string) {
  for (const key of values.keys()) {
    if (key.startsWith(prefix)) values.delete(key);
  }
}
