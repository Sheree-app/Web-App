/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { ONLINE_WINDOW_MS } from "./lib/presence";
import schema from "./schema";

/**
 * Online status and last seen.
 *
 * The invariants under test:
 *
 *   - nobody is online until their app has said so at least once, and absence is
 *     never dressed up as a status;
 *   - "online" expires by itself, because a force-quit can never send a goodbye —
 *     this is the case a stored boolean would get wrong forever;
 *   - last seen survives going away, and is the moment they left rather than the
 *     moment the window closed;
 *   - the privacy setting is enforced on every read, in both directions, because
 *     a one-way mirror is not a privacy setting.
 *
 * These run the real functions against the real schema, so a regression in the
 * storage rule fails here instead of quietly showing somebody as available.
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

const AMA = "user-ama";
const BELLA = "user-bella";
const OUTSIDER = "user-chi";

function identity(externalId: string) {
  return { subject: externalId, name: externalId };
}

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

/** Ama is the customer in every thread here; Bella owns a professional profile. */
async function seedFixture(t: Test): Promise<{ amaId: Id<"users">; bellaId: Id<"users"> }> {
  const amaId = await seedUser(t, { externalId: AMA, customerName: "Ama" });
  const bellaId = await seedUser(t, {
    externalId: BELLA,
    customerName: "Bella",
    professionalName: "Bella Beauty",
  });
  await seedUser(t, { externalId: OUTSIDER, customerName: "Chi" });
  return { amaId, bellaId };
}

async function contact(t: Test, fromExternalId: string, toExternalId: string) {
  return await t
    .withIdentity(identity(fromExternalId))
    .mutation(api.conversations.getOrCreateDirect, {
      peerExternalId: toExternalId,
      originKind: "profile",
    });
}

/** "I am here" — what `PresenceHeartbeat` sends on mount and every 30s. */
async function beat(t: Test, externalId: string): Promise<number> {
  return await t.withIdentity(identity(externalId)).mutation(api.presence.heartbeat, {});
}

/** "I am leaving" — background, or the session ending. */
async function sayGoodbye(t: Test, externalId: string): Promise<number | null> {
  return await t.withIdentity(identity(externalId)).mutation(api.presence.goAway, {});
}

async function setVisibility(t: Test, externalId: string, visibility: "everyone" | "nobody") {
  return await t
    .withIdentity(identity(externalId))
    .mutation(api.presence.setVisibility, { visibility });
}

async function peerPresence(t: Test, externalId: string, conversationId: Id<"conversations">) {
  return await t
    .withIdentity(identity(externalId))
    .query(api.presence.peerPresence, { conversationId });
}

/**
 * Moves somebody's last heartbeat into the past, as a crashed app would, and
 * returns the timestamp it left behind.
 *
 * Scanned rather than indexed: the test context is schema-loose by design (the
 * same reason `conversationRoles.test.ts` scans), and the fixture is two rows.
 */
async function backdateHeartbeat(
  t: Test,
  userId: Id<"users">,
  ageMs: number,
): Promise<number> {
  const lastSeenAt = Date.now() - ageMs;
  await t.run(async (ctx) => {
    const rows = await ctx.db.query("presence").collect();
    const row = rows.find((candidate) => candidate.userId === userId);
    if (!row) throw new Error("expected a presence row to backdate");
    await ctx.db.patch(row._id, { lastSeenAt });
  });
  return lastSeenAt;
}

