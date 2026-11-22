/**
 * Shapes shared by every Sheree API route. The full contract lives in the
 * backend repo: `sheree-backend/docs/api/*.md` (written by hand, one page per
 * area) and `docs/openapi.json` (request schemas only; responses are not typed
 * there yet). Response types for each feature live next to that feature's
 * `api.ts` as it is ported.
 */

/** `user` in every token response. */
export type ApiUser = {
  /** Same UUID as the Supabase user id. */
  id: string;
  role: 'customer' | 'professional';
  /** Blocked accounts never receive tokens. */
  account_status: 'active' | 'suspended';
};

/**
 * Returned by sign-in, verify-email, password reset, exchange and refresh
 * (`docs/api/auth.md`, `POST /v1/auth/sign-in`).
 */
export type TokenResponse = {
  access_token: string;
  token_type: 'Bearer';
  /** Seconds. Always 900. */
  expires_in: number;
  /** Opaque and single use: every refresh returns a new one. */
  refresh_token: string;
  /** ISO 8601. Mobile logins slide to 60 days on every refresh. */
  refresh_expires_at: string;
  user: ApiUser;
};

/** Every non-2xx response: `{ error: { code, message, details? } }`. */
export type ErrorEnvelope = {
  error: { code: string; message: string; details?: unknown };
};

/** Cursor-paged lists. Pass `next_cursor` back as `?cursor=`; `null` means the end. */
export type Page<T> = { items: T[]; next_cursor: string | null };
