import { describe, expect, it } from "vitest";
import type { UpkeepItem } from "./api";
import { calendarItems, escapeText, foldLine, upkeepIcs } from "./ics";

const base: UpkeepItem = {
  category: "nails",
  name: "Nails",
  cycle_days: 21,
  last_done: "2026-10-28",
  last_source: "spend",
  next_due: "2026-11-18",
  days_left: 6,
  status: "due_soon",
  booked_for: null,
  rebook: null,
};
const today = "2026-11-12";

describe("upkeep .ics", () => {
  it("only includes upcoming, unbooked due dates", () => {
    const items = [
      base,
      { ...base, category: "lashes", next_due: "2026-11-01", status: "overdue" as const },
      { ...base, category: "brows", status: "booked" as const, booked_for: "2026-11-14" },
      { ...base, category: "hair", next_due: null, days_left: null },
      { ...base, category: "braids", next_due: today },
    ];
    expect(calendarItems(items, today).map((i) => i.category)).toEqual(["nails", "braids"]);
  });

  it("writes all-day events with the app's two reminders", () => {
    const ics = upkeepIcs(
      [{ ...base, rebook: { professional_id: "p", professional_name: "Ama, Accra", avatar_url: null, service: null } }],
      { today, origin: "https://sheree.test", now: new Date("2026-11-12T08:30:00.123Z") },
    );
    const lines = ics.split("\r\n");
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(lines).toContain("UID:upkeep-nails-20261118@sheree");
    expect(lines).toContain("DTSTAMP:20261112T083000Z");
    expect(lines).toContain("DTSTART;VALUE=DATE:20261118");
    expect(lines).toContain("DTEND;VALUE=DATE:20261119");
    expect(lines).toContain("SUMMARY:Time for fresh nails");
    expect(lines).toContain("TRIGGER:-P1DT14H");
    expect(lines).toContain("TRIGGER:PT10H");
    expect(lines).toContain("URL:https://sheree.test/upkeep");
    expect(ics.replace(/\r\n /g, "")).toContain(
      "DESCRIPTION:It's been a while. Book Ama\\, Accra again on Sheree.\\nhttps://sheree.test/upkeep",
    );
  });

  it("escapes and folds", () => {
    expect(escapeText("a;b,c\\d\ne")).toBe("a\;b\\,c\\\\d\\ne");
    const long = `DESCRIPTION:${"é".repeat(60)}`;
    const folded = foldLine(long);
    for (const part of folded.split("\r\n")) expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, "")).toBe(long);
  });
});
