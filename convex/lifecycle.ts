import type { Doc } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";

/**
 * Conversation cleanup.
 *
 * The product intent is that a thread is a working space for one custom booking
 * rather than a permanent social inbox, but deleting is deliberately staged and
 * never touches the business record:
 *
 *   active → booked → settled → purge_eligible → contents removed
 *
 * What is deleted: message bodies, chat image objects, reply chains, receipts.
 * What is kept: the `conversations` tombstone (participants, booking id, when it
 * was cleaned) and every `priceCards` row, so a booking, payment, dispute or
 * moderation review can still be reconstructed. Bookings themselves live in
 * Postgres and are never touched from here.
 */

/** Grace period after a booking finishes before a thread becomes purgeable. */
const SETTLED_GRACE_MS = 30 * 24 * 3_600_000;
/** Extra delay between "eligible" and actually wiping contents. */
const PURGE_DELAY_MS = 7 * 24 * 3_600_000;

export const flagSettledForCleanup = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - SETTLED_GRACE_MS;
    const settled = await ctx.db
      .query("conversations")
      .withIndex("by_lifecycle_last_message", (q) => q.eq("lifecycle", "settled"))
      .take(200);

    let flagged = 0;
    for (const conversation of settled) {
      const archivedAt = conversation.archivedAt ?? conversation.updatedAt;
      if (archivedAt > cutoff) continue;
      await ctx.db.patch(conversation._id, {
        lifecycle: "purge_eligible",
        updatedAt: Date.now(),
      });
      flagged += 1;
    }
    return flagged;
  },
});

export const purgeEligible = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - PURGE_DELAY_MS;
    const eligible = await ctx.db
      .query("conversations")
      .withIndex("by_lifecycle_last_message", (q) => q.eq("lifecycle", "purge_eligible"))
      .take(50);

    let purgedConversations = 0;
    let deletedMessages = 0;
    let deletedObjects = 0;

    for (const conversation of eligible) {
      const archivedAt = conversation.archivedAt ?? conversation.updatedAt;
      if (archivedAt > cutoff) continue;

      // Already emptied? Then leave the tombstone alone rather than re-scanning.
      if (conversation.messageCount === 0) continue;

      const messages = await ctx.db
        .query("messages")
        .withIndex("by_conversation_created", (q) =>
          q.eq("conversationId", conversation._id),
        )
        .take(500);

      for (const message of messages) {
        if (message.attachmentId) {
          const attachment = await ctx.db.get(message.attachmentId);
          if (attachment) {
            try {
              await ctx.storage.delete(attachment.storageId);
              deletedObjects += 1;
            } catch {
              // The object may already be gone; the row still goes.
            }
            await ctx.db.delete(attachment._id);
          }
        }
        await ctx.db.delete(message._id);
        deletedMessages += 1;
      }

      // Receipts only exist to make sends idempotent; their messages are gone.
      const receipts = await ctx.db
        .query("sendReceipts")
        .withIndex("by_client_message_id", (q) =>
          q.eq("authorId", conversation.lastMessageAuthorId),
        )
        .take(200);
      for (const receipt of receipts) {
        if (receipt.conversationId === conversation._id) {
          await ctx.db.delete(receipt._id);
        }
      }

      // Read cursors describe messages that no longer exist.
      for (const participantId of conversation.participantIds) {
        const state = await ctx.db
          .query("readStates")
          .withIndex("by_conversation_user", (q) =>
            q.eq("conversationId", conversation._id).eq("userId", participantId),
          )
          .unique();
        if (state) await ctx.db.delete(state._id);
      }

      // Soft tombstone: the thread is hidden from every list, but the numeric
      // link to the booking survives for audit.
      await ctx.db.patch(conversation._id, {
        messageCount: 0,
        lastMessagePreview: "This conversation has been closed",
        updatedAt: Date.now(),
      });
      purgedConversations += 1;
    }

    return { purgedConversations, deletedMessages, deletedObjects };
  },
});

/** Housekeeping: drops proposals nobody acted on. Cards stay for audit. */
export const expireStalePriceCards = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const sent = await ctx.db
      .query("priceCards")
      .withIndex("by_status_expiry", (q) => q.eq("status", "sent"))
      .take(200);

    let expired = 0;
    for (const card of sent as Doc<"priceCards">[]) {
      if (card.expiresAt === null || card.expiresAt > now) continue;
      await ctx.db.patch(card._id, { status: "expired", updatedAt: now });
      expired += 1;
    }
    return expired;
  },
});
