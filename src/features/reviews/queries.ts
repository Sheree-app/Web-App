"use client";

import { STALE } from "@/lib/query-cache";
import { useQuery } from "@/lib/use-query";
import { useAuth } from "@/providers/auth-provider";
import { fetchCustomerReviews, MY_REVIEWS_KEY } from "./api";

/** Her reviews (the same entry the Me page counts). */
export function useCustomerReviews() {
  const { user } = useAuth();
  return useQuery(user ? MY_REVIEWS_KEY : null, fetchCustomerReviews, { staleTime: STALE.medium });
}
