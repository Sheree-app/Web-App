/**
 * Copy and composition rules for the "rate your professional" prompt.
 *
 * The prompt is a one-tap experience — tap a star and share — but the reviews
 * table only accepts a written body between 10 and 1000 characters. Instead of
 * blocking a happy customer behind a keyboard, the prompt composes an honest
 * sentence from the rating and lets the highlights/note refine it. Keeping that
 * logic pure and separate from the modal is what makes the fallback copy
 * testable, and keeps the exact wording out of the component.
 */

export const REVIEW_BODY_MIN = 10;
export const REVIEW_BODY_MAX = 1000;

/** The handwritten-style line that answers each star count. */
export const REVIEW_PROMPT_WORDS = [
  "",
  "Not for me",
  "Could be better",
  "It was good",
  "Really lovely",
  "Absolutely loved it",
] as const;

export type ReviewHighlight = { id: string; label: string };

const LOVED_HIGHLIGHTS: ReviewHighlight[] = [
  { id: "finish", label: "Lovely finish" },
  { id: "welcome", label: "So welcoming" },
  { id: "timing", label: "Right on time" },
  { id: "space", label: "Beautiful space" },
];

const OKAY_HIGHLIGHTS: ReviewHighlight[] = [
  { id: "good", label: "Good overall" },
  { id: "timing", label: "Right on time" },
  { id: "space", label: "Lovely space" },
  { id: "improve", label: "Room to improve" },
];

const IMPROVE_HIGHLIGHTS: ReviewHighlight[] = [
  { id: "late", label: "Started late" },
  { id: "rushed", label: "Rushed finish" },
  { id: "brief", label: "Not quite what I asked" },
  { id: "reach", label: "Hard to reach" },
];

/**
 * Highlights are rating-aware: a five-star visit and a two-star visit should
 * not offer the same words, or the prompt reads like a template.
 */
export function reviewHighlights(rating: number): ReviewHighlight[] {
  if (rating >= 4) return LOVED_HIGHLIGHTS;
  if (rating === 3) return OKAY_HIGHLIGHTS;
  return IMPROVE_HIGHLIGHTS;
}

/**
 * The sentence shared when the customer rates but writes nothing. Every option
 * clears the 10-character floor, so a single tap always produces a valid review.
 */
export function defaultReviewBody(rating: number): string {
  if (rating >= 5) return "Absolutely loved it — I would book again.";
  if (rating === 4) return "Really lovely appointment.";
  if (rating === 3) return "It was good overall.";
  if (rating === 2) return "Could have been better.";
  if (rating === 1) return "Not the experience I hoped for.";
  return "";
}

/**
 * What the customer actually shares. Chosen highlights and their own note win;
 * the rating's default sentence fills in when they add nothing (or too little
 * to clear the minimum).
 */
export function composeReviewBody(input: {
  rating: number;
  highlights: string[];
  note: string;
}): string {
  const picked = input.highlights
    .map((label) => label.trim())
    .filter(Boolean)
    .join(". ");
  const note = input.note.trim();
  const written = [picked, note].filter(Boolean).join(". ");
  const body = written.length >= REVIEW_BODY_MIN ? written : defaultReviewBody(input.rating);
  return body.slice(0, REVIEW_BODY_MAX);
}
