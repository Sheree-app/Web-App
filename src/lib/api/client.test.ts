import { describe, expect, it, vi } from 'vitest';
import { createApiClient, type StoredSession, type TokenStore } from './client';
import { ApiError } from './errors';
import type { TokenResponse } from './types';

const BASE = 'https://api.test';
const user = { id: '6f1c2d3e-4a5b-4c6d-8e7f-90a1b2c3d4e5', role: 'customer', account_status: 'active' } as const;

const tokens = (n: number, expiresIn = 900): TokenResponse => ({
  access_token: `access-${n}`,
  token_type: 'Bearer',
  expires_in: expiresIn,
  refresh_token: `refresh-${n}`,
  refresh_expires_at: '2099-01-01T00:00:00.000Z',
  user,
});

const json = (status: number, body?: unknown, headers: Record<string, string> = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers });

const apiError = (status: number, code: string, message = code) => json(status, { error: { code, message } });

function memoryStore(initial: StoredSession | null = null) {
  let value = initial;
  const store: TokenStore & { value: () => StoredSession | null } = {
    load: vi.fn(async () => value),
    save: vi.fn(async (s: StoredSession) => {
      value = s;
    }),
    clear: vi.fn(async () => {
      value = null;
    }),
    value: () => value,
  };
  return store;
}

const stored = (n: number): StoredSession => ({
  refreshToken: `refresh-${n}`,
  refreshExpiresAt: '2099-01-01T00:00:00.000Z',
  user,
});

type Route = (init: RequestInit, url: string) => Response | Promise<Response>;

