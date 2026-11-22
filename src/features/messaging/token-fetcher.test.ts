import { describe, expect, test, vi } from "vitest";
import { createMessagingTokenFetcher, type ConvexTokenSource } from "./token-fetcher";

const source = (userId: string | null = "account-a") => {
  let n = 0;
  const s = {
    user: userId,
    currentUserId: () => s.user,
    issue: vi.fn(async () => ({ token: `token-${++n}`, expires_in: 900 })),
  };
  return s as typeof s & ConvexTokenSource;
};

describe("messaging auth token", () => {
  test("reuses a valid token and asks again only near expiry", async () => {
    let clock = 0;
    const s = source();
    const fetch = createMessagingTokenFetcher(s, "account-a", () => clock);
    expect(await fetch({ forceRefreshToken: false })).toBe("token-1");
    for (let i = 0; i < 5; i++) expect(await fetch({ forceRefreshToken: false })).toBe("token-1");
    clock = 850_000;
    expect(await fetch({ forceRefreshToken: false })).toBe("token-2");
    expect(s.issue).toHaveBeenCalledTimes(2);
  });

  test("a Convex forced refresh issues a new token once", async () => {
    const s = source();
    const fetch = createMessagingTokenFetcher(s, "account-a");
    await fetch({ forceRefreshToken: false });
    expect(await fetch({ forceRefreshToken: true })).toBe("token-2");
    expect(await fetch({ forceRefreshToken: false })).toBe("token-2");
    expect(s.issue).toHaveBeenCalledTimes(2);
  });

  test("concurrent requests share one call", async () => {
    let resolve!: (value: { token: string; expires_in: number }) => void;
    const s = source();
    s.issue.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const fetch = createMessagingTokenFetcher(s, "account-a");
    const first = fetch({ forceRefreshToken: true });
    const second = fetch({ forceRefreshToken: true });
    expect(s.issue).toHaveBeenCalledTimes(1);
    resolve({ token: "fresh", expires_in: 900 });
    expect(await Promise.all([first, second])).toEqual(["fresh", "fresh"]);
  });

  test("sign-out and account switching never return the wrong token", async () => {
    const s = source("account-b");
    expect(await createMessagingTokenFetcher(s, "account-a")({ forceRefreshToken: true })).toBeNull();
    expect(await createMessagingTokenFetcher(s, undefined)({ forceRefreshToken: true })).toBeNull();
    expect(s.issue).not.toHaveBeenCalled();
  });

  test("a token issued after the account changed is dropped", async () => {
    const s = source();
    s.issue.mockImplementationOnce(async () => {
      s.user = "account-b";
      return { token: "late", expires_in: 900 };
    });
    expect(await createMessagingTokenFetcher(s, "account-a")({ forceRefreshToken: false })).toBeNull();
  });

  test("failures end without retrying", async () => {
    const s = source();
    s.issue.mockRejectedValueOnce(new Error("offline"));
    expect(await createMessagingTokenFetcher(s, "account-a")({ forceRefreshToken: true })).toBeNull();
    expect(s.issue).toHaveBeenCalledTimes(1);
  });
});
