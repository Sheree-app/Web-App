import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetFoundingBadgeStore,
  getCachedFoundingBadge,
  requestFoundingBadge,
  requestFoundingBadgeForUser,
  requestFoundingBadges,
} from "./store";

// `GET /v1/professionals/badges`: `ids` or `user_ids`, comma-separated.
const get = vi.fn();

vi.mock("@/lib/api", () => ({
  api: { get: (...args: unknown[]) => get(...args) },
}));

type Query = { ids?: string; user_ids?: string };
const queryOf = (call: unknown[]) => (call[1] as { query: Query }).query;
const idsOf = (call: unknown[]) => queryOf(call).ids?.split(",") ?? [];
const byProfileCalls = () => get.mock.calls.filter((call) => queryOf(call).ids !== undefined);

function foundingRow(id: string, position = 1, userId = `user-of-${id}`) {
  return {
    professional_id: id,
    user_id: userId,
    is_official: false,
    is_founding: true,
    founding_position: position,
    founding_categories: ["Braids"],
    awarded_at: "2026-01-05T00:00:00Z",
  };
}

function notFoundingRow(id: string) {
  return {
    professional_id: id,
    user_id: `user-of-${id}`,
    is_official: false,
    is_founding: false,
    founding_position: null,
    founding_categories: [],
    awarded_at: null,
  };
}

beforeEach(() => {
  __resetFoundingBadgeStore();
  get.mockReset();
});

describe("batching and caching", () => {
  it("resolves a single badge", async () => {
    get.mockResolvedValue([foundingRow("prof-1", 12)]);

    const badge = await requestFoundingBadge("prof-1");

    expect(get).toHaveBeenCalledWith("/v1/professionals/badges", {
      auth: "optional",
      query: { ids: "prof-1" },
    });
    expect(badge).toEqual({
      professionalId: "prof-1",
      isFounding: true,
      position: 12,
      categories: ["Braids"],
      awardedAt: "2026-01-05T00:00:00Z",
    });
  });

  it("maps a non-founding professional to a null badge value", async () => {
    get.mockResolvedValue([notFoundingRow("prof-2")]);

    const badge = await requestFoundingBadge("prof-2");

    expect(badge?.isFounding).toBe(false);
    // Cached as "known, not founding" so the badge never appears.
    expect(getCachedFoundingBadge("prof-2")?.isFounding).toBe(false);
  });

  it("deduplicates ids and batches in chunks of 100", async () => {
    get.mockImplementation(async (_path: string, opts: { query: Query }) =>
      (opts.query.ids ?? "").split(",").map((id) => foundingRow(id)),
    );

    const ids = Array.from({ length: 150 }, (_, index) => `prof-${index}`);
    await requestFoundingBadges([...ids, ...ids]);

    expect(get).toHaveBeenCalledTimes(2);
    expect(idsOf(get.mock.calls[0])).toHaveLength(100);
    expect(idsOf(get.mock.calls[1])).toHaveLength(50);
  });

  it("caches results for later requests", async () => {
    get.mockResolvedValue([foundingRow("prof-1")]);

    await requestFoundingBadge("prof-1");
    await requestFoundingBadge("prof-1");

    expect(get).toHaveBeenCalledTimes(1);
  });

  it("deduplicates concurrent requests for the same profile", async () => {
    get.mockResolvedValue([foundingRow("prof-1")]);

    const [first, second] = await Promise.all([
      requestFoundingBadge("prof-1"),
      requestFoundingBadge("prof-1"),
    ]);

    expect(get).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
  });
});

describe("fail-open behaviour", () => {
  it("returns no badge when the lookup fails", async () => {
    get.mockRejectedValue(new Error("network down"));

    const badge = await requestFoundingBadge("prof-1");

    expect(badge).toBeNull();
    expect(getCachedFoundingBadge("prof-1")).toBeUndefined();
  });

  it("does not cache a failed lookup, so a retry can succeed", async () => {
    get.mockRejectedValueOnce(new Error("network down"));
    get.mockResolvedValueOnce([foundingRow("prof-1")]);

    await expect(requestFoundingBadge("prof-1")).resolves.toBeNull();
    const retried = await requestFoundingBadge("prof-1");

    expect(get).toHaveBeenCalledTimes(2);
    expect(retried?.isFounding).toBe(true);
  });

  it("does not cache a failed user profile lookup", async () => {
    get.mockRejectedValueOnce(new Error("boom"));

    await expect(requestFoundingBadgeForUser("user-1")).resolves.toBeNull();
    get.mockResolvedValueOnce([foundingRow("prof-1", 1, "user-1")]);
    await expect(requestFoundingBadgeForUser("user-1")).resolves.not.toBeNull();
    expect(get).toHaveBeenCalledTimes(2);
  });
});

describe("user id resolution", () => {
  it("resolves a Sheree user id by account", async () => {
    get.mockResolvedValue([foundingRow("prof-9", 1, "user-9")]);

    const badge = await requestFoundingBadgeForUser("user-9");

    expect(get).toHaveBeenCalledWith("/v1/professionals/badges", {
      auth: "optional",
      query: { user_ids: "user-9" },
    });
    // The account lookup already carries the badge: no second request.
    expect(byProfileCalls()).toHaveLength(0);
    expect(badge?.professionalId).toBe("prof-9");
  });

  it("caches the badge by user id as well as profile id", async () => {
    get.mockResolvedValue([foundingRow("prof-9", 1, "user-9")]);

    await requestFoundingBadgeForUser("user-9");
    await requestFoundingBadgeForUser("user-9");

    expect(get).toHaveBeenCalledTimes(1);
    expect(getCachedFoundingBadge("prof-9")?.isFounding).toBe(true);
  });

  it("returns null when the user has no professional profile", async () => {
    get.mockResolvedValue([]);

    await expect(requestFoundingBadgeForUser("customer-1")).resolves.toBeNull();
    expect(byProfileCalls()).toHaveLength(0);
  });
});
