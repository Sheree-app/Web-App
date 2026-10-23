export type BookingSnapshot = { price: number; deposit_amount: number; balance_amount: number; sheree_fee_amount: number | null; customer_total: number; currency: string };
import { supabase } from "@/lib/supabase";
import { FunctionsHttpError } from "@supabase/supabase-js";
export type DayState = "available" | "limited" | "full" | "closed";
export type AvailabilityDay = { date: string; state: DayState };
export async function fetchAvailability(
  profileId: string,
  /**
   * `null` is valid for a conversation-only service: the availability RPC
   * counts existing bookings per day and only uses this to exclude the service
   * being edited, so a card without a catalogue row can share the same path.
   */
  serviceId: string | null,
  fromDate: string,
  dayCount = 35,
) {
  const { data, error } = await supabase.rpc("get_booking_availability", {
    profile_id: profileId,
    service_id: serviceId,
    from_date: fromDate,
    day_count: dayCount,
  } as never);
  if (error) throw error;
  return data ?? [];
}
export type BookingSlot={time:string;available:boolean;reason:string|null};
export type BookingFulfilment={offersMobile:boolean;travelFee:number;businessAddress:string|null;countryCode:string;depositRequired:boolean;phone:string|null};
export async function fetchBookingFulfilment(profileId:string):Promise<BookingFulfilment>{const{data,error}=await supabase.rpc('get_booking_fulfilment' as never,{profile_id:profileId} as never);if(error)throw error;const row=(data??{}) as unknown as{offers_mobile?:boolean;travel_fee?:number|string;business_address?:string|null;country_code?:string;deposit_required?:boolean;phone?:string|null};return{offersMobile:Boolean(row.offers_mobile),travelFee:Number(row.travel_fee??0),businessAddress:row.business_address??null,countryCode:row.country_code??'GH',depositRequired:row.deposit_required!==false,phone:row.phone??null}}
export async function fetchBookingSlots(profileId:string,serviceId:string,date:string):Promise<BookingSlot[]>{const{data,error}=await supabase.rpc('get_booking_slots' as never,{profile_id:profileId,service_id:serviceId,booking_date:date} as never);if(error)throw error;return((data??[])as unknown as Array<{slot_time:string;is_available:boolean;unavailable_reason:string|null}>).map(row=>({time:row.slot_time,available:row.is_available,reason:row.unavailable_reason}))}
export class BookingAvailabilityError extends Error{constructor(message:string){super(message);this.name='BookingAvailabilityError'}}
export function bookingAvailabilityAlert(message: string) {
  if (/too close to book/i.test(message)) {
    return {
      title: "One hour's notice required",
      message:
        "Appointments must be booked at least 1 hour in advance. Please choose a later time.",
    };
  }
  return {
    title: "That slot just went",
    message:
      "That time is no longer available. Choose another time and we’ll keep your details here.",
  };
}
export async function reserveBooking(
  serviceId: string,
  startsAt: string,
  notes?: string,
  mobileService = false,
) {
  const { data, error } = await supabase.rpc("reserve_booking", {
    service_id: serviceId,
    starts_at: startsAt,
    notes: notes || null,
    mobile_service: mobileService,
  });
  if(error){const message=error.message??'';if(/too close|just booked|fully booked|working hours|scheduled break|away at that time/i.test(message))throw new BookingAvailabilityError(message);throw error}
  const id = data as string;
  const { data: booking, error: statusError } = await supabase
    .from("bookings" as never)
    .select("status,booking_reference,price,deposit_amount,balance_amount,sheree_fee_amount,customer_total,currency")
    .eq("id", id)
    .single();
  if (statusError) throw statusError;
  return {
    snapshot: booking as unknown as BookingSnapshot,
    id,
    status:(booking as unknown as{status:"requested"|"confirmed";booking_reference:string}).status,
    reference:(booking as unknown as{status:"requested"|"confirmed";booking_reference:string}).booking_reference,
  };
}
/**
 * A conversation price card as mirrored into Postgres.
 *
 * The booking UI only ever renders this row: it is written by Convex from the
 * card the professional authored, and the booking RPC re-reads it too. Nothing
 * on this screen is allowed to override its price.
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

export async function fetchConversationPriceCard(
  priceCardId: string,
): Promise<CustomPriceCard | null> {
  const { data, error } = await supabase
    .from("conversation_price_cards" as never)
    .select(
      "id,professional_user_id,customer_user_id,service_name,description,price,currency,duration_minutes,status,expires_at,booking_id",
    )
    .eq("id", priceCardId)
    .maybeSingle();
  if (error) throw error;
  const row = data as unknown as {
    id: string;
    professional_user_id: string;
    customer_user_id: string;
    service_name: string;
    description: string | null;
    price: number | string;
    currency: string;
    duration_minutes: number;
    status: CustomPriceCard["status"];
    expires_at: string | null;
    booking_id: string | null;
  } | null;
  if (!row) return null;

  const { data: profile, error: profileError } = await supabase
    .from("professional_profiles")
    .select("id")
    .eq("user_id", row.professional_user_id)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile) return null;

  return {
    id: row.id,
    professionalUserId: row.professional_user_id,
    customerUserId: row.customer_user_id,
    professionalProfileId: (profile as unknown as { id: string }).id,
    serviceName: row.service_name,
    description: row.description,
    price: Number(row.price),
    currency: row.currency || "GHS",
    durationMinutes: Number(row.duration_minutes),
    status: row.status,
    expiresAt: row.expires_at,
    bookingId: row.booking_id,
  };
}

/** Slot list for a custom service, which depends on the card's duration. */
export async function fetchCustomBookingSlots(
  profileId: string,
  durationMinutes: number,
  date: string,
): Promise<BookingSlot[]> {
  const { data, error } = await supabase.rpc(
    "get_booking_slots_custom" as never,
    {
      p_profile_id: profileId,
      p_duration_minutes: durationMinutes,
      p_booking_date: date,
    } as never,
  );
  if (error) throw error;
  return ((data ?? []) as unknown as Array<{
    slot_time: string;
    is_available: boolean;
    unavailable_reason: string | null;
  }>).map((row) => ({
    time: row.slot_time,
    available: row.is_available,
    reason: row.unavailable_reason,
  }));
}

