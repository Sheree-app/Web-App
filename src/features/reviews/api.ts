import { api } from "@/lib/api";
import { CREATOR_PROFILE_PREFIX } from "@/features/profile/api";
import { AppError, errorCode, withServerMessage } from "@/lib/errors";
import { invalidateCachedPrefix } from "@/lib/query-cache";

/** Cache key for her reviews (shared with the Me page's Reviews count). */
export const MY_REVIEWS_KEY = "me:reviews";

/**
 * Reviews through the Sheree API (`sheree-backend/docs/api/reviews.md`). The
 * server applies the rules the app used to apply itself: only completed visits,
 * the 60-day prompt window, and never a prompt to review your own profile.
 */
export type ReviewContext = {
  bookingId: string;
  professionalId: string;
  professionalName: string;
  avatarUrl: string | null;
  /** Blue Verified Professional status. */
  verified: boolean;
  /** Pink Founding Beautician status — separate from Sheree's verified status. */
  founding: boolean;
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
  verified: boolean;
  founding: boolean;
  serviceName: string;
  rating: number;
  body: string;
  createdAt: string;
};

/**
 * The booking a customer still owes a review for, resolved when the app opens.
 */
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

/**
 * How far back the app will still ask for a review. The server applies it
 * (`GET /v1/reviews/pending`); kept here for screens that mention it.
 */
export const PENDING_REVIEW_WINDOW_DAYS = 60;

type VisitRow = {
  booking_id: string;
  service_name: string;
  completed_at: string;
  professional_id: string;
  professional_name: string;
  avatar_url: string | null;
  verified: boolean;
  founding: boolean;
};
type ReviewRow = {
  id: string;
  booking_id: string;
  rating: number;
  body: string;
  created_at: string;
  service_name: string;
  professional_id: string;
  professional_name: string;
  avatar_url: string | null;
  verified: boolean;
  founding: boolean;
};

const toPending = (row: VisitRow): PendingReview => ({
  bookingId: row.booking_id,
  professionalId: row.professional_id,
  professionalName: row.professional_name,
  avatarUrl: row.avatar_url,
  serviceName: row.service_name,
  completedAt: row.completed_at,
  verified: Boolean(row.verified),
  founding: Boolean(row.founding),
});

const toReview = (row: ReviewRow): CustomerReview => ({
  id: row.id,
  bookingId: row.booking_id,
  professionalId: row.professional_id,
  professionalName: row.professional_name,
  avatarUrl: row.avatar_url,
  verified: Boolean(row.verified),
  founding: Boolean(row.founding),
  serviceName: row.service_name ?? "Appointment",
  rating: row.rating,
  body: row.body,
  createdAt: row.created_at,
});

export async function fetchReviewContext(bookingId: string): Promise<ReviewContext> {
  try {
    const row = await api.get<VisitRow & { existing_review: ReviewRow | null }>(
      `/v1/bookings/${encodeURIComponent(bookingId)}/review`,
    );
    return { ...toPending(row), existingReview: row.existing_review ? toReview(row.existing_review) : null };
  } catch (error) {
    if (errorCode(error) === "booking_not_found") throw new AppError("We couldn’t find this appointment.", "not_found");
    if (errorCode(error) === "booking_not_completed")
      throw new AppError("You can review this appointment after it’s completed.", "not_completed");
    throw error;
  }
}

// The API acts on the signed-in user; the parameters keep the old signature.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function fetchPendingReview(_userId: string, _now = Date.now()): Promise<PendingReview | null> {
  const { pending } = await api.get<{ pending: VisitRow | null }>("/v1/reviews/pending");
  return pending ? toPending(pending) : null;
}

/**
 * Submits a review from its booking id alone. The rating prompt rates without
 * loading the full review screen first, so it does not need a `ReviewContext`.
 * The server's refusals ("You can only review your own appointment.", "…after
 * it is completed.") are written for the user and kept as `AppError`s.
 */
export async function submitBookingReview(bookingId: string, rating: number, body: string) {
  try {
    await api.post<ReviewRow>("/v1/reviews", { body: { booking_id: bookingId, rating, body: body.trim() } });
    // Her list and count, and the professional's rating and reviews.
    invalidateCachedPrefix(MY_REVIEWS_KEY);
    invalidateCachedPrefix(CREATOR_PROFILE_PREFIX);
  } catch (error) {
    if (errorCode(error) === "already_reviewed")
      throw new AppError("You’ve already reviewed this appointment.", "already_reviewed");
    // Screens show `message` as-is, so only the server's user-facing refusals keep theirs.
    throw withServerMessage(error);
  }
}

export async function createReview(context: ReviewContext, rating: number, body: string) {
  await submitBookingReview(context.bookingId, rating, body);
}

export async function fetchCustomerReviews(): Promise<CustomerReview[]> {
  return (await api.get<ReviewRow[]>("/v1/me/reviews")).map(toReview);
}