describe("online status", () => {
  test("nobody is online until their app has said so", async () => {
    const t = convexTest(schema, modules);
    await seedFixture(t);
    const conversationId = await contact(t, AMA, BELLA);

    // Neither side has ever opened the app, so there is no status to report —
    // and the answer says "never seen" rather than inventing an offline reading.
    expect(await peerPresence(t, AMA, conversationId)).toEqual({ online: false, lastSeenAt: null });
    expect(await peerPresence(t, BELLA, conversationId)).toEqual({
      online: false,
      lastSeenAt: null,
    });

    const rows = await t.run(async (ctx) => await ctx.db.query("presence").collect());
    expect(rows).toHaveLength(0);
  });

  test("a heartbeat makes you online to the person you are talking to, and a goodbye ends it", async () => {
    const t = convexTest(schema, modules);
    await seedFixture(t);
    const conversationId = await contact(t, AMA, BELLA);

    const beatAt = await beat(t, AMA);

    const asBella = await peerPresence(t, BELLA, conversationId);
    expect(asBella?.online).toBe(true);
    expect(asBella?.lastSeenAt).toBe(beatAt);

    // Leaving ends it immediately rather than leaving Bella to watch a green dot
    // until the window lapses, and it moves last-seen forward with it.
    const leftAt = await sayGoodbye(t, AMA);
    const afterLeaving = await peerPresence(t, BELLA, conversationId);
    expect(afterLeaving?.online).toBe(false);
    expect(afterLeaving?.lastSeenAt).toBe(leftAt);
    expect(afterLeaving?.lastSeenAt).toBeGreaterThanOrEqual(beatAt);
  });

  test("a force-quit goes offline by itself, and keeps the last time they were here", async () => {
    const t = convexTest(schema, modules);
    const { amaId } = await seedFixture(t);
    const conversationId = await contact(t, AMA, BELLA);

    await beat(t, AMA);

    // The app was killed: the row still says "active" and always will, which is
    // exactly why online is derived from the timestamp rather than stored.
    const lastBeat = await backdateHeartbeat(t, amaId, ONLINE_WINDOW_MS + 5_000);

    const seenByBella = await peerPresence(t, BELLA, conversationId);
    expect(seenByBella?.online).toBe(false);
    // Last seen is the moment of the last beat — not the moment the window closed
    // and not now. The app is gone; the evidence that it was here survives.
    expect(seenByBella?.lastSeenAt).toBe(lastBeat);
    expect(Date.now() - (seenByBella?.lastSeenAt ?? 0)).toBeGreaterThan(ONLINE_WINDOW_MS);
  });

  test("one dropped heartbeat does not blink somebody offline", async () => {
    const t = convexTest(schema, modules);
    const { amaId } = await seedFixture(t);
    const conversationId = await contact(t, AMA, BELLA);

    await beat(t, AMA);
    // A beat is late but the next one is already on its way.
    await backdateHeartbeat(t, amaId, ONLINE_WINDOW_MS - 5_000);

    expect((await peerPresence(t, BELLA, conversationId))?.online).toBe(true);

    // Just past the window and the answer changes, so the slack above is real
    // slack rather than an unbounded "trust the flag".
    await backdateHeartbeat(t, amaId, ONLINE_WINDOW_MS + 5_000);
    expect((await peerPresence(t, BELLA, conversationId))?.online).toBe(false);
  });

  test("choosing a setting before ever beating does not publish a last-seen of 1970", async () => {
    const t = convexTest(schema, modules);
    await seedFixture(t);
    const conversationId = await contact(t, AMA, BELLA);

    // Bella turns her status off without her app ever having beaten. The row this
    // writes must not be mistaken for a sighting at the epoch.
    await setVisibility(t, BELLA, "nobody");
    await setVisibility(t, BELLA, "everyone");

    expect(await peerPresence(t, AMA, conversationId)).toEqual({
      online: false,
      lastSeenAt: null,
    });
  });
});

describe("presence privacy", () => {
  test("hiding your status is reciprocal, not a one-way mirror", async () => {
    const t = convexTest(schema, modules);
    await seedFixture(t);
    const conversationId = await contact(t, AMA, BELLA);
    await beat(t, AMA);
    await beat(t, BELLA);

    // Both are here and both can see each other.
    expect((await peerPresence(t, BELLA, conversationId))?.online).toBe(true);
    expect((await peerPresence(t, AMA, conversationId))?.online).toBe(true);

    await setVisibility(t, BELLA, "nobody");

    // Ama can no longer see Bella...
    expect(await peerPresence(t, AMA, conversationId)).toBeNull();
    // ...and Bella loses Ama's status in the same breath. Otherwise the setting
    // would be a way to watch without being watched.
    expect(await peerPresence(t, BELLA, conversationId)).toBeNull();

    await setVisibility(t, BELLA, "everyone");
    expect((await peerPresence(t, AMA, conversationId))?.online).toBe(true);
  });

  test("hiding your status still shows it to you", async () => {
    const t = convexTest(schema, modules);
    await seedFixture(t);
    await beat(t, AMA);

    const before = await t
      .withIdentity(identity(AMA))
      .query(api.presence.getMine, {});
    expect(before.visibility).toBe("everyone");
    expect(before.online).toBe(true);

    await setVisibility(t, AMA, "nobody");

    const after = await t.withIdentity(identity(AMA)).query(api.presence.getMine, {});
    expect(after.visibility).toBe("nobody");
    // What the setting decides is what OTHERS see. You are still told the truth
    // about yourself, which is what makes the screen trustworthy.
    expect(after.online).toBe(true);
    expect(after.lastSeenAt).not.toBeNull();
  });

  test("a conversation id is not a key to a stranger's activity", async () => {
    const t = convexTest(schema, modules);
    await seedFixture(t);
    const conversationId = await contact(t, AMA, BELLA);
    await beat(t, AMA);

    // Chi is a real, signed-in account with no part in this conversation.
    expect(await peerPresence(t, OUTSIDER, conversationId)).toBeNull();

    // And a signed-out caller gets nothing at all.
    expect(await t.query(api.presence.peerPresence, { conversationId })).toBeNull();
    expect((await t.query(api.presence.getMine, {})).visibility).toBe("everyone");
  });
});
