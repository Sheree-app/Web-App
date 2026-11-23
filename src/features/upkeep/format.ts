import type { UpkeepItem } from "./api";
import { dayLabel } from "./dates";

/** "Every 3 weeks", "Every 10 days". */
export function cycleLabel(days: number): string {
  if (days % 7 === 0) {
    const weeks = days / 7;
    return weeks === 1 ? "Every week" : `Every ${weeks} weeks`;
  }
  return `Every ${days} days`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The one line that says where she stands. */
export function statusLine(item: UpkeepItem, today: string): string {
  if (item.status === "booked" && item.booked_for) return `Booked for ${dayLabel(item.booked_for, today)}`;
  if (item.days_left === null) return "Add when you last had it done";
  if (item.days_left < 0) return `Overdue by ${plural(-item.days_left, "day")}`;
  if (item.days_left === 0) return "Due today";
  if (item.days_left === 1) return "Due tomorrow";
  if (item.status === "due_soon") return `Due in ${plural(item.days_left, "day")}`;
  return item.days_left >= 14 && item.days_left % 7 === 0
    ? `${plural(item.days_left / 7, "week")} to go`
    : `${plural(item.days_left, "day")} to go`;
}

/** "Done 18 days ago" / "Done today". */
export function lastDoneLine(item: UpkeepItem, today: string): string | null {
  if (!item.last_done) return null;
  const ago = Math.round(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${item.last_done}T00:00:00Z`)) / 86_400_000,
  );
  if (ago <= 0) return "Done today";
  if (ago === 1) return "Done yesterday";
  return `Done ${plural(ago, "day")} ago`;
}

/** How much of the cycle has passed, 0..1 (full when due or overdue). */
export function progress(item: UpkeepItem): number {
  if (item.days_left === null) return 0;
  return Math.min(1, Math.max(0, (item.cycle_days - item.days_left) / item.cycle_days));
}

/** Week presets offered when choosing how often. */
export const CYCLE_PRESETS = [7, 14, 21, 28, 35, 42, 56, 70, 84];

/** Where rebooking goes: the same service with the same pro, or her profile when it's gone. */
export function rebookHref(item: UpkeepItem): string | null {
  const r = item.rebook;
  if (!r) return null;
  return r.service
    ? `/booking/${encodeURIComponent(r.professional_id)}?service=${encodeURIComponent(r.service.id)}`
    : `/professional/${encodeURIComponent(r.professional_id)}`;
}
