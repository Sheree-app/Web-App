import { describe, expect, it } from "vitest";
import { byMonth, lookDate, money, parseAmount, pickableDays } from "./format";

describe("looks format", () => {
  it("labels days, adding the year only for other years", () => {
    expect(lookDate("2026-11-12", "2026-11-12")).toBe("Today");
    expect(lookDate("2026-11-11", "2026-11-12")).toBe("Yesterday");
    expect(lookDate("2026-10-02", "2026-11-12")).toBe("Fri 2 Oct");
    expect(lookDate("2025-12-24", "2026-11-12")).toBe("24 Dec 2025");
  });

  it("groups by month in order", () => {
    const groups = byMonth([{ done_on: "2026-11-09" }, { done_on: "2026-11-01" }, { done_on: "2026-09-30" }]);
    expect(groups.map((g) => [g.month, g.items.length])).toEqual([
      ["2026-11", 2],
      ["2026-09", 1],
    ]);
  });

  it("offers the last 30 days this month, every day of past months", () => {
    const now = pickableDays("2026-11", "2026-11-12");
    expect(now).toHaveLength(30);
    expect(now[0]).toBe("2026-11-12");
    expect(now[29]).toBe("2026-10-14");
    const past = pickableDays("2026-02", "2026-11-12");
    expect(past).toHaveLength(28);
    expect(past[0]).toBe("2026-02-28");
  });

  it("parses amounts and formats money like the app", () => {
    expect(parseAmount("1,250.5")).toBe(1250.5);
    expect(parseAmount("0")).toBeNull();
    expect(parseAmount("1.234")).toBeNull();
    expect(money(1250)).toBe("GH₵1,250");
    expect(money(85.5)).toBe("GH₵85.50");
  });
});
