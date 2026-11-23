/**
 * Date and number helpers for My Looks. The shared day, month and money
 * helpers are the spend tracker's (same labels everywhere); only the
 * looks-specific ones live here. Days are Accra days (UTC all year).
 */
import { dayLabel, todayDay } from "@/features/spend/format";

export {
  addDays,
  currentMonth,
  dayLabel,
  dayOfMonth,
  money,
  monthLabel,
  parseAmount,
  pickableDays,
  shiftMonth,
  todayDay,
  weekdayShort,
} from "@/features/spend/format";

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Today", "Yesterday", "Mon 10 Nov", or "10 Nov 2025" for other years. */
export function lookDate(day: string, today = todayDay()): string {
  if (day.slice(0, 4) === today.slice(0, 4)) return dayLabel(day, today);
  const [y, m, d] = day.split("-").map(Number);
  return `${d} ${MONTHS_SHORT[m - 1]} ${y}`;
}

/** Groups looks (already newest first) under "November 2026"-style headings. */
export function byMonth<T extends { done_on: string }>(items: T[]): Array<{ month: string; items: T[] }> {
  const groups: Array<{ month: string; items: T[] }> = [];
  for (const item of items) {
    const month = item.done_on.slice(0, 7);
    const last = groups[groups.length - 1];
    if (last && last.month === month) last.items.push(item);
    else groups.push({ month, items: [item] });
  }
  return groups;
}
