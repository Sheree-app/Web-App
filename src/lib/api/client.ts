import { ApiError, CLIENT_ERROR_CODES, isApiError } from './errors';
import type { ApiUser, ErrorEnvelope, TokenResponse } from './types';

/**
 * HTTP client for the Sheree API (NestJS, `sheree-backend`).
 *
 * Sessions follow `docs/api/auth.md`:
 * - The access token (ES256 JWT, 15 min) is kept in memory only. It is
 *   refreshed shortly before it expires, and once more if the server still
 *   answers `401 invalid_access_token`.
 * - The refresh token is single use and rotates on every refresh. Only it, its
 *   expiry and the user are persisted (through `TokenStore`, localStorage on
 *   the web). Refreshes are single-flight: two refreshes with the same token would
 *   trip the server's reuse detection and end the login.
 * - The session is dropped only when the server says it is over
 *   (`invalid_refresh_token`, `account_blocked`, ...). Being offline or a 5xx
 *   never signs anyone out.
 *
 * Web additions over the mobile client: several tabs share one stored login,
 * so refreshes take a cross-tab `lock` and re-read storage first (a refresh
 * with a token another tab already spent would trip reuse detection), and
 * `session.syncFromStore()` follows sign-ins and sign-outs made in other tabs.
 *
 * This file must not touch browser globals so it stays testable under vitest;
 * the app's wiring lives in `./index.ts`.
 */

export type StoredSession = {
  refreshToken: string;
  /** ISO 8601, from `refresh_expires_at`. */
  refreshExpiresAt: string;
  user: ApiUser;
};

export interface TokenStore {
  load(): Promise<StoredSession | null>;
  save(session: StoredSession): Promise<void>;
  clear(): Promise<void>;
}

/**
 * `none`: never sends a token. `optional`: sends one when signed in (the
 * response is personalised). `required`: fails with `not_signed_in` without one.
 * Matches the "Auth" column in `docs/endpoints.md`.
 */
export type AuthMode = 'none' | 'optional' | 'required';

export type QueryValue = string | number | boolean | null | undefined;

export type RequestOptions = {
  query?: Record<string, QueryValue | QueryValue[]>;
  /** Serialised as JSON. */
  body?: unknown;
  /** Defaults to `required`. */
  auth?: AuthMode;
  signal?: AbortSignal;
  timeoutMs?: number;
  headers?: Record<string, string>;
};

export type SessionChangeReason = 'signed_in' | 'refreshed' | 'signed_out' | 'expired';
export type SessionListener = (user: ApiUser | null, reason: SessionChangeReason) => void;

export type ApiClientOptions = {
  /** e.g. `https://api.example.com` (no `/v1`, no trailing slash needed). `null` = not configured. */
  baseUrl: string | null;
  store: TokenStore;
  fetch?: typeof fetch;
  now?: () => number;
  /** Per-request timeout. Default 20 s. */
  timeoutMs?: number;
  /** Refresh this long before the access token expires. Default 60 s. */
  refreshMarginMs?: number;
  /**
   * Runs `fn` while holding a lock shared by every tab (Web Locks). Default:
   * no lock, which is fine for a single tab.
   */
  lock?: <T>(fn: () => Promise<T>) => Promise<T>;
  /** A storage read or write failed. The session still works for this run. */
  onStorageError?: (error: unknown, operation: 'load' | 'save' | 'clear') => void;
};

/** Refresh answers that mean the login is over and signing in again is the only fix. */
const SESSION_ENDING_CODES = new Set([
  'invalid_refresh_token',
  'account_blocked',
  'account_not_found',
  'not_an_admin',
]);

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_REFRESH_MARGIN_MS = 60_000;

export type ApiClient = ReturnType<typeof createApiClient>;

