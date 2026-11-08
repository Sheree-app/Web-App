import { describe, expect, it } from "vitest";
import {
    REVIEW_BODY_MAX,
    REVIEW_BODY_MIN,
    composeReviewBody,
    defaultReviewBody,
    reviewHighlights,
} from "./prompt";

describe("defaultReviewBody", () => {
  it("produces a valid review body for every star rating", () => {
    for (const rating of [1, 2, 3, 4, 5]) {
      const body = defaultReviewBody(rating);
      expect(body.length).toBeGreaterThanOrEqual(REVIEW_BODY_MIN);
      expect(body.length).toBeLessThanOrEqual(REVIEW_BODY_MAX);
    }
  });

  it("has nothing to say before a star is chosen", () => {
    expect(defaultReviewBody(0)).toBe("");
  });
});

describe("reviewHighlights", () => {
  it("offers warm words for a four or five star visit", () => {
    expect(reviewHighlights(5)).toEqual(reviewHighlights(4));
    expect(reviewHighlights(5).map((item) => item.id)).toContain("finish");
  });

  it("offers a mixed set for a three star visit", () => {
    const ids = reviewHighlights(3).map((item) => item.id);
    expect(ids).toContain("good");
    expect(ids).toContain("improve");
  });

  it("offers constructive words for a two or one star visit", () => {
    expect(reviewHighlights(2)).toEqual(reviewHighlights(1));
    expect(reviewHighlights(1).map((item) => item.id)).toContain("late");
  });
});

describe("composeReviewBody", () => {
  it("uses the chosen highlights", () => {
    expect(
      composeReviewBody({ rating: 5, highlights: ["Lovely finish", "So welcoming"], note: "" }),
    ).toBe("Lovely finish. So welcoming");
  });

  it("adds the customer's note after the highlights", () => {
    expect(
      composeReviewBody({
        rating: 4,
        highlights: ["Right on time"],
        note: "The braids are perfect.",
      }),
    ).toBe("Right on time. The braids are perfect.");
  });

  it("falls back to the rating sentence when nothing is written", () => {
    expect(composeReviewBody({ rating: 5, highlights: [], note: "" })).toBe(
      defaultReviewBody(5),
    );
  });

  it("falls back when the note is shorter than the review minimum", () => {
    expect(composeReviewBody({ rating: 2, highlights: [], note: "ok" })).toBe(
      defaultReviewBody(2),
    );
  });

  it("never exceeds the database limit", () => {
    const body = composeReviewBody({
      rating: 5,
      highlights: [],
      note: "a".repeat(REVIEW_BODY_MAX + 500),
    });
    expect(body).toHaveLength(REVIEW_BODY_MAX);
  });

  it("returns an empty body when nothing is rated or written", () => {
    expect(composeReviewBody({ rating: 0, highlights: [], note: "" })).toBe("");
  });
});
