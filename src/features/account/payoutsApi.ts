import { supabase } from "@/lib/supabase";
import { fetchOwnProfessionalId } from "./api";
import {
    fetchPayoutAccount,
    type PayoutAccount,
} from "./payoutApi";

export type { PayoutAccount };

export type PayoutStatus =
  | "pending"
  | "processing"
  | "paid"
  | "failed"
  | "reversed";
export type PayoutType = "completion" | "customer_cancellation";
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
type RawPayout = {
  id: string;
  booking_id: string | null;
  amount: number | string;
  status: PayoutStatus;
  payout_type: PayoutType;
  deposit_amount: number | string | null;
  platform_fee: number | string | null;
  service_price: number | string | null;
  created_at: string;
  paid_at: string | null;
  failure_reason: string | null;
  bookings: { booking_reference: string; service_name: string } | null;
};
const numberOrNull = (value: number | string | null | undefined) =>
  value === null || value === undefined ? null : Number(value);

// Professionals may read their own payouts via RLS; the account details come
// from the payout-account edge function (the table itself is server-only).
export async function fetchPayouts(userId: string): Promise<PayoutsData> {
  const professionalId = await fetchOwnProfessionalId(userId);
  const [payoutResult, account] = await Promise.all([
    supabase
      .from("payouts" as never)
      .select(
        "id, booking_id, amount, status, payout_type, deposit_amount, platform_fee, service_price, created_at, paid_at, failure_reason, bookings(booking_reference, service_name)",
      )
      .eq("professional_id", professionalId)
      .order("created_at", { ascending: false }),
    fetchPayoutAccount().catch(() => null),
  ]);
  if (payoutResult.error) throw payoutResult.error;
  const rows = (payoutResult.data ?? []) as unknown as RawPayout[];
  const items: Payout[] = rows.map((row) => ({
    id: row.id,
    bookingReference: row.bookings?.booking_reference ?? null,
    serviceName: row.bookings?.service_name ?? null,
    status: row.status,
    amount: Number(row.amount),
    depositAmount: numberOrNull(row.deposit_amount),
    platformFee: numberOrNull(row.platform_fee),
    servicePrice: numberOrNull(row.service_price),
    payoutType: row.payout_type,
    createdAt: row.created_at,
    paidAt: row.paid_at,
    failureReason: row.failure_reason,
  }));
  const sum = (list: Payout[]) =>
    list.reduce((total, item) => total + item.amount, 0);
  const expected = items.filter(
    (item) => item.status === "pending" || item.status === "processing",
  );
  const received = items.filter((item) => item.status === "paid");
  const attention = items.filter(
    (item) => item.status === "failed" || item.status === "reversed",
  );
  return {
    summary: {
      expected: sum(expected),
      received: sum(received),
      attention: sum(attention),
      expectedCount: expected.length,
      receivedCount: received.length,
      attentionCount: attention.length,
      count: items.length,
    },
    items,
    account,
  };
}
