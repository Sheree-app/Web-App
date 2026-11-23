import { api } from "@/lib/api";
import { SESSION_STORAGE_KEY } from "@/lib/api/browser-token-store";
import { createQueryStore, type KeyValueStorage } from "./query-store";

/**
 * The app-wide data cache (see `query-store.ts` for how it behaves). Feature
 * `api.ts` modules read and invalidate it through the helpers below; pages
 * read it through `useQuery` (`@/lib/use-query`).
 *
 * It belongs to whoever is signed in: on start it restores what that person's
 * last visit cached (instant first paint after a reload), and it is wiped on
 * sign-out or when another account signs in, in this tab or another.
 */

const browserStorage: KeyValueStorage | null = (() => {
  if (typeof window === "undefined") return null;
  try {
    const probe = "sheree:query-cache:probe";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
})();

/** Things that must never sit in storage: money details and one-off flows. */
const NEVER_PERSIST = [/^payout/, /^checkout/, /^booking-flow/];

export const queryStore = createQueryStore({
  storage: browserStorage,
  shouldPersist: (key) => !NEVER_PERSIST.some((pattern) => pattern.test(key)),
});

/** The signed-in user id from the API client's storage, read synchronously. */
function storedUserId(): string | null {
  if (!browserStorage) return null;
  try {
    const raw = browserStorage.getItem(SESSION_STORAGE_KEY);
    const id = raw ? (JSON.parse(raw) as { user?: { id?: unknown } }).user?.id : null;
    return typeof id === "string" ? id : null;
  } catch {
    return null;
  }
}

if (typeof window !== "undefined") {
  // Restored before any component renders, so the first client render after
  // hydration already has the last visit's data.
  queryStore.restore(storedUserId());
  api.session.subscribe((user) => {
    const next = user?.id ?? null;
    if (next !== queryStore.scope()) queryStore.clear(next);
  });
  // Don't lose the last few changes when the tab closes or is hidden.
  window.addEventListener("pagehide", () => queryStore.persistNow());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") queryStore.persistNow();
  });
}

/** Common freshness windows. Stale data still shows; it's refetched behind it. */
export const STALE = {
  /** Feeds, counts, notifications: change often. */
  short: 30_000,
  /** Profiles, lists of your own things. */
  medium: 5 * 60_000,
  /** Catalogue data: categories, service fee. */
  long: 30 * 60_000,
} as const;

// ---- The original helpers, kept for the feature modules -------------------

/** A fresh value, or undefined when missing or stale. */
export function getCached<T>(key: string): T | undefined {
  return queryStore.isFresh(key) ? queryStore.get<T>(key)?.value : undefined;
}

/** The value even if stale (for an instant paint while it refreshes). */
export function peekCached<T>(key: string): T | undefined {
  return queryStore.get<T>(key)?.value;
}

export function setCached<T>(key: string, value: T, ttlMs: number) {
  return queryStore.set(key, value, ttlMs);
}

/** Returns a fresh cached value or fetches (sharing any running request). */
export function cachedQuery<T>(
  key: string,
  ttlMs: number,
  query: () => Promise<T>,
  options?: { force?: boolean },
): Promise<T> {
  return queryStore.fetch(key, ttlMs, query, options);
}

export function updateCached<T>(key: string, update: (value: T) => T) {
  queryStore.update(key, update);
}

/** Marks `key` stale: it keeps showing and is refetched wherever it is used. */
export function invalidateCached(key: string) {
  queryStore.invalidate((k) => k === key);
}

/** Marks every key starting with `prefix` stale (e.g. all feed pages). */
export function invalidateCachedPrefix(prefix: string) {
  queryStore.invalidate((k) => k.startsWith(prefix));
}

/** Drops `key` entirely (the thing it described no longer exists). */
export function removeCached(key: string) {
  queryStore.remove((k) => k === key);
}
