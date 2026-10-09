import { storageGet, storageSet } from "@/lib/storage";
import { supabase } from "@/lib/supabase/client";
import { db } from "@/lib/supabase/untyped";
import {
  existingSubscriptionJson,
  notificationPermission,
  subscribeToWebPush,
  unsubscribeFromWebPush,
  webPushConfigured,
  webPushSupported,
  type WebPushSubscriptionJson,
} from "./web-push";

export type NotificationAudience = "customer" | "professional" | "all";

export type NotificationData = {
  url?: unknown;
  route?: unknown;
  type?: unknown;
  event?: unknown;
  audience?: unknown;
  postId?: unknown;
  actorId?: unknown;
  bookingId?: unknown;
  paymentId?: unknown;
  notificationId?: unknown;
};

export type AppNotification = {
  id: string;
  kind:
    | "appointment_reminder"
    | "message"
    | "booking"
    | "payment"
    | "review"
    | "promotion"
    | "social";
  audience: NotificationAudience;
  title: string;
  body: string;
  url: string | null;
  data: NotificationData;
  readAt: string | null;
  createdAt: string;
};

/** Where a notification should take you, given what it carries. */
export function notificationDestination(data: NotificationData) {
  if (data.event === "review_requested" && typeof data.bookingId === "string")
    return `/review/${data.bookingId}`;
  if (
    (data.event === "feed_post_likes" ||
      data.event === "feed_post_comments" ||
      data.event === "feed_post_saves") &&
    typeof data.postId === "string"
  )
    return `/post/${data.postId}`;
  if (data.event === "review_created") return "/profile";
  // Payments are shown inside the booking they belong to.
  if (typeof data.paymentId === "string") return null;
  if (typeof data.bookingId === "string") return "/bookings";
  if (typeof data.route === "string" && data.route.startsWith("/")) return data.route;
  if (typeof data.url === "string" && data.url.startsWith("/")) return data.url;
  return "/notifications";
}

export type NotificationPreferences = {
  pushEnabled: boolean;
  bookingReminders: boolean;
  beautyReminders: boolean;
  feedUpdates: boolean;
  professionalUpdates: boolean;
  reengagement: boolean;
  marketing: boolean;
  bookingUpdates: boolean;
  portfolioReminders: boolean;
  feedEngagement: boolean;
  businessReminders: boolean;
  quietHoursEnabled: boolean;
  quietFrom: string;
  quietUntil: string;
};

export const defaultNotificationPreferences: NotificationPreferences = {
  pushEnabled: true,
  bookingReminders: true,
  beautyReminders: true,
  feedUpdates: true,
  professionalUpdates: true,
  reengagement: true,
  marketing: true,
  bookingUpdates: true,
  portfolioReminders: true,
  feedEngagement: true,
  businessReminders: true,
  quietHoursEnabled: true,
  quietFrom: "22:00",
  quietUntil: "08:00",
};

const deviceIdKey = "sheree:push-device-id";

