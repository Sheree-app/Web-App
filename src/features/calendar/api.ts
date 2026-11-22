import { api } from "@/lib/api";
import { errorCode } from "@/lib/errors";
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
/** The next 20 requested/confirmed appointments, not your own bookings as a customer. */
export async function fetchUpcomingAppointments(): Promise<
  CalendarAppointment[]
> {
  try {
    const rows = await api.get<Array<{ id: string; booking_reference: string; service_name: string; starts_at: string; ends_at: string; status: CalendarAppointment["status"] }>>("/v1/me/professional/upcoming");
    return rows.map((row) => ({
      id: row.id,
      bookingReference: row.booking_reference,
      serviceName: row.service_name,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      status: row.status,
    }));
  } catch (error) {
    // No professional profile yet: an empty calendar, as before.
    if (errorCode(error) === "not_a_professional") return [];
    throw error;
  }
}
/** Paid requests waiting for approval, soonest first. */
export async function fetchBookingRequests(): Promise<BookingRequest[]> {
  const rows = await api.get<Array<{ id: string; booking_reference: string; customer_name: string | null; service_name: string; starts_at: string; deposit_amount: number | string; payment_status: BookingRequest["paymentStatus"] }>>("/v1/me/professional/booking-requests");
  return rows.map((x) => ({
    id: x.id,
    bookingReference: x.booking_reference,
    customerName: x.customer_name ?? "Client",
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
/** `GET /v1/me/schedule` (`sheree-backend/docs/api/schedule.md`). */
export async function fetchSchedule(): Promise<Schedule> {
  const raw = await api.get<Raw>("/v1/me/schedule");
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
/** The schedule in the API's shape (`PUT /v1/me/schedule`). */
export function schedulePayload(schedule: Schedule) {
  return {
    preferences: {
      max_appointments_per_day: schedule.preferences.maxAppointmentsPerDay,
      buffer_minutes: schedule.preferences.bufferMinutes,
      default_duration_minutes: schedule.preferences.defaultDurationMinutes,
      approval_mode: schedule.preferences.approvalMode,
    },
    hours: schedule.hours.map((x) => ({
      day_of_week: x.dayOfWeek,
      opens_at: x.isClosed ? null : x.opensAt.slice(0, 5),
      closes_at: x.isClosed ? null : x.closesAt.slice(0, 5),
      is_closed: x.isClosed,
    })),
    breaks: schedule.breaks.map((x) => ({
      day_of_week: x.dayOfWeek,
      starts_at: x.startsAt,
      ends_at: x.endsAt,
      ...label(x.label),
    })),
    blocks: schedule.blocks.map((x) => ({
      starts_at: x.startsAt,
      ends_at: x.endsAt,
      ...label(x.label),
    })),
  };
}
export async function saveSchedule(schedule: Schedule) {
  // Replaces preferences, all 7 days, breaks and time off in one transaction.
  await api.put<Raw>("/v1/me/schedule", { body: schedulePayload(schedule) });
}
// The API rejects an empty label; leaving it out gets its default ("Break" / "Unavailable").
const label = (value: string | undefined) => (value?.trim() ? { label: value.trim().slice(0, 60) } : {});
