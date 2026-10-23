import { describe, expect, test } from "vitest";
import { conversationHref, conversationIdFromPath } from "./routes";

/**
 * Direct URLs, refreshes and browser navigation all go through this parser.
 * If it disagrees with the route, the phone shows the list while the thread
 * route is open — exactly the off-by-one that a deep link exposes.
 */
describe("conversation routing", () => {
  test("reads the thread id from the URL", () => {
    expect(conversationIdFromPath("/messages/abc123")).toBe("abc123");
    expect(conversationIdFromPath("/messages/abc123?from=notification")).toBe("abc123");
    expect(conversationIdFromPath("/messages/abc123#new")).toBe("abc123");
  });

  test("the list route has no thread", () => {
    expect(conversationIdFromPath("/messages")).toBeNull();
    expect(conversationIdFromPath("/messages/")).toBeNull();
    expect(conversationIdFromPath("/bookings")).toBeNull();
    expect(conversationIdFromPath(null)).toBeNull();
  });

  test("ids survive encoding, so links round-trip", () => {
    const id = "kg2 d/abc";
    expect(conversationIdFromPath(conversationHref(id))).toBe(id);
  });

  test("a malformed escape is used verbatim rather than crashing the route", () => {
    expect(conversationIdFromPath("/messages/%E0%A4%A")).toBe("%E0%A4%A");
  });
});
