"use client";

import { cn } from "@/lib/utils";
import { Star } from "lucide-react";

const GOLD = "#E2B15E";

/**
 * Five stars; pass `onChange` to make them a picker (click the current one to
 * clear). The picker is a radio group, so arrow keys move between stars.
 */
export function Stars({
  value,
  onChange,
  size = 18,
  label = "Rating",
}: {
  value: number | null;
  onChange?: (value: number | null) => void;
  size?: number;
  label?: string;
}) {
  if (!onChange) {
    return (
      <span role="img" aria-label={value ? `${value} out of 5 stars` : "Not rated"} className="inline-flex gap-0.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <StarIcon key={n} on={(value ?? 0) >= n} size={size} />
        ))}
      </span>
    );
  }

  const move = (delta: number) => onChange(Math.min(5, Math.max(1, (value ?? 0) + delta)));
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex gap-2"
      onKeyDown={(event) => {
        if (event.key === "ArrowRight" || event.key === "ArrowUp") {
          event.preventDefault();
          move(1);
        } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
          event.preventDefault();
          move(-1);
        }
      }}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n === 1 ? "" : "s"}`}
          // One tab stop for the group, on the chosen star (or the first).
          tabIndex={(value ?? 1) === n ? 0 : -1}
          onClick={() => onChange(value === n ? null : n)}
          className="rounded-full p-0.5 transition hover:scale-110 focus-visible:outline-2 focus-visible:outline-primary active:scale-95"
        >
          <StarIcon on={(value ?? 0) >= n} size={size} />
        </button>
      ))}
    </div>
  );
}

function StarIcon({ on, size }: { on: boolean; size: number }) {
  return (
    <Star
      aria-hidden
      style={{ width: size, height: size, color: on ? GOLD : undefined }}
      className={cn(on ? "fill-current" : "text-line")}
    />
  );
}
