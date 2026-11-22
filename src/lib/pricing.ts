export type FeeConfig = {
    service_fee_rate: number;
    service_fee_cap: number;
    currency: string;
};
// Emergency fallback explicitly required by the pricing policy.
export const FALLBACK_FEE_CONFIG: FeeConfig = { service_fee_rate: 0.05, service_fee_cap: 50, currency: "GHS" };
export const toPesewas = (v: number) => Number.isFinite(v) ? Math.sign(v) * Math.round((Math.abs(v) + Number.EPSILON) * 100) : 0;
export const toCedis = (v: number) => v / 100;
const round = (n: bigint, d: bigint) => Number((n * 2n + d) / (d * 2n));
export function financials(value: number, config: FeeConfig) {
    const price = Math.max(0, toPesewas(value));
    const rawFee = round(BigInt(price) * BigInt(Math.round(config.service_fee_rate * 1000000)), 1000000n);
    const fee = Math.min(rawFee, toPesewas(config.service_fee_cap));
    const deposit = round(BigInt(price) * 40n, 100n);
    return { price, fee, total: price + fee, deposit, dueNow: deposit + fee, balance: price - deposit, capped: rawFee >= toPesewas(config.service_fee_cap) && fee > 0 };
}
export function formatMoney(value: number | string | null | undefined, currency: string) {
    return new Intl.NumberFormat("en-GH", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(toCedis(toPesewas(Number(value ?? 0))));
}
export function bookingDueNow(b: {
    deposit_amount: number | string;
    sheree_fee_amount: number | string | null;
}) {
    return toPesewas(Number(b.deposit_amount)) + (b.sheree_fee_amount == null ? 0 : toPesewas(Number(b.sheree_fee_amount)));
}
export function feeLabel(c: FeeConfig, capped: boolean) {
    return `Sheree service fee (${Number((c.service_fee_rate * 100).toFixed(4))}%${capped ? `, capped at ${formatMoney(c.service_fee_cap, c.currency)}` : ""})`;
}
// Codes from the API client (`src/lib/api/errors.ts`), duck-typed so this file
// stays importable by the plain-node pricing tests.
const EXPECTED_FALLBACK_CODES = new Set(["network_error", "timeout", "api_not_configured"]);
function isExpectedFeeConfigFallback(error: unknown) {
    const candidate = error as { code?: unknown; message?: unknown } | null;
    const code = String(candidate?.code ?? "");
    const message = String(candidate?.message ?? "");
    return EXPECTED_FALLBACK_CODES.has(code) ||
        /failed to fetch|network error|network request failed|fetch failed/i.test(message);
}
/**
 * Loads and validates the fee config. `load` returns the body of
 * `GET /v1/service-fee` (`sheree-backend/docs/api/bookings.md`); the caller
 * picks the auth mode (the server has no session).
 */
export async function fetchFeeConfig(load: () => Promise<unknown>): Promise<FeeConfig> {
    try {
        const data = await load();
        const row = (Array.isArray(data) ? data[0] : data) as FeeConfig | null | undefined;
        if (!row || !Number.isFinite(Number(row.service_fee_rate)) || Number(row.service_fee_rate) < 0 || !Number.isFinite(Number(row.service_fee_cap)) || Number(row.service_fee_cap) < 0 || !row.currency)
            throw new Error("Invalid fee configuration");
        new Intl.NumberFormat("en", { style: "currency", currency: row.currency });
        return { service_fee_rate: Number(row.service_fee_rate), service_fee_cap: Number(row.service_fee_cap), currency: row.currency };
    }
    catch (error) {
        // Offline, or no API configured in this deployment: the fallback is the
        // policy of record, so don't turn that into a server console error on
        // every page render.
        if (!isExpectedFeeConfigFallback(error))
            console.error("Service fee config unavailable; using emergency fallback", error);
        return FALLBACK_FEE_CONFIG;
    }
}
