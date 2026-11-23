"use client";
import { createContext, useContext } from "react";
import { api } from "@/lib/api";
import { FALLBACK_FEE_CONFIG, fetchFeeConfig, financials, formatMoney, toCedis, type FeeConfig } from "@/lib/pricing";
import { STALE } from "@/lib/query-cache";
import { useQuery } from "@/lib/use-query";
/** Cache key for the service fee (public, rarely changes). */
export const SERVICE_FEE_KEY = "pub:service-fee";
/** `GET /v1/service-fee`. The emergency fallback is never cached: the last good value (or the server's) stays. */
async function loadFeeConfig(): Promise<FeeConfig> {
    const config = await fetchFeeConfig(() => api.get<unknown>("/v1/service-fee", { auth: "optional" }));
    if (config === FALLBACK_FEE_CONFIG)
        throw new Error("Service fee config unavailable");
    return config;
}
const Context = createContext<FeeConfig | null>(null);
export function PricingProvider({ initialConfig, children }: {
    initialConfig: FeeConfig;
    children: React.ReactNode;
}) {
    // The server rendered with `initialConfig`; the cached value (refreshed behind it, and on focus once stale) takes over after.
    const config = useQuery(SERVICE_FEE_KEY, loadFeeConfig, { staleTime: STALE.long }).data ?? initialConfig;
    return <Context.Provider value={config}>{children}</Context.Provider>;
}
export function usePricing() {
    const config = useContext(Context);
    if (!config)
        throw new Error("PricingProvider required");
    return { config, money: (v: number | string | null | undefined) => formatMoney(v, config.currency), financials: (price: number) => financials(price, config), customerPrice: (price: number) => formatMoney(toCedis(financials(price, config).total), config.currency) };
}
export function CustomerPrice({ value, prefix = "" }: {
    value: number;
    prefix?: string;
}) { const { customerPrice } = usePricing(); return <>{prefix}{customerPrice(value)}</>; }
