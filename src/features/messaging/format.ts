import type {
  MessageView,
  PriceCardView,
  PresenceView,
  PriceCardStatus,
} from "./types";

/**
 * Presentation helpers for the chat.
 *
 * Pure functions, so the grouping and status rules can be tested without a
 * browser and reused by every thread surface (messages, post side panel).
 */

const DAY_MS = 86_400_000;

export function startOfDay(value: number | Date): number {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function dayKey(value: number): string {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

export function dayLabel(value: number, now = Date.now()): string {
  const today = startOfDay(now);
  const day = startOfDay(value);
  const diff = Math.round((today - day) / DAY_MS);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff > 1 && diff < 7) {
    return new Intl.DateTimeFormat("en-GB", { weekday: "long" }).format(value);
  }
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: new Date(value).getFullYear() === new Date(now).getFullYear() ? undefined : "numeric",
  }).format(value);
}

export function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(timestamp);
}

/** `m:ss` for voice notes; `0:07` rather than `7`. */
export function formatDuration(millis: number): string {
  const total = Math.max(0, Math.round(millis / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Presence copy, in one place.
 *
 * `unknown` (no row) renders nothing at all; `offline` with a last-seen time
 * says when they were last here. "Away" is kept distinct from "offline" because
 * they mean different things: one is a known state, the other is a guess.
 */
export function presenceLabel(presence: PresenceView | null | undefined, now = Date.now()): string | null {
  if (!presence || presence.lastSeenAt === null) return null;
  if (presence.online) return "Online";
  const elapsed = now - presence.lastSeenAt;
  if (elapsed <= 5 * 60_000) return "Away";
  const date = new Date(presence.lastSeenAt);
  const sameDay = dayKey(presence.lastSeenAt) === dayKey(now);
  const time = formatTime(presence.lastSeenAt);
  if (sameDay) return `Last seen ${time}`;
  const label = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(date);
  return `Last seen ${label}`;
}

/** Groups consecutive messages by author within a five-minute window. */
export function isGroupedWithPrevious(current: MessageView, previous: MessageView | undefined): boolean {
  if (!previous) return false;
  if (previous.authorId !== current.authorId) return false;
  if (previous.kind === "system" || current.kind === "system") return false;
  return current.createdAt - previous.createdAt < 5 * 60_000;
}

export type MessageRow = {
  message: MessageView;
  groupedWithPrevious: boolean;
  showDay: boolean;
  dayLabel: string | null;
};

/** Turns a chronological list into the rows the thread renders. */
export function buildMessageRows(messages: MessageView[], now = Date.now()): MessageRow[] {
  let lastDay: string | null = null;
  return messages.map((message, index) => {
    const key = dayKey(message.createdAt);
    const showDay = key !== lastDay;
    lastDay = key;
    return {
      message,
      groupedWithPrevious: !showDay && isGroupedWithPrevious(message, messages[index - 1]),
      showDay,
      dayLabel: showDay ? dayLabel(message.createdAt, now) : null,
    };
  });
}

export function formatPrice(minor: number, currency = "GHS"): string {
  const amount = Number.isFinite(minor) ? minor / 100 : 0;
  try {
    return new Intl.NumberFormat("en-GH", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export function isPriceCardExpired(card: PriceCardView, now = Date.now()): boolean {
  return card.status === "expired" || (card.expiresAt !== null && card.expiresAt <= now);
}

/** The state the customer sees, folding expiry and booking status into one word. */
export function priceCardStateLabel(card: PriceCardView, now = Date.now()): string {
  if (card.status === "cancelled") return "Withdrawn";
  if (card.status === "booked") {
    if (card.bookingStatus === "completed") return "Settled";
    if (card.bookingStatus === "cancelled") return "Booking cancelled";
    if (card.bookingStatus === "no_show") return "No show";
    return card.bookingReference ? `Booked · ${card.bookingReference}` : "Booked";
  }
  if (isPriceCardExpired(card, now)) return "Expired";
  return "Awaiting booking";
}

export function canBookPriceCard(card: PriceCardView, now = Date.now()): boolean {
  return card.status === "sent" && !isPriceCardExpired(card, now) && card.publishedAt !== null;
}

export function canWithdrawPriceCard(card: PriceCardView): boolean {
  return card.status === "sent";
}

export const PRICE_CARD_TONE: Record<PriceCardStatus, string> = {
  draft: "bg-tint text-muted",
  sent: "bg-secondary text-ink",
  booked: "bg-success-surface text-success",
  expired: "bg-raised text-muted",
  cancelled: "bg-danger-surface text-danger",
};
