"use client";

import { STALE } from "@/lib/query-cache";
import { useQuery } from "@/lib/use-query";
import { useAuth } from "@/providers/auth-provider";
import {
  fetchPayoutAccount,
  fetchPayoutInstitutions,
  PAYOUT_ACCOUNT_KEY,
  PAYOUT_ACCOUNT_TTL,
  payoutInstitutionsKey,
  type PayoutMethod,
} from "./payoutApi";
import { fetchPayouts, PAYOUTS_KEY } from "./payoutsApi";

/** Her payout account summary (in memory only: `payout*` keys are never stored). */
export function usePayoutAccount() {
  const { user } = useAuth();
  return useQuery(user ? PAYOUT_ACCOUNT_KEY : null, fetchPayoutAccount, { staleTime: PAYOUT_ACCOUNT_TTL });
}

/** Her payouts with their totals (in memory only). */
export function usePayouts() {
  const { user } = useAuth();
  return useQuery(user ? PAYOUTS_KEY : null, () => fetchPayouts(), { staleTime: STALE.short });
}

/** Banks or mobile money networks for a payout method (in memory only). */
export function usePayoutInstitutions(method: PayoutMethod | null) {
  return useQuery(method ? payoutInstitutionsKey(method) : null, () => fetchPayoutInstitutions(method!), {
    staleTime: STALE.long,
  });
}
