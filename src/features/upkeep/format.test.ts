import { describe, expect, it } from "vitest";
import type { UpkeepItem } from "./api";
import { cycleLabel, lastDoneLine, progress, rebookHref, statusLine } from "./format";

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

describe("upkeep format", () => {
  it("names cycles", () => {
    expect(cycleLabel(21)).toBe("Every 3 weeks");
    expect(cycleLabel(7)).toBe("Every week");
    expect(cycleLabel(10)).toBe("Every 10 days");
  });

  it("says where she stands", () => {
    expect(statusLine(base, today)).toBe("Due in 6 days");
    expect(statusLine({ ...base, days_left: 0 }, today)).toBe("Due today");
    expect(statusLine({ ...base, days_left: 1 }, today)).toBe("Due tomorrow");
    expect(
      statusLine({ ...base, days_left: -1, status: "overdue" }, today),
    ).toBe("Overdue by 1 day");
    expect(statusLine({ ...base, days_left: 14, status: "fresh" }, today)).toBe(
      "2 weeks to go",
    );
    expect(statusLine({ ...base, days_left: 10, status: "fresh" }, today)).toBe(
      "10 days to go",
    );
    expect(
      statusLine(
        { ...base, status: "booked", booked_for: "2026-11-13" },
        today,
      ),
    ).toBe("Booked for Fri 13 Nov");
    expect(
      statusLine(
        {
          ...base,
          days_left: null,
          last_done: null,
          next_due: null,
          status: "fresh",
        },
        today,
      ),
    ).toBe("Add when you last had it done");
  });

  it("describes the last time and progress", () => {
    expect(lastDoneLine(base, today)).toBe("Done 15 days ago");
    expect(lastDoneLine({ ...base, last_done: today }, today)).toBe(
      "Done today",
    );
    expect(progress(base)).toBeCloseTo(15 / 21);
    expect(progress({ ...base, days_left: -3 })).toBe(1);
  });

  it("rebooks the same service, or opens the profile when it's gone", () => {
    expect(rebookHref(base)).toBeNull();
    const rebook = {
      professional_id: "pro-1",
      professional_name: "Ama",
      avatar_url: null,
      service: { id: "svc 1", name: "Gel", price: 120, duration_minutes: 60 },
    };
    expect(rebookHref({ ...base, rebook })).toBe("/booking/pro-1?service=svc%201");
    expect(rebookHref({ ...base, rebook: { ...rebook, service: null } })).toBe("/professional/pro-1");
  });
});
