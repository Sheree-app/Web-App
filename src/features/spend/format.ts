/**
 * Date and number helpers for the spend tracker, ported from the mobile app.
 * Plain arithmetic rather than Intl so the output matches the app exactly.
 * Days are Accra days, and Ghana is on UTC all year.
 */

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const todayDay = (now = new Date()) => now.toISOString().slice(0, 10);
export const currentMonth = (now = new Date()) => now.toISOString().slice(0, 7);

/** A `YYYY-MM` the API accepts. */
export const isMonth = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);

/**
 * Cedis as the app shows them: "GH₵1,250" or "GH₵1,250.50". Same output as
 * the mobile `money()` so screenshots and share cards match across clients.
 */
export function money(value: number): string {
  const cents = Math.round(Math.abs(value) * 100);
  const whole = Math.floor(cents / 100);
  const pesewas = cents % 100;
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const sign = value < 0 ? "-" : "";
  return pesewas === 0
    ? `GH₵${sign}${grouped}`
    : `GH₵${sign}${grouped}.${String(pesewas).padStart(2, "0")}`;
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const index = y * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** "November 2026", or "November" with `year: false`. */
export function monthLabel(month: string, opts: { year?: boolean } = {}): string {
  const [y, m] = month.split("-").map(Number);
  return opts.year === false ? MONTHS[m - 1] : `${MONTHS[m - 1]} ${y}`;
}

/** "Nov" for chart axes. */
export const monthInitial = (month: string) => monthLabel(month, { year: false }).slice(0, 3);

const dayDate = (day: string) => new Date(`${day}T00:00:00Z`);

/** "Today", "Yesterday" or "Mon 10 Nov". */
export function dayLabel(day: string, today = todayDay()): string {
  if (day === today) return "Today";
  if (day === addDays(today, -1)) return "Yesterday";
  const d = dayDate(day);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].slice(0, 3)}`;
}

export const weekdayShort = (day: string) => DAYS[dayDate(day).getUTCDay()];
export const dayOfMonth = (day: string) => dayDate(day).getUTCDate();

export function addDays(day: string, delta: number): string {
  const d = dayDate(day);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/**
 * The days offered when logging a spend in `month`: the last 30 days for the
 * current month, otherwise every day of that month. Newest first.
 */
export function pickableDays(month: string, today = todayDay()): string[] {
  if (month >= today.slice(0, 7)) {
    return Array.from({ length: 30 }, (_, i) => addDays(today, -i));
  }
  const days: string[] = [];
  for (let day = `${month}-01`; day.slice(0, 7) === month; day = addDays(day, 1)) days.push(day);
  return days.reverse();
}

/** Change vs. last month as a whole percent, or null when there's nothing to compare. */
export function changePercent(total: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((total - previous) / previous) * 100);
}

/** "↑ 12% vs October", "Same as October" (lower-case `same` with `lower`). */
export function changeLabel(month: string, change: number, opts: { lower?: boolean } = {}): string {
  const previous = monthLabel(shiftMonth(month, -1), { year: false });
  if (change === 0) return `${opts.lower ? "same" : "Same"} as ${previous}`;
  return `${change > 0 ? "↑" : "↓"} ${Math.abs(change)}% vs ${previous}`;
}

/** "1 treat", "3 treats". */
export const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

/** Share of `total`, as whole percents that always add up to 100. */
export function shares(amounts: number[]): number[] {
  const total = amounts.reduce((a, b) => a + b, 0);
  if (total <= 0) return amounts.map(() => 0);
  const raw = amounts.map((a) => (a / total) * 100);
  const floors = raw.map(Math.floor);
  let left = 100 - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i] += 1;
    left -= 1;
  }
  return floors;
}

/** Parses what she typed into the amount field ("1,250.5" → 1250.5). */
export function parseAmount(text: string): number | null {
  const cleaned = text.replace(/[,\s]/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return value > 0 ? value : null;
}
