/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

/**
 * Role and context tests for messaging.
 *
 * The invariant under test is the whole point of the change:
 *
 *   the role a user occupies IN THE CONVERSATION decides their identity and
 *   their inbox — never their app mode and never "do they own a professional
 *   profile?".
 *
 * These run against the real schema and the real Convex functions, so they fail
 * if the architecture regresses, not just the UI.
 */

const modules = import.meta.glob("./**/*.ts");

beforeAll(() => {
  // `syncProfiles` and the notification dispatcher reach Postgres from actions.
  // They are scheduled by the mutations under test, so the tests stand in for
  // that boundary: an empty result set means "no profile data to reconcile", and
  // nothing here ever touches the network.
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

type SeedUser = {
  externalId: string;
  /** Personal / customer-facing name. */
  customerName: string;
  /** Business name; only set for accounts that own a professional profile. */
  professionalName?: string | null;
  role?: "customer" | "professional";
};

function identity(externalId: string) {
  return { subject: externalId, name: externalId };
}

async function seedUser(t: ReturnType<typeof convexTest>, user: SeedUser) {
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
      role: user.role ?? (professionalName ? "professional" : "customer"),
      syncedAt: Date.now(),
    }),
  );
}

type Fixture = {
  aId: Id<"users">;
  bId: Id<"users">;
  cId: Id<"users">;
};

/** Ama (customer + professional profile), Bella Beauty, Chika (customer only). */
async function seedFixture(t: ReturnType<typeof convexTest>): Promise<Fixture> {
  const aId = await seedUser(t, {
    externalId: "user-a",
    customerName: "Ama",
    professionalName: "Ama's Nails",
    role: "professional",
  });
  const bId = await seedUser(t, {
    externalId: "user-b",
    customerName: "Bella",
    professionalName: "Bella Beauty",
    role: "professional",
  });
  const cId = await seedUser(t, {
    externalId: "user-c",
    customerName: "Chika",
    role: "customer",
  });
  return { aId, bId, cId };
}

/** Starts a conversation the way every entry point in the app does. */
async function contact(
  t: ReturnType<typeof convexTest>,
  fromExternalId: string,
  toExternalId: string,
) {
  return await t
    .withIdentity(identity(fromExternalId))
    .mutation(api.conversations.getOrCreateDirect, {
      peerExternalId: toExternalId,
      originKind: "profile",
    });
}

async function inbox(
  t: ReturnType<typeof convexTest>,
  externalId: string,
  which: "customer" | "professional",
) {
  return await t
    .withIdentity(identity(externalId))
    .query(api.conversations.list, { inbox: which, limit: 40 });
}

async function conversationDoc(t: ReturnType<typeof convexTest>, id: Id<"conversations">) {
  return await t.run(async (ctx) => ctx.db.get(id));
}

/**
 * Everything about a thread that a view is not allowed to change. Collected by
 * scan rather than index because the fixture data is tiny and the test context is
 * intentionally schema-loose.
 */
async function snapshotConversation(t: ReturnType<typeof convexTest>, id: Id<"conversations">) {
  return await t.run(async (ctx) => {
    const conversation = await ctx.db.get(id);
    const messages = (await ctx.db.query("messages").collect()).filter(
      (message) => message.conversationId === id,
    );
    const states = (await ctx.db.query("readStates").collect()).filter(
      (state) => state.conversationId === id,
    );
    return { conversation, messages, states };
  });
}

