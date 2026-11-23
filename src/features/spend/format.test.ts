import { describe, expect, it } from "vitest";
import {
  changeLabel,
  changePercent,
  dayLabel,
  isMonth,
  money,
  monthLabel,
  parseAmount,
  pickableDays,
  shares,
  shiftMonth,
} from "./format";

describe("spend format", () => {
  it("shifts months across years", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });

  it("labels months and days", () => {
    expect(monthLabel("2026-11")).toBe("November 2026");
    expect(monthLabel("2026-11", { year: false })).toBe("November");
    expect(dayLabel("2026-11-12", "2026-11-12")).toBe("Today");
    expect(dayLabel("2026-11-11", "2026-11-12")).toBe("Yesterday");
    expect(dayLabel("2026-11-10", "2026-11-12")).toBe("Tue 10 Nov");
  });

  it("offers the last 30 days this month, or the whole of a past month", () => {
    const now = pickableDays("2026-11", "2026-11-12");
    expect(now).toHaveLength(30);
    expect(now[0]).toBe("2026-11-12");
    expect(now[29]).toBe("2026-10-14");
    const past = pickableDays("2026-02", "2026-11-12");
    expect(past).toHaveLength(28);
    expect(past[0]).toBe("2026-02-28");
  });

  it("compares with last month", () => {
    expect(changePercent(120, 100)).toBe(20);
    expect(changePercent(50, 0)).toBeNull();
    expect(changeLabel("2026-11", 20)).toBe("↑ 20% vs October");
    expect(changeLabel("2026-01", -5)).toBe("↓ 5% vs December");
    expect(changeLabel("2026-11", 0)).toBe("Same as October");
    expect(changeLabel("2026-11", 0, { lower: true })).toBe("same as October");
  });

  it("makes percentages that add up to 100", () => {
    expect(shares([1, 1, 1])).toEqual([34, 33, 33]);
    expect(shares([0, 0])).toEqual([0, 0]);
  });

  it("parses typed amounts", () => {
    expect(parseAmount("1,250.5")).toBe(1250.5);
    expect(parseAmount("0")).toBeNull();
    expect(parseAmount("12.345")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
  });

  it("formats cedis like the app", () => {
    expect(money(1250)).toBe("GH₵1,250");
    expect(money(1250.5)).toBe("GH₵1,250.50");
    expect(money(-80)).toBe("GH₵-80");
  });

  it("accepts only real months", () => {
    expect(isMonth("2026-11")).toBe(true);
    expect(isMonth("2026-13")).toBe(false);
    expect(isMonth(undefined)).toBe(false);
  });
});