/**
 * Reserves a conversation service through the existing booking engine.
 *
 * The only inputs are the card id, a time and a note: the price and duration
 * come from the Postgres mirror inside `reserve_custom_booking`, so they cannot
 * be substituted by this client.
 */
export async function reserveCustomBooking(
  priceCardId: string,
  startsAt: string,
  notes?: string,
  mobileService = false,
) {
  const { data, error } = await supabase.rpc(
    "reserve_custom_booking" as never,
    {
      price_card_id: priceCardId,
      starts_at: startsAt,
      notes: notes || null,
      mobile_service: mobileService,
    } as never,
  );
  if (error) {
    const message = error.message ?? "";
    if (/too close|just booked|fully booked|working hours|scheduled break|away at that time|booking window/i.test(message)) {
      throw new BookingAvailabilityError(message);
    }
    throw error;
  }
  const id = data as string;
  const { data: booking, error: statusError } = await supabase
    .from("bookings" as never)
    .select("status,booking_reference,price,deposit_amount,balance_amount,sheree_fee_amount,customer_total,currency,payment_status")
    .eq("id", id)
    .single();
  if (statusError) throw statusError;
  const row = booking as unknown as {
    status: "requested" | "confirmed";
    booking_reference: string;
    payment_status: "pending" | "paid";
  };
  return {
    snapshot: booking as unknown as BookingSnapshot,
    id,
    status: row.status,
    reference: row.booking_reference,
    paid: row.payment_status === "paid",
  };
}

