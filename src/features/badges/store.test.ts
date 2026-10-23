import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetFoundingBadgeStore,
  getCachedFoundingBadge,
  requestFoundingBadge,
  requestFoundingBadgeForUser,
  requestFoundingBadges,
} from "./store";

const rpc = vi.fn();
const from = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: (...args: unknown[]) => from(...args),
  },
}));

function foundingRow(id: string, position = 1) {
  return {
    professional_id: id,
    is_founding: true,
    founding_position: position,
    founding_categories: ["Braids"],
    awarded_at: "2026-01-05T00:00:00Z",
  };
}

function notFoundingRow(id: string) {
  return {
    professional_id: id,
    is_founding: false,
    founding_position: null,
    founding_categories: [],
    awarded_at: null,
  };
}

beforeEach(() => {
  __resetFoundingBadgeStore();
  rpc.mockReset();
  from.mockReset();
});

describe("batching and caching", () => {
  it("resolves a single badge", async () => {
    rpc.mockResolvedValue({ data: [foundingRow("prof-1", 12)], error: null });

    const badge = await requestFoundingBadge("prof-1");

    expect(rpc).toHaveBeenCalledWith("get_founding_badges", { profile_ids: ["prof-1"] });
    expect(badge).toEqual({
      professionalId: "prof-1",
      isFounding: true,
      position: 12,
      categories: ["Braids"],
      awardedAt: "2026-01-05T00:00:00Z",
    });
  });

  it("maps a non-founding professional to a null badge value", async () => {
    rpc.mockResolvedValue({ data: [notFoundingRow("prof-2")], error: null });

    const badge = await requestFoundingBadge("prof-2");

    expect(badge?.isFounding).toBe(false);
    // Cached as "known, not founding" so the badge never appears.
    expect(getCachedFoundingBadge("prof-2")?.isFounding).toBe(false);
  });

  it("deduplicates ids and batches in chunks of 100", async () => {
    rpc.mockImplementation(async (_fn: string, args: { profile_ids: string[] }) => ({
      data: args.profile_ids.map((id) => foundingRow(id)),
      error: null,
    }));

    const ids = Array.from({ length: 150 }, (_, index) => `prof-${index}`);
    await requestFoundingBadges([...ids, ...ids]);

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[0][1].profile_ids).toHaveLength(100);
    expect(rpc.mock.calls[1][1].profile_ids).toHaveLength(50);
  });

  it("caches results for later requests", async () => {
    rpc.mockResolvedValue({ data: [foundingRow("prof-1")], error: null });

    await requestFoundingBadge("prof-1");
    await requestFoundingBadge("prof-1");

    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("deduplicates concurrent requests for the same profile", async () => {
    rpc.mockResolvedValue({ data: [foundingRow("prof-1")], error: null });

    const [first, second] = await Promise.all([
      requestFoundingBadge("prof-1"),
      requestFoundingBadge("prof-1"),
    ]);

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
  });
});

describe("fail-open behaviour", () => {
  it("returns no badge when the RPC fails", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "network down" } });

    const badge = await requestFoundingBadge("prof-1");

    expect(badge).toBeNull();
    expect(getCachedFoundingBadge("prof-1")).toBeUndefined();
  });

  it("does not cache a failed lookup, so a retry can succeed", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "network down" } });
    rpc.mockResolvedValueOnce({ data: [foundingRow("prof-1")], error: null });

    await expect(requestFoundingBadge("prof-1")).resolves.toBeNull();
    const retried = await requestFoundingBadge("prof-1");

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(retried?.isFounding).toBe(true);
  });

  it("does not cache a failed user profile lookup", async () => {
    from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: { message: "boom" } }),
        }),
      }),
    }));

    await expect(requestFoundingBadgeForUser("user-1")).resolves.toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("user id resolution", () => {
  it("resolves a Sheree user id through professional_profiles", async () => {
    from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { id: "prof-9" }, error: null }),
        }),
      }),
    }));
    rpc.mockResolvedValue({ data: [foundingRow("prof-9")], error: null });

    const badge = await requestFoundingBadgeForUser("user-9");

    expect(from).toHaveBeenCalledWith("professional_profiles");
    expect(rpc).toHaveBeenCalledWith("get_founding_badges", { profile_ids: ["prof-9"] });
    expect(badge?.professionalId).toBe("prof-9");
  });

  it("caches the badge by user id as well as profile id", async () => {
    from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { id: "prof-9" }, error: null }),
        }),
      }),
    }));
    rpc.mockResolvedValue({ data: [foundingRow("prof-9")], error: null });

    await requestFoundingBadgeForUser("user-9");
    await requestFoundingBadgeForUser("user-9");

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledTimes(1);
    expect(getCachedFoundingBadge("prof-9")?.isFounding).toBe(true);
  });

  it("returns null when the user has no professional profile", async () => {
    from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }),
    }));

    await expect(requestFoundingBadgeForUser("customer-1")).resolves.toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });
});
