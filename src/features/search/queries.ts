"use client";

import { STALE } from "@/lib/query-cache";
import { useQuery } from "@/lib/use-query";
import { searchKey, searchMarketplace, type SearchPricing } from "./api";

/** Results for a (debounced) search; nothing is asked for under two characters. */
export function useSearchResults(query: string, pricing: SearchPricing, minimumRating: number) {
  const text = query.trim();
  return useQuery(
    text.length >= 2 ? searchKey(text, pricing, minimumRating) : null,
    () => searchMarketplace(text, pricing, minimumRating),
    { staleTime: STALE.short },
  );
}
