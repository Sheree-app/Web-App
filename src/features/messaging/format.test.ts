import { describe, expect, test } from "vitest";
import {
  buildMessageRows,
  canBookPriceCard,
  canWithdrawPriceCard,
  dayLabel,
  formatDuration,
  formatPrice,
  isGroupedWithPrevious,
  presenceLabel,
  priceCardStateLabel,
} from "./format";
import type { MessageView, PriceCardView } from "./types";

const NOW = new Date("2026-03-14T12:00:00Z").getTime();

function message(overrides: Partial<MessageView> = {}): MessageView {
  return {
    id: "m1" as MessageView["id"],
    conversationId: "c1" as MessageView["conversationId"],
    authorId: "u1" as MessageView["authorId"],
    authorName: "Ama",
    kind: "text",
    body: "Hello",
    createdAt: NOW,
    isMine: false,
    replyTo: null,
    image: null,
    voice: null,
    priceCard: null,
    ...overrides,
  };
}

function card(overrides: Partial<PriceCardView> = {}): PriceCardView {
  return {
    id: "p1" as PriceCardView["id"],
    conversationId: "c1" as PriceCardView["conversationId"],
    creatorId: "u1" as PriceCardView["creatorId"],
    recipientId: "u2" as PriceCardView["recipientId"],
    serviceName: "Silk press",
    description: null,
    priceMinor: 22_000,
    currency: "GHS",
    durationMinutes: 90,
    durationLabel: "90 min",
    status: "sent",
    bookingId: null,
    bookingReference: null,
    bookingStartsAt: null,
    bookingStatus: null,
    expiresAt: NOW + 86_400_000,
    publishedAt: NOW,
    publishError: null,
    createdAt: NOW,
    ...overrides,
  };
}

describe("date separators", () => {
  test("labels today and yesterday, then falls back to a real date", () => {
    expect(dayLabel(NOW, NOW)).toBe("Today");
    expect(dayLabel(NOW - 86_400_000, NOW)).toBe("Yesterday");
    expect(dayLabel(new Date("2026-03-10T12:00:00Z").getTime(), NOW)).toBe("Tuesday");
    expect(dayLabel(new Date("2026-01-04T12:00:00Z").getTime(), NOW)).toBe("4 January");
  });

  test("a new day starts a new row group", () => {
    const rows = buildMessageRows(
      [
        message({ id: "a" as MessageView["id"], createdAt: NOW - 86_400_000 }),
        message({ id: "b" as MessageView["id"], createdAt: NOW, body: "Morning" }),
        message({ id: "c" as MessageView["id"], createdAt: NOW + 60_000, body: "Morning!" }),
      ],
      NOW,
    );
    expect(rows[0].showDay).toBe(true);
    expect(rows[1].showDay).toBe(true);
    expect(rows[2].showDay).toBe(false);
    expect(rows[2].groupedWithPrevious).toBe(true);
  });
});

describe("message grouping", () => {
  test("consecutive messages from the same author within five minutes group", () => {
    const first = message({ createdAt: NOW });
    const second = message({ createdAt: NOW + 60_000 });
    expect(isGroupedWithPrevious(second, first)).toBe(true);
    expect(isGroupedWithPrevious({ ...second, authorId: "u2" as MessageView["authorId"] }, first)).toBe(
      false,
    );
    expect(
      isGroupedWithPrevious({ ...second, createdAt: NOW + 6 * 60_000 }, first),
    ).toBe(false);
  });

  test("system messages never group with chat bubbles", () => {
    const first = message();
    expect(isGroupedWithPrevious({ ...message(), kind: "system" }, first)).toBe(false);
  });
});

describe("presence copy", () => {
  test("distinguishes unknown, online, away and last seen", () => {
    expect(presenceLabel(null)).toBeNull();
    expect(presenceLabel({ online: false, lastSeenAt: null })).toBeNull();
    expect(presenceLabel({ online: true, lastSeenAt: NOW })).toBe("Online");
    expect(presenceLabel({ online: false, lastSeenAt: NOW - 60_000 }, NOW)).toBe("Away");
    expect(presenceLabel({ online: false, lastSeenAt: NOW - 3_600_000 }, NOW)).toContain(
      "Last seen",
    );
  });
});

describe("voice durations", () => {
  test("formats m:ss", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(7_400)).toBe("0:07");
    expect(formatDuration(125_000)).toBe("2:05");
  });
});

describe("price cards", () => {
  test("formats the authoritative minor-unit price", () => {
    expect(formatPrice(22_000)).toContain("220.00");
  });

  test("only a live, published card can be booked", () => {
    expect(canBookPriceCard(card(), NOW)).toBe(true);
    expect(canBookPriceCard(card({ status: "expired" }), NOW)).toBe(false);
    expect(canBookPriceCard(card({ expiresAt: NOW - 1 }), NOW)).toBe(false);
    expect(canBookPriceCard(card({ publishedAt: null }), NOW)).toBe(false);
    expect(canBookPriceCard(card({ status: "booked" }), NOW)).toBe(false);
  });

  test("only an unbooked card can be withdrawn", () => {
    expect(canWithdrawPriceCard(card())).toBe(true);
    expect(canWithdrawPriceCard(card({ status: "booked" }))).toBe(false);
  });

  test("folds booking states into the label the bubble shows", () => {
    expect(priceCardStateLabel(card(), NOW)).toBe("Awaiting booking");
    expect(priceCardStateLabel(card({ status: "cancelled" }), NOW)).toBe("Withdrawn");
    expect(priceCardStateLabel(card({ status: "expired" }), NOW)).toBe("Expired");
    expect(
      priceCardStateLabel(
        card({ status: "booked", bookingStatus: "confirmed", bookingReference: "SHR-42" }),
        NOW,
      ),
    ).toBe("Booked · SHR-42");
    expect(
      priceCardStateLabel(card({ status: "booked", bookingStatus: "completed" }), NOW),
    ).toBe("Settled");
  });
});