describe("conversation role model", () => {
  test("Test A — a customer-only user contacting a professional", async () => {
    const t = convexTest(schema, modules);
    const { bId, cId } = await seedFixture(t);

    // Chika (no professional profile at all) contacts Bella Beauty.
    const conversationId = await contact(t, "user-c", "user-b");

    const conversation = await conversationDoc(t, conversationId);
    // The caller is the customer; the peer is the professional.
    expect(conversation?.customerUserId).toEqual(cId);
    expect(conversation?.professionalUserId).toEqual(bId);

    const customerInbox = await inbox(t, "user-c", "customer");
    const professionalInbox = await inbox(t, "user-b", "professional");
    expect(customerInbox.map((row) => row.id)).toEqual([conversationId]);
    expect(professionalInbox.map((row) => row.id)).toEqual([conversationId]);

    // Bella sees Chika's personal identity.
    expect(professionalInbox[0].peer.displayName).toBe("Chika");
    expect(professionalInbox[0].peer.role).toBe("customer");
    expect(professionalInbox[0].viewerRole).toBe("professional");
    expect(professionalInbox[0].viewerDisplayName).toBe("Bella Beauty");

    // Chika sees the professional identity.
    expect(customerInbox[0].peer.displayName).toBe("Bella Beauty");
    expect(customerInbox[0].peer.role).toBe("professional");
    expect(customerInbox[0].viewerRole).toBe("customer");
    expect(customerInbox[0].viewerDisplayName).toBe("Chika");
    expect(customerInbox[0].context).toBe("professional_contact");

    // Neither of them sees it in the other inbox.
    expect(await inbox(t, "user-c", "professional")).toEqual([]);
    expect(await inbox(t, "user-b", "customer")).toEqual([]);
  });

  test("Test B — a customer who also owns a professional profile", async () => {
    const t = convexTest(schema, modules);
    const { aId, bId } = await seedFixture(t);

    const conversationId = await contact(t, "user-a", "user-b");

    const conversation = await conversationDoc(t, conversationId);
    expect(conversation?.customerUserId).toEqual(aId);
    expect(conversation?.professionalUserId).toEqual(bId);
    expect(conversation?.context).toBe("professional_contact");

    // Bella must see "Ama", never "Ama's Nails".
    const bellaProfessionalInbox = await inbox(t, "user-b", "professional");
    expect(bellaProfessionalInbox).toHaveLength(1);
    expect(bellaProfessionalInbox[0].peer.displayName).toBe("Ama");
    expect(bellaProfessionalInbox[0].peer.displayName).not.toBe("Ama's Nails");

    // Ama sees it in her CUSTOMER inbox...
    const amaCustomerInbox = await inbox(t, "user-a", "customer");
    expect(amaCustomerInbox.map((row) => row.id)).toEqual([conversationId]);
    expect(amaCustomerInbox[0].peer.displayName).toBe("Bella Beauty");
    expect(amaCustomerInbox[0].viewerDisplayName).toBe("Ama");

    // ...and NOT in her professional inbox, even though she owns a profile.
    expect(await inbox(t, "user-a", "professional")).toEqual([]);

    // Sender identity is also resolved per role, not globally.
    await t.withIdentity(identity("user-a")).mutation(api.messages.sendText, {
      conversationId,
      body: "Hi Bella, can I book a set?",
      clientMessageId: "msg-1",
    });

    const bellaView = await t.withIdentity(identity("user-b")).query(api.messages.list, {
      conversationId,
      paginationOpts: { numItems: 20, cursor: null },
    });
    expect(bellaView.page[0].authorName).toBe("Ama");
    expect(bellaView.page[0].isMine).toBe(false);
  });

  test("Test C — professional contacting professional to book them", async () => {
    const t = convexTest(schema, modules);
    const { aId, bId } = await seedFixture(t);

    // Ama's Nails wants to book Bella Beauty. In THIS conversation Ama is the
    // customer, whatever her profile says.
    const conversationId = await contact(t, "user-a", "user-b");

    const conversation = await conversationDoc(t, conversationId);
    expect(conversation?.customerUserId).toEqual(aId);
    expect(conversation?.professionalUserId).toEqual(bId);

    const amaCustomerInbox = await inbox(t, "user-a", "customer");
    expect(amaCustomerInbox.map((row) => row.id)).toEqual([conversationId]);

    const bellaProfessionalInbox = await inbox(t, "user-b", "professional");
    expect(bellaProfessionalInbox.map((row) => row.id)).toEqual([conversationId]);
    expect(bellaProfessionalInbox[0].peer.displayName).toBe("Ama");

    // Ama's professional profile does not change her role, or move the thread.
    expect(await inbox(t, "user-a", "professional")).toEqual([]);

    // Both directions of the thread carry the right identity.
    await t.withIdentity(identity("user-a")).mutation(api.messages.sendText, {
      conversationId,
      body: "Are you free next week?",
      clientMessageId: "msg-c1",
    });
    await t.withIdentity(identity("user-b")).mutation(api.messages.sendText, {
      conversationId,
      body: "Yes — sending a quote.",
      clientMessageId: "msg-c2",
    });

    const bellaView = await t.withIdentity(identity("user-b")).query(api.messages.list, {
      conversationId,
      paginationOpts: { numItems: 20, cursor: null },
    });
    const bellaSeesAma = bellaView.page.find((message) => !message.isMine);
    expect(bellaSeesAma?.authorName).toBe("Ama");

    const amaView = await t.withIdentity(identity("user-a")).query(api.messages.list, {
      conversationId,
      paginationOpts: { numItems: 20, cursor: null },
    });
    const amaSeesBella = amaView.page.find((message) => !message.isMine);
    expect(amaSeesBella?.authorName).toBe("Bella Beauty");
  });

  test("Test D — switching mode is a view, never a write", async () => {
    const t = convexTest(schema, modules);
    await seedFixture(t);
    const conversationId = await contact(t, "user-a", "user-b");
    await t.withIdentity(identity("user-a")).mutation(api.messages.sendText, {
      conversationId,
      body: "Hello",
      clientMessageId: "msg-d1",
    });
    await t.withIdentity(identity("user-b")).mutation(api.conversations.markRead, {
      conversationId,
    });

    const before = await snapshotConversation(t, conversationId);

    // Customer Mode → Professional Mode → Customer Mode.
    const firstCustomerInbox = await inbox(t, "user-a", "customer");
    const professionalInbox = await inbox(t, "user-a", "professional");
    const secondCustomerInbox = await inbox(t, "user-a", "customer");

    expect(firstCustomerInbox.map((row) => row.id)).toEqual([conversationId]);
    expect(professionalInbox).toEqual([]);
    expect(secondCustomerInbox.map((row) => row.id)).toEqual([conversationId]);

    const after = await snapshotConversation(t, conversationId);

    // The record itself is byte-for-byte untouched by viewing it.
    expect(after.conversation).toEqual(before.conversation);
    expect(after.messages).toEqual(before.messages);
    expect(after.states).toEqual(before.states);
  });

  test("Test E — one account, two conversations, two inboxes, no cross-contamination", async () => {
    const t = convexTest(schema, modules);
    const { aId, bId, cId } = await seedFixture(t);

    // Conversation 1: Ama is the customer (contacting Bella Beauty).
    const asCustomer = await contact(t, "user-a", "user-b");
    // Conversation 2: Ama is the professional (Chika asks her for a price).
    const asProfessional = await contact(t, "user-c", "user-a");

    expect(asCustomer).not.toEqual(asProfessional);

    const docOne = await conversationDoc(t, asCustomer);
    const docTwo = await conversationDoc(t, asProfessional);
    expect(docOne?.customerUserId).toEqual(aId);
    expect(docOne?.professionalUserId).toEqual(bId);
    expect(docTwo?.customerUserId).toEqual(cId);
    expect(docTwo?.professionalUserId).toEqual(aId);
    expect(docOne?.contextKey).not.toEqual(docTwo?.contextKey);

    const amaCustomerInbox = await inbox(t, "user-a", "customer");
    const amaProfessionalInbox = await inbox(t, "user-a", "professional");

    expect(amaCustomerInbox.map((row) => row.id)).toEqual([asCustomer]);
    expect(amaProfessionalInbox.map((row) => row.id)).toEqual([asProfessional]);
    expect(amaCustomerInbox[0].peer.displayName).toBe("Bella Beauty");
    expect(amaProfessionalInbox[0].peer.displayName).toBe("Chika");

    // The same two threads from the other side.
    expect((await inbox(t, "user-b", "professional")).map((row) => row.id)).toEqual([asCustomer]);
    expect((await inbox(t, "user-c", "customer")).map((row) => row.id)).toEqual([asProfessional]);

    // Closing the loop: a message from Ama reads as the customer in one thread
    // and as the professional in the other.
    await t.withIdentity(identity("user-a")).mutation(api.messages.sendText, {
      conversationId: asCustomer,
      body: "Booking question",
      clientMessageId: "msg-e1",
    });
    await t.withIdentity(identity("user-a")).mutation(api.messages.sendText, {
      conversationId: asProfessional,
      body: "Here is your quote",
      clientMessageId: "msg-e2",
    });

    const chikaView = await t.withIdentity(identity("user-c")).query(api.messages.list, {
      conversationId: asProfessional,
      paginationOpts: { numItems: 20, cursor: null },
    });
    expect(chikaView.page[0].authorName).toBe("Ama's Nails");

    const bellaView = await t.withIdentity(identity("user-b")).query(api.messages.list, {
      conversationId: asCustomer,
      paginationOpts: { numItems: 20, cursor: null },
    });
    expect(bellaView.page[0].authorName).toBe("Ama");
  });

  test("the same pair can hold both contexts without merging them", async () => {
    const t = convexTest(schema, modules);
    const { aId, bId } = await seedFixture(t);

    // Ama asks Bella for a booking...
    const amaAsCustomer = await contact(t, "user-a", "user-b");
    // ...and Bella separately asks Ama for one. Same two accounts, two contexts.
    const bellaAsCustomer = await contact(t, "user-b", "user-a");

    expect(amaAsCustomer).not.toEqual(bellaAsCustomer);

    const one = await conversationDoc(t, amaAsCustomer);
    const two = await conversationDoc(t, bellaAsCustomer);
    expect(one?.customerUserId).toEqual(aId);
    expect(one?.professionalUserId).toEqual(bId);
    expect(two?.customerUserId).toEqual(bId);
    expect(two?.professionalUserId).toEqual(aId);

    // Re-contacting resolves to the existing thread rather than creating another.
    expect(await contact(t, "user-a", "user-b")).toEqual(amaAsCustomer);
    expect(await contact(t, "user-b", "user-a")).toEqual(bellaAsCustomer);

    expect((await inbox(t, "user-a", "customer")).map((row) => row.id)).toEqual([amaAsCustomer]);
    expect((await inbox(t, "user-a", "professional")).map((row) => row.id)).toEqual([
      bellaAsCustomer,
    ]);
  });

  test("the unread badge counts only the inbox it is asked about", async () => {
    const t = convexTest(schema, modules);
    await seedFixture(t);
    const asCustomer = await contact(t, "user-a", "user-b");
    const asProfessional = await contact(t, "user-c", "user-a");

    await t.withIdentity(identity("user-a")).mutation(api.conversations.markRead, {
      conversationId: asCustomer,
    });
    await t.withIdentity(identity("user-a")).mutation(api.conversations.markRead, {
      conversationId: asProfessional,
    });

    // Chika writes to Ama-as-professional; Bella writes to Ama-as-customer.
    await t.withIdentity(identity("user-c")).mutation(api.messages.sendText, {
      conversationId: asProfessional,
      body: "One more thing",
      clientMessageId: "msg-badge-1",
    });
    await t.withIdentity(identity("user-b")).mutation(api.messages.sendText, {
      conversationId: asCustomer,
      body: "About your booking",
      clientMessageId: "msg-badge-2",
    });

    expect(
      await t.withIdentity(identity("user-a")).query(api.conversations.unreadTotal, {
        inbox: "customer",
      }),
    ).toBe(1);
    expect(
      await t.withIdentity(identity("user-a")).query(api.conversations.unreadTotal, {
        inbox: "professional",
      }),
    ).toBe(1);
    // Without an inbox the total is the legacy sum across both.
    expect(
      await t.withIdentity(identity("user-a")).query(api.conversations.unreadTotal, {}),
    ).toBe(2);
  });

  test("only the professional in the conversation can send a price card", async () => {
    const t = convexTest(schema, modules);
    await seedFixture(t);
    const conversationId = await contact(t, "user-a", "user-b");

    // Ama is the customer here, so she cannot quote.
    await expect(
      t.withIdentity(identity("user-a")).mutation(api.priceCards.create, {
        conversationId,
        serviceName: "Custom set",
        priceMinor: 22_000,
        durationMinutes: 90,
        durationLabel: "1.5 hours",
      }),
    ).rejects.toThrow(/professional in this conversation/i);

    // Bella, the professional in this thread, can.
    await t.withIdentity(identity("user-b")).mutation(api.priceCards.create, {
      conversationId,
      serviceName: "Custom set",
      priceMinor: 22_000,
      durationMinutes: 90,
      durationLabel: "1.5 hours",
    });

    const cards = await t.withIdentity(identity("user-a")).query(api.priceCards.byConversation, {
      conversationId,
    });
    expect(cards).toHaveLength(1);
    expect(cards[0].serviceName).toBe("Custom set");
  });
});

