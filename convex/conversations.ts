import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import {
  MessagingError,
  ensureViewer,
  orderedParticipants,
  participantKeyFor,
  requireParticipantConversation,
  requireViewer,
  viewerOrNull,
} from "./lib/identity";
import {
  contextKeyFor,
  identityForRole,
  resolveConversationRoles,
  roleIn,
  rolesAreExplicit,
  type ConversationRole,
  type ConversationRoles,
} from "./lib/roles";
import { ensurePlaceholderUser, peerIdOf } from "./lib/users";
import {
  conversationPeer,
  conversationReadReceipt,
  type ConversationReadReceipt,
  type ConversationSummary,
} from "./lib/views";

const originKindValidator = v.union(
  v.literal("profile"),
  v.literal("post"),
  v.literal("service"),
  v.literal("custom_service"),
);

const contextValidator = v.union(
  v.literal("professional_contact"),
  v.literal("booking"),
);

/**
 * Which inbox a query is asking for. This is a VIEW filter, never an identity:
 * it selects threads by the role the caller already holds inside them.
 */
const inboxValidator = v.union(v.literal("customer"), v.literal("professional"));

/**
 * Writes the role columns onto a thread that predates them.
 *
 * Called when a thread is re-opened, so old conversations heal themselves as
 * soon as they are touched — the explicit fields then become the source of truth
 * for inbox placement and identity resolution. It never reassigns roles that are
 * already stored, so mode switching and re-entry cannot move a thread.
 */
async function adoptRoles(
  ctx: MutationCtx,
  conversation: Doc<"conversations">,
  roles: ConversationRoles,
): Promise<void> {
  const contextKey = contextKeyFor(roles.customerId, roles.professionalId);
  const needsRoles = !rolesAreExplicit(conversation);
  const needsContext = conversation.context !== "professional_contact";
  const needsKey = conversation.contextKey !== contextKey;
  if (!needsRoles && !needsContext && !needsKey) return;
  await ctx.db.patch(conversation._id, {
    customerUserId: roles.customerId,
    professionalUserId: roles.professionalId,
    contextKey,
    context: "professional_contact",
  });
}

/**
 * Finds an existing thread between two accounts that predates `contextKey`.
 *
 * `participantKey` is the sorted account pair, so it cannot distinguish "A
 * contacted B" from "B contacted A" — both exist legitimately and share it. The
 * caller therefore has to confirm the roles match before adopting the row, and
 * otherwise create a second, correctly-scoped thread.
 */
async function findPairThread(
  ctx: MutationCtx,
  aExternalId: string,
  bExternalId: string,
): Promise<Doc<"conversations"> | null> {
  return ctx.db
    .query("conversations")
    .withIndex("by_participant_key", (q) =>
      q.eq("participantKey", participantKeyFor(aExternalId, bExternalId)),
    )
    .first();
}

/**
 * Deterministically resolves the 1-to-1 thread for the CURRENT CONTEXT.
 *
 * Every entry point in the app is "this user is contacting that professional", so
 * the caller is the customer and the peer is the professional — recorded
 * explicitly here, whatever mode either of them happens to be browsing in.
 *
 * Uniqueness is keyed on `contextKey` (`customerUserId:professionalUserId`), not
 * on the account pair, so a later context where the roles are reversed creates
 * its own thread instead of silently merging with this one.
 */
