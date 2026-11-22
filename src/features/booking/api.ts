import { api, isApiError, type Page } from "@/lib/api";
import { AppError, errorCode, withServerMessage } from "@/lib/errors";

/**
 * Booking and checkout through the Sheree API (`sheree-backend/docs/api/bookings.md`,
 * `payments.md`). Reservation, rescheduling and payment settlement run the same
 * SQL and Paystack logic server-side as before. Payment refusals keep their
 * user-facing messages (`withServerMessage`), so screens can show them as-is
 * and branch on `errorCode` (`hold_expired`, `payment_received`, ...).
 */
const key = (profileKey: string) => encodeURIComponent(profileKey.trim());
const bookingPath = (bookingId: string) => encodeURIComponent(bookingId);

/** Reservation refusals that mean "that time (or price card) can't be booked". */
const AVAILABILITY_CODES = new Set([
  "notice_required",
  "outside_booking_window",
  "slot_unavailable",
  "professional_unavailable",
  "price_card_booked",
  "price_card_expired",
  "price_card_unavailable",
]);

export type BookingSnapshot = { price: number; deposit_amount: number; balance_amount: number; sheree_fee_amount: number | null; customer_total: number | null; currency: string };
export type DayState = "available" | "limited" | "full" | "closed";
export type AvailabilityDay = { date: string; state: DayState };
export async function fetchAvailability(
  profileId: string,
  /**
   * `null` is valid for a conversation-only service: availability counts
   * bookings per day and ignores the service, so a card without a catalogue
   * row can share the same path.
   */
  serviceId: string | null,
  fromDate: string,
  dayCount = 35,
): Promise<AvailabilityDay[]> {
  return api.get<AvailabilityDay[]>(`/v1/professionals/${key(profileId)}/availability`, {
    auth: "optional",
    query: { service_id: serviceId || undefined, from: fromDate, days: Math.min(62, Math.max(1, dayCount)) },
  });
}
export type BookingSlot={time:string;available:boolean;reason:string|null};
export type BookingFulfilment={offersMobile:boolean;travelFee:number;businessAddress:string|null;countryCode:string;depositRequired:boolean;phone:string|null};
export async function fetchBookingFulfilment(profileId:string):Promise<BookingFulfilment>{const row=await api.get<{offers_mobile?:boolean;travel_fee?:number|string;business_address?:string|null;country_code?:string;deposit_required?:boolean;phone?:string|null}>(`/v1/professionals/${key(profileId)}/fulfilment`);return{offersMobile:Boolean(row.offers_mobile),travelFee:Number(row.travel_fee??0),businessAddress:row.business_address??null,countryCode:row.country_code??'GH',depositRequired:row.deposit_required!==false,phone:row.phone??null}}
export async function fetchBookingSlots(profileId:string,serviceId:string,date:string):Promise<BookingSlot[]>{return api.get<BookingSlot[]>(`/v1/professionals/${key(profileId)}/slots`,{auth:'optional',query:{service_id:serviceId,date}})}
export class BookingAvailabilityError extends Error{constructor(message:string){super(message);this.name='BookingAvailabilityError'}}
export function bookingAvailabilityAlert(message: string) {
  if (/too close to book/i.test(message)) {
    return {
      title: "One hour's notice required",
      message:
        "Appointments must be booked at least 1 hour in advance. Please choose a later time.",
    };
  }
  if (/booking window/i.test(message))
    return { title: "Too far ahead", message: "That date is too far ahead to book yet. Choose an earlier date." };
  if (/working hours/i.test(message))
    return { title: "Outside working hours", message: "This professional doesn’t work at that time. Choose a time within their working hours." };
  if (/away at that time/i.test(message))
    return { title: "Professional is away", message: "This professional is away at that time. Choose another day or time." };
  if (/scheduled break/i.test(message))
    return { title: "Professional is on a break", message: "This professional is on a break at that time. Choose another time." };
  if (/fully booked/i.test(message))
    return { title: "Fully booked", message: "That day is fully booked. Choose another day." };
  // Price-card bookings from a conversation fail for reasons of the card itself.
  if (/price card has expired/i.test(message))
    return { title: "Price card expired", message: "This price card has expired. Ask the professional to send a new one." };
  if (/price card (was withdrawn|is no longer available)/i.test(message))
    return { title: "Price card withdrawn", message: "The professional withdrew this price card. Ask them to send a new one." };
  if (/price card has already been booked/i.test(message))
    return { title: "Already booked", message: "This price card has already been booked. Check your bookings, or ask the professional for a new one." };
  if (/no longer accepting bookings/i.test(message))
    return { title: "Not taking bookings", message: "This professional isn’t taking bookings right now. Please try again later." };
  return {
    title: "That slot just went",
    message:
      "That time is no longer available. Choose another time and we’ll keep your details here.",
  };
}

