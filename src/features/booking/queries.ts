"use client";

import { useAuthGated } from "@/features/account/queries";
import { resolveProfileId } from "@/features/profile/api";
import { fetchReviewContext } from "@/features/reviews/api";
import { fetchProfessionalName, fetchProfessionalServices } from "@/features/services/api";
import { STALE } from "@/lib/query-cache";
import { useQuery } from "@/lib/use-query";
import { useAuth } from "@/providers/auth-provider";
import { useMemo } from "react";
import {
  BOOKINGS_KEY,
  bookingCatalogueKey,
  bookingKey,
  bookingReviewKey,
  fetchBookingFulfilment,
  fetchCustomerBookings,
  fetchMyBooking,
  toDisputeBooking,
  toRescheduleBooking,
  type BookingFulfilment,
} from "./api";

/** The first page of her bookings, as the Bookings tab shows it. */
export const BOOKINGS_PAGE_SIZE = 30;

/** Her bookings, latest first (first page). Statuses move, so kept short. */
export function useCustomerBookings() {
  const { user } = useAuth();
  return useAuthGated(
    useQuery(user ? BOOKINGS_KEY : null, () => fetchCustomerBookings(null, BOOKINGS_PAGE_SIZE), {
      staleTime: STALE.short,
    }),
  );
}

/** One of her bookings, raw; the hooks below shape it for each screen. */
function useMyBooking(bookingId: string | null) {
  const { user } = useAuth();
  return useAuthGated(
    useQuery(user && bookingId ? bookingKey(bookingId) : null, () => fetchMyBooking(bookingId!), {
      staleTime: STALE.short,
    }),
  );
}

/** A booking as the reschedule screen needs it. */
export function useRescheduleBooking(bookingId: string | null) {
  const query = useMyBooking(bookingId);
  const data = useMemo(() => (query.data ? toRescheduleBooking(query.data) : undefined), [query.data]);
  return { ...query, data };
}

/** A booking as the dispute screen needs it. */
export function useDisputeBooking(bookingId: string | null) {
  const query = useMyBooking(bookingId);
  const data = useMemo(() => (query.data ? toDisputeBooking(query.data) : undefined), [query.data]);
  return { ...query, data };
}

/** The visit she's reviewing, with her review if she already left one. */
export function useReviewContext(bookingId: string | null) {
  const { user } = useAuth();
  return useAuthGated(
    useQuery(user && bookingId ? bookingReviewKey(bookingId) : null, () => fetchReviewContext(bookingId!), {
      staleTime: STALE.short,
    }),
  );
}

export type BookingCatalogue = {
  profileId: string;
  services: Awaited<ReturnType<typeof fetchProfessionalServices>>;
  name: string;
  fulfilment: BookingFulfilment | null;
};

/**
 * What the booking screen needs to describe a catalogue booking. Prices and
 * the travel fee live here, so it's `booking-flow:` (never persisted) and
 * short-lived; the server charges its own prices either way.
 */
export function useBookingCatalogue(professionalKey: string | null) {
  return useQuery<BookingCatalogue>(
    professionalKey ? bookingCatalogueKey(professionalKey) : null,
    async () => {
      const profileId = await resolveProfileId(professionalKey!);
      const [services, name, fulfilment] = await Promise.all([
        fetchProfessionalServices(profileId),
        fetchProfessionalName(profileId).catch(() => ""),
        fetchBookingFulfilment(profileId).catch(() => null),
      ]);
      return { profileId, services, name, fulfilment };
    },
    { staleTime: STALE.short },
  );
}
