/**
 * Codes the client itself produces. They never come from the server, so they
 * cannot collide with the codes in `sheree-backend/docs/api/README.md`.
 */
export const CLIENT_ERROR_CODES = {
  /** The request never got an HTTP response (offline, DNS, TLS, reset). */
  network: 'network_error',
  /** No response within the client timeout. */
  timeout: 'timeout',
  /** A signed-in route was called with no session on the device. */
  notSignedIn: 'not_signed_in',
  /** `NEXT_PUBLIC_API_URL` is not set in this build. */
  notConfigured: 'api_not_configured',
  /** A non-2xx response without our error envelope (proxy page, 502 from the host). */
  badResponse: 'bad_response',
} as const;

/**
 * Any failed call to the Sheree API. Branch on `code`, never on `message`
 * (`docs/api/README.md` § Errors). Whether `message` may be shown to the user
 * is decided in `src/lib/errors.ts` (`userMessage`), not here.
 */
export class ApiError extends Error {
  /** HTTP status, or 0 when there was no response. */
  readonly status: number;
  readonly code: string;
  /** Validation fields, `pending_authentication_token`, `min_length`, … */
  readonly details?: unknown;
  /** Seconds, from the `Retry-After` header on 429. */
  readonly retryAfter?: number;
  /** `METHOD /path` without the query string, for telemetry. */
  readonly endpoint?: string;

  constructor(
    status: number,
    code: string,
    message: string,
    options: { details?: unknown; retryAfter?: number; endpoint?: string; cause?: unknown } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = options.details;
    this.retryAfter = options.retryAfter;
    this.endpoint = options.endpoint;
    if (options.cause !== undefined) (this as { cause?: unknown }).cause = options.cause;
  }
}

export const isApiError = (error: unknown): error is ApiError => error instanceof ApiError;