/** `pending_payment` until the deposit is verified, then promoted server-side. */
export type BookingFlowStatus = "pending_payment" | "requested" | "confirmed";
/** `POST /v1/bookings` response. */
type ReservedRow = {
  id: string;
  booking_reference: string;
  status: BookingFlowStatus;
  payment_status: "pending" | "paid" | "failed" | "refund_pending" | "refunded";
  price: number;
  deposit_amount: number;
  balance_amount: number;
  sheree_fee_amount: number | null;
  customer_total: number | null;
};
async function reserve(body: Record<string, unknown>) {
  try {
    const row = await api.post<ReservedRow>("/v1/bookings", { body });
    const snapshot: BookingSnapshot = {
      price: Number(row.price),
      deposit_amount: Number(row.deposit_amount),
      balance_amount: Number(row.balance_amount),
      sheree_fee_amount: row.sheree_fee_amount == null ? null : Number(row.sheree_fee_amount),
      customer_total: row.customer_total == null ? null : Number(row.customer_total),
      // Bookings are GHS only (docs/api/payments.md).
      currency: "GHS",
    };
    return { snapshot, id: row.id, status: row.status, reference: row.booking_reference, paid: row.payment_status === "paid" };
  } catch (error) {
    // The message is the reservation SQL's own text, which the alert matches on.
    if (isApiError(error) && AVAILABILITY_CODES.has(error.code)) throw new BookingAvailabilityError(error.message);
    throw withServerMessage(error);
  }
}
/**
 * Reserves a catalogue service. Repeating it within the 15-minute hold returns
 * the same booking, so a retry never strands a second slot.
 */
export async function reserveBooking(
  serviceId: string,
  startsAt: string,
  notes?: string,
  mobileService = false,
) {
  return reserve({ service_id: serviceId, starts_at: startsAt, notes: notes || null, mobile_service: mobileService });
}
/** Re-reads a booking's status, e.g. after a zero-amount checkout promoted it. */
export async function fetchBookingStatus(bookingId: string): Promise<BookingFlowStatus> {
  return (await api.get<{ status: BookingFlowStatus }>(`/v1/me/bookings/${bookingPath(bookingId)}`)).status;
}
/**
 * A conversation price card, as the booking screen shows it.
 *
 * The price shown here is display only: `POST /v1/bookings` re-reads the card's
 * Postgres mirror and charges that, so nothing on this screen can change it.
 */
export type CustomPriceCard = {
  id: string;
  professionalUserId: string;
  customerUserId: string;
  professionalProfileId: string;
  serviceName: string;
  description: string | null;
  price: number;
  currency: string;
  durationMinutes: number;
  status: "draft" | "sent" | "booked" | "expired" | "cancelled";
  expiresAt: string | null;
  bookingId: string | null;
};
/** The fields of Convex's `priceCards.get` view this screen needs. */
export type PriceCardSource = {
  serviceName: string;
  description: string | null;
  priceMinor: number;
  currency: string;
  durationMinutes: number;
  status: CustomPriceCard["status"];
  bookingId: string | null;
  expiresAt: number | null;
};
/**
 * Loads a price card for booking.
 *
 * TODO(api): there is no route that reads `conversation_price_cards`; the card
 * is read from Convex (which the Postgres mirror is written from) through
 * `readCard`, and the professional's profile id from their account id
 * (`professionalUserId`, the conversation peer in the booking link).
 */
