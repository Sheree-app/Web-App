import { api } from "@/lib/api";
import { reportError } from "@/lib/errors";
import {
    fetchPayoutAccount,
    type PayoutAccount,
} from "./payoutApi";

export type { PayoutAccount };

/** Never persisted: keys starting with `payout` stay in memory (`@/lib/query-cache`). */
export const PAYOUTS_KEY = "payout:list";

export type PayoutStatus =
  | "pending"
  | "processing"
  | "paid"
  | "failed"
  | "reversed";
export type PayoutType = "completion" | "customer_cancellation";
/**
 * Which Sheree fee model the payout was booked under: `legacy` kept 10% of the
 * deposit; `customer_paid_fee` means the customer paid the fee on top and the
 * professional received the whole deposit.
 */
export type PayoutFeeModel = "legacy" | "customer_paid_fee";
export type Payout = {
  id: string;
  bookingReference: string | null;
  serviceName: string | null;
  status: PayoutStatus;
  amount: number;
  depositAmount: number | null;
  platformFee: number | null;
  servicePrice: number | null;
  payoutType: PayoutType;
  feeModel: PayoutFeeModel;
  createdAt: string;
  paidAt: string | null;
  failureReason: string | null;
};
export type PayoutSummary = {
  expected: number;
  received: number;
  attention: number;
  expectedCount: number;
  receivedCount: number;
  attentionCount: number;
  count: number;
};
export type PayoutsData = {
  summary: PayoutSummary;
  items: Payout[];
  account: PayoutAccount | null;
};
/** `GET /v1/me/payouts` (`sheree-backend/docs/api/payments.md`). */
type RawPayout = {
  id: string;
  booking_id: string | null;
  amount: number;
  status: PayoutStatus;
  payout_type: PayoutType;
  deposit_amount: number | null;
  platform_fee: number | null;
  service_price: number | null;
  fee_model: PayoutFeeModel | null;
  created_at: string;
  paid_at: string | null;
  failure_reason: string | null;
  booking_reference: string | null;
  service_name: string | null;
};
type RawSummary = {
  expected: number;
  received: number;
  attention: number;
  expected_count: number;
  received_count: number;
  attention_count: number;
  count: number;
};
const numberOrNull = (value: number | string | null | undefined) =>
  value === null || value === undefined ? null : Number(value);

// The API totals expected / received / needs-attention payouts itself; the
// account summary comes from the payout-account route and may fail on its own.
// `_userId` is kept for callers: the API reads the signed-in professional.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function fetchPayouts(_userId?: string): Promise<PayoutsData> {
  const [data, account] = await Promise.all([
    api.get<{ summary: RawSummary; items: RawPayout[] }>("/v1/me/payouts"),
    fetchPayoutAccount().catch((error) => {
      reportError(error, "payouts.account");
      return null;
    }),
  ]);
  const items: Payout[] = data.items.map((row) => ({
    id: row.id,
    bookingReference: row.booking_reference ?? null,
    serviceName: row.service_name ?? null,
    status: row.status,
    amount: Number(row.amount),
    depositAmount: numberOrNull(row.deposit_amount),
    platformFee: numberOrNull(row.platform_fee),
    servicePrice: numberOrNull(row.service_price),
    payoutType: row.payout_type,
    feeModel: row.fee_model ?? "legacy",
    createdAt: row.created_at,
    paidAt: row.paid_at,
    failureReason: row.failure_reason,
  }));
  const s = data.summary;
  return {
    summary: {
      expected: Number(s.expected),
      received: Number(s.received),
      attention: Number(s.attention),
      expectedCount: s.expected_count,
      receivedCount: s.received_count,
      attentionCount: s.attention_count,
      count: s.count,
    },
    items,
    account,
  };
}
