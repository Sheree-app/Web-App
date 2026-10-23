import { supabase } from "@/lib/supabase/client";

/**
 * Founding Beautician badge store, ported from the mobile `badges/store`.
 *
 * Founding status is server-authoritative — `professional_profiles
 * .is_founding_beautician` is the fast boolean every surface reads, and
 * `get_founding_badges` is the richer lookup used when only an id is known.
 * Nothing here computes eligibility.
 *
 * The store:
 *  - accepts profile ids and deduplicates them,
 *  - batches lookups in chunks of 100,
 *  - caches results for five minutes,
 *  - shares one request between concurrent callers,
 *  - notifies subscribers as results arrive,
 *  - fails open (no badge) when the RPC fails, without caching the failure so a
 *    later attempt can still succeed.
 */

export type FoundingBadgeData = {
  professionalId: string;
  isFounding: boolean;
  position: number | null;
  categories: string[];
  awardedAt: string | null;
};

type CacheEntry<T> = { value: T; expiresAt: number };

type Waiter = { resolve: (value: FoundingBadgeData | null) => void };

type FoundingBadgeRow = {
  professional_id: string;
  is_founding: boolean | null;
  founding_position: number | null;
  founding_categories: string[] | null;
  awarded_at: string | null;
};

export const FOUNDING_CACHE_TTL_MS = 5 * 60 * 1000;
export const FOUNDING_BATCH_SIZE = 100;

const badgeCache = new Map<string, CacheEntry<FoundingBadgeData | null>>();
const userBadgeCache = new Map<string, CacheEntry<FoundingBadgeData | null>>();
const userProfileCache = new Map<string, CacheEntry<string | null>>();

const queue = new Map<string, Waiter[]>();
const userProfileRequests = new Map<string, Promise<string | null>>();
const listeners = new Set<() => void>();

let flushScheduled = false;

function readEntry<T>(cache: Map<string, CacheEntry<T>>, key: string): T | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

function writeEntry<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T) {
  cache.set(key, { value, expiresAt: Date.now() + FOUNDING_CACHE_TTL_MS });
  return value;
}

function notify() {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* a broken subscriber must not break the others */
    }
  }
}

function mapRow(row: FoundingBadgeRow): FoundingBadgeData {
  return {
    professionalId: row.professional_id,
    isFounding: Boolean(row.is_founding),
    position: row.founding_position == null ? null : Number(row.founding_position),
    categories: Array.isArray(row.founding_categories) ? row.founding_categories : [],
    awardedAt: row.awarded_at ?? null,
  };
}

/** Calls the RPC for one chunk and resolves every waiter in it. */
async function fetchChunk(ids: string[]) {
  const waiters = ids.map((id) => ({ id, list: queue.get(id) ?? [] }));
  for (const id of ids) queue.delete(id);

  let rows: FoundingBadgeRow[] = [];
  try {
    const { data, error } = await supabase.rpc(
      "get_founding_badges" as never,
      { profile_ids: ids } as never,
    );
    if (error) throw error;
    rows = (data ?? []) as FoundingBadgeRow[];
  } catch {
    // Fail open: show no badge, and do not cache the failure so the next
    // attempt can retry once the network recovers.
    for (const { list } of waiters) for (const waiter of list) waiter.resolve(null);
    return;
  }

  const byId = new Map<string, FoundingBadgeData>();
  for (const row of rows) {
    if (!row?.professional_id) continue;
    byId.set(row.professional_id, mapRow(row));
  }

  for (const { id, list } of waiters) {
    const value = byId.get(id) ?? null;
    writeEntry(badgeCache, id, value);
    for (const waiter of list) waiter.resolve(value);
  }

  notify();
}

async function flushQueue() {
  const ids = [...queue.keys()];
  if (!ids.length) return;

  for (let start = 0; start < ids.length; start += FOUNDING_BATCH_SIZE) {
    await fetchChunk(ids.slice(start, start + FOUNDING_BATCH_SIZE));
  }
}