async function getDeviceId() {
  let value = await storageGet(deviceIdKey);
  if (!value) {
    value = `web-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await storageSet(deviceIdKey, value);
  }
  return value;
}

/**
 * Browser notification permission, plus what this deployment can actually
 * deliver: a browser without the Push API, or a build without a VAPID key, can
 * hold the permission and still never receive a push.
 */
export async function getNotificationPermission() {
  const supported = webPushSupported();
  if (!supported) {
    return { granted: false, canAskAgain: false, supported: false, configured: false };
  }
  return {
    granted: Notification.permission === "granted",
    canAskAgain: Notification.permission === "default",
    supported: true,
    configured: webPushConfigured(),
  };
}

export async function requestNotificationPermission() {
  if (typeof window === "undefined" || !("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  return (await Notification.requestPermission()) === "granted";
}

/**
 * The native app opened OS settings from here. Browsers offer no equivalent
 * deep link, so this returns the instruction the screen should show instead.
 */
export async function openNotificationSettings(): Promise<string> {
  return "Open your browser’s site settings for Sheree and allow notifications.";
}

/** Missing column means the Web Push migration hasn't been applied yet. */
function pushError(error: { message?: string }) {
  const message = error.message ?? "Push settings could not be saved.";
  return new Error(
    /web_push_subscription/i.test(message)
      ? "This project is missing the web_push_subscription column — apply supabase/migrations/20260916010000_web_push_subscriptions.sql."
      : message,
  );
}

/** One row per browser, so preferences follow the device the person used. */
export async function persistWebPushSubscription(
  userId: string,
  deviceId: string,
  subscription: WebPushSubscriptionJson,
) {
  const now = new Date().toISOString();
  const table = db.from("push_tokens");

  const { data: existing } = await table
    .select("id")
    .eq("user_id", userId)
    .eq("device_id", deviceId)
    .maybeSingle();

  const payload = {
    user_id: userId,
    platform: "web",
    device_name: typeof navigator === "undefined" ? "Browser" : navigator.userAgent.slice(0, 120),
    device_id: deviceId,
    web_push_subscription: subscription,
    last_used_at: now,
    updated_at: now,
    enabled: true,
  };

  const { error } = existing
    ? await table.update(payload).eq("id", existing.id)
    : await table.insert(payload);
  if (error) throw pushError(error);
  return deviceId;
}

/**
 * Creates the browser subscription (asking for permission if needed) and stores
 * it against the signed-in user. Returns the device id, or null when the
 * browser can't subscribe or permission was refused.
 */
export async function registerForPushNotifications(userId?: string) {
  if (!webPushSupported()) return null;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const resolvedUserId = userId ?? user?.id;
  if (!resolvedUserId) return null;

  const subscription = await subscribeToWebPush();
  if (!subscription) return null;

  const deviceId = await getDeviceId();
  await persistWebPushSubscription(resolvedUserId, deviceId, subscription);
  return deviceId;
}

export type PushState = {
  supported: boolean;
  configured: boolean;
  permission: NotificationPermission | "unsupported";
  subscribed: boolean;
  deviceId: string | null;
};

/**
 * What the settings screen needs to tell the truth: whether the browser and the
 * deployment support push, whether permission is held, and whether a
 * subscription is stored for this device.
 *
 * A subscription the browser holds but the database doesn't know about (it
 * rotated, or the row was cleared) is re-saved here, and the service worker's
 * `pushsubscriptionchange` message does the same thing in-session.
 */
export async function fetchPushState(): Promise<PushState> {
  const supported = webPushSupported();
  const configured = webPushConfigured();
  const permission = notificationPermission();
  if (!supported) {
    return { supported, configured, permission, subscribed: false, deviceId: null };
  }

  let subscription: WebPushSubscriptionJson | null = null;
  try {
    subscription = await existingSubscriptionJson();
  } catch {
    subscription = null;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!subscription || !user) {
    return { supported, configured, permission, subscribed: false, deviceId: null };
  }

  const deviceId = await getDeviceId();
  try {
    await persistWebPushSubscription(user.id, deviceId, subscription);
    return { supported, configured, permission, subscribed: true, deviceId };
  } catch {
    return { supported, configured, permission, subscribed: true, deviceId };
  }
}

/** Re-saves a subscription the service worker rotated while the tab was open. */
export async function syncWebPushSubscription(subscription: WebPushSubscriptionJson) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  await persistWebPushSubscription(user.id, await getDeviceId(), subscription);
}

export async function setPushEnabled(enabled: boolean) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  if (enabled) {
    await registerForPushNotifications(user.id);
    return;
  }

  // Drop the browser subscription too: turning the switch back on re-subscribes.
  await unsubscribeFromWebPush().catch(() => false);

  // Scoped to this browser, so signing out of push here doesn't silence the
  // phone as well. The global switch is `notification_preferences.push_enabled`.
  const { error } = await db
    .from("push_tokens")
    .update({ enabled: false, web_push_subscription: null, updated_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("device_id", await getDeviceId());
  if (error) throw pushError(error);
}

export async function fetchNotificationPreferences(): Promise<NotificationPreferences> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return defaultNotificationPreferences;

  const { data, error } = await db
    .from("notification_preferences")
    .select(
      "push_enabled,booking_reminders,beauty_reminders,feed_updates,professional_updates,reengagement,marketing,booking_updates,portfolio_reminders,feed_engagement,business_reminders,quiet_hours_enabled,quiet_from,quiet_until",
    )
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return defaultNotificationPreferences;

  return {
    pushEnabled: Boolean(data.push_enabled),
    bookingReminders: Boolean(data.booking_reminders),
    beautyReminders: Boolean(data.beauty_reminders),
    feedUpdates: Boolean(data.feed_updates),
    professionalUpdates: Boolean(data.professional_updates),
    reengagement: Boolean(data.reengagement),
    marketing: Boolean(data.marketing),
    bookingUpdates: Boolean(data.booking_updates),
    portfolioReminders: Boolean(data.portfolio_reminders),
    feedEngagement: Boolean(data.feed_engagement),
    businessReminders: Boolean(data.business_reminders),
    quietHoursEnabled: Boolean(data.quiet_hours_enabled),
    quietFrom: String(data.quiet_from).slice(0, 5),
    quietUntil: String(data.quiet_until).slice(0, 5),
  };
}

export async function saveNotificationPreferences(value: NotificationPreferences) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Sign in to save notification settings.");

  const { error } = await db.from("notification_preferences").upsert(
    {
      user_id: user.id,
      push_enabled: value.pushEnabled,
      booking_reminders: value.bookingReminders,
      beauty_reminders: value.beautyReminders,
      feed_updates: value.feedUpdates,
      professional_updates: value.professionalUpdates,
      reengagement: value.reengagement,
      marketing: value.marketing,
      booking_updates: value.bookingUpdates,
      portfolio_reminders: value.portfolioReminders,
      feed_engagement: value.feedEngagement,
      business_reminders: value.businessReminders,
      quiet_hours_enabled: value.quietHoursEnabled,
      quiet_from: value.quietFrom,
      quiet_until: value.quietUntil,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  if (error) throw error;
}

export type NotificationCursor = { createdAt: string; id: string };

export async function fetchNotifications(
  audience: "customer" | "professional",
  cursor: NotificationCursor | null = null,
  pageSize = 30,
) {
  let query = db
    .from("notifications")
    .select("id,kind,audience,title,body,url,data,read_at,created_at")
    .in("audience", [audience, "all"])
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(pageSize);

  if (cursor) {
    query = query.or(
      `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
    );
  }

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []) as Array<{
    id: string;
    kind: AppNotification["kind"];
    audience: NotificationAudience;
    title: string;
    body: string;
    url: string | null;
    data: NotificationData | null;
    read_at: string | null;
    created_at: string;
  }>;
  const last = rows.at(-1);

  return {
    items: rows.map<AppNotification>((row) => ({
      id: row.id,
      kind: row.kind,
      audience: row.audience,
      title: row.title,
      body: row.body,
      url: row.url,
      data: row.data ?? {},
      readAt: row.read_at,
      createdAt: row.created_at,
    })),
    nextCursor:
      rows.length === pageSize && last
        ? { createdAt: last.created_at, id: last.id }
        : null,
  };
}

export async function markNotificationRead(id: string) {
  const { error } = await db
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

/** Records that a notification was acted on — drives the "opened" metric. */
export async function markNotificationOpened(id: string) {
  const { error } = await db.rpc("mark_notification_opened", { notification_id: id });
  if (error) throw error;
}

export async function recordAppOpen(mode: "customer" | "professional") {
  const { error } = await db.rpc("record_app_open", { active_mode: mode });
  if (error) throw error;
}

export async function markAllNotificationsRead(audience: "customer" | "professional") {
  const { error } = await db
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .is("read_at", null)
    .in("audience", [audience, "all"]);
  if (error) throw error;
}

export async function fetchUnreadNotificationCount(audience: "customer" | "professional") {
  const { count, error } = await db
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null)
    .in("audience", [audience, "all"]);
  if (error) throw error;
  return count ?? 0;
}
