"use client";

import { useAuthGated } from "@/features/account/queries";
import { useQuery } from "@/lib/use-query";
import { useAuth } from "@/providers/auth-provider";
import { fetchLook, fetchLookPrompts, fetchLooks, lookKey, LOOKS_KEY, LOOKS_TTL_MS, PROMPTS_KEY } from "./api";

/** The first page of her looks (the Me card, the profile count, the grid's first page). */
export function useLooksFirstPage() {
  const { user } = useAuth();
  return useAuthGated(useQuery(user ? LOOKS_KEY : null, () => fetchLooks(), { staleTime: LOOKS_TTL_MS }));
}

/** Recent bookings still waiting for a photo. */
export function useLookPrompts() {
  const { user } = useAuth();
  return useAuthGated(useQuery(user ? PROMPTS_KEY : null, fetchLookPrompts, { staleTime: LOOKS_TTL_MS }));
}

/** One look. */
export function useLook(id: string | null) {
  const { user } = useAuth();
  return useAuthGated(useQuery(user && id ? lookKey(id) : null, () => fetchLook(id!), { staleTime: LOOKS_TTL_MS }));
}