export async function fetchConversationPriceCard(
  priceCardId: string,
  professionalUserId: string,
  readCard: (priceCardId: string) => Promise<PriceCardSource | null>,
): Promise<CustomPriceCard | null> {
  const card = await readCard(priceCardId);
  if (!card) return null;
  const rows = await api.get<Array<{ professional_id: string; user_id: string }>>("/v1/professionals/badges", {
    auth: "optional",
    query: { user_ids: professionalUserId },
  });
  const profile = rows.find((row) => row.user_id === professionalUserId);
  if (!profile) return null;
  return {
    id: priceCardId,
    professionalUserId,
    customerUserId: api.session.user()?.id ?? "",
    professionalProfileId: profile.professional_id,
    serviceName: card.serviceName,
    description: card.description,
    price: card.priceMinor / 100,
    currency: card.currency || "GHS",
    durationMinutes: Number(card.durationMinutes),
    status: card.status,
    expiresAt: card.expiresAt == null ? null : new Date(card.expiresAt).toISOString(),
    bookingId: card.bookingId,
  };
}

/** Slot list for a custom service, which depends on the card's duration. */
export async function fetchCustomBookingSlots(
  profileId: string,
  durationMinutes: number,
  date: string,
): Promise<BookingSlot[]> {
  return api.get<BookingSlot[]>(`/v1/professionals/${key(profileId)}/custom-slots`, {
    query: { duration_minutes: Math.round(durationMinutes), date },
  });
}

/**
 * Reserves a conversation service through the same booking engine.
 *
 * The only inputs are the card id, a time and a note: the price and duration
 * come from the card's Postgres mirror server-side, so this client cannot
 * substitute them.
 */
export async function reserveCustomBooking(
  priceCardId: string,
  startsAt: string,
  notes?: string,
  mobileService = false,
) {
  return reserve({ price_card_id: priceCardId, starts_at: startsAt, notes: notes || null, mobile_service: mobileService });
}

export type PaystackSession = {
  accessCode: string;
  authorizationUrl: string;
  reference: string;
  paid: boolean;
  /** Pesewas Paystack will charge (deposit plus Sheree's fee); null when nothing is due. */
  amount: number | null;
  /** The professional's share inside `amount`, in pesewas. */
  depositAmount: number | null;
  /** Sheree's service fee inside `amount`, in pesewas. */
  shereeFee: number | null;
};
/**
 * Where Paystack sends the customer back. The server only keeps https://sheree.world
 * URLs (no open redirect); elsewhere (localhost, previews) Paystack falls back
 * to its dashboard callback.
 */
const paymentCallbackUrl = (bookingId: string) =>
  typeof window === "undefined"
    ? undefined
    : `${window.location.origin}/booking/return?bookingId=${encodeURIComponent(bookingId)}`;
export async function initializeDeposit(
  bookingId: string,
): Promise<PaystackSession> {
  let data: Partial<PaystackSession> & { paid?: boolean };
  try {
    // Safe to resend: the server reuses the open Paystack session for this booking.
    data = await api.post<Partial<PaystackSession> & { paid?: boolean }>(`/v1/bookings/${bookingPath(bookingId)}/checkout`, {
      body: { callback_url: paymentCallbackUrl(bookingId) },
    });
  } catch (error) {
    throw withServerMessage(error);
  }
  return {
    accessCode: data.accessCode ?? "",
    authorizationUrl: data.authorizationUrl ?? "",
    reference: data.reference ?? "",
    paid: Boolean(data.paid),
    amount: typeof data.amount === "number" ? data.amount : null,
    depositAmount: typeof data.depositAmount === "number" ? data.depositAmount : null,
    shereeFee: typeof data.shereeFee === "number" ? data.shereeFee : null,
  };
}
export async function verifyDeposit(bookingId: string, reference: string) {
  try {
    const data = await api.post<{ paid: boolean }>(`/v1/bookings/${bookingPath(bookingId)}/verify-payment`, {
      body: { reference },
    });
    return Boolean(data.paid);
  } catch (error) {
    throw withServerMessage(error);
  }
}
/**
 * Releases a reservation whose payment was abandoned (cancelled with reason
 * `payment_abandoned`); a payment that lands afterwards is refunded server-side.
 */