describe("legacy conversations", () => {
  /**
   * A conversation written the way the old code wrote it: two accounts, no role
   * columns. This is the shape the migration has to cope with.
   */
  async function seedLegacyConversation(
    t: ReturnType<typeof convexTest>,
    aId: Id<"users">,
    bId: Id<"users">,
    firstAuthorId: Id<"users">,
  ) {
    return await t.run(async (ctx) => {
      const now = Date.now();
      const conversationId = await ctx.db.insert("conversations", {
        participantIds: [aId, bId],
        participantKey: "user-a:user-b",
        participantOne: "user-a",
        participantTwo: "user-b",
        lifecycle: "active",
        lastMessageAt: now,
        lastMessagePreview: "Hi",
        lastMessageKind: "text",
        lastMessageAuthorId: firstAuthorId,
        messageCount: 1,
        bookingId: null,
        archivedAt: null,
        originKind: "profile",
        originPostId: null,
        originImageUrl: null,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("messages", {
        conversationId,
        authorId: firstAuthorId,
        kind: "text",
        body: "Hi",
        attachmentId: null,
        replyToMessageId: null,
        priceCardId: null,
        deletedAt: null,
        createdAt: now,
        clientSentAt: now,
      });
      return conversationId;
    });
  }

  test("a pre-migration thread still lands in the right inbox and shows the right name", async () => {
    const t = convexTest(schema, modules);
    const { aId, bId } = await seedFixture(t);
    const legacyId = await seedLegacyConversation(t, aId, bId, aId);

    // Roles are inferred from the accounts (exactly one is a professional).
    const bellaInbox = await inbox(t, "user-b", "professional");
    expect(bellaInbox.map((row) => row.id)).toEqual([legacyId]);
    expect(bellaInbox[0].peer.displayName).toBe("Ama");

    const amaCustomerInbox = await inbox(t, "user-a", "customer");
    expect(amaCustomerInbox.map((row) => row.id)).toEqual([legacyId]);
    expect(await inbox(t, "user-a", "professional")).toEqual([]);
  });

  test("the backfill materialises roles without touching anything else", async () => {
    const t = convexTest(schema, modules);
    const { aId, bId } = await seedFixture(t);
    const legacyId = await seedLegacyConversation(t, aId, bId, aId);

    const before = await snapshotConversation(t, legacyId);

    const dryRun = await t.mutation(internal.maintenance.backfillConversationRoles, {
      dryRun: true,
    });
    expect(dryRun.migrated).toBe(1);
    expect(dryRun.ambiguous).toBe(0);
    // A dry run writes nothing.
    expect(await conversationDoc(t, legacyId)).toEqual(before.conversation);

    const result = await t.mutation(internal.maintenance.backfillConversationRoles, {});
    expect(result.migrated).toBe(1);
    expect(result.alreadyScoped).toBe(0);

    const after = await conversationDoc(t, legacyId);
    expect(after?.customerUserId).toEqual(aId);
    expect(after?.professionalUserId).toEqual(bId);
    expect(after?.context).toBe("professional_contact");
    expect(after?.contextKey).toBe(`${aId}:${bId}`);

    // Only the role columns move — messages, read state and timestamps stay put.
    const post = await snapshotConversation(t, legacyId);
    expect(post.messages).toEqual(before.messages);
    expect(post.states).toEqual(before.states);
    expect({
      ...after,
      customerUserId: undefined,
      professionalUserId: undefined,
      context: undefined,
      contextKey: undefined,
    }).toEqual(before.conversation);

    // And the inboxes are unchanged by the migration itself.
    expect((await inbox(t, "user-b", "professional")).map((row) => row.id)).toEqual([legacyId]);
    expect((await inbox(t, "user-a", "customer")).map((row) => row.id)).toEqual([legacyId]);
    expect(await inbox(t, "user-a", "professional")).toEqual([]);

    // It is idempotent.
    const again = await t.mutation(internal.maintenance.backfillConversationRoles, {});
    expect(again.migrated).toBe(0);
    expect(again.alreadyScoped).toBe(1);
  });

  test("re-contacting a legacy thread adopts it instead of duplicating it", async () => {
    const t = convexTest(schema, modules);
    const { aId, bId } = await seedFixture(t);
    const legacyId = await seedLegacyConversation(t, aId, bId, aId);

    const reopened = await contact(t, "user-a", "user-b");
    expect(reopened).toEqual(legacyId);

    const adopted = await conversationDoc(t, legacyId);
    expect(adopted?.customerUserId).toEqual(aId);
    expect(adopted?.professionalUserId).toEqual(bId);

    const total = await t.run(async (ctx) => ctx.db.query("conversations").collect());
    expect(total).toHaveLength(1);
  });
});
