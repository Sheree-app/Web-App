"use client";

import { useAuthGated } from "@/features/account/queries";
import { useQuery } from "@/lib/use-query";
import { useAuth } from "@/providers/auth-provider";
import { fetchSpendMonth, spendKey, SPEND_TTL_MS } from "./api";

/** One month of spend (`YYYY-MM`). */
export function useSpendMonth(month: string | null) {
  const { user } = useAuth();
  return useAuthGated(
    useQuery(user && month ? spendKey(month) : null, () => fetchSpendMonth(month!), {
      staleTime: SPEND_TTL_MS,
    }),
  );
}
