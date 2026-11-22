import { api } from "@/lib/api";
import { errorCode, withServerMessage } from "@/lib/errors";
export class PayoutAccountRequiredError extends Error {
  constructor() {
    super("Set up a payout account before completing this appointment.");
    this.name = "PayoutAccountRequiredError";
  }
}
export type StudioBooking = {
  id: string;
  bookingReference:string;
  customerName: string;
  customerAvatar: string | null;
  serviceName: string;
  startsAt: string;
  endsAt: string;
  status: "requested" | "confirmed";
  paymentStatus: "pending" | "paid" | "refund_pending" | "refunded";
  price: number;
  depositAmount: number;
};
export type ProfessionalDashboard = {
  name: string;
  businessName: string;
  avatarUrl: string | null;
  todayCount: number;
  upcomingCount: number;
  pendingCount: number;
  monthRevenue: number;
  today: StudioBooking[];
  nextBooking: StudioBooking | null;
};
type RawBooking = {
  id: string;
  booking_reference:string;
  customer_name: string;
  customer_avatar: string | null;
  service_name: string;
  starts_at: string;
  ends_at: string;
  status: "requested" | "confirmed";
  payment_status: StudioBooking["paymentStatus"];
  price: number | string;
  deposit_amount: number | string;
};
type Raw = {
  profile: { name: string; business_name: string; avatar_url: string | null };
  today_count: number;
  upcoming_count: number;
  pending_count: number;
  month_revenue: number | string;
  today: RawBooking[];
  next_booking: RawBooking | null;
};
const booking = (row: RawBooking): StudioBooking => ({
  id: row.id,
  bookingReference:row.booking_reference,
  customerName: row.customer_name,
  customerAvatar: row.customer_avatar,
  serviceName: row.service_name,
  startsAt: row.starts_at,
  endsAt: row.ends_at,
  status: row.status,
  paymentStatus: row.payment_status,
  price: Number(row.price),
  depositAmount: Number(row.deposit_amount),
});
/**
 * A professional's action on a booking on their business. Refusals
 * (`cannot_confirm`, `not_started`, `deposit_unpaid`, ...) keep their
 * user-facing messages; a cancellation retries a failed or stuck refund.
 */
export async function manageBooking(
  bookingId: string,
  action: "confirm" | "complete" | "cancel",
  reason?: string,
) {
  try {
    return await api.post<{ status: string; refund: string | null; payout?: string | null; refundAmount?: number; professionalCompensation?: number; shereeFeeRefunded?: number; warning?: string; supportCode?: string }>(
      `/v1/me/professional/bookings/${encodeURIComponent(bookingId)}/${action}`,
      action === "cancel" ? { body: reason ? { reason } : {} } : {},
    );
  } catch (error) {
    // The API records the payout as processing even without an account today;
    // kept so the studio's payout-setup prompt still works if that changes.
    if (action === "complete" && errorCode(error) === "payout_account_missing") throw new PayoutAccountRequiredError();
    throw withServerMessage(error);
  }
}
export async function fetchProfessionalDashboard(): Promise<ProfessionalDashboard> {
  const raw = await api.get<Raw>("/v1/me/professional/dashboard");
  return {
    name: raw.profile.name,
    businessName: raw.profile.business_name,
    avatarUrl: raw.profile.avatar_url,
    todayCount: Number(raw.today_count),
    upcomingCount: Number(raw.upcoming_count),
    pendingCount: Number(raw.pending_count),
    monthRevenue: Number(raw.month_revenue),
    today: (raw.today ?? []).map(booking),
    nextBooking: raw.next_booking ? booking(raw.next_booking) : null,
  };
}
