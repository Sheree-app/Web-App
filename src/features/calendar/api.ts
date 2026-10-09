import { supabase } from "@/lib/supabase";
import { defaultSchedule, type Schedule } from "./data";
export type BookingRequest = {
  id: string;
  bookingReference:string;
  customerName: string;
  serviceName: string;
  startsAt: string;
  depositAmount: number;
  paymentStatus: "pending" | "paid" | "refund_pending" | "refunded";
};
export type CalendarAppointment = {
  id: string;
  bookingReference: string;
  serviceName: string;
  startsAt: string;
  endsAt: string;
  status: "requested" | "confirmed";
};
export async function fetchUpcomingAppointments(): Promise<
  CalendarAppointment[]
> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const { data: profile } = await supabase
    .from("professional_profiles")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile) return [];
  // `bookings` predates the generated Supabase client types in this project.
  const { data, error } = await (supabase as any)
    .from("bookings")
    .select("id,booking_reference,service_name,starts_at,ends_at,status")
    .eq("professional_id", profile.id)
    .neq("customer_id", user.id)
    .gte("starts_at", new Date().toISOString())
    .in("status", ["requested", "confirmed"])
    .order("starts_at", { ascending: true })
    .limit(20);
  if (error) throw error;
  return (data ?? []).map((row: {
    id: string;
    booking_reference: string;
    service_name: string;
    starts_at: string;
    ends_at: string;
    status: CalendarAppointment["status"];
  }) => ({
    id: row.id,
    bookingReference: row.booking_reference,
    serviceName: row.service_name,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status as CalendarAppointment["status"],
  }));
}
export async function fetchBookingRequests(): Promise<BookingRequest[]> {
  const { data, error } = await supabase.rpc(
    "get_professional_booking_requests" as never,
  );
  if (error) throw error;
  return (
    (data ?? []) as Array<{
      id: string;
      booking_reference:string;
      customer_name: string;
      service_name: string;
      starts_at: string;
      deposit_amount: number | string;
      payment_status: BookingRequest["paymentStatus"];
    }>
  ).map((x) => ({
    id: x.id,
    bookingReference:x.booking_reference,
    customerName: x.customer_name,
    serviceName: x.service_name,
    startsAt: x.starts_at,
    depositAmount: Number(x.deposit_amount),
    paymentStatus: x.payment_status,
  }));
}
type Raw = {
  preferences?: {
    max_appointments_per_day?: number;
    buffer_minutes?: number;
    default_duration_minutes?: number;
    approval_mode?: string;
  };
  hours?: Array<{
    day_of_week: number;
    opens_at: string | null;
    closes_at: string | null;
    is_closed: boolean;
  }>;
  breaks?: Array<{
    day_of_week: number;
    starts_at: string;
    ends_at: string;
    label: string;
  }>;
  blocks?: Array<{ starts_at: string; ends_at: string; label: string }>;
};
export async function fetchSchedule(): Promise<Schedule> {
  const { data, error } = await supabase.rpc("get_my_schedule");
  if (error) throw error;
  const raw = data as Raw;
  return {
    preferences: {
      maxAppointmentsPerDay: raw.preferences?.max_appointments_per_day ?? 8,
      bufferMinutes: raw.preferences?.buffer_minutes ?? 15,
      defaultDurationMinutes: raw.preferences?.default_duration_minutes ?? 60,
      approvalMode:
        raw.preferences?.approval_mode === "manual" ? "manual" : "automatic",
    },
    hours: raw.hours?.length
      ? raw.hours.map((x) => ({
          dayOfWeek: x.day_of_week,
          opensAt: (x.opens_at ?? "09:00").slice(0, 5),
          closesAt: (x.closes_at ?? "18:00").slice(0, 5),
          isClosed: x.is_closed,
        }))
      : defaultSchedule.hours,
    breaks:
      raw.breaks?.map((x) => ({
        dayOfWeek: x.day_of_week,
        startsAt: x.starts_at.slice(0, 5),
        endsAt: x.ends_at.slice(0, 5),
        label: x.label,
      })) ?? [],
    blocks:
      raw.blocks?.map((x) => ({
        startsAt: x.starts_at,
        endsAt: x.ends_at,
        label: x.label,
      })) ?? [],
  };
}
export async function saveSchedule(schedule: Schedule) {
  const payload = {
    preferences: {
      max_appointments_per_day: schedule.preferences.maxAppointmentsPerDay,
      buffer_minutes: schedule.preferences.bufferMinutes,
      default_duration_minutes: schedule.preferences.defaultDurationMinutes,
      approval_mode: schedule.preferences.approvalMode,
    },
    hours: schedule.hours.map((x) => ({
      day_of_week: x.dayOfWeek,
      opens_at: x.opensAt,
      closes_at: x.closesAt,
      is_closed: x.isClosed,
    })),
    breaks: schedule.breaks.map((x) => ({
      day_of_week: x.dayOfWeek,
      starts_at: x.startsAt,
      ends_at: x.endsAt,
      label: x.label,
    })),
    blocks: schedule.blocks.map((x) => ({
      starts_at: x.startsAt,
      ends_at: x.endsAt,
      label: x.label,
    })),
  };
  const { error } = await supabase.rpc("save_my_schedule", { payload });
  if (error) throw error;
}
