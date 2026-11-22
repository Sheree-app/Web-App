import { env } from "@/lib/env";
import { browserTokenStore, crossTabLock, SESSION_STORAGE_KEY } from "./browser-token-store";
import { createApiClient } from "./client";

/**
 * The web app's single Sheree API client. Features import `api` from here and
 * call routes by path, e.g. `api.get<Page<Post>>('/v1/feed', { auth: 'optional' })`.
 * Route list: `sheree-backend/docs/endpoints.md`; payloads: `docs/api/*.md`.
 *
 * On the server (server components, route handlers) there is never a session:
 * only public routes (`auth: 'none'`) make sense there.
 */
export const isApiConfigured = Boolean(env.apiUrl);

export const api = createApiClient({
  baseUrl: env.apiUrl || null,
  store: browserTokenStore,
  lock: crossTabLock,
  onStorageError: (error, operation) => {
    console.warn(`[api] token storage ${operation} failed`, error);
  },
});

if (typeof window !== "undefined") {
  // Another tab signed in, refreshed or signed out.
  window.addEventListener("storage", (event) => {
    if (event.key === SESSION_STORAGE_KEY || event.key === null) void api.session.syncFromStore();
  });
}

export { ApiError, CLIENT_ERROR_CODES, isApiError } from "./errors";
export type { ApiClient, AuthMode, RequestOptions, SessionChangeReason, SessionListener } from "./client";
export type { ApiUser, ErrorEnvelope, Page, TokenResponse } from "./types";
