import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge conditional class names, letting later Tailwind utilities win. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** `1.2 km` / `900 m`, matching the distance copy used across explore. */
export function formatDistance(metres: number | null | undefined) {
  if (!metres || !Number.isFinite(metres)) return "";
  return metres < 1000 ? `${Math.round(metres)} m` : `${(metres / 1000).toFixed(1)} km`;
}

export function formatRating(rating: number | string | null | undefined) {
  const value = typeof rating === "string" ? Number(rating) : (rating ?? 0);
  return Number.isFinite(value) ? value.toFixed(1) : "New";
}

/** Long, unambiguous date copy: "Sat 14 Sep, 10:30". */
export function formatSlot(iso: string | null | undefined) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatDay(iso: string | null | undefined) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(
    date,
  );
}

/** Compact relative time for feeds: "now", "4h", "3d". */
export function timeAgo(iso: string | null | undefined) {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks}w`;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(then));
}

/** Initials fallback for avatars, matching the mobile treatment. */
export function initials(name: string | null | undefined) {
  if (!name) return "S";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "S";
}

export function truncate(value: string, max = 120) {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}
