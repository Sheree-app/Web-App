import { ApiError, CLIENT_ERROR_CODES } from "@/lib/api/errors";

/**
 * Error copy for calls to the Sheree API (port of the mobile app's
 * `src/lib/errors.ts`, without the Supabase and Sentry parts).
 *
 * `AppError` carries a message that is safe to show as-is. API refusals with a
 * business code (`hold_expired`, `cannot_cancel`, ...) carry a message written
 * for the user, as the edge functions' `error` field did: `withServerMessage`
 * turns those into `AppError`s. Everything else gets the screen's own copy.
 */
export class AppError extends Error {
  readonly code: string;
  readonly supportCode?: string;
  constructor(message: string, code = "app_error", supportCode?: string) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.supportCode = supportCode;
  }
}

export const OFFLINE_MESSAGE = "We couldn’t reach Sheree. Check your connection and try again.";
export const SESSION_EXPIRED_MESSAGE = "Your session has expired. Sign in again to continue.";
export const GENERIC_MESSAGE = "Something went wrong on our side. Please try again.";
export const RATE_LIMITED_MESSAGE = "Too many attempts. Wait a minute and try again.";

/** Codes whose `message` is written for the user (`docs/api/README.md` § Errors). */
const API_USER_FACING_CODES = new Set(["rejected", "invalid_value", "forbidden"]);

const API_SESSION_CODES = new Set<string>([
  "invalid_access_token",
  "invalid_refresh_token",
  CLIENT_ERROR_CODES.notSignedIn,
]);

/** Codes whose message is generic or technical, never copy for the user. */
const GENERIC_API_CODES = new Set<string>([
  "validation_failed",
  "bad_request",
  "unauthorized",
  "internal",
  "rate_limited",
  "invalid_access_token",
  "invalid_refresh_token",
  CLIENT_ERROR_CODES.network,
  CLIENT_ERROR_CODES.timeout,
  CLIENT_ERROR_CODES.notSignedIn,
  CLIENT_ERROR_CODES.notConfigured,
  CLIENT_ERROR_CODES.badResponse,
]);

export function isNetworkError(error: unknown): boolean {
  if (error instanceof ApiError) {
    return error.code === CLIENT_ERROR_CODES.network || error.code === CLIENT_ERROR_CODES.timeout;
  }
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return message.includes("failed to fetch") || message.includes("network request failed");
}

export function isSessionExpired(error: unknown): boolean {
  return error instanceof ApiError && API_SESSION_CODES.has(error.code);
}

/**
 * Turns a business refusal from the booking, payment and similar routes into
 * an `AppError` whose message is shown as-is. Generic failures pass through.
 */
export function withServerMessage(error: unknown): unknown {
  if (!(error instanceof ApiError) || !error.message) return error;
  if (error.status >= 500 && error.status !== 502 && error.status !== 503) return error;
  if (GENERIC_API_CODES.has(error.code)) return error;
  const details = (error.details as { support_code?: unknown; supportCode?: unknown } | undefined) ?? {};
  const supportCode =
    typeof details.support_code === "string"
      ? details.support_code
      : typeof details.supportCode === "string"
        ? details.supportCode
        : undefined;
  return new AppError(error.message, error.code, supportCode);
}

/** The stable code of an error from our server, if any. */
export function errorCode(error: unknown): string | null {
  if (error instanceof AppError || error instanceof ApiError) return error.code;
  return null;
}

/** The text to show for `error`; unknown errors become `fallback` and are logged. */
export function userMessage(error: unknown, fallback: string = GENERIC_MESSAGE, context?: string): string {
  if (error instanceof AppError) return error.message;
  if (isNetworkError(error)) return OFFLINE_MESSAGE;
  if (isSessionExpired(error)) return SESSION_EXPIRED_MESSAGE;
  if (error instanceof ApiError) {
    if (error.code === "rate_limited") return RATE_LIMITED_MESSAGE;
    if (API_USER_FACING_CODES.has(error.code) && error.message) return error.message;
    if (error.status >= 500 || error.code === CLIENT_ERROR_CODES.badResponse) reportError(error, context);
    return fallback;
  }
  reportError(error, context);
  return fallback;
}

export function reportError(error: unknown, context?: string): void {
  try {
    console.error(context ? `[${context}]` : "[error]", error);
  } catch {
    /* never throw into UI code */
  }
}
