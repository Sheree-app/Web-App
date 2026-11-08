import { supabase } from "@/lib/supabase";

export type ReviewContext = {
  bookingId: string;
  professionalId: string;
  professionalName: string;
  avatarUrl: string | null;
  serviceName: string;
  completedAt: string;
  existingReview: CustomerReview | null;
};

export type CustomerReview = {
  id: string;
  bookingId: string;
  professionalId: string;
  professionalName: string;
  avatarUrl: string | null;
  serviceName: string;
  rating: number;
  body: string;
  createdAt: string;
};

type ReviewRow = {
  id: string;
  booking_id: string;
  professional_id: string;
  rating: number;
  body: string;
  created_at: string;
  bookings:
    | {
        service_name: string;
        professional_profiles:
          | { display_name: string | null; business_name: string; profile_photo_url: string | null }
          | Array<{ display_name: string | null; business_name: string; profile_photo_url: string | null }>
          | null;
      }
    | Array<{
        service_name: string;
        professional_profiles:
          | { display_name: string | null; business_name: string; profile_photo_url: string | null }
          | Array<{ display_name: string | null; business_name: string; profile_photo_url: string | null }>
          | null;
      }>
    | null;
};

const first = <T,>(value: T | T[] | null) =>
  Array.isArray(value) ? value[0] ?? null : value;

function mapReview(row: ReviewRow): CustomerReview {
  const booking = first(row.bookings);
  const professional = first(booking?.professional_profiles ?? null);
  return {
    id: row.id,
    bookingId: row.booking_id,
    professionalId: row.professional_id,
    professionalName:
      professional?.display_name || professional?.business_name || "Your professional",
    avatarUrl: professional?.profile_photo_url ?? null,
    serviceName: booking?.service_name ?? "Appointment",
    rating: row.rating,
    body: row.body,
    createdAt: row.created_at,
  };
}

export async function fetchReviewContext(bookingId: string): Promise<ReviewContext> {
  const { data: booking, error } = await supabase
    .from("bookings" as never)
    .select("id,professional_id,service_name,ends_at,status,professional_profiles(display_name,business_name,profile_photo_url),reviews(id,booking_id,professional_id,rating,body,created_at)")
    .eq("id", bookingId)
    .maybeSingle();
  if (error) throw error;
  if (!booking) throw new Error("This appointment could not be found.");
  const row = booking as unknown as {
    id: string;
    professional_id: string;
    service_name: string;
    ends_at: string;
    status: string;
    professional_profiles: { display_name: string | null; business_name: string; profile_photo_url: string | null } | Array<{ display_name: string | null; business_name: string; profile_photo_url: string | null }> | null;
    reviews: ReviewRow | ReviewRow[] | null;
  };
  if (row.status !== "completed")
    throw new Error("You can review this appointment after it is completed.");
  const professional = first(row.professional_profiles);
  const review = first(row.reviews);
  return {
    bookingId: row.id,
    professionalId: row.professional_id,
    professionalName:
      professional?.display_name || professional?.business_name || "Your professional",
    avatarUrl: professional?.profile_photo_url ?? null,
    serviceName: row.service_name,
    completedAt: row.ends_at,
    existingReview: review ? mapReview({ ...review, bookings: { service_name: row.service_name, professional_profiles: row.professional_profiles } }) : null,
  };
}

export type PendingReview = {
  bookingId: string;
  professionalId: string;
  professionalName: string;
  avatarUrl: string | null;
  serviceName: string;
  completedAt: string;
  verified: boolean;
  founding: boolean;
};

type PendingReviewProfessional = {
  user_id: string | null;
  display_name: string | null;
  business_name: string | null;
  profile_photo_url: string | null;
  is_verified: boolean | null;
  is_founding_beautician: boolean | null;
};

type PendingReviewRow = {
  id: string;
  customer_id: string;
  professional_id: string;
  service_name: string;
  ends_at: string;
  professional_profiles: PendingReviewProfessional | PendingReviewProfessional[] | null;
  reviews: { id: string } | Array<{ id: string }> | null;
};

/**
 * How far back the rating prompt still asks. Older visits stay reviewable from
 * Bookings, but asking about them on every visit would feel like nagging.
 * Same window as the mobile app.
 */
export const PENDING_REVIEW_WINDOW_DAYS = 60;

/**
 * The most recent completed appointment this member booked and hasn't rated,
 * for the "Appointment complete" prompt. Ported from the mobile app's
 * `fetchPendingReview`, query unchanged.
 */
export async function fetchPendingReview(
  userId: string,
  now = Date.now(),
): Promise<PendingReview | null> {
  const since = new Date(now - PENDING_REVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("bookings" as never)
    .select(
      "id,customer_id,professional_id,service_name,ends_at,professional_profiles(user_id,display_name,business_name,profile_photo_url,is_verified,is_founding_beautician),reviews(id)",
    )
    // The professional who served a visit can read the booking too; without
    // this filter a professional in customer mode would be asked to rate herself.
    .eq("customer_id", userId)
    .eq("status", "completed")
    .gte("ends_at", since)
    .order("ends_at", { ascending: false })
    .limit(12);
  if (error) throw error;
  // `booking_id` is unique on `reviews`, so any embedded review means the visit
  // is already rated. Old self-bookings are skipped as well.
  const row = ((data ?? []) as unknown as PendingReviewRow[]).find((candidate) => {
    if (first(candidate.reviews)) return false;
    return first(candidate.professional_profiles)?.user_id !== candidate.customer_id;
  });
  if (!row) return null;
  const professional = first(row.professional_profiles);
  return {
    bookingId: row.id,
    professionalId: row.professional_id,
    professionalName:
      professional?.business_name || professional?.display_name || "Your professional",
    avatarUrl: professional?.profile_photo_url ?? null,
    serviceName: row.service_name,
    completedAt: row.ends_at,
    verified: Boolean(professional?.is_verified),
    founding: Boolean(professional?.is_founding_beautician),
  };
}

/** Submits a review from its booking id alone (the prompt has no ReviewContext). */
export async function submitBookingReview(bookingId: string, rating: number, body: string) {
  const { error } = await supabase.rpc("submit_review" as never, {
    review_booking_id: bookingId,
    review_rating: rating,
    review_body: body.trim(),
  } as never);
  if (error?.code === "23505") throw new Error("You have already reviewed this appointment.");
  if (error) throw new Error(error.message || "The review could not be shared.");
}

export async function createReview(context: ReviewContext, rating: number, body: string) {
  await submitBookingReview(context.bookingId, rating, body);
}

export async function fetchCustomerReviews(): Promise<CustomerReview[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from("reviews" as never)
    .select("id,booking_id,professional_id,rating,body,created_at,bookings!inner(service_name,professional_profiles(display_name,business_name,profile_photo_url))")
    // Published reviews are public so profiles can show them; without this the
    // member's own list would include everyone else's reviews too.
    .eq("customer_id", user.id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as unknown as ReviewRow[]).map(mapReview);
}