export const getOrCreateDirect = mutation({
  args: {
    peerExternalId: v.string(),
    originKind: originKindValidator,
    /** Defaults to `professional_contact`; the only context produced today. */
    context: v.optional(contextValidator),
    originPostId: v.optional(v.string()),
    originImageUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const viewer = await ensureViewer(ctx);
    if (args.peerExternalId === viewer.externalId) {
      throw new MessagingError("invalid", "You cannot start a conversation with yourself.");
    }

    const peer = await ensurePlaceholderUser(ctx, args.peerExternalId);
    const roles: ConversationRoles = {
      customerId: viewer._id,
      professionalId: peer._id,
      source: "conversation",
    };
    const contextKey = contextKeyFor(roles.customerId, roles.professionalId);

    const existing = await ctx.db
      .query("conversations")
      .withIndex("by_context_key", (q) => q.eq("contextKey", contextKey))
      .first();

    if (existing) {
      await adoptRoles(ctx, existing, roles);
      // Re-entering from a post can enrich the context banner, but never
      // overwrites context the thread already carries.
      if (!existing.originPostId && args.originPostId) {
        await ctx.db.patch(existing._id, {
          originKind: args.originKind,
          originPostId: args.originPostId,
          originImageUrl: args.originImageUrl ?? existing.originImageUrl,
          updatedAt: Date.now(),
        });
      }
      return existing._id;
    }

    const legacy = await findPairThread(ctx, viewer.externalId, peer.externalId);
    if (legacy) {
      const legacyRoles = await resolveConversationRoles(ctx, legacy);
      // Only adopt the pre-existing thread when it is genuinely this context.
      // A reversed pair (the other user was the customer there) is a different
      // conversation and must not be merged into this one.
      if (
        legacyRoles &&
        legacyRoles.customerId === viewer._id &&
        legacyRoles.professionalId === peer._id
      ) {
        await adoptRoles(ctx, legacy, roles);
        if (!legacy.originPostId && args.originPostId) {
          await ctx.db.patch(legacy._id, {
            originKind: args.originKind,
            originPostId: args.originPostId,
            originImageUrl: args.originImageUrl ?? legacy.originImageUrl,
            updatedAt: Date.now(),
          });
        }
        return legacy._id;
      }
    }

    const [one, two] = orderedParticipants(viewer.externalId, peer.externalId);
    const now = Date.now();

    const conversationId = await ctx.db.insert("conversations", {
      participantIds: [viewer._id, peer._id],
      participantKey: participantKeyFor(viewer.externalId, peer.externalId),
      participantOne: one,
      participantTwo: two,
      customerUserId: roles.customerId,
      professionalUserId: roles.professionalId,
      contextKey,
      context: "professional_contact",
      lifecycle: "active",
      lastMessageAt: now,
      lastMessagePreview: "Conversation started",
      lastMessageKind: "system",
      lastMessageAuthorId: viewer._id,
      messageCount: 0,
      bookingId: null,
      archivedAt: null,
      originKind: args.originKind,
      originPostId: args.originPostId ?? null,
      originImageUrl: args.originImageUrl ?? null,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("readStates", {
      conversationId,
      userId: viewer._id,
      lastReadAt: now,
      lastReadMessageId: null,
      unreadCount: 0,
    });

    await ctx.scheduler.runAfter(0, internal.users.syncProfiles, {
      externalIds: [viewer.externalId, peer.externalId],
    });

    return conversationId;
  },
});

/** Builds one inbox row, resolved through the caller's role in that thread. */
async function summarize(
  ctx: QueryCtx,
  conversation: Doc<"conversations">,
  viewer: Doc<"users">,
  knownRole: ConversationRole | null,
): Promise<ConversationSummary | null> {
  const viewerRole = knownRole ?? (await roleIn(ctx, conversation, viewer._id));
  if (!viewerRole) return null;

  const peer = await conversationPeer(ctx, conversation, viewer._id);
  if (!peer) return null;

  const state = await ctx.db
    .query("readStates")
    .withIndex("by_conversation_user", (q) =>
      q.eq("conversationId", conversation._id).eq("userId", viewer._id),
    )
    .unique();

  return {
    id: conversation._id,
    peer,
    lastMessagePreview: conversation.lastMessagePreview,
    lastMessageAt: conversation.lastMessageAt,
    lastMessageKind: conversation.lastMessageKind,
    lastMessageFromMe: conversation.lastMessageAuthorId === viewer._id,
    unreadCount: state?.unreadCount ?? 0,
    lifecycle: conversation.lifecycle,
    bookingId: conversation.bookingId,
    originKind: conversation.originKind,
    originImageUrl: conversation.originImageUrl,
    viewerRole,
    viewerDisplayName: identityForRole(viewer, viewerRole).displayName,
    context: conversation.context ?? "professional_contact",
  };
}

function isLive(conversation: Doc<"conversations">): boolean {
  return conversation.lifecycle !== "purge_eligible";
}

/**
 * One inbox, and only one.
 *
 * Customer Mode lists threads where the caller is `customerUserId`; Professional
 * Mode lists threads where the caller is `professionalUserId`. Ownership of a
 * professional profile is never consulted, so a customer who happens to own a
 * business does not see their enquiry in the professional inbox, and the same
 * thread can never appear in both.
 *
 * `inbox` is optional purely for older builds: without it the thread list is
 * returned unfiltered, with roles still resolved correctly.
 */
export const list = query({
  args: {
    inbox: v.optional(inboxValidator),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<ConversationSummary[]> => {
    const viewer = await viewerOrNull(ctx);
    if (!viewer) return [];
    const limit = Math.min(Math.max(args.limit ?? 40, 1), 100);

    const inbox = args.inbox;
    const rows = new Map<Id<"conversations">, Doc<"conversations">>();

    if (inbox === "customer" || inbox === "professional") {
      // Explicitly scoped threads, straight off the role index.
      const scoped =
        inbox === "customer"
          ? await ctx.db
              .query("conversations")
              .withIndex("by_customer_last_message", (q) =>
                q.eq("customerUserId", viewer._id),
              )
              .order("desc")
              .take(limit)
          : await ctx.db
              .query("conversations")
              .withIndex("by_professional_last_message", (q) =>
                q.eq("professionalUserId", viewer._id),
              )
              .order("desc")
              .take(limit);
      for (const conversation of scoped) rows.set(conversation._id, conversation);
    }

    // Threads created before the role columns existed still need to appear in
    // the right inbox, so they are resolved by role and filtered the same way.
    const [asOne, asTwo] = await Promise.all([
      ctx.db
        .query("conversations")
        .withIndex("by_participant_one", (q) => q.eq("participantOne", viewer.externalId))
        .order("desc")
        .take(limit),
      ctx.db
        .query("conversations")
        .withIndex("by_participant_two", (q) => q.eq("participantTwo", viewer.externalId))
        .order("desc")
        .take(limit),
    ]);

    for (const conversation of [...asOne, ...asTwo]) {
      if (rows.has(conversation._id)) continue;
      if (rolesAreExplicit(conversation)) continue;
      if (!conversation.participantIds.some((id) => id === viewer._id)) continue;
      if (inbox) {
        const role = await roleIn(ctx, conversation, viewer._id);
        if (role !== inbox) continue;
      }
      rows.set(conversation._id, conversation);
    }

    const merged = [...rows.values()]
      .filter(isLive)
      .sort((a, b) => b.lastMessageAt - a.lastMessageAt)
      .slice(0, limit);

    const summaries = await Promise.all(
      merged.map((conversation) => summarize(ctx, conversation, viewer, inbox ?? null)),
    );

    return summaries.filter((summary): summary is ConversationSummary => summary !== null);
  },
});

/** Single conversation header data. Returns null when not a participant. */
export const get = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args): Promise<ConversationSummary | null> => {
    const viewer = await viewerOrNull(ctx);
    if (!viewer) return null;
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation) return null;
    if (!conversation.participantIds.some((id) => id === viewer._id)) return null;
    return summarize(ctx, conversation, viewer, null);
  },
});

