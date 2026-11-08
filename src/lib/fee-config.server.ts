import "server-only";

import { env, isSupabaseConfigured } from "@/lib/env";
import { FALLBACK_FEE_CONFIG, fetchFeeConfig, type FeeConfig } from "@/lib/pricing";
import { createClient } from "@supabase/supabase-js";
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
 * It used to be read with the cookie-bound Supabase client on every request.
 * Reading cookies in the root layout made every route dynamic and put a
 * database round trip in front of every page. The config is the same for
 * everyone (and readable by `anon`), so it's fetched without cookies and
 * cached here.
 */
export const getFeeConfig = unstable_cache(
  async (): Promise<FeeConfig> => {
    if (!isSupabaseConfigured) return FALLBACK_FEE_CONFIG;
    const client = createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    return fetchFeeConfig(client as unknown as Parameters<typeof fetchFeeConfig>[0]);
  },
  ["service-fee-config"],
  { revalidate: FEE_CONFIG_TTL_SECONDS, tags: ["service-fee-config"] },
);
