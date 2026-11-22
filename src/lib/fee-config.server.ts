import "server-only";

import { api, isApiConfigured } from "@/lib/api";
import { FALLBACK_FEE_CONFIG, fetchFeeConfig, type FeeConfig } from "@/lib/pricing";
import { unstable_cache } from "next/cache";

/**
 * How long the server reuses the fee config. `PricingProvider` already
 * re-fetches it in the browser every 60 seconds and whenever the tab regains
 * focus, so this matches the freshness the app had already chosen.
 */
export const FEE_CONFIG_TTL_SECONDS = 60;

/**
 * The service fee config for the root layout, shared by every visitor.
 *
 * Reading cookies in the root layout would make every route dynamic, and the
 * config is the same for everyone (`GET /v1/service-fee` is public), so it's
 * fetched without a session and cached here.
 */
export const getFeeConfig = unstable_cache(
  async (): Promise<FeeConfig> => {
    if (!isApiConfigured) return FALLBACK_FEE_CONFIG;
    return fetchFeeConfig(() => api.get<unknown>("/v1/service-fee", { auth: "none" }));
  },
  ["service-fee-config"],
  { revalidate: FEE_CONFIG_TTL_SECONDS, tags: ["service-fee-config"] },
);
