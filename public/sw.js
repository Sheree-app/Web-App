/* Sheree service worker — Web Push delivery.
 *
 * Served from the site root so its scope covers every route. The page
 * ([`src/features/notifications/web-push.ts`](../src/features/notifications/web-push.ts))
 * registers it, subscribes with the deployment's VAPID key, and stores the
 * subscription on the user's `push_tokens` row; `notification-worker` sends to
 * it. Nothing here holds state except the push subscription itself, which the
 * browser owns.
 */

const DEFAULT_URL = "/notifications";
const ICON = "/images/icon.png";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  // Take over without waiting for the next navigation: a freshly granted
  // permission should start receiving pushes immediately.
  event.waitUntil(self.clients.claim());
});

function payloadFrom(data) {
  if (!data) return {};
  try {
    return data.json();
  } catch {
    try {
      return { body: data.text() };
    } catch {
      return {};
    }
  }
}

self.addEventListener("push", (event) => {
  const payload = payloadFrom(event.data);
  const title = payload.title || "Sheree";
  const url = payload.url || (payload.data && payload.data.url) || DEFAULT_URL;
  const notificationId =
    payload.notificationId || (payload.data && payload.data.notificationId) || null;

  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || "",
      icon: payload.icon || ICON,
      badge: payload.badge || ICON,
      // Same notification id collapses updates instead of stacking duplicates.
      tag: notificationId || undefined,
      renotify: Boolean(notificationId),
      data: { url, notificationId },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const url = data.url || DEFAULT_URL;
  const notificationId = data.notificationId || null;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of windows) {
        if ("focus" in client) {
          // A Sheree tab is open: let the app route itself so the click keeps
          // its history and the page can mark the notification as opened.
          client.postMessage({ type: "sheree:notification-click", notificationId, url });
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })(),
  );
});

/* Browsers occasionally rotate a subscription. Re-subscribe with the same key
 * and hand the new subscription to an open page, which knows the signed-in user
 * and owns the database write. */
self.addEventListener("pushsubscriptionchange", (event) => {
  const applicationServerKey =
    event.oldSubscription && event.oldSubscription.options
      ? event.oldSubscription.options.applicationServerKey
      : null;
  if (!applicationServerKey) return;

  event.waitUntil(
    (async () => {
      const subscription = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of windows) {
        client.postMessage({
          type: "sheree:push-subscription-change",
          subscription: subscription.toJSON(),
        });
      }
    })(),
  );
});
