"use client";

import { useUnreadNotificationCount } from "@/features/notifications/queries";
import { STALE } from "@/lib/query-cache";
import { useQuery } from "@/lib/use-query";
import { useAuth } from "@/providers/auth-provider";
import { DASHBOARD_KEY, fetchProfessionalDashboard } from "./api";

/** The studio home: today's rail, the pulse metrics, the next booking. */
export function useProfessionalDashboard() {
  const { user } = useAuth();
  return useQuery(user ? DASHBOARD_KEY : null, fetchProfessionalDashboard, { staleTime: STALE.short });
}

/**
 * Unread studio notifications, for the bell's dot. Shares the notifications
 * feature's key, so reading them on /notifications clears the dot at once.
 */
export const useStudioUnreadCount = () => useUnreadNotificationCount("professional");