export function createApiClient(options: ApiClientOptions) {
  const baseUrl = options.baseUrl ? options.baseUrl.replace(/\/+$/, '') : null;
  // Without a scheme (`api.example.com`) fetch fails before any request is
  // sent, which would read as "offline". Say what is wrong instead.
  const badBaseUrl = baseUrl !== null && !/^https?:\/\/[^/]+/i.test(baseUrl);
  const doFetch = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const refreshMarginMs = options.refreshMarginMs ?? DEFAULT_REFRESH_MARGIN_MS;
  const { store } = options;

  let access: { token: string; expiresAt: number } | null = null;
  let stored: StoredSession | null = null;
  let loading: Promise<void> | null = null;
  let refreshing: Promise<string | null> | null = null;
  // Bumped on every sign-in and sign-out, so a refresh that finishes after the
  // session changed cannot put the old login back.
  let generation = 0;
  const listeners = new Set<SessionListener>();

  const notify = (reason: SessionChangeReason) => {
    const user = stored?.user ?? null;
    for (const listener of listeners) {
      try {
        listener(user, reason);
      } catch {
        /* a listener must not break the client */
      }
    }
  };

  const storageError = (error: unknown, operation: 'load' | 'save' | 'clear') => {
    try {
      options.onStorageError?.(error, operation);
    } catch {
      /* reporting must not break the client */
    }
  };

  const isExpired = (session: StoredSession) => {
    const end = Date.parse(session.refreshExpiresAt);
    return Number.isFinite(end) && end <= now();
  };

  function ensureLoaded(): Promise<void> {
    if (!loading) {
      loading = (async () => {
        const startedAt = generation;
        let session: StoredSession | null = null;
        try {
          session = await store.load();
        } catch (error) {
          // Unreadable storage: signed out for this run, but nothing is
          // deleted, so the next launch can still read it.
          storageError(error, 'load');
          return;
        }
        // A sign-in that happened while storage was being read wins.
        if (startedAt !== generation) return;
        if (session && isExpired(session)) {
          await store.clear().catch((error: unknown) => storageError(error, 'clear'));
          return;
        }
        stored = session;
      })();
    }
    return loading;
  }

  async function persist(session: StoredSession) {
    try {
      await store.save(session);
    } catch (error) {
      // The login works in memory. If the app is killed before the next
      // successful save, the next launch holds a spent refresh token.
      storageError(error, 'save');
    }
  }

  async function forget() {
    access = null;
    stored = null;
    try {
      await store.clear();
    } catch (error) {
      storageError(error, 'clear');
    }
  }

  async function applyTokens(tokens: TokenResponse) {
    access = { token: tokens.access_token, expiresAt: now() + tokens.expires_in * 1000 };
    stored = {
      refreshToken: tokens.refresh_token,
      refreshExpiresAt: tokens.refresh_expires_at,
      user: tokens.user,
    };
    await persist(stored);
  }

  const withLock = options.lock ?? (<T>(fn: () => Promise<T>) => fn());

  /** The session changed mid-refresh: ask again once the lock is released. */
  const RETRY = Symbol('retry');

  async function runRefresh(): Promise<string | null> {
    const result = await withLock(refreshLocked);
    // Never re-enter from inside the lock: Web Locks would wait on itself.
    return result === RETRY ? accessToken() : result;
  }

  async function refreshLocked(): Promise<string | null | typeof RETRY> {
    const startedAt = generation;
    let session = stored;
    if (!session) throw notSignedIn();
    // Another tab may have refreshed (or signed out) while this one waited for
    // the lock; its rotated token is in storage and ours is spent.
    if (options.lock) {
      let latest: StoredSession | null | undefined;
      try {
        latest = await store.load();
      } catch {
        latest = undefined;
      }
      if (startedAt !== generation) return RETRY;
      if (latest === null) {
        generation += 1;
        access = null;
        stored = null;
        notify('signed_out');
        throw notSignedIn();
      }
      if (latest && latest.refreshToken !== session.refreshToken) {
        if (latest.user.id !== session.user.id) {
          generation += 1;
          access = null;
          stored = latest;
          notify('signed_in');
          // The token we were refreshing belonged to someone else; refresh the
          // new login on the next request.
          throw notSignedIn();
        }
        session = latest;
        stored = latest;
      }
    }
    // One retry, for `refresh_conflict` when storage holds a newer token.
    for (let attempt = 0; ; attempt += 1) {
      try {
        const tokens = await send<TokenResponse>('POST', '/v1/auth/refresh', {
          body: { refresh_token: session.refreshToken },
        }, null);
        if (startedAt !== generation) return RETRY;
        await applyTokens(tokens);
        notify('refreshed');
        return tokens.access_token;
      } catch (error) {
        if (startedAt !== generation) return RETRY;
        if (!isApiError(error)) throw error;
        if (error.code === 'refresh_conflict' && attempt === 0) {
          // Another refresh with this token won within the last 10 s. Its
          // result can only be in storage (this client is single-flight), e.g.
          // from a previous run killed right after saving.
          const latest = await store.load().catch(() => null);
          if (latest && latest.refreshToken !== session.refreshToken) {
            session = latest;
            stored = latest;
            continue;
          }
          throw error;
        }
        if (SESSION_ENDING_CODES.has(error.code)) {
          generation += 1;
          await forget();
          notify('expired');
        }
        throw error;
      }
    }
  }

  /** A valid access token, refreshing if needed; `null` when signed out. */
  async function accessToken(force = false): Promise<string | null> {
    await ensureLoaded();
    if (!stored) return null;
    if (!force && access && access.expiresAt - refreshMarginMs > now()) return access.token;
    if (!refreshing) {
      const current: Promise<string | null> = runRefresh().finally(() => {
        if (refreshing === current) refreshing = null;
      });
      refreshing = current;
    }
    return refreshing;
  }

  function notSignedIn() {
    return new ApiError(401, CLIENT_ERROR_CODES.notSignedIn, 'Not signed in');
  }

  function buildUrl(path: string, query?: RequestOptions['query']) {
    if (!baseUrl) {
      throw new ApiError(0, CLIENT_ERROR_CODES.notConfigured, 'NEXT_PUBLIC_API_URL is not set');
    }
    if (badBaseUrl) {
      throw new ApiError(
        0,
        CLIENT_ERROR_CODES.notConfigured,
        `NEXT_PUBLIC_API_URL must start with https:// (got "${baseUrl}")`,
      );
    }
    const params: string[] = [];
    for (const [key, raw] of Object.entries(query ?? {})) {
      for (const value of Array.isArray(raw) ? raw : [raw]) {
        if (value === undefined || value === null) continue;
        params.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
      }
    }
    return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}${params.length ? `?${params.join('&')}` : ''}`;
  }

  async function send<T>(
    method: string,
    path: string,
    opts: RequestOptions,
    token: string | null,
  ): Promise<T> {
    const endpoint = `${method} ${path}`;
    const url = buildUrl(path, opts.query);
    const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, opts.timeoutMs ?? timeoutMs);
    const onAbort = () => controller.abort();
    opts.signal?.addEventListener('abort', onAbort);
    if (opts.signal?.aborted) controller.abort();

    let response: Response;
    let text: string;
    try {
      response = await doFetch(url, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: controller.signal,
      });
      text = await response.text();
    } catch (error) {
      if (timedOut) {
        throw new ApiError(0, CLIENT_ERROR_CODES.timeout, 'Request timed out', { endpoint, cause: error });
      }
      // Cancelled by the caller: let them see their own abort.
      if (opts.signal?.aborted) throw error;
      throw new ApiError(0, CLIENT_ERROR_CODES.network, 'Network request failed', { endpoint, cause: error });
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
    }

    let json: unknown = undefined;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
    }

    if (!response.ok) {
      const envelope = (json as Partial<ErrorEnvelope> | undefined)?.error;
      const retryHeader = Number(response.headers.get('Retry-After'));
      const retryAfter = Number.isFinite(retryHeader) && retryHeader > 0 ? retryHeader : undefined;
      if (envelope && typeof envelope.code === 'string') {
        throw new ApiError(response.status, envelope.code, String(envelope.message ?? ''), {
          details: envelope.details,
          retryAfter,
          endpoint,
        });
      }
      throw new ApiError(response.status, CLIENT_ERROR_CODES.badResponse, `HTTP ${response.status}`, {
        retryAfter,
        endpoint,
      });
    }
    if (!text) return undefined as T;
    if (json === undefined) {
      throw new ApiError(response.status, CLIENT_ERROR_CODES.badResponse, 'Response was not JSON', { endpoint });
    }
    return json as T;
  }

  async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const auth = opts.auth ?? 'required';
    let token: string | null = null;
    if (auth !== 'none') {
      try {
        token = await accessToken();
      } catch (error) {
        // The login just ended: an optional route can still answer signed out.
        if (auth === 'optional' && !stored) token = null;
        else throw error;
      }
      if (auth === 'required' && !token) throw notSignedIn();
    }
    try {
      return await send<T>(method, path, opts, token);
    } catch (error) {
      // The guard refused the token before the handler ran, so a retry is
      // safe even for writes. Happens after a key rotation or clock skew.
      if (token && isApiError(error) && error.status === 401 && error.code === 'invalid_access_token') {
        // Force a refresh only if the rejected token is still the current one.
        // If another request already refreshed, reuse its token: every extra
        // rotation is another chance to lose a refresh reply.
        const fresh = await accessToken(access?.token === token);
        if (!fresh) throw notSignedIn();
        return send<T>(method, path, opts, fresh);
      }
      throw error;
    }
  }

  return {
    get: <T>(path: string, opts?: Omit<RequestOptions, 'body'>) => request<T>('GET', path, opts),
    post: <T>(path: string, opts?: RequestOptions) => request<T>('POST', path, opts),
    put: <T>(path: string, opts?: RequestOptions) => request<T>('PUT', path, opts),
    patch: <T>(path: string, opts?: RequestOptions) => request<T>('PATCH', path, opts),
    delete: <T>(path: string, opts?: RequestOptions) => request<T>('DELETE', path, opts),

    session: {
      /** Reads the stored session once; resolves to the signed-in user or `null`. */
      async ready(): Promise<ApiUser | null> {
        await ensureLoaded();
        return stored?.user ?? null;
      },
      /** The signed-in user as of the last load or refresh, without I/O. */
      user: (): ApiUser | null => stored?.user ?? null,
      /** A valid access token (for Convex token exchange and similar), or `null`. */
      accessToken: () => accessToken(),
      /**
       * Starts a session from a token response: sign-in, verify-email,
       * password reset or the one-time Supabase exchange.
       */
      async start(tokens: TokenResponse): Promise<void> {
        await ensureLoaded();
        generation += 1;
        refreshing = null;
        await applyTokens(tokens);
        notify('signed_in');
      },
      /**
       * Signs out on this device at once, then ends the login on the server
       * (best effort: an unreachable server leaves a login that expires on its
       * own and holds no token on this device).
       */
      async signOut(): Promise<void> {
        await ensureLoaded();
        const refreshToken = stored?.refreshToken;
        generation += 1;
        refreshing = null;
        await forget();
        notify('signed_out');
        if (refreshToken) {
          await send('POST', '/v1/auth/sign-out', { body: { refresh_token: refreshToken } }, null).catch(
            () => undefined,
          );
        }
      },
      /**
       * Re-reads storage after another tab changed it (the `storage` event).
       * Never calls the server: the other tab already did.
       */
      async syncFromStore(): Promise<void> {
        await ensureLoaded();
        let latest: StoredSession | null;
        try {
          latest = await store.load();
        } catch (error) {
          storageError(error, 'load');
          return;
        }
        if (latest && isExpired(latest)) latest = null;
        const current = stored;
        if (!latest) {
          if (!current) return;
          generation += 1;
          refreshing = null;
          access = null;
          stored = null;
          notify('signed_out');
          return;
        }
        if (current && current.user.id === latest.user.id) {
          // A refresh in another tab: keep our access token (still valid),
          // take the new refresh token so ours is never reused.
          stored = latest;
          return;
        }
        generation += 1;
        refreshing = null;
        access = null;
        stored = latest;
        notify('signed_in');
      },
      subscribe(listener: SessionListener): () => void {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
  };
}
