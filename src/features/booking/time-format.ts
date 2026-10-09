// Formats booking times as a 12-hour clock with AM/PM.
//
// Slot times from get_booking_slots arrive as "HH:MM" 24-hour strings
// (e.g. "14:30"), while booking.starts_at arrives as a full ISO timestamp.
// Both are normalised here so customers always see times like "2:30 PM".

export function formatTime12(value: string): string {
  if (!value) return value;
  if (value.includes("T") || value.includes(" ")) {
    return new Date(value).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  }
  const [hourStr, minuteStr] = value.split(":");
  const hour = Number(hourStr);
  if (Number.isNaN(hour)) return value;
  const minute = minuteStr !== undefined ? minuteStr.padStart(2, "0") : "00";
  const period = hour < 12 ? "AM" : "PM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${minute} ${period}`;
}