export type PaystackSession = {
  accessCode: string;
  authorizationUrl: string;
  reference: string;
  paid: boolean;
};
async function functionError(error: unknown, data: unknown) {
  if (data && typeof data === "object" && "error" in data)
    return String((data as { error: unknown }).error);
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.json();
      if (body?.error) return String(body.error);
    } catch {
      /* use the SDK message */
    }
  }
  return error instanceof Error ? error.message : "Payment service unavailable";
}
export async function initializeDeposit(
  bookingId: string,
): Promise<PaystackSession> {
  const { data, error } = await supabase.functions.invoke(
    "paystack-initialize",
    { body: { bookingId } },
  );
  if (error) throw new Error(await functionError(error, data));
  if (data?.error) throw new Error(data.error);
  return {
    accessCode: data.accessCode ?? "",
    authorizationUrl: data.authorizationUrl ?? "",
    reference: data.reference ?? "",
    paid: Boolean(data.paid),
  };
}
export async function verifyDeposit(bookingId: string, reference: string) {
  const { data, error } = await supabase.functions.invoke("paystack-verify", {
    body: { bookingId, reference },
  });
  if (error) throw new Error(await functionError(error, data));
  if (data?.error) throw new Error(data.error);
  return Boolean(data.paid);
}
export async function releaseUnpaidBooking(bookingId: string) {
  const { error } = await supabase.rpc("release_unpaid_booking" as never, {
    booking_id: bookingId,
  } as never);
  if (error) throw error;
}
export async function cancelCustomerBooking(bookingId: string) {
  const { data, error } = await supabase.functions.invoke("booking-manage", {
    body: {
      bookingId,
      action: "customer_cancel",
      reason: "Cancelled by customer",
    },
  });
  if (error) throw new Error(await functionError(error, data));
  if (data?.error) throw new Error(data.error);
  return data as { status: "cancelled"; refund: "pending" | "failed" | "processing" | "needs_attention" | "refunded" | null; refundAmount?: number; professionalCompensation?: number; warning?: string; supportCode?: string };
}
export class RescheduleAvailabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RescheduleAvailabilityError";
  }
}
export type RescheduleBooking = {
  id: string;
  professionalId: string;
  serviceId: string;
  serviceName: string;
  startsAt: string;
  endsAt: string;
  notes: string | null;
  status: "requested" | "confirmed";
  paymentStatus: "pending" | "paid";
  price: number;
  depositAmount: number;
  balanceAmount: number;
  isMobileService: boolean;
  travelFee: number;
};
export async function fetchBookingForReschedule(
  bookingId: string,
): Promise<RescheduleBooking> {
  const { data, error } = await supabase
    .from("bookings" as never)
    .select(
      "id,professional_id,service_id,service_name,starts_at,ends_at,notes,status,payment_status,price,deposit_amount,balance_amount,is_mobile_service,travel_fee",
    )
    .eq("id", bookingId)
    .single();
  if (error) throw error;
  const row = data as unknown as {
    id: string;
    professional_id: string;
    service_id: string;
    service_name: string;
    starts_at: string;
    ends_at: string;
    notes: string | null;
    status: RescheduleBooking["status"];
    payment_status: RescheduleBooking["paymentStatus"];
    price: number | string;
    deposit_amount: number | string;
    balance_amount: number | string;
    is_mobile_service: boolean;
    travel_fee: number | string;
  };
  return {
    id: row.id,
    professionalId: row.professional_id,
    serviceId: row.service_id,
    serviceName: row.service_name,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    notes: row.notes,
    status: row.status,
    paymentStatus: row.payment_status,
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
  const { data, error } = await supabase.rpc("reschedule_booking" as never, {
    booking_id: bookingId,
    new_starts_at: startsAt,
    notes: notes || null,
    mobile_service: mobileService,
  } as never);
  if (error) {
    const message = error.message ?? "";
    if (
      /too close|just booked|fully booked|working hours|scheduled break|away at that time|outside the booking window/i.test(
        message,
      )
    )
      throw new RescheduleAvailabilityError(message);
    throw error;
  }
  return data as string;
}

export type CustomerBooking = {
  id: string;
  professionalId: string;
  serviceId: string;
  serviceName: string;
  startsAt: string;
  endsAt: string;
  status: "requested" | "confirmed" | "cancelled" | "completed";
  paymentStatus: "pending" | "paid" | "failed" | "refund_pending" | "refunded";
  price: number;
  depositAmount: number;
  balanceAmount: number;
  shereeFeeAmount: number | null;
  currency: string;
  cancellationPolicy: string | null;
  professionalName: string;
  avatarUrl: string | null;
  reviewed: boolean;
};
type BookingRow = {
  id: string;
  professional_id: string;
  service_id: string;
  service_name: string;
  starts_at: string;
  ends_at: string;
  status: CustomerBooking["status"];
  payment_status: CustomerBooking["paymentStatus"];
  price: number | string;
  deposit_amount: number | string;
  balance_amount: number | string;
  sheree_fee_amount: number | string | null;
  currency: string;
  cancellation_policy: string | null;
  professional_profiles:
    | {
        display_name: string | null;
        business_name: string;
        profile_photo_url: string | null;
      }
    | Array<{
        display_name: string | null;
        business_name: string;
        profile_photo_url: string | null;
      }>
    | null;
  reviews: { id: string } | Array<{ id: string }> | null;
};
export type BookingCursor={startsAt:string;id:string};
export async function fetchCustomerBookings(cursor:BookingCursor|null=null,pageSize=30) {
  let query = supabase
    .from("bookings" as never)
    .select(
      "id,professional_id,service_id,service_name,starts_at,ends_at,status,payment_status,price,deposit_amount,balance_amount,sheree_fee_amount,currency,cancellation_policy,professional_profiles(display_name,business_name,profile_photo_url),reviews(id)",
    ).order("starts_at", { ascending: false }).order("id",{ascending:false}).limit(pageSize) as any;
  if(cursor)query=query.or(`starts_at.lt.${cursor.startsAt},and(starts_at.eq.${cursor.startsAt},id.lt.${cursor.id})`);
  const {data,error}=await query;
  if (error) throw error;
  const rows=(data??[]) as unknown as BookingRow[];
  const items=rows.map((row) => {
    const joined = Array.isArray(row.professional_profiles)
      ? row.professional_profiles[0]
      : row.professional_profiles;
    return {
      id: row.id,
      professionalId: row.professional_id,
      serviceId: row.service_id,
      serviceName: row.service_name,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      status: row.status,
      paymentStatus: row.payment_status,
      price: Number(row.price),
      depositAmount: Number(row.deposit_amount),
      balanceAmount: Number(row.balance_amount),
      shereeFeeAmount: row.sheree_fee_amount == null ? null : Number(row.sheree_fee_amount),
      currency: row.currency,
      cancellationPolicy: row.cancellation_policy,
      professionalName:
        joined?.display_name || joined?.business_name || "Your professional",
      avatarUrl: joined?.profile_photo_url ?? null,
      reviewed: Array.isArray(row.reviews) ? row.reviews.length > 0 : Boolean(row.reviews),
    };
  });const last=rows.at(-1);return{items,nextCursor:rows.length===pageSize&&last?{startsAt:last.starts_at,id:last.id}:null};
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
  const { data, error } = await supabase
    .from("bookings" as never)
    .select(
      "id,service_name,starts_at,status,payment_status,deposit_amount,sheree_fee_amount,currency,professional_profiles(display_name,business_name)",
    )
    .eq("id", bookingId)
    .single();
  if (error) throw error;
  const row = data as unknown as {
    id: string;
    service_name: string;
    starts_at: string;
    status: CustomerBooking["status"];
    payment_status: CustomerBooking["paymentStatus"];
    deposit_amount: number | string;
    sheree_fee_amount: number | string | null;
    currency: string;
    professional_profiles:
      | { display_name: string | null; business_name: string }
      | Array<{ display_name: string | null; business_name: string }>
      | null;
  };
  const joined = Array.isArray(row.professional_profiles)
    ? row.professional_profiles[0]
    : row.professional_profiles;
  return {
    id: row.id,
    serviceName: row.service_name,
    professionalName:
      joined?.display_name || joined?.business_name || "Your professional",
    startsAt: row.starts_at,
    status: row.status,
    paymentStatus: row.payment_status,
    depositAmount: Number(row.deposit_amount),
    shereeFeeAmount: row.sheree_fee_amount == null ? null : Number(row.sheree_fee_amount),
    currency: row.currency,
  };
}
export async function submitBookingDispute(input: {
  bookingId: string;
  category: DisputeCategory;
  subject: string;
  description: string;
  requestedRefund?: number | null;
}) {
  const { data, error } = await supabase.rpc(
    "submit_booking_dispute" as never,
    {
      booking_id: input.bookingId,
      dispute_category: input.category,
      dispute_subject: input.subject,
      dispute_description: input.description,
      requested_refund: input.requestedRefund ?? null,
    } as never,
  );
  if (error) throw error;
  return data as { id: string; status: "open" };
}