/** A fetch that answers by `METHOD /path` and records what it was sent. */
function fakeFetch(routes: Record<string, Route | Route[]>) {
  const calls: { key: string; url: string; init: RequestInit }[] = [];
  const counters: Record<string, number> = {};
  const fn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const key = `${init.method} ${new URL(url).pathname}`;
    calls.push({ key, url, init });
    const route = routes[key];
    if (!route) throw new Error(`unexpected ${key}`);
    const handler = Array.isArray(route) ? route[Math.min((counters[key] = (counters[key] ?? -1) + 1), route.length - 1)] : route;
    return handler(init, url);
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

const authHeader = (init: RequestInit) => (init.headers as Record<string, string>).Authorization;
const bodyOf = (init: RequestInit) => JSON.parse(String(init.body));

describe('requests', () => {
  it('builds the URL, sends JSON and parses the response', async () => {
    const { fetch, calls } = fakeFetch({ 'POST /v1/things': () => json(201, { id: 1 }) });
    const api = createApiClient({ baseUrl: `${BASE}/`, store: memoryStore(), fetch });
    const result = await api.post<{ id: number }>('/v1/things', {
      auth: 'none',
      body: { a: 1 },
      query: { q: 'nail art', tag: ['x', 'y'], skip: undefined, none: null },
    });
    expect(result).toEqual({ id: 1 });
    expect(calls[0].url).toBe(`${BASE}/v1/things?q=nail%20art&tag=x&tag=y`);
    expect(bodyOf(calls[0].init)).toEqual({ a: 1 });
    expect(authHeader(calls[0].init)).toBeUndefined();
  });

  it('returns undefined for 204', async () => {
    const { fetch } = fakeFetch({ 'DELETE /v1/x': () => new Response(null, { status: 204 }) });
    const api = createApiClient({ baseUrl: BASE, store: memoryStore(), fetch });
    await expect(api.delete('/v1/x', { auth: 'none' })).resolves.toBeUndefined();
  });

  it('turns the error envelope into an ApiError with details and Retry-After', async () => {
    const { fetch } = fakeFetch({
      'POST /v1/auth/sign-in': () =>
        json(429, { error: { code: 'rate_limited', message: 'Too many', details: { x: 1 } } }, { 'Retry-After': '30' }),
    });
    const api = createApiClient({ baseUrl: BASE, store: memoryStore(), fetch });
    const error = await api.post('/v1/auth/sign-in', { auth: 'none', body: {} }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 429, code: 'rate_limited', retryAfter: 30, details: { x: 1 }, endpoint: 'POST /v1/auth/sign-in' });
  });

  it('marks responses without our envelope as bad_response', async () => {
    const { fetch } = fakeFetch({ 'GET /v1/health': () => new Response('<html>Application failed to respond</html>', { status: 502 }) });
    const api = createApiClient({ baseUrl: BASE, store: memoryStore(), fetch });
    await expect(api.get('/v1/health', { auth: 'none' })).rejects.toMatchObject({ status: 502, code: 'bad_response' });
  });

  it('maps fetch failures to network_error and timeouts to timeout', async () => {
    const failing = vi.fn(async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;
    const api = createApiClient({ baseUrl: BASE, store: memoryStore(), fetch: failing });
    await expect(api.get('/v1/x', { auth: 'none' })).rejects.toMatchObject({ status: 0, code: 'network_error' });

    const hanging = vi.fn(
      (_: unknown, init: RequestInit) =>
        new Promise<Response>((_, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted')))),
    ) as unknown as typeof fetch;
    const slow = createApiClient({ baseUrl: BASE, store: memoryStore(), fetch: hanging, timeoutMs: 5 });
    await expect(slow.get('/v1/x', { auth: 'none' })).rejects.toMatchObject({ code: 'timeout' });
  });

  it('rethrows the caller’s own abort', async () => {
    const hanging = vi.fn(
      (_: unknown, init: RequestInit) =>
        new Promise<Response>((_, reject) =>
          init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))),
        ),
    ) as unknown as typeof fetch;
    const api = createApiClient({ baseUrl: BASE, store: memoryStore(), fetch: hanging });
    const controller = new AbortController();
    const pending = api.get('/v1/x', { auth: 'none', signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('refuses a base URL without a scheme instead of reporting offline', async () => {
    const fetchSpy = vi.fn();
    const api = createApiClient({ baseUrl: 'api.example.com', store: memoryStore(), fetch: fetchSpy as unknown as typeof fetch });
    await expect(api.get('/v1/x', { auth: 'none' })).rejects.toMatchObject({
      code: 'api_not_configured',
      message: expect.stringContaining('https://'),
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fails with api_not_configured without a base URL', async () => {
    const api = createApiClient({ baseUrl: null, store: memoryStore(), fetch: vi.fn() as unknown as typeof fetch });
    await expect(api.get('/v1/x', { auth: 'none' })).rejects.toMatchObject({ code: 'api_not_configured' });
  });
});

describe('auth modes', () => {
  it('required: fails with not_signed_in and never calls the server', async () => {
    const { fetch, calls } = fakeFetch({});
    const api = createApiClient({ baseUrl: BASE, store: memoryStore(), fetch });
    await expect(api.get('/v1/me')).rejects.toMatchObject({ status: 401, code: 'not_signed_in' });
    expect(calls).toHaveLength(0);
  });

  it('optional: goes without a token when signed out', async () => {
    const { fetch, calls } = fakeFetch({ 'GET /v1/feed': () => json(200, { items: [], next_cursor: null }) });
    const api = createApiClient({ baseUrl: BASE, store: memoryStore(), fetch });
    await api.get('/v1/feed', { auth: 'optional' });
    expect(authHeader(calls[0].init)).toBeUndefined();
  });

  it('optional: answers signed out when the refresh says the login is over', async () => {
    const { fetch, calls } = fakeFetch({
      'POST /v1/auth/refresh': () => apiError(401, 'invalid_refresh_token'),
      'GET /v1/feed': () => json(200, { items: [], next_cursor: null }),
    });
    const api = createApiClient({ baseUrl: BASE, store: memoryStore(stored(1)), fetch });
    await api.get('/v1/feed', { auth: 'optional' });
    expect(authHeader(calls[1].init)).toBeUndefined();
  });
});

describe('session', () => {
  it('refreshes on first use after launch and persists the rotated token', async () => {
    const store = memoryStore(stored(1));
    const { fetch, calls } = fakeFetch({
      'POST /v1/auth/refresh': () => json(200, tokens(2)),
      'GET /v1/me': () => json(200, { ok: true }),
    });
    const api = createApiClient({ baseUrl: BASE, store, fetch });
    expect(await api.session.ready()).toEqual(user);
    await api.get('/v1/me');
    expect(bodyOf(calls[0].init)).toEqual({ refresh_token: 'refresh-1' });
    expect(authHeader(calls[1].init)).toBe('Bearer access-2');
    expect(store.value()?.refreshToken).toBe('refresh-2');
  });

  it('reuses the access token until it is close to expiry', async () => {
    let clock = 0;
    const { fetch, calls } = fakeFetch({
      'POST /v1/auth/refresh': () => json(200, tokens(3)),
      'GET /v1/me': () => json(200, {}),
    });
    const api = createApiClient({ baseUrl: BASE, store: memoryStore(), fetch, now: () => clock });
    await api.session.start(tokens(1));
    await api.get('/v1/me');
    clock = 800_000; // 100 s left: still above the 60 s margin
    await api.get('/v1/me');
    expect(calls.filter((c) => c.key === 'POST /v1/auth/refresh')).toHaveLength(0);
    clock = 850_000; // 50 s left
    await api.get('/v1/me');
    expect(calls.filter((c) => c.key === 'POST /v1/auth/refresh')).toHaveLength(1);
    expect(authHeader(calls.at(-1)!.init)).toBe('Bearer access-3');
  });

  it('runs one refresh for concurrent requests', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { fetch, calls } = fakeFetch({
      'POST /v1/auth/refresh': async () => {
        await gate;
        return json(200, tokens(2));
      },
      'GET /v1/a': () => json(200, {}),
      'GET /v1/b': () => json(200, {}),
    });
    const api = createApiClient({ baseUrl: BASE, store: memoryStore(stored(1)), fetch });
    const both = Promise.all([api.get('/v1/a'), api.get('/v1/b')]);
    await new Promise((r) => setTimeout(r, 0));
    release();
    await both;
    expect(calls.filter((c) => c.key === 'POST /v1/auth/refresh')).toHaveLength(1);
  });

  it('refreshes and retries once on 401 invalid_access_token', async () => {
    const { fetch, calls } = fakeFetch({
      'POST /v1/auth/refresh': () => json(200, tokens(2)),
      'POST /v1/likes': [() => apiError(401, 'invalid_access_token'), () => json(201, { liked: true })],
    });
    const api = createApiClient({ baseUrl: BASE, store: memoryStore(), fetch });
    await api.session.start(tokens(1));
    await expect(api.post('/v1/likes', { body: {} })).resolves.toEqual({ liked: true });
    expect(calls.map((c) => [c.key, authHeader(c.init)])).toEqual([
      ['POST /v1/likes', 'Bearer access-1'],
      ['POST /v1/auth/refresh', undefined],
      ['POST /v1/likes', 'Bearer access-2'],
    ]);
  });

  it('does not refresh again for a 401 on a token that was already replaced', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { fetch, calls } = fakeFetch({
      'POST /v1/auth/refresh': [() => json(200, tokens(2)), () => json(200, tokens(3))],
      'GET /v1/a': [() => apiError(401, 'invalid_access_token'), () => json(200, { a: true })],
      // b was sent with access-1 too, but its 401 lands after a's refresh finished.
      'GET /v1/b': [
        async () => {
          await gate;
          return apiError(401, 'invalid_access_token');
        },
        () => json(200, { b: true }),
      ],
    });
    const api = createApiClient({ baseUrl: BASE, store: memoryStore(), fetch });
    await api.session.start(tokens(1));
    const b = api.get('/v1/b');
    await expect(api.get('/v1/a')).resolves.toEqual({ a: true });
    release();
    await expect(b).resolves.toEqual({ b: true });
    expect(calls.filter((c) => c.key === 'POST /v1/auth/refresh')).toHaveLength(1);
    expect(authHeader(calls.at(-1)!.init)).toBe('Bearer access-2');
  });

  it.each(['invalid_refresh_token', 'account_blocked'])('ends the session on %s and tells listeners', async (code) => {
    const store = memoryStore(stored(1));
    const { fetch } = fakeFetch({ 'POST /v1/auth/refresh': () => apiError(code === 'account_blocked' ? 403 : 401, code) });
    const api = createApiClient({ baseUrl: BASE, store, fetch });
    const listener = vi.fn();
    api.session.subscribe(listener);
    await expect(api.get('/v1/me')).rejects.toMatchObject({ code });
    expect(store.value()).toBeNull();
    expect(api.session.user()).toBeNull();
    expect(listener).toHaveBeenCalledWith(null, 'expired');
  });

  it.each([
    ['offline', () => Promise.reject(new TypeError('Network request failed'))],
    ['a 5xx', () => apiError(500, 'internal')],
    ['a 429', () => apiError(429, 'rate_limited')],
  ])('keeps the session when the refresh fails with %s', async (_, answer) => {
    const store = memoryStore(stored(1));
    const { fetch } = fakeFetch({ 'POST /v1/auth/refresh': answer as Route });
    const api = createApiClient({ baseUrl: BASE, store, fetch });
    await expect(api.get('/v1/me')).rejects.toBeInstanceOf(ApiError);
    expect(store.value()?.refreshToken).toBe('refresh-1');
    expect(api.session.user()).toEqual(user);
  });

  it('on refresh_conflict, retries with a newer token from storage', async () => {
    const store = memoryStore(stored(1));
    const { fetch, calls } = fakeFetch({
      'POST /v1/auth/refresh': [() => apiError(409, 'refresh_conflict'), () => json(200, tokens(3))],
      'GET /v1/me': () => json(200, {}),
    });
    const api = createApiClient({ baseUrl: BASE, store, fetch });
    await api.session.ready();
    await store.save(stored(2)); // e.g. written by a previous run
    await api.get('/v1/me');
    expect(calls.filter((c) => c.key === 'POST /v1/auth/refresh').map((c) => bodyOf(c.init).refresh_token)).toEqual([
      'refresh-1',
      'refresh-2',
    ]);
    expect(store.value()?.refreshToken).toBe('refresh-3');
  });

  it('on refresh_conflict with nothing newer, fails without signing out', async () => {
    const store = memoryStore(stored(1));
    const { fetch } = fakeFetch({ 'POST /v1/auth/refresh': () => apiError(409, 'refresh_conflict') });
    const api = createApiClient({ baseUrl: BASE, store, fetch });
    await expect(api.get('/v1/me')).rejects.toMatchObject({ code: 'refresh_conflict' });
    expect(store.value()).not.toBeNull();
  });

  it('drops a stored login that has already expired', async () => {
    const store = memoryStore({ ...stored(1), refreshExpiresAt: '2000-01-01T00:00:00.000Z' });
    const api = createApiClient({ baseUrl: BASE, store, fetch: vi.fn() as unknown as typeof fetch });
    expect(await api.session.ready()).toBeNull();
    expect(store.clear).toHaveBeenCalled();
  });

  it('treats unreadable storage as signed out without deleting it', async () => {
    const store = memoryStore(stored(1));
    (store.load as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('keychain locked'));
    const onStorageError = vi.fn();
    const api = createApiClient({ baseUrl: BASE, store, fetch: vi.fn() as unknown as typeof fetch, onStorageError });
    expect(await api.session.ready()).toBeNull();
    expect(store.clear).not.toHaveBeenCalled();
    expect(onStorageError).toHaveBeenCalledWith(expect.any(Error), 'load');
  });

  it('signs out locally first, then ends the login on the server', async () => {
    const store = memoryStore();
    const { fetch, calls } = fakeFetch({ 'POST /v1/auth/sign-out': () => Promise.reject(new TypeError('offline')) });
    const api = createApiClient({ baseUrl: BASE, store, fetch });
    const listener = vi.fn();
    await api.session.start(tokens(1));
    api.session.subscribe(listener);
    await expect(api.session.signOut()).resolves.toBeUndefined();
    expect(store.value()).toBeNull();
    expect(listener).toHaveBeenCalledWith(null, 'signed_out');
    expect(bodyOf(calls[0].init)).toEqual({ refresh_token: 'refresh-1' });
  });

  it('does not let a refresh that finishes after sign-out restore the login', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const store = memoryStore(stored(1));
    const { fetch } = fakeFetch({
      'POST /v1/auth/refresh': async () => {
        await gate;
        return json(200, tokens(2));
      },
      'POST /v1/auth/sign-out': () => new Response(null, { status: 204 }),
    });
    const api = createApiClient({ baseUrl: BASE, store, fetch });
    const pending = api.session.accessToken();
    await new Promise((r) => setTimeout(r, 0));
    await api.session.signOut();
    release();
    await expect(pending).resolves.toBeNull();
    expect(store.value()).toBeNull();
    expect(api.session.user()).toBeNull();
  });
});

describe('several tabs (web)', () => {
  /** A lock like Web Locks: one holder at a time, in request order. */
  function fakeLock() {
    let tail: Promise<unknown> = Promise.resolve();
    const calls = { count: 0 };
    const lock = <T,>(fn: () => Promise<T>): Promise<T> => {
      calls.count += 1;
      const run = tail.then(fn, fn);
      tail = run.catch(() => undefined);
      return run;
    };
    return Object.assign(lock, { calls });
  }

  it('refreshes with the token another tab rotated into storage, not its own spent one', async () => {
    const store = memoryStore(stored(1));
    const { fetch, calls } = fakeFetch({
      'POST /v1/auth/refresh': () => json(200, tokens(3)),
      'GET /v1/me': () => json(200, {}),
    });
    const api = createApiClient({ baseUrl: BASE, store, fetch, lock: fakeLock() });
    await api.session.ready();
    // Another tab refreshed meanwhile.
    await store.save(stored(2));
    await api.get('/v1/me');
    expect(bodyOf(calls[0].init)).toEqual({ refresh_token: 'refresh-2' });
    expect(store.value()?.refreshToken).toBe('refresh-3');
  });

  it('stops when another tab signed out while this one waited for the lock', async () => {
    const store = memoryStore(stored(1));
    const { fetch, calls } = fakeFetch({});
    const api = createApiClient({ baseUrl: BASE, store, fetch, lock: fakeLock() });
    const listener = vi.fn();
    api.session.subscribe(listener);
    await api.session.ready();
    await store.clear();
    await expect(api.get('/v1/me')).rejects.toMatchObject({ code: 'not_signed_in' });
    expect(calls).toHaveLength(0);
    expect(listener).toHaveBeenCalledWith(null, 'signed_out');
    expect(api.session.user()).toBeNull();
  });

  it('runs one refresh at a time through the lock', async () => {
    const lock = fakeLock();
    const { fetch } = fakeFetch({
      'POST /v1/auth/refresh': () => json(200, tokens(2)),
      'GET /v1/a': () => json(200, {}),
      'GET /v1/b': () => json(200, {}),
    });
    const api = createApiClient({ baseUrl: BASE, store: memoryStore(stored(1)), fetch, lock });
    await Promise.all([api.get('/v1/a'), api.get('/v1/b')]);
    expect(lock.calls.count).toBe(1);
  });

  describe('syncFromStore', () => {
    it('follows a sign-out in another tab without calling the server', async () => {
      const store = memoryStore(stored(1));
      const { fetch, calls } = fakeFetch({});
      const api = createApiClient({ baseUrl: BASE, store, fetch });
      const listener = vi.fn();
      api.session.subscribe(listener);
      await api.session.ready();
      await store.clear();
      await api.session.syncFromStore();
      expect(api.session.user()).toBeNull();
      expect(listener).toHaveBeenCalledWith(null, 'signed_out');
      expect(calls).toHaveLength(0);
    });

    it('takes a rotated refresh token silently and keeps the access token', async () => {
      const store = memoryStore();
      const { fetch, calls } = fakeFetch({ 'GET /v1/me': () => json(200, {}) });
      const api = createApiClient({ baseUrl: BASE, store, fetch });
      await api.session.start(tokens(1));
      const listener = vi.fn();
      api.session.subscribe(listener);
      await store.save(stored(2));
      await api.session.syncFromStore();
      expect(listener).not.toHaveBeenCalled();
      await api.get('/v1/me');
      expect(authHeader(calls[0].init)).toBe('Bearer access-1');
    });

    it('follows a sign-in as someone else', async () => {
      const store = memoryStore();
      const api = createApiClient({ baseUrl: BASE, store, fetch: fakeFetch({}).fetch });
      await api.session.ready();
      const other = { ...stored(5), user: { ...user, id: 'other-user' } };
      await store.save(other);
      const listener = vi.fn();
      api.session.subscribe(listener);
      await api.session.syncFromStore();
      expect(api.session.user()?.id).toBe('other-user');
      expect(listener).toHaveBeenCalledWith(other.user, 'signed_in');
    });
  });
});