export async function releaseUnpaidBooking(bookingId: string) {
  await api.post<{ released: boolean }>(`/v1/bookings/${bookingPath(bookingId)}/release`);
}
export async function cancelCustomerBooking(bookingId: string) {
  try {
    return await api.post<{ status: "cancelled"; refund: "pending" | "failed" | "processing" | "needs_attention" | "refunded" | null; refundAmount?: number; professionalCompensation?: number; /** Sheree service fee returned to the customer. */ shereeFeeRefunded?: number; warning?: string; supportCode?: string }>(
      `/v1/me/bookings/${bookingPath(bookingId)}/cancel`,
      { body: { reason: "Cancelled by customer" } },
    );
  } catch (error) {
    throw withServerMessage(error);
  }
}
/** A subclass so screens that check `BookingAvailabilityError` catch it too. */
export class RescheduleAvailabilityError extends BookingAvailabilityError {
  constructor(message: string) {
    super(message);
    this.name = "RescheduleAvailabilityError";
  }
}
export type RescheduleBooking = {
  id: string;
  professionalId: string;
  /** Empty for a price-card booking, which has no catalogue service. */
  serviceId: string;
  serviceName: string;
  startsAt: string;
  endsAt: string;
  notes: string | null;
  status: "pending_payment" | "requested" | "confirmed";
  paymentStatus: "pending" | "paid";
  price: number;
  depositAmount: number;
  balanceAmount: number;
  isMobileService: boolean;
  travelFee: number;
};
/** `GET /v1/me/bookings/:id` and the list items (`docs/api/bookings.md`). */
type MyBookingRow = {
  id: string;
  booking_reference: string;
  status: CustomerBooking["status"];
  payment_status: CustomerBooking["paymentStatus"];
  starts_at: string;
  ends_at: string;
  service_name: string;
  price: number;
  deposit_amount: number;
  balance_amount: number;
  travel_fee: number;
  sheree_fee_amount: number | null;
  customer_total: number | null;
  is_mobile_service: boolean;
  professional_id: string;
  service_id: string | null;
  notes: string | null;
  cancellation_policy: string | null;
  professional_name: string;
  avatar_url: string | null;
  professional_location: string | null;
  reviewed: boolean;
};
const feeOrNull = (value: number | null | undefined) => (value === null || value === undefined ? null : Number(value));

/** One of your bookings as the customer; not found (or not yours) reads as an AppError. */
async function fetchMyBooking(bookingId: string): Promise<MyBookingRow> {
  try {
    return await api.get<MyBookingRow>(`/v1/me/bookings/${bookingPath(bookingId)}`);
  } catch (error) {
    if (errorCode(error) === "booking_not_found") throw new AppError("We couldn’t find this appointment.", "not_found");
    throw error;
  }
}

export async function fetchBookingForReschedule(
  bookingId: string,
): Promise<RescheduleBooking> {
  // Rescheduling is customer-only; the API only returns your own bookings.
  const row = await fetchMyBooking(bookingId);
  return {
    id: row.id,
    professionalId: row.professional_id,
    serviceId: row.service_id ?? "",
    serviceName: row.service_name,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    notes: row.notes,
    status: row.status as RescheduleBooking["status"],
    paymentStatus: row.payment_status as RescheduleBooking["paymentStatus"],
    price: Number(row.price),
    depositAmount: Number(row.deposit_amount),
    balanceAmount: Number(row.balance_amount),
    isMobileService: Boolean(row.is_mobile_service),
    travelFee: Number(row.travel_fee ?? 0),
  };
}
export async function rescheduleBooking(
  bookingId: string,
  startsAt: string,
  notes?: string,
  mobileService = false,
) {
  try {
    const row = await api.post<MyBookingRow>(`/v1/bookings/${bookingPath(bookingId)}/reschedule`, {
      body: { starts_at: startsAt, notes: notes || null, mobile_service: mobileService },
    });
    return row.id;
  } catch (error) {
    if (isApiError(error) && AVAILABILITY_CODES.has(error.code)) throw new RescheduleAvailabilityError(error.message);
    throw withServerMessage(error);
  }
}

