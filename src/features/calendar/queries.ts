"use client";

import { STALE } from "@/lib/query-cache";
import { useQuery } from "@/lib/use-query";
import { useAuth } from "@/providers/auth-provider";
import {
  BOOKING_REQUESTS_KEY,
  fetchBookingRequests,
  fetchSchedule,
  fetchUpcomingAppointments,
  SCHEDULE_KEY,
  SCHEDULE_TTL,
  UPCOMING_KEY,
} from "./api";

/** Her hours, breaks, time off and booking rules. */
export function useSchedule() {
  const { user } = useAuth();
  return useQuery(user ? SCHEDULE_KEY : null, fetchSchedule, { staleTime: SCHEDULE_TTL });
}

/** The next requested/confirmed appointments on her diary. */
export function useUpcomingAppointments() {
  const { user } = useAuth();
  return useQuery(user ? UPCOMING_KEY : null, fetchUpcomingAppointments, { staleTime: STALE.short });
}

/** Paid requests waiting for her answer. */
export function useBookingRequests() {
  const { user } = useAuth();
  return useQuery(user ? BOOKING_REQUESTS_KEY : null, fetchBookingRequests, { staleTime: STALE.short });
}
