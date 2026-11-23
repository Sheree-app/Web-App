"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { queryStore, STALE } from "./query-cache";
import type { Entry } from "./query-store";

export type QueryOptions = {
  /** How long a value counts as fresh. Default `STALE.medium` (5 min). */
  staleTime?: number;
  /** false = don't fetch (e.g. waiting for a user id). A null key does the same. */
  enabled?: boolean;
  /** Refetch stale data when the tab regains focus or the network returns. Default true. */
  refetchOnFocus?: boolean;
};

export type QueryResult<T> = {
  /** The cached value, shown even while it refreshes. */
  data: T | undefined;
  /** The last fetch failed (data, if any, is the previous value). */
  error: unknown;
  /** Nothing to show yet: first load with an empty cache. */
  isLoading: boolean;
  /** A request is running (first load or background refresh). */
  isFetching: boolean;
  /** Fetches now, ignoring freshness. Resolves when done; never throws. */
  refetch: () => Promise<void>;
};

type Mounted = { staleTime: number; fetcher: () => Promise<unknown>; refetchOnFocus: boolean; count: number };

/** Keys some mounted component is showing, so focus and invalidation can refresh them. */
const mounted = new Map<string, Mounted>();

const revalidate = (key: string, force = false) => {
  const source = mounted.get(key);
  if (!source) return;
  if (!force && queryStore.isFresh(key)) return;
  void queryStore.fetch(key, source.staleTime, source.fetcher, { force }).catch(() => undefined);
};

if (typeof window !== "undefined") {
  const refreshVisible = () => {
    for (const [key, source] of mounted) if (source.refetchOnFocus) revalidate(key);
  };
  window.addEventListener("focus", refreshVisible);
  window.addEventListener("online", refreshVisible);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshVisible();
  });
  // An invalidation marks a key stale; refetch it right away if it's on screen.
  queryStore.onInvalidate((keys) => {
    for (const key of keys) revalidate(key, true);
  });
}

const noopSubscribe = () => () => {};
const serverSnapshot = () => undefined;

/**
 * Reads `key` from the app cache and keeps it fresh: cached data (even stale,
 * even from the last visit) renders at once, and a request runs only when the
 * data is missing or stale. Every component showing the same key shares one
 * request and one value, and edits that update or invalidate the key re-render
 * them all.
 *
 * Keys name the data, not the page: `me:account`, `pro:<id>`, `feed:<seed>`.
 * The cache is per signed-in person, so keys don't need the user id.
 */
export function useQuery<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  { staleTime = STALE.medium, enabled = true, refetchOnFocus = true }: QueryOptions = {},
): QueryResult<T> {
  const active = Boolean(key) && enabled;
  const fetcherRef = useRef(fetcher);
  // Declared before the effects below, so they always see the latest fetcher.
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  const subscribe = useCallback(
    (onChange: () => void) => (key ? queryStore.subscribe(key, onChange) : () => {}),
    [key],
  );
  const getSnapshot = useCallback(() => (key ? queryStore.get<T>(key) : undefined), [key]);
  // The server render (and hydration) never sees the browser cache; React
  // re-renders with it straight after hydrating, so there is no mismatch.
  const entry = useSyncExternalStore(key ? subscribe : noopSubscribe, getSnapshot, serverSnapshot) as
    | Entry<T>
    | undefined;

  // Register while mounted, and fetch if there's nothing fresh.
  useEffect(() => {
    if (!active || !key) return;
    let source = mounted.get(key);
    if (!source) {
      source = { staleTime, refetchOnFocus, fetcher: () => fetcherRef.current(), count: 0 };
      mounted.set(key, source);
    }
    source.count += 1;
    // The newest mount's fetcher wins (it closes over the latest arguments).
    source.fetcher = () => fetcherRef.current();
    source.staleTime = staleTime;
    revalidate(key);
    const registered = source;
    return () => {
      registered.count -= 1;
      if (registered.count === 0 && mounted.get(key) === registered) mounted.delete(key);
    };
  }, [active, key, staleTime, refetchOnFocus]);

  const refetch = useCallback(async () => {
    if (!key) return;
    await queryStore
      .fetch(key, staleTime, () => fetcherRef.current(), { force: true })
      .then(
        () => undefined,
        () => undefined,
      );
  }, [key, staleTime]);

  const data = active ? entry?.value : undefined;
  return {
    data,
    error: active ? entry?.error : undefined,
    isLoading: active && data === undefined && !entry?.error,
    isFetching: Boolean(active && entry?.fetching),
    refetch,
  };
}

/** Writes a value under `key` (after a save that returned the new state). */
export const setQueryData = <T,>(key: string, value: T, staleTime: number = STALE.medium) =>
  queryStore.set(key, value, staleTime);

/** Changes a cached value in place (optimistic edits); no-op when not cached. */
export const updateQueryData = <T,>(key: string, change: (value: T) => T) => queryStore.update(key, change);

/** Marks keys stale; anything on screen refetches at once, the rest on next use. */
export const invalidateQueries = (prefix: string) => queryStore.invalidate((key) => key.startsWith(prefix));

/** Warms the cache ahead of a navigation (e.g. on hover). Errors are ignored. */
export const prefetchQuery = <T,>(key: string, fetcher: () => Promise<T>, staleTime: number = STALE.medium) => {
  void queryStore.fetch(key, staleTime, fetcher).catch(() => undefined);
};
