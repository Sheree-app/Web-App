import { describe, expect, test } from "vitest";
import {
  createPending,
  markAcknowledged,
  markFailed,
  reconcilePending,
  retryingPending,
} from "./outbox";
import type { Id } from "../../../convex/_generated/dataModel";
import type { ReplyReference } from "./types";

const reply: ReplyReference = {
  messageId: "m0" as Id<"messages">,
  authorName: "Bella",
  preview: "Are you free Friday?",
  available: true,
};

describe("optimistic outbox", () => {
  test("a new send renders immediately as sending", () => {
    const pending = createPending({
      clientMessageId: "c-1",
      body: "Hello",
      createdAt: 1_000,
      replyTo: reply,
    });
    expect(pending).toMatchObject({
      clientMessageId: "c-1",
      body: "Hello",
      status: "sending",
      replyTo: reply,
    });
  });

  test("the bubble retires only after the live query contains the server id", () => {
    let pending = [createPending({ clientMessageId: "c-1", body: "Hello" })];
    pending = markAcknowledged(pending, "c-1", "server-1");
    expect(pending).toHaveLength(1);

    // The query has not delivered the new row yet — keeping the bubble avoids
    // the message disappearing and flashing back in.
    expect(reconcilePending(pending, ["other"])).toHaveLength(1);
    expect(reconcilePending(pending, ["server-1"])).toHaveLength(0);
  });

  test("a retry keeps the same id, so the server can deduplicate", () => {
    let pending = [createPending({ clientMessageId: "c-1", body: "Hello" })];
    pending = markFailed(pending, "c-1");
    expect(pending[0].status).toBe("failed");
    expect(pending[0].clientMessageId).toBe("c-1");

    pending = retryingPending(pending, "c-1");
    expect(pending[0].status).toBe("sending");
    expect(pending[0].clientMessageId).toBe("c-1");
  });

  test("failed and unacknowledged messages are never reconciled away", () => {
    const pending = [
      { ...createPending({ clientMessageId: "c-1", body: "A" }), status: "failed" as const },
      createPending({ clientMessageId: "c-2", body: "B" }),
    ];
    expect(reconcilePending(pending, ["server-1"])).toHaveLength(2);
  });
});
