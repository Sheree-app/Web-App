import { env } from "@/lib/env";

/**
 * Web Push, the browser's counterpart to the app's Expo push tokens.
 *
 * Three things have to line up before a push can arrive: the browser must
 * support service workers and the Push API, the deployment must publish a VAPID
 * public key, and the visitor must grant permission. This module owns the first
 * two checks and the subscription lifecycle; persisting the subscription to
 * `push_tokens` is [`api.ts`](./api.ts)'s job, and actually sending is
 * `notification-worker`'s.
 */

export type WebPushSubscriptionJson = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

/** The public half of the VAPID pair. Empty means push isn't set up here. */
export const vapidPublicKey = env.vapidPublicKey;

export function webPushConfigured() {
  return vapidPublicKey.length > 0;
}

export function webPushSupported() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function notificationPermission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

/** VAPID keys and subscription keys are base64url; PushManager wants bytes. */
export function urlBase64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

/**
 * Registers `/sw.js` and waits until it controls the page, so a push sent in
 * the same session is actually delivered.
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!webPushSupported()) return null;
  const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  if (!navigator.serviceWorker.controller) {
    await new Promise<void>((resolve) => {
      const timer = window.setTimeout(resolve, 3000);
      navigator.serviceWorker.addEventListener(
        "controllerchange",
        () => {
          window.clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  }
  return registration;
}

async function registrationFor(): Promise<ServiceWorkerRegistration | null> {
  if (!webPushSupported()) return null;
  const existing = await navigator.serviceWorker.getRegistration("/");
  if (existing) return existing;
  return registerServiceWorker();
}

/** The subscription this browser already holds, as plain JSON. */
export async function existingSubscriptionJson(): Promise<WebPushSubscriptionJson | null> {
  const registration = await registrationFor();
  if (!registration) return null;
  const subscription = await registration.pushManager.getSubscription();
  return subscription ? (subscription.toJSON() as WebPushSubscriptionJson) : null;
}

/**
 * Asks for permission and returns the subscription — reusing the browser's own
 * if it already has one, so re-enabling never creates a duplicate endpoint.
 */
export async function subscribeToWebPush(): Promise<WebPushSubscriptionJson | null> {
  if (!webPushSupported() || !webPushConfigured()) return null;

  const registration = await registrationFor();
  if (!registration) return null;

  const existing = await registration.pushManager.getSubscription();
  if (existing) return existing.toJSON() as WebPushSubscriptionJson;

  if (Notification.permission !== "granted") {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return null;
  }

  const subscription = await registration.pushManager.subscribe({
    // Every push must surface something to the user; browsers reject otherwise.
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  });
  return subscription.toJSON() as WebPushSubscriptionJson;
}

/** Drops the browser subscription. The caller clears the `push_tokens` row. */
export async function unsubscribeFromWebPush() {
  const registration = await registrationFor();
  if (!registration) return false;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return false;
  return subscription.unsubscribe();
}

/**
 * Shows a notification straight from the service worker — the same rendering
 * path a delivered push uses, so people can check their setup without waiting
 * for a real one.
 */
export async function previewWebPush(title: string, body: string, url = "/notifications") {
  const registration = await registrationFor();
  if (!registration || Notification.permission !== "granted") return false;
  await registration.showNotification(title, {
    body,
    icon: "/images/icon.png",
    badge: "/images/icon.png",
    tag: "sheree-preview",
    data: { url, notificationId: null },
  });
  return true;
}

type ServiceWorkerMessages = {
  onNotificationClick?: (payload: { notificationId: string | null; url: string }) => void;
  onSubscriptionChange?: (subscription: WebPushSubscriptionJson) => void;
};

/**
 * Bridges the service worker back into the app: a notification click should
 * route the open tab, and a rotated subscription has to be re-saved.
 */
export function listenToServiceWorker({
  onNotificationClick,
  onSubscriptionChange,
}: ServiceWorkerMessages) {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return () => undefined;

  const handler = (event: MessageEvent) => {
    const message = event.data;
    if (!message || typeof message !== "object") return;
    if (message.type === "sheree:notification-click") {
      onNotificationClick?.({
        notificationId: message.notificationId ?? null,
        url: typeof message.url === "string" ? message.url : "/notifications",
      });
      return;
    }
    if (message.type === "sheree:push-subscription-change" && message.subscription) {
      onSubscriptionChange?.(message.subscription as WebPushSubscriptionJson);
    }
  };

  navigator.serviceWorker.addEventListener("message", handler);
  return () => navigator.serviceWorker.removeEventListener("message", handler);
}
