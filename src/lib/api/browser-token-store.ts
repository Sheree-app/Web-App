import type { StoredSession, TokenStore } from "./client";

/**
 * Where the web keeps the login: the refresh token, its expiry and the user, in
 * localStorage (the access token stays in memory). Every tab of the site shares
 * it; `index.ts` follows changes made by other tabs.
 *
 * A second, value-less cookie (`sheree_signed_in=1`) tells the Next.js proxy
 * that someone is probably signed in, so it can keep signed-out visitors off
 * protected pages without a round trip. It is a hint, not a credential: the API
 * checks the real token on every call.
 */
export const SESSION_STORAGE_KEY = "sheree:api-session";
export const SIGNED_IN_COOKIE = "sheree_signed_in";

function setHintCookie(expiresAt: string | null) {
  if (typeof document === "undefined") return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  if (!expiresAt) {
    document.cookie = `${SIGNED_IN_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
    return;
  }
  const seconds = Math.floor((Date.parse(expiresAt) - Date.now()) / 1000);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    setHintCookie(null);
    return;
  }
  document.cookie = `${SIGNED_IN_COOKIE}=1; Path=/; Max-Age=${seconds}; SameSite=Lax${secure}`;
}

function isStoredSession(value: unknown): value is StoredSession {
  const v = value as Partial<StoredSession> | null;
  return Boolean(
    v &&
      typeof v.refreshToken === "string" &&
      typeof v.refreshExpiresAt === "string" &&
      v.user &&
      typeof v.user.id === "string",
  );
}

export const browserTokenStore: TokenStore = {
  async load() {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    let session: StoredSession | null = null;
    if (raw) {
      try {
        const parsed: unknown = JSON.parse(raw);
        session = isStoredSession(parsed) ? parsed : null;
      } catch {
        session = null;
      }
    }
    // Keep the proxy's hint in step with what is really stored.
    setHintCookie(session?.refreshExpiresAt ?? null);
    return session;
  },
  async save(session) {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    setHintCookie(session.refreshExpiresAt);
  },
  async clear() {
    if (typeof window === "undefined") return;
    setHintCookie(null);
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
  },
};

/** Serialises token refreshes across tabs; plain call where Web Locks are missing. */
export function crossTabLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks?.request) return fn();
  return locks.request("sheree-api-refresh", fn) as Promise<T>;
}
