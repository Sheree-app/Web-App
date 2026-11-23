"use client";

import { fetchAccount } from "@/features/auth/api";
import { fetchSavedFeed } from "@/features/feed/api";
import { fetchCustomerReviews } from "@/features/reviews/api";
import { STALE } from "@/lib/query-cache";
import { useQuery, type QueryResult } from "@/lib/use-query";
import { useAuth } from "@/providers/auth-provider";
import { ACCOUNT_DETAILS_KEY, ACCOUNT_TTL, accountQueryKey, loadAccountProfile } from "./api";
import { fetchWorkedWithProfessionals } from "./beauticians";

/**
 * While the session is still being restored there is no user yet, so a
 * per-user query has no key and reads as "not loading, no data". Screens
 * would flash their empty or error state; this keeps them on their skeleton.
 */
export function useAuthGated<T>(query: QueryResult<T>): QueryResult<T> {
  const { loading } = useAuth();
  if (!loading || query.data !== undefined || query.error) return query;
  return { ...query, isLoading: true };
}

/** The signed-in person's profile, as the Me and settings pages show it. */
export function useAccountProfile(role: "customer" | "professional") {
  const { user } = useAuth();
  const email = user?.email ?? "";
  return useQuery(user ? accountQueryKey(role) : null, () => loadAccountProfile(role, email), {
    staleTime: ACCOUNT_TTL,
  });
}

/** `GET /v1/me` as it comes: username, phone, the professional-account wish. */
export function useAccountDetails() {
  const { user } = useAuth();
  return useAuthGated(useQuery(user ? ACCOUNT_DETAILS_KEY : null, fetchAccount, { staleTime: ACCOUNT_TTL }));
}

/** Everyone she's had a completed appointment with (changes only when a booking completes). */
export function useBeauticians() {
  const { user } = useAuth();
  return useQuery(user ? "me:beauticians" : null, fetchWorkedWithProfessionals, { staleTime: STALE.long });
}

const SAVED_PAGE = 50;

/** The first page of saved posts, for the Saved count. */
export function useSavedCount() {
  const { user } = useAuth();
  return useQuery(user ? "me:saved:count" : null, () => fetchSavedFeed(null, SAVED_PAGE), {
    staleTime: STALE.medium,
  });
}

/** Her reviews, for the Reviews count. */
export function useMyReviews() {
  const { user } = useAuth();
  return useQuery(user ? "me:reviews" : null, fetchCustomerReviews, { staleTime: STALE.medium });
}
