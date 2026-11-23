/**
 * Day and month helpers. The shared ones are the spend tracker's (same labels
 * everywhere); the calendar-only ones live here. Days are Accra days, and
 * Ghana is on UTC all year.
 */
export {
  addDays,
  dayLabel,
  dayOfMonth,
  monthLabel,
  pickableDays,
  shiftMonth,
  todayDay,
  weekdayShort,
} from "@/features/spend/format";

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
const dayDate = (day: string) => new Date(`${day}T00:00:00Z`);

/** "Friday 13 November", for screen readers. */
export function longDayLabel(day: string): string {
  const d = dayDate(day);
  const weekday = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][
    d.getUTCDay()
  ];
  return `${weekday} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** The cells of a Monday-first month grid: `null` pads the first and last week. */
export function monthCells(month: string): Array<string | null> {
  const [y, m] = month.split("-").map(Number);
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: Array<string | null> = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`),
  ];
  while (cells.length % 7) cells.push(null);
  return cells;
}
