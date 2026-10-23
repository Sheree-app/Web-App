import type { PendingMessage, ReplyReference } from "./types";

/**
 * Optimistic outbox rules, kept pure so they can be tested.
 *
 * A pending message is rendered until the server copy appears in the paginated
 * query. Retrying reuses the SAME `clientMessageId`, which is what makes the
 * Convex idempotency guard collapse a retry into the original message instead of
 * posting a duplicate.
 */

export function createPending(input: {
  clientMessageId: string;
  body: string;
  createdAt?: number;
  replyTo?: ReplyReference | null;
}): PendingMessage {
  return {
    clientMessageId: input.clientMessageId,
    body: input.body,
    createdAt: input.createdAt ?? Date.now(),
    replyTo: input.replyTo ?? null,
    status: "sending",
  };
}

export function markAcknowledged(
  pending: PendingMessage[],
  clientMessageId: string,
  ackId: string,
): PendingMessage[] {
  return pending.map((item) =>
    item.clientMessageId === clientMessageId
      ? { ...item, status: "sending", ackId }
      : item,
  );
}

export function markFailed(
  pending: PendingMessage[],
  clientMessageId: string,
): PendingMessage[] {
  return pending.map((item) =>
    item.clientMessageId === clientMessageId ? { ...item, status: "failed" } : item,
  );
}

/**
 * Retires bubbles the live query now contains. Unacknowledged or failed items
 * stay put so a retry is always possible.
 */
export function reconcilePending(
  pending: PendingMessage[],
  serverMessageIds: Iterable<string>,
): PendingMessage[] {
  const server = new Set(serverMessageIds);
  return pending.filter((item) => !item.ackId || !server.has(item.ackId));
}

/** The retry keeps the original id, so the server can deduplicate it. */
export function retryingPending(
  pending: PendingMessage[],
  clientMessageId: string,
): PendingMessage[] {
  return pending.map((item) =>
    item.clientMessageId === clientMessageId
      ? { ...item, status: "sending" }
      : item,
  );
}
