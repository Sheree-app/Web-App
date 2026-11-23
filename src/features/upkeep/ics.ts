import type { UpkeepItem } from "./api";

/**
 * "Add to calendar" for the web. The app schedules device notifications (two
 * days before something's due and on the day, at 10:00); a browser can't do
 * that without web push, so instead she downloads an .ics file and her own
 * calendar app does the reminding, with the same two alarms.
 *
 * Plain RFC 5545, built here with no dependency. UIDs are stable per category
 * and due day, so importing again updates rather than duplicates in most apps.
 */

/** Items worth putting on a calendar: a due date today or later, not already booked. */
export function calendarItems(items: UpkeepItem[], today: string): UpkeepItem[] {
  return items.filter((i) => i.status !== "booked" && i.next_due !== null && i.next_due >= today);
}

const compact = (day: string) => day.replaceAll("-", "");

const nextDay = (day: string) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/** TEXT escaping (RFC 5545 §3.3.11). */
export const escapeText = (value: string) =>
  value.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Folds a content line at 75 octets (§3.1), never splitting a UTF-8 character. */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    // The first line holds 75 octets; continuation lines lose one to the leading space.
    if (size + bytes > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += char;
    size += bytes;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

const stamp = (now: Date) => now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** The whole calendar file. `origin` makes each event link back to /upkeep. */
export function upkeepIcs(items: UpkeepItem[], opts: { today: string; origin?: string; now?: Date }): string {
  const dtstamp = stamp(opts.now ?? new Date());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Sheree//Beauty calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Sheree beauty calendar",
  ];
  for (const item of calendarItems(items, opts.today)) {
    const due = item.next_due as string;
    const name = item.name.toLowerCase();
    const who = item.rebook?.professional_name;
    const url = opts.origin ? `${opts.origin}/upkeep` : null;
    const description = [
      who ? `It's been a while. Book ${who} again on Sheree.` : `Plan your next ${name} appointment on Sheree.`,
      url,
    ]
      .filter(Boolean)
      .join("\n");
    lines.push(
      "BEGIN:VEVENT",
      `UID:upkeep-${item.category}-${compact(due)}@sheree`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${compact(due)}`,
      `DTEND;VALUE=DATE:${compact(nextDay(due))}`,
      `SUMMARY:${escapeText(`Time for fresh ${name}`)}`,
      `DESCRIPTION:${escapeText(description)}`,
      ...(url ? [`URL:${url}`] : []),
      "TRANSP:TRANSPARENT",
      // Two days before at 10:00 (all-day events start at midnight).
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${escapeText(`${item.name} due in 2 days`)}`,
      "TRIGGER:-P1DT14H",
      "END:VALARM",
      // On the day at 10:00.
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${escapeText(`Time for fresh ${name}`)}`,
      "TRIGGER:PT10H",
      "END:VALARM",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

/** Saves the file in the browser (opens the "add to calendar" prompt on iOS). */
export function downloadIcs(contents: string, filename = "sheree-beauty-calendar.ics") {
  const url = URL.createObjectURL(new Blob([contents], { type: "text/calendar;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
