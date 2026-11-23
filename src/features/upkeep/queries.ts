"use client";

import { useAuthGated } from "@/features/account/queries";
import { api } from "@/lib/api";
import { useQuery } from "@/lib/use-query";
import { useAuth } from "@/providers/auth-provider";
import { UPKEEP_KEY, UPKEEP_TTL_MS, type UpkeepPlan } from "./api";

/** Her beauty calendar. */
export function useUpkeep() {
  const { user } = useAuth();
  // The raw read: `fetchUpkeep` also writes the cache, which the hook does itself.
  return useAuthGated(
    useQuery(user ? UPKEEP_KEY : null, () => api.get<UpkeepPlan>("/v1/me/upkeep"), {
      staleTime: UPKEEP_TTL_MS,
    }),
  );
}
