"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { fetchFeeConfig, financials, formatMoney, toCedis, type FeeConfig } from "@/lib/pricing";
const Context = createContext<FeeConfig | null>(null);
export function PricingProvider({ initialConfig, children }: {
    initialConfig: FeeConfig;
    children: React.ReactNode;
}) {
    const [config, setConfig] = useState(initialConfig);
    useEffect(() => { const refresh = () => { void fetchFeeConfig(supabase).then(setConfig); }; const timer = setInterval(refresh, 60000); window.addEventListener("focus", refresh); return () => { clearInterval(timer); window.removeEventListener("focus", refresh); }; }, []);
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
