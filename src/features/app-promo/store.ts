/**
 * Store listings and the "not now" memory for the get-the-app banners.
 *
 * The ids match the mobile app's `app.config.ts` (bundle id / Android package);
 * the App Store id comes from Apple's public lookup for that bundle id.
 */
export const APP_STORE_ID = "6799416814";
export const ANDROID_PACKAGE = "com.raphaelwright.sheree";

export const APP_STORE_URL = `https://apps.apple.com/app/id${APP_STORE_ID}`;
export const PLAY_STORE_URL = `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`;

export type Store = "ios" | "android";

/**
 * What the visitor is on, as far as the stores care:
 * - `ios` / `android`: a phone or tablet. Show only that store.
 * - `mac`: a Mac, whose owner most likely carries an iPhone. Show both, Apple first.
 * - `desktop`: Windows, Linux, ChromeOS or unknown. Show both, Google Play first
 *   (ChromeOS installs from Play, and most of our audience is on Android).
 */
export type StorePlatform = "ios" | "android" | "mac" | "desktop";

export type PlatformHints = {
  userAgent: string;
  /** `navigator.maxTouchPoints`, which unmasks an iPad posing as a Mac. */
  maxTouchPoints?: number;
  /** `navigator.userAgentData.platform` (Chromium only), e.g. "Android", "macOS". */
  uaPlatform?: string | null;
};

export function detectPlatform({ userAgent, maxTouchPoints = 0, uaPlatform }: PlatformHints): StorePlatform {
  const hint = uaPlatform?.toLowerCase() ?? "";
  // Client hints are more reliable than the user-agent string where they exist.
  if (hint === "android") return "android";
  if (hint === "ios") return "ios";

  // iPhone, iPod, older iPads, and Chrome/Firefox/in-app browsers on iOS.
  if (/iphone|ipad|ipod/i.test(userAgent)) return "ios";
  // Before Android: some Android browsers mention "like Mac OS X" or "Linux".
  if (/android/i.test(userAgent)) return "android";
  // iPadOS 13+ reports itself as desktop Safari on a Mac; only touch gives it away.
  const mac = hint === "macos" || /macintosh|mac os x/i.test(userAgent);
  if (mac) return maxTouchPoints > 1 ? "ios" : "mac";
  return "desktop";
}

/** Which store buttons to show, in order. */
export function storesFor(platform: StorePlatform): Store[] {
  switch (platform) {
    case "ios":
      return ["ios"];
    case "android":
      return ["android"];
    case "mac":
      return ["ios", "android"];
    default:
      return ["android", "ios"];
  }
}

export const STORE_URL: Record<Store, string> = { ios: APP_STORE_URL, android: PLAY_STORE_URL };

/**
 * One "not now" quiets every banner for a while: someone who closes the feed
 * tile shouldn't meet the same ask on Bookings a minute later.
 */
const DISMISSED_KEY = "sheree:app-promo-dismissed-at";
export const DISMISS_DAYS = 4;

export function isDismissed(now = Date.now()): boolean {
  try {
    const at = Number(window.localStorage.getItem(DISMISSED_KEY));
    return Number.isFinite(at) && at > 0 && now - at < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

const listeners = new Set<() => void>();

export function dismissAppPromo() {
  try {
    window.localStorage.setItem(DISMISSED_KEY, String(Date.now()));
  } catch {
    /* still hide for this page view */
  }
  dismissedThisView = true;
  listeners.forEach((listener) => listener());
}

let dismissedThisView = false;

/** For useSyncExternalStore: re-render every banner when one is dismissed. */
export function subscribeAppPromo(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function appPromoHidden() {
  return dismissedThisView || isDismissed();
}