function scheduleFlush() {
  if (flushScheduled) return;
  flushScheduled = true;
  queueMicrotask(() => {
    flushScheduled = false;
    void flushQueue();
  });
}

function enqueue(professionalId: string): Promise<FoundingBadgeData | null> {
  return new Promise((resolve) => {
    const waiters = queue.get(professionalId) ?? [];
    waiters.push({ resolve });
    queue.set(professionalId, waiters);
    scheduleFlush();
  });
}

/** Cached badge for a profile id. `undefined` means "not resolved yet". */
export function getCachedFoundingBadge(
  professionalId: string | null | undefined,
): FoundingBadgeData | null | undefined {
  if (!professionalId) return undefined;
  return readEntry(badgeCache, professionalId);
}

/** Cached badge for a Sheree user id. */
export function getCachedFoundingBadgeForUser(
  userId: string | null | undefined,
): FoundingBadgeData | null | undefined {
  if (!userId) return undefined;
  return readEntry(userBadgeCache, userId);
}

/** Resolves a badge for one profile id (batched with any other callers). */
export function requestFoundingBadge(
  professionalId: string | null | undefined,
): Promise<FoundingBadgeData | null> {
  const id = professionalId?.trim();
  if (!id) return Promise.resolve(null);

  const cached = readEntry(badgeCache, id);
  if (cached !== undefined) return Promise.resolve(cached);

  return enqueue(id);
}

/** Resolves a badge for many profile ids at once, returning a lookup map. */
export async function requestFoundingBadges(
  professionalIds: Array<string | null | undefined>,
): Promise<Map<string, FoundingBadgeData | null>> {
  const unique = [...new Set(professionalIds.filter((id): id is string => Boolean(id)))];
  const results = await Promise.all(unique.map((id) => requestFoundingBadge(id)));
  return new Map(unique.map((id, index) => [id, results[index]]));
}

/** Looks a professional profile up by Sheree user id, cached for five minutes. */
async function profileIdForUser(userId: string): Promise<string | null> {
  const cached = readEntry(userProfileCache, userId);
  if (cached !== undefined) return cached;

  const pending = userProfileRequests.get(userId);
  if (pending) return pending;

  const request = (async () => {
    try {
      const { data, error } = await supabase
        .from("professional_profiles")
        .select("id")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw error;
      return writeEntry(userProfileCache, userId, data?.id ?? null);
    } catch {
      // Fail open without poisoning the cache.
      return null;
    }
  })().finally(() => userProfileRequests.delete(userId));

  userProfileRequests.set(userId, request);
  return request;
}

/**
 * Messaging only knows Sheree user ids. Resolve the professional profile, then
 * the badge — cached under both the user id and the profile id.
 */
export async function requestFoundingBadgeForUser(
  userId: string | null | undefined,
): Promise<FoundingBadgeData | null> {
  const id = userId?.trim();
  if (!id) return null;

  const cached = readEntry(userBadgeCache, id);
  if (cached !== undefined) return Promise.resolve(cached);

  const profileId = await profileIdForUser(id);
  if (!profileId) return null;

  const badge = await requestFoundingBadge(profileId);
  writeEntry(userBadgeCache, id, badge);
  return badge;
}

/** Subscribes to badge arrivals. Returns an unsubscribe function. */
export function subscribeFoundingBadges(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Drops cached badges (used after a professional completes onboarding). */
export function invalidateFoundingBadges(professionalIds?: string[]) {
  if (!professionalIds) {
    badgeCache.clear();
    userBadgeCache.clear();
    userProfileCache.clear();
    notify();
    return;
  }
  for (const id of professionalIds) {
    badgeCache.delete(id);
    userBadgeCache.delete(id);
  }
  notify();
}

/** Test helper: clears every cache, pending queue and subscriber. */
export function __resetFoundingBadgeStore() {
  badgeCache.clear();
  userBadgeCache.clear();
  userProfileCache.clear();
  queue.clear();
  userProfileRequests.clear();
  listeners.clear();
  flushScheduled = false;
}