/**
 * Advances the caller's read cursor for one thread. A single conversation-level
 * cursor is written here — not one row per message — so rendering a long
 * conversation never produces a mutation storm.
 */
export const markRead = mutation({
  args: {
    conversationId: v.id("conversations"),
    lastReadMessageId: v.optional(v.id("messages")),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const conversation = await requireParticipantConversation(
      ctx,
      args.conversationId,
      viewer._id,
    );
    const now = Date.now();
    const state = await ctx.db
      .query("readStates")
      .withIndex("by_conversation_user", (q) =>
        q.eq("conversationId", conversation._id).eq("userId", viewer._id),
      )
      .unique();

    if (state) {
      if (state.unreadCount === 0 && state.lastReadMessageId === (args.lastReadMessageId ?? null)) {
        return state.lastReadAt;
      }
      await ctx.db.patch(state._id, {
        lastReadAt: now,
        lastReadMessageId: args.lastReadMessageId ?? state.lastReadMessageId,
        unreadCount: 0,
      });
    } else {
      await ctx.db.insert("readStates", {
        conversationId: conversation._id,
        userId: viewer._id,
        lastReadAt: now,
        lastReadMessageId: args.lastReadMessageId ?? null,
        unreadCount: 0,
      });
    }
    return now;
  },
});

/**
 * The peer's read cursor for one thread — what makes a read receipt possible
 * without storing one row per message.
 *
 * The caller derives "Read" on their own bubbles by comparing each message's
 * `createdAt` with `peerLastReadAt` (or by matching `peerLastReadMessageId`), so
 * this query is the only thing the chat has to subscribe to: when the peer opens
 * the thread, `markRead` patches their single cursor row and this subscription
 * pushes the new value to the sender.
 *
 * Returns null when the caller is not a participant, matching `get`.
 */
export const readReceipt = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args): Promise<ConversationReadReceipt | null> => {
    const viewer = await viewerOrNull(ctx);
    if (!viewer) return null;
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation) return null;
    // Same gate as every other read path: a conversation id supplied by the
    // client must never reach another user's thread.
    if (!conversation.participantIds.some((id) => id === viewer._id)) return null;
    return conversationReadReceipt(ctx, conversation, viewer._id);
  },
});

/**
 * Total unread messages for the Messages badge.
 *
 * With `inbox` set, only threads the caller holds that role in are counted, so
 * the badge matches the inbox on screen. Without it, every thread counts — the
 * long-standing behaviour, kept for older builds.
 */
export const unreadTotal = query({
  args: { inbox: v.optional(inboxValidator) },
  handler: async (ctx, args): Promise<number> => {
    const viewer = await viewerOrNull(ctx);
    if (!viewer) return 0;
    const states = await ctx.db
      .query("readStates")
      .withIndex("by_user", (q) => q.eq("userId", viewer._id))
      .collect();
    let total = 0;
    for (const state of states) {
      if (state.unreadCount <= 0) continue;
      const conversation = await ctx.db.get(state.conversationId);
      // Threads awaiting cleanup must not contribute to the badge.
      if (!conversation || !isLive(conversation)) continue;
      if (args.inbox) {
        const role = await roleIn(ctx, conversation, viewer._id);
        if (role !== args.inbox) continue;
      }
      total += state.unreadCount;
    }
    return total;
  },
});

/** Marks a thread as eligible for the cleanup job once its booking has settled. */
export const markSettled = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const conversation = await requireParticipantConversation(
      ctx,
      args.conversationId,
      viewer._id,
    );
    if (conversation.lifecycle === "purge_eligible") return conversation.lifecycle;
    await ctx.db.patch(conversation._id, {
      lifecycle: "settled",
      archivedAt: Date.now(),
      updatedAt: Date.now(),
    });
    return "settled" as const;
  },
});

export { peerIdOf };