export type CustomerBooking = {
  id: string;
  professionalId: string;
  serviceId: string;
  serviceName: string;
  startsAt: string;
  endsAt: string;
  status: "pending_payment" | "requested" | "confirmed" | "cancelled" | "completed" | "no_show";
  paymentStatus: "pending" | "paid" | "failed" | "refund_pending" | "refunded";
  price: number;
  depositAmount: number;
  balanceAmount: number;
  shereeFeeAmount: number | null;
  currency: string;
  cancellationPolicy: string | null;
  professionalName: string;
  avatarUrl: string | null;
  /** Where the appointment happens. */
  professionalLocation: string | null;
  reviewed: boolean;
};
/** Opaque, from the API: pass `nextCursor` back as it came. */
export type BookingCursor = string;
/**
 * Your bookings as the customer, latest first. The API leaves out unpaid and
 * abandoned checkouts (a checkout in flight is not an appointment).
 */
export async function fetchCustomerBookings(cursor: BookingCursor | null = null, pageSize = 30) {
  const page = await api.get<Page<MyBookingRow>>("/v1/me/bookings", {
    query: { cursor: cursor ?? undefined, page_size: Math.min(50, pageSize) },
  });
  const items: CustomerBooking[] = page.items.map((row) => ({
    id: row.id,
    professionalId: row.professional_id,
    serviceId: row.service_id ?? "",
    serviceName: row.service_name,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    paymentStatus: row.payment_status,
    price: Number(row.price),
    depositAmount: Number(row.deposit_amount),
    balanceAmount: Number(row.balance_amount),
    shereeFeeAmount: feeOrNull(row.sheree_fee_amount),
    currency: "GHS",
    cancellationPolicy: row.cancellation_policy,
    professionalName: row.professional_name || "Your professional",
    avatarUrl: row.avatar_url ?? null,
    professionalLocation: row.professional_location ?? null,
    reviewed: Boolean(row.reviewed),
  }));
  return { items, nextCursor: page.next_cursor as BookingCursor | null };
}
export type DisputeCategory =
  | "service_quality"
  | "no_show"
  | "cancellation"
  | "payment"
  | "conduct"
  | "other";
export type DisputeBooking = {
  id: string;
  serviceName: string;
  professionalName: string;
  startsAt: string;
  status: CustomerBooking["status"];
  paymentStatus: CustomerBooking["paymentStatus"];
  depositAmount: number;
  shereeFeeAmount: number | null;
  currency: string;
};
export async function fetchBookingForDispute(
  bookingId: string,
): Promise<DisputeBooking> {
  // Disputes are raised here by the customer who booked the visit.
  // TODO(api): a professional can dispute too (POST accepts both sides), but
  // there is no read of one booking for them; this page stays customer-only.
  const row = await fetchMyBooking(bookingId);
  return {
    id: row.id,
    serviceName: row.service_name,
    professionalName: row.professional_name || "Your professional",
    startsAt: row.starts_at,
    status: row.status,
    paymentStatus: row.payment_status,
    depositAmount: Number(row.deposit_amount),
    shereeFeeAmount: feeOrNull(row.sheree_fee_amount),
    currency: "GHS",
  };
}
export async function submitBookingDispute(input: {
  bookingId: string;
  category: DisputeCategory;
  subject: string;
  description: string;
  requestedRefund?: number | null;
}) {
  try {
    return await api.post<{ id: string; status: "open" }>(`/v1/bookings/${bookingPath(input.bookingId)}/disputes`, {
      body: {
        category: input.category,
        subject: input.subject.trim(),
        description: input.description.trim(),
        ...(input.requestedRefund ? { requested_refund: input.requestedRefund } : {}),
      },
    });
  } catch (error) {
    throw withServerMessage(error);
  }
}
