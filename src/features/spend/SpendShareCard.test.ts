import { describe, expect, it } from "vitest";
import { segmentWidths } from "./SpendShareCard";

describe("share card category bar", () => {
  it("splits the bar by amount", () => {
    expect(segmentWidths([300, 100], 400, 7)).toEqual([300, 100]);
  });

  it("keeps tiny categories visible and shares the rest", () => {
    const widths = segmentWidths([1000, 1], 307, 7);
    expect(widths[1]).toBe(7);
    expect(widths[0]).toBe(300);
  });

  it("draws nothing for an empty month", () => {
    expect(segmentWidths([0, 0], 300, 7)).toEqual([0, 0]);
  });
});
