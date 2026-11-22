import { api, type Page } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { storageGet, storageSet } from "@/lib/storage";
import {
  notificationPermission,
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
  // Traction milestones open the post itself too.
  if (data.event === "feed_post_milestones" && typeof data.postId === "string")
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

// TODO(api): the API stores Expo push tokens only (`PUT /v1/push-tokens`).
// Web Push needs a route that takes the browser subscription (endpoint +
// p256dh/auth keys) per device, and a per-device disable. Until then the
// browser is never subscribed, so permission isn't asked for a push that could
// never be delivered.
const WEB_PUSH_UNAVAILABLE =
  "Push notifications aren’t available in the browser yet. The Sheree app can send them to your phone.";

/**
 * Creates the browser subscription (asking for permission if needed) and stores
 * it against the signed-in user. Returns the device id, or null when the
 * browser can't subscribe or permission was refused.
 */
export async function registerForPushNotifications(userId?: string): Promise<string | null> {
  if (!webPushSupported()) return null;
  const resolvedUserId = userId ?? (await api.session.ready())?.id;
  if (!resolvedUserId) return null;
  // See the TODO above: fail before the permission prompt and subscription.
  throw new AppError(WEB_PUSH_UNAVAILABLE, "web_push_unavailable");
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
 * subscription is stored for this device. Nothing can be stored yet (see the
 * TODO above), so `subscribed` stays false.
 */
export async function fetchPushState(): Promise<PushState> {
  const supported = webPushSupported();
  const configured = webPushConfigured();
  const permission = notificationPermission();
  if (!supported) {
    return { supported, configured, permission, subscribed: false, deviceId: null };
  }
  const user = await api.session.ready();
  return { supported, configured, permission, subscribed: false, deviceId: user ? await getDeviceId() : null };
}

/**
 * Re-saves a subscription the service worker rotated while the tab was open.
 * Nothing to save it to yet (see the TODO above).
 */
export async function syncWebPushSubscription(subscription: WebPushSubscriptionJson) {
  void subscription;
}

export async function setPushEnabled(enabled: boolean) {
  if (!(await api.session.ready())) return;

  if (enabled) {
    await registerForPushNotifications();
    return;
  }

  // Only this browser: `POST /v1/push-tokens/disable` would silence the phone
  // as well. The global switch is the `push_enabled` preference.
  await unsubscribeFromWebPush().catch(() => false);
}

/** `GET/PUT /v1/notifications/preferences` (`sheree-backend/docs/api/notifications.md`). */
type PreferencesRow = {
  push_enabled: boolean;
  booking_reminders: boolean;
  beauty_reminders: boolean;
  feed_updates: boolean;
  professional_updates: boolean;
  reengagement: boolean;
  marketing: boolean;
  booking_updates: boolean;
  portfolio_reminders: boolean;
  feed_engagement: boolean;
  business_reminders: boolean;
  quiet_hours_enabled: boolean;
  quiet_from: string;
  quiet_until: string;
};

export async function fetchNotificationPreferences(): Promise<NotificationPreferences> {
  if (!(await api.session.ready())) return defaultNotificationPreferences;
  const data = await api.get<PreferencesRow>("/v1/notifications/preferences");
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

// Saving with push off also disables push on every device, server side.
export async function saveNotificationPreferences(value: NotificationPreferences) {
  if (!(await api.session.ready())) throw new AppError("Sign in to save notification settings.");
  await api.put<PreferencesRow>("/v1/notifications/preferences", {
    body: {
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
      quiet_from: value.quietFrom.slice(0, 5),
      quiet_until: value.quietUntil.slice(0, 5),
    },
  });
}

/** Opaque, from the API: pass `nextCursor` back as it came. */
export type NotificationCursor = string;

type NotificationRow = {
  id: string;
  kind: AppNotification["kind"];
  audience: NotificationAudience;
  title: string;
  body: string;
  url: string | null;
  data: NotificationData | null;
  read_at: string | null;
  created_at: string;
};

/** Chat messages are left out by the API: they belong to the inbox. */
export async function fetchNotifications(
  audience: "customer" | "professional",
  cursor: NotificationCursor | null = null,
  pageSize = 30,
) {
  const page = await api.get<Page<NotificationRow>>("/v1/notifications", {
    query: { audience, cursor: cursor ?? undefined, page_size: Math.min(50, pageSize) },
  });
  return {
    items: page.items.map<AppNotification>((row) => ({
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
    nextCursor: page.next_cursor,
  };
}

export async function markNotificationRead(id: string) {
  await api.post<void>(`/v1/notifications/${encodeURIComponent(id)}/read`);
}

/** Records that a notification was acted on — drives the "opened" metric. */
export async function markNotificationOpened(id: string) {
  await api.post<void>(`/v1/notifications/${encodeURIComponent(id)}/opened`);
}

export async function recordAppOpen(mode: "customer" | "professional") {
  await api.post<void>("/v1/app-opens", { body: { mode } });
}

export async function markAllNotificationsRead(audience: "customer" | "professional") {
  await api.post<{ updated: number }>("/v1/notifications/read-all", { body: { audience } });
}

// The badge is decoration: it never throws, so a failure here can't take down
// the screen that loads it alongside its real content.
export async function fetchUnreadNotificationCount(audience: "customer" | "professional") {
  try {
    const { count } = await api.get<{ count: number }>("/v1/notifications/unread-count", {
      query: { audience },
    });
    return Number(count ?? 0);
  } catch {
    return 0;
  }
}
