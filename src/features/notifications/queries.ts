"use client";

import { STALE } from "@/lib/query-cache";
import { useQuery } from "@/lib/use-query";
import { useAuth } from "@/providers/auth-provider";
import {
  fetchNotificationPreferences,
  fetchNotifications,
  fetchUnreadNotificationCount,
  NOTIFICATION_PREFS_KEY,
  notificationsKey,
  unreadCountKey,
} from "./api";

/** The first page of the inbox for one role; older pages stay in the screen. */
export function useNotifications(audience: "customer" | "professional") {
  const { signedIn } = useAuth();
  return useQuery(signedIn ? notificationsKey(audience) : null, () => fetchNotifications(audience, null, 30), {
    staleTime: STALE.short,
  });
}

/** The bell's unread count (0 on failure: it's decoration). */
export function useUnreadNotificationCount(audience: "customer" | "professional") {
  const { signedIn } = useAuth();
  return useQuery(signedIn ? unreadCountKey(audience) : null, () => fetchUnreadNotificationCount(audience), {
    staleTime: STALE.short,
  });
}

/** Her notification settings. */
export function useNotificationPreferences() {
  const { signedIn } = useAuth();
  return useQuery(signedIn ? NOTIFICATION_PREFS_KEY : null, fetchNotificationPreferences, {
    staleTime: STALE.medium,
  });
}
