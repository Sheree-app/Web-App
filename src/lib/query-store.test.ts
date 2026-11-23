import { describe, expect, it, vi } from "vitest";
import { createQueryStore, type KeyValueStorage } from "./query-store";

function memoryStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe("query store", () => {
  it("serves a fresh value without fetching, and refetches once stale", async () => {
    let clock = 1_000;
    const store = createQueryStore({ now: () => clock });
    const fetcher = vi.fn(async () => `v${fetcher.mock.calls.length}`);
    expect(await store.fetch("k", 100, fetcher)).toBe("v1");
    expect(await store.fetch("k", 100, fetcher)).toBe("v1");
    expect(fetcher).toHaveBeenCalledTimes(1);
    clock += 101;
    expect(store.isFresh("k")).toBe(false);
    // Stale values are still readable while the refetch runs.
    expect(store.get("k")?.value).toBe("v1");
    expect(await store.fetch("k", 100, fetcher)).toBe("v2");
  });

  it("shares one request between concurrent readers", async () => {
    const store = createQueryStore();
    const d = deferred<string>();
    const fetcher = vi.fn(() => d.promise);
    const a = store.fetch("k", 1000, fetcher);
    const b = store.fetch("k", 1000, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(store.get("k")?.fetching).toBe(true);
    d.resolve("x");
    expect(await Promise.all([a, b])).toEqual(["x", "x"]);
    expect(store.get("k")?.fetching).toBe(false);
  });

  it("keeps the old value when a refresh fails, and records the error", async () => {
    const store = createQueryStore();
    store.set("k", "old", 0);
    await expect(store.fetch("k", 1000, async () => Promise.reject(new Error("offline")))).rejects.toThrow("offline");
    expect(store.get("k")?.value).toBe("old");
    expect(store.get("k")?.error).toBeInstanceOf(Error);
    await store.fetch("k", 1000, async () => "new");
    expect(store.get("k")?.error).toBeUndefined();
  });

  it("notifies subscribers with a new entry object on every change", async () => {
    const store = createQueryStore();
    const listener = vi.fn();
    const off = store.subscribe("k", listener);
    store.set("k", 1, 1000);
    const first = store.get("k");
    store.update<number>("k", (n) => n + 1);
    expect(store.get("k")).not.toBe(first);
    expect(store.get("k")?.value).toBe(2);
    expect(listener).toHaveBeenCalledTimes(2);
    off();
    store.set("k", 3, 1000);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("invalidate marks matching keys stale, keeps their values and reports them", () => {
    const store = createQueryStore();
    const hit = vi.fn();
    store.onInvalidate(hit);
    store.set("me:looks", [1], 60_000);
    store.set("me:spend:2026-11", 5, 60_000);
    store.set("pub:categories", [], 60_000);
    store.invalidate((k) => k.startsWith("me:"));
    expect(store.isFresh("me:looks")).toBe(false);
    expect(store.get("me:looks")?.value).toEqual([1]);
    expect(store.isFresh("pub:categories")).toBe(true);
    expect(hit).toHaveBeenCalledWith(["me:looks", "me:spend:2026-11"]);
  });

  it("persists and restores for the same person, as stale entries", async () => {
    const storage = memoryStorage();
    const clock = 10_000;
    const a = createQueryStore({ storage, now: () => clock, persistDelayMs: 0 });
    a.restore("user-1");
    a.set("me:account", { name: "Ama" }, 60_000);
    const b = createQueryStore({ storage, now: () => clock });
    b.restore("user-1");
    expect(b.get("me:account")?.value).toEqual({ name: "Ama" });
    expect(b.isFresh("me:account")).toBe(false);
  });

  it("never loads another person's cache, and removes it", () => {
    const storage = memoryStorage();
    const a = createQueryStore({ storage, persistDelayMs: 0 });
    a.restore("user-1");
    a.set("me:account", "secret", 60_000);
    const b = createQueryStore({ storage });
    b.restore("user-2");
    expect(b.get("me:account")).toBeUndefined();
    expect(storage.data.size).toBe(0);
  });

  it("drops persisted entries older than maxAge", () => {
    const storage = memoryStorage();
    let clock = 0;
    const a = createQueryStore({ storage, now: () => clock, persistDelayMs: 0 });
    a.restore(null);
    a.set("old", 1, 10);
    clock = 8 * 24 * 60 * 60 * 1000;
    a.set("new", 2, 10);
    const b = createQueryStore({ storage, now: () => clock });
    b.restore(null);
    expect(b.get("old")).toBeUndefined();
    expect(b.get("new")?.value).toBe(2);
  });

  it("skips keys that must not be persisted and trims to the size limit", () => {
    const storage = memoryStorage();
    let clock = 0;
    const store = createQueryStore({
      storage,
      now: () => ++clock,
      persistDelayMs: 0,
      shouldPersist: (k) => !k.startsWith("payout"),
      maxPersisted: 2,
    });
    store.restore(null);
    store.set("payout:account", "bank", 1000);
    store.set("a", 1, 1000);
    store.set("b", 2, 1000);
    store.set("c", 3, 1000);
    const saved = JSON.parse(storage.data.get("sheree:query-cache:v1")!);
    expect(saved.entries.map((e: unknown[]) => e[0])).toEqual(["c", "b"]);
  });

  it("clear wipes memory and storage, and a request from before can't write back", async () => {
    const storage = memoryStorage();
    const store = createQueryStore({ storage, persistDelayMs: 0 });
    store.restore("user-1");
    store.set("me:account", "a", 1000);
    const d = deferred<string>();
    const pending = store.fetch("me:looks", 1000, () => d.promise);
    store.clear(null);
    expect(store.get("me:account")).toBeUndefined();
    expect(storage.data.size).toBe(0);
    d.resolve("late");
    await pending;
    expect(store.get("me:looks")).toBeUndefined();
    expect(store.scope()).toBeNull();
  });

  it("survives broken or foreign storage contents", () => {
    const storage = memoryStorage();
    storage.setItem("sheree:query-cache:v1", "{not json");
    const store = createQueryStore({ storage });
    expect(() => store.restore("u")).not.toThrow();
    storage.setItem("sheree:query-cache:v1", JSON.stringify({ v: 99 }));
    expect(() => store.restore("u")).not.toThrow();
    expect(store.keys()).toEqual([]);
  });
});
