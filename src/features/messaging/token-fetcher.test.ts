import { describe, expect, test, vi } from "vitest";
import { createMessagingTokenFetcher } from "./token-fetcher";
const result = (token = "initial", id = "account-a") => ({ data: { session: { access_token: token, user: { id } } }, error: null });

describe("messaging auth token rotation", () => {
  test("the same fetcher reads updated tokens without refreshing a valid session", async () => {
    let session = result();
    const auth = { getSession: vi.fn(async () => session), refreshSession: vi.fn(async () => result("rotated")) };
    const fetch = createMessagingTokenFetcher(auth, "account-a");
    expect(await fetch({ forceRefreshToken: false })).toBe("initial");
    session = result("rotated");
    expect(await fetch({ forceRefreshToken: false })).toBe("rotated");
    expect(auth.refreshSession).not.toHaveBeenCalled();
  });
  test("a Convex forced refresh rotates once and subsequent cached reads do not refresh", async () => {
    let session = result();
    const auth = { getSession: vi.fn(async () => session), refreshSession: vi.fn(async () => { session = result("rotated"); return session; }) };
    const fetch = createMessagingTokenFetcher(auth, "account-a");
    expect(await fetch({ forceRefreshToken: true })).toBe("rotated");
    for (let i = 0; i < 10; i++) expect(await fetch({ forceRefreshToken: false })).toBe("rotated");
    expect(auth.refreshSession).toHaveBeenCalledTimes(1);
  });
  test("concurrent refresh requests share one refresh", async () => {
    let resolve!: (value: ReturnType<typeof result>) => void;
    const refreshed = new Promise<ReturnType<typeof result>>(done => { resolve = done; });
    const auth = { getSession: vi.fn(async () => result()), refreshSession: vi.fn(() => refreshed) };
    const fetch = createMessagingTokenFetcher(auth, "account-a");
    const first = fetch({ forceRefreshToken: true });
    const second = fetch({ forceRefreshToken: true });
    await Promise.resolve();
    expect(auth.refreshSession).toHaveBeenCalledTimes(1);
    resolve(result("fresh"));
    expect(await Promise.all([first, second])).toEqual(["fresh", "fresh"]);
  });
  test("a rate-limited refresh returns an auth failure without retrying", async () => {
    const auth = { getSession: vi.fn(async () => result()), refreshSession: vi.fn(async () => ({ data: { session: null }, error: { status: 429 } })) };
    expect(await createMessagingTokenFetcher(auth, "account-a")({ forceRefreshToken: true })).toBeNull();
    expect(auth.refreshSession).toHaveBeenCalledTimes(1);
  });
  test("sign-out and account switching never return or refresh the wrong token", async () => {
    const auth = { getSession: vi.fn(async () => result("other-token", "account-b")), refreshSession: vi.fn(async () => result("other-token", "account-b")) };
    expect(await createMessagingTokenFetcher(auth, "account-a")({ forceRefreshToken: true })).toBeNull();
    expect(await createMessagingTokenFetcher(auth, undefined)({ forceRefreshToken: true })).toBeNull();
    expect(auth.refreshSession).not.toHaveBeenCalled();
  });
  test("network failures terminate rather than triggering automatic retries", async () => {
    const auth = { getSession: vi.fn(async () => result()), refreshSession: vi.fn(async () => { throw new Error("offline"); }) };
    expect(await createMessagingTokenFetcher(auth, "account-a")({ forceRefreshToken: true })).toBeNull();
    expect(auth.refreshSession).toHaveBeenCalledTimes(1);
  });
});
