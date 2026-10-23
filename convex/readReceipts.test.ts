/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

/**
 * Read-receipt tests.
 *
 * The invariant under test is that a receipt is derived from ONE cursor per
 * participant, and that the cursor is trustworthy:
 *
 *   - it starts as nothing ("not read yet") and never as "read";
 *   - it advances only when the reader's own client opens the thread;
 *   - it lands on the same clock as `messages.createdAt`, because the app
 *     decides "Read" by comparing the two client-side;
 *   - it is the PEER's cursor, so the two sides of a thread never see each
 *     other's own reading reflected back as a receipt on their own words.
 *
 * These run against the real schema and functions, so a regression in the
 * storage rule fails here rather than silently showing the wrong tick.
 */

const modules = import.meta.glob("./**/*.ts");

beforeAll(() => {
  // `getOrCreateDirect` schedules `syncProfiles`, which reaches Postgres from an
  // action. The tests stand in for that boundary: an empty result set means "no
  // profile data to reconcile", and nothing here ever touches the network.
  process.env.SUPABASE_URL = "https://supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  vi.stubGlobal(
    "fetch",
    async () => new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } }),
  );
});

afterAll(() => {
  vi.unstubAllGlobals();
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

type Test = ReturnType<typeof convexTest>;

function identity(externalId: string) {
  return { subject: externalId, name: externalId };
}

/** Ama is the customer in every thread here; Bella owns a professional profile. */
const AMA = "user-ama";
const BELLA = "user-bella";
const OUTSIDER = "user-chi";

/**
 * Idempotency keys are unique per (author, key) across the whole deployment, so
 * the counter is module-level rather than per conversation.
 */
let clientMessageSeq = 0;

async function seedUser(
  t: Test,
  user: { externalId: string; customerName: string; professionalName?: string | null },
): Promise<Id<"users">> {
  const professionalName = user.professionalName ?? null;
  return await t.run(async (ctx) =>
    ctx.db.insert("users", {
      externalId: user.externalId,
      username: user.customerName,
      customerName: user.customerName,
      professionalName,
      professionalAvatarUrl: professionalName ? `${user.externalId}-business.jpg` : null,
      displayName: user.customerName,
      avatarUrl: `${user.externalId}-personal.jpg`,
      role: professionalName ? "professional" : "customer",
      syncedAt: Date.now(),
    }),
  );
}

async function seedFixture(t: Test): Promise<void> {
  await seedUser(t, { externalId: AMA, customerName: "Ama" });
  await seedUser(t, {
    externalId: BELLA,
    customerName: "Bella",
    professionalName: "Bella Beauty",
  });
  await seedUser(t, { externalId: OUTSIDER, customerName: "Chi" });
}

/** Starts the thread the way every entry point in the app does. */
async function contact(t: Test, fromExternalId: string, toExternalId: string) {
  return await t
    .withIdentity(identity(fromExternalId))
    .mutation(api.conversations.getOrCreateDirect, {
      peerExternalId: toExternalId,
      originKind: "profile",
    });
}

async function sendText(t: Test, author: string, conversationId: Id<"conversations">, body: string) {
  clientMessageSeq += 1;
  return await t.withIdentity(identity(author)).mutation(api.messages.sendText, {
    conversationId,
    body,
    clientMessageId: `msg-${clientMessageSeq}`,
  });
}

async function markRead(
  t: Test,
  reader: string,
  conversationId: Id<"conversations">,
  lastReadMessageId?: Id<"messages">,
) {
  await t.withIdentity(identity(reader)).mutation(api.conversations.markRead, {
    conversationId,
    lastReadMessageId,
  });
}

/** What `reader` is told about how much the OTHER participant has read. */
async function receiptFor(t: Test, reader: string, conversationId: Id<"conversations">) {
  return await t
    .withIdentity(identity(reader))
    .query(api.conversations.readReceipt, { conversationId });
}

describe("read receipts", () => {
  test("a sent message is unread until the peer actually opens the thread", async () => {
    const t = convexTest(schema, modules);
    await seedFixture(t);
    const conversationId = await contact(t, AMA, BELLA);

    // Nothing has been sent, so there is no cursor row at all.
    expect(await receiptFor(t, AMA, conversationId)).toEqual({
      peerLastReadAt: null,
      peerLastReadMessageId: null,
      peerName: "Bella Beauty",
    });

    const sent = await sendText(t, AMA, conversationId, "Are you free on Friday?");

    // Sending writes the recipient a placeholder cursor row with `lastReadAt: 0`.
    // It must still read as "not read yet": the app has a single meaning for that
    // state, so a zeroed row can never be mistaken for "read at the epoch".
    expect(await receiptFor(t, AMA, conversationId)).toEqual({
      peerLastReadAt: null,
      peerLastReadMessageId: null,
      peerName: "Bella Beauty",
    });

    await markRead(t, BELLA, conversationId, sent.messageId);

    const read = await receiptFor(t, AMA, conversationId);
    expect(read?.peerLastReadMessageId).toEqual(sent.messageId);
    // The decisive assertion: the cursor shares a clock with `createdAt`, because
    // the app compares the two to decide that this very message is Read.
    expect(read?.peerLastReadAt ?? 0).toBeGreaterThanOrEqual(sent.createdAt);
  });

  test("each side is shown the other's cursor, named by their role in the thread", async () => {
    const t = convexTest(schema, modules);
    await seedFixture(t);
    const conversationId = await contact(t, AMA, BELLA);
    const sent = await sendText(t, AMA, conversationId, "Hello Bella");

    // Ama reads, which must become BELLA's receipt — never Ama's own.
    await markRead(t, AMA, conversationId, sent.messageId);

    const bellaSees = await receiptFor(t, BELLA, conversationId);
    expect(bellaSees?.peerLastReadMessageId).toEqual(sent.messageId);
    // The professional sees the customer's personal name...
    expect(bellaSees?.peerName).toBe("Ama");

    const amaSees = await receiptFor(t, AMA, conversationId);
    // ...and the customer sees the business identity, in this thread only.
    expect(amaSees?.peerName).toBe("Bella Beauty");
    expect(amaSees?.peerLastReadMessageId).toBeNull();
    expect(amaSees?.peerLastReadAt).toBeNull();
  });

  test("a message sent after the read stays unread until the thread is opened again", async () => {
    const t = convexTest(schema, modules);
    await seedFixture(t);
    const conversationId = await contact(t, AMA, BELLA);

    const first = await sendText(t, AMA, conversationId, "First");
    await markRead(t, BELLA, conversationId, first.messageId);

    const second = await sendText(t, AMA, conversationId, "Second");

    // The cursor is still parked on the first message, so the second is Sent even
    // though the thread was read a moment ago: the app's rule is
    // `createdAt <= peerLastReadAt`, and that does not hold for the second.
    const afterSecond = await receiptFor(t, AMA, conversationId);
    expect(afterSecond?.peerLastReadMessageId).toEqual(first.messageId);
    expect(afterSecond?.peerLastReadAt).not.toBeNull();
    expect(afterSecond?.peerLastReadAt ?? 0).toBeLessThan(second.createdAt);

    // Reading again advances the one cursor rather than adding a second one.
    await markRead(t, BELLA, conversationId, second.messageId);
    const afterReread = await receiptFor(t, AMA, conversationId);
    expect(afterReread?.peerLastReadMessageId).toEqual(second.messageId);
    expect(afterReread?.peerLastReadAt ?? 0).toBeGreaterThanOrEqual(second.createdAt);

    const cursorRows = await t.run(async (ctx) =>
      (await ctx.db.query("readStates").collect()).filter(
        (state) => state.conversationId === conversationId,
      ),
    );
    // Still exactly one cursor per participant — and note the second message did
    // not add a third. Receipts cost a row per person, not a row per message.
    expect(cursorRows).toHaveLength(2);
  });

  test("reading clears the badge, and the next message turns it back on", async () => {
    const t = convexTest(schema, modules);
    await seedFixture(t);
    const conversationId = await contact(t, AMA, BELLA);

    const unreadFor = async () => {
      const inbox = await t
        .withIdentity(identity(BELLA))
        .query(api.conversations.list, { inbox: "professional", limit: 40 });
      return inbox.find((row) => row.id === conversationId)?.unreadCount ?? 0;
    };

    const first = await sendText(t, AMA, conversationId, "Ping");
    expect(await unreadFor()).toBe(1);

    await markRead(t, BELLA, conversationId, first.messageId);
    expect(await unreadFor()).toBe(0);

    await sendText(t, AMA, conversationId, "Ping again");
    expect(await unreadFor()).toBe(1);
  });

  test("the cursor is never exposed to somebody who is not in the thread", async () => {
    const t = convexTest(schema, modules);
    await seedFixture(t);
    const conversationId = await contact(t, AMA, BELLA);
    const sent = await sendText(t, AMA, conversationId, "Private");
    await markRead(t, BELLA, conversationId, sent.messageId);

    // Chi is a real, signed-in user with no part in this conversation.
    expect(await receiptFor(t, OUTSIDER, conversationId)).toBeNull();

    // And a signed-out caller gets nothing at all.
    expect(await t.query(api.conversations.readReceipt, { conversationId })).toBeNull();
  });
});
