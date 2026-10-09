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

export async function createReview(context: ReviewContext, rating: number, body: string) {
  const { error } = await supabase.rpc("submit_review" as never, {
    review_booking_id: context.bookingId,
    review_rating: rating,
    review_body: body.trim(),
  } as never);
  if (error?.code === "23505") throw new Error("You have already reviewed this appointment.");
  if (error) throw new Error(error.message || "The review could not be shared.");
}

export async function fetchCustomerReviews(): Promise<CustomerReview[]> {
  const { data, error } = await supabase
    .from("reviews" as never)
    .select("id,booking_id,professional_id,rating,body,created_at,bookings!inner(service_name,professional_profiles(display_name,business_name,profile_photo_url))")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as unknown as ReviewRow[]).map(mapReview);
}
