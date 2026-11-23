"use client";

import { STALE } from "@/lib/query-cache";
import { prefetchQuery, useQuery } from "@/lib/use-query";
import { creatorProfileKey, loadCreatorProfile } from "./api";

/** A professional's public profile, by handle or UUID. */
export function useCreatorProfile(key: string | null) {
  return useQuery(key ? creatorProfileKey(key) : null, () => loadCreatorProfile(key!), {
    staleTime: STALE.medium,
  });
}

/** Warms a profile before the tap lands (hover, focus, touchstart). */
export const prefetchCreatorProfile = (key: string) =>
  prefetchQuery(creatorProfileKey(key), () => loadCreatorProfile(key), STALE.medium);
