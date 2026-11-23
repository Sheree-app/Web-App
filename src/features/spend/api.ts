import { api } from "@/lib/api";
import { UPKEEP_KEY } from "@/features/upkeep/api";
import { invalidateCached, invalidateCachedPrefix } from "@/lib/query-cache";

/** One thing she spent on: a paid Sheree booking or something she logged. */
export type SpendItem = {
  id: string;
  source: "booking" | "manual";
  category: string;
  category_name: string;
  title: string;
  amount: number;
  date: string; // YYYY-MM-DD (Accra day)
  professional_name: string | null;
  avatar_url: string | null;
  upcoming: boolean;
};

export type SpendCategoryTotal = {
  slug: string;
  name: string;
  amount: number;
  count: number;
};

export type SpendMonth = {
  month: string; // YYYY-MM
  currency: string;
  total: number;
  booked_total: number;
  logged_total: number;
  appointments: number;
  budget: number | null;
  previous_total: number;
  categories: SpendCategoryTotal[];
  trend: Array<{ month: string; total: number }>;
  entries: SpendItem[];
};

/**
 * Months are cached per person so the Me card and /spend agree, and dropped
 * whenever she adds, removes or budgets (the mobile app's `changesMe`).
 */
export const SPEND_PREFIX = "me:spend:";
const CACHE_PREFIX = SPEND_PREFIX;
const CACHE_TTL = 5 * 60_000;
/** Cache key for one month (per signed-in person). */
export const spendKey = (month: string) => `${CACHE_PREFIX}${month}`;
export const SPEND_TTL_MS = CACHE_TTL;

export const fetchSpendMonth = (month?: string) =>
  api.get<SpendMonth>("/v1/me/spend", { query: month ? { month } : undefined });

const changesSpend = async <T>(request: Promise<T>) => {
  const result = await request;
  invalidateCachedPrefix(CACHE_PREFIX);
  // A logged spend counts as "last done" on the beauty calendar.
  invalidateCached(UPKEEP_KEY);
  return result;
};

export const addSpendEntry = (input: {
  category: string;
  amount: number;
  spent_on: string;
  note: string | null;
}) => changesSpend(api.post<SpendItem>("/v1/me/spend/entries", { body: input }));

export const deleteSpendEntry = (id: string) =>
  changesSpend(api.delete<{ deleted: true }>(`/v1/me/spend/entries/${encodeURIComponent(id)}`));

export const setSpendBudget = (monthlyAmount: number | null) =>
  changesSpend(
    api.put<{ budget: number | null }>("/v1/me/spend/budget", {
      body: { monthly_amount: monthlyAmount },
    }),
  );
