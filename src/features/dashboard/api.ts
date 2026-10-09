import { supabase } from "@/lib/supabase";
import { FunctionsHttpError } from "@supabase/supabase-js";
export class PayoutAccountRequiredError extends Error {
  constructor() {
    super("Set up a payout account before completing this appointment.");
    this.name = "PayoutAccountRequiredError";
  }
}
async function bookingActionError(error: unknown, data: unknown) {
  if (data && typeof data === "object" && "error" in data)
    return String((data as { error: unknown }).error);
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.json();
      if (body && typeof body === "object" && "error" in body)
        return String((body as { error: unknown }).error);
    } catch {
      /* Fall through to the transport error when the response is not JSON. */
    }
  }
  return error instanceof Error
    ? error.message
    : "Appointment could not be updated";
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
export async function manageBooking(
  bookingId: string,
  action: "confirm" | "complete" | "cancel",
  reason?: string,
) {
  const { data, error } = await supabase.functions.invoke("booking-manage", {
    body: { bookingId, action, reason },
  });
  const message = error || data?.error
    ? await bookingActionError(error, data)
    : "";
  if (
    action === "complete" &&
    message === "Set up a payout account before completing this appointment."
  )
    throw new PayoutAccountRequiredError();
  if (error || data?.error)
    throw new Error(message);
  return data;
}
export async function fetchProfessionalDashboard(): Promise<ProfessionalDashboard> {
  const { data, error } = await supabase.rpc(
    "get_professional_dashboard" as never,
  );
  if (error) throw error;
  const raw = data as unknown as Raw;
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
