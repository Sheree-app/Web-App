import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import {
  MessagingError,
  ensureViewer,
  requireParticipantConversation,
  requireViewer,
  viewerOrNull,
} from "./lib/identity";
import {
  identityForRole,
  resolveConversationRoles,
  roleFieldsFor,
  roleIn,
} from "./lib/roles";
import {
  fetchBooking,
  updateConversationPriceCardStatus,
  upsertConversationPriceCard,
} from "./lib/supabase";
import { peerIdOf } from "./lib/users";
import { priceCardView, type PriceCardView } from "./lib/views";
import { recordOutgoingMessage } from "./messages";

const DEFAULT_TTL_HOURS = 24 * 7;
const MAX_PRICE_MINOR = 100_000_000; // GHS 1,000,000 ceiling on a single proposal

/**
 * A price card is a one-off, conversation-only custom service. It is never
 * written to `professional_services`, so it can never appear on a public
 * profile, in search, or in the catalogue.
 *
 * Sending a proposal means acting as the provider, so this is only allowed for
 * the participant who is the *professional in this conversation* — not for any
 * account that happens to own a professional profile. That is how a professional
 * can book another professional: in that thread they are the customer, and only
 * the other side can quote them.
 *
 * The card's creator/recipient therefore always agree with the conversation's
 * `professionalUserId`/`customerUserId`.
 */
export const create = mutation({
  args: {
    conversationId: v.id("conversations"),
    serviceName: v.string(),
    description: v.optional(v.string()),
    priceMinor: v.number(),
    currency: v.optional(v.string()),
    durationMinutes: v.number(),
    durationLabel: v.string(),
    ttlHours: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const viewer = await ensureViewer(ctx);
    const conversation = await requireParticipantConversation(
      ctx,
      args.conversationId,
      viewer._id,
    );

    // Role comes from the conversation, never from profile ownership or mode.
    // Threads old enough to have no resolvable role at all stay permissive, so a
    // legacy conversation is never silently blocked.
    const roles = await resolveConversationRoles(ctx, conversation);
    const viewerRole = await roleIn(ctx, conversation, viewer._id);
    if (roles && roles.source !== "participants" && viewerRole === "customer") {
      throw new MessagingError(
        "not_allowed",
        "Only the professional in this conversation can send a price card.",
      );
    }

    const serviceName = args.serviceName.trim();
    if (!serviceName) {
      throw new MessagingError("invalid", "Give the service a name.");
    }
    if (serviceName.length > 120) {
      throw new MessagingError("invalid", "That service name is too long.");
    }
    const priceMinor = Math.round(args.priceMinor);
    if (!Number.isFinite(priceMinor) || priceMinor <= 0) {
      throw new MessagingError("invalid", "Enter a price greater than zero.");
    }
    if (priceMinor > MAX_PRICE_MINOR) {
      throw new MessagingError("invalid", "That price is too high.");
    }
    const durationMinutes = Math.round(args.durationMinutes);
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0 || durationMinutes > 24 * 60) {
      throw new MessagingError("invalid", "Enter a duration between 1 minute and 24 hours.");
    }
    const durationLabel = args.durationLabel.trim() || `${durationMinutes} min`;

    const recipientId = peerIdOf(conversation, viewer._id);
    const now = Date.now();
    const ttlHours = Math.min(Math.max(args.ttlHours ?? DEFAULT_TTL_HOURS, 1), 24 * 30);

    const priceCardId = await ctx.db.insert("priceCards", {
      conversationId: conversation._id,
      creatorId: viewer._id,
      recipientId,
      serviceName,
      description: args.description?.trim() || null,
      priceMinor,
      currency: args.currency ?? "GHS",
      durationMinutes,
      durationLabel,
      status: "sent",
      messageId: null,
      bookingId: null,
      bookingReference: null,
      bookingStartsAt: null,
      bookingStatus: null,
      bookingSyncedAt: null,
      expiresAt: now + ttlHours * 3_600_000,
      publishedAt: null,
      publishError: null,
      createdAt: now,
      updatedAt: now,
    });

    const messageId = await ctx.db.insert("messages", {
      conversationId: conversation._id,
      authorId: viewer._id,
      kind: "price_card",
      body: serviceName,
      attachmentId: null,
      replyToMessageId: null,
      priceCardId,
      deletedAt: null,
      createdAt: now,
      clientSentAt: now,
    });
    await ctx.db.patch(priceCardId, { messageId });

    // A proposal is itself proof of the context: whoever sent it is the provider
    // and the other participant is the customer. Healing the conversation here
    // means a thread created before the role columns existed becomes explicit as
    // soon as it is used, without waiting for the backfill.
    if (roles && roles.source !== "conversation") {
      await ctx.db.patch(
        conversation._id,
        roleFieldsFor({ customerId: recipientId, professionalId: viewer._id, source: "price_card" }),
      );
    }

    // Publish the proposal to the platform backend. Until this lands, BOOK NOW
    // stays disabled, because the booking RPC validates the price against that
    // mirrored row rather than trusting anything the client sends.
    await ctx.scheduler.runAfter(0, internal.priceCards.publishToPlatform, {
      priceCardId,
    });

    await recordOutgoingMessage(
      ctx,
      conversation,
      viewer._id,
      serviceName,
      "price_card",
      now,
    );

    const recipient = await ctx.db.get(recipientId);
    if (recipient) {
      await ctx.scheduler.runAfter(0, internal.notifications.notifyPriceCard, {
        conversationId: conversation._id,
        recipientExternalId: recipient.externalId,
        // The recipient is the customer here, so the quote is announced under
        // the provider's business identity.
        senderName: identityForRole(viewer, "professional").displayName,
        serviceName,
      });
    }

    return { priceCardId, messageId };
  },
});

/**
 * Withdraws a proposal. Only the professional who created the card may do this,
 * and only while it is still awaiting a booking — once booked, the booking is
 * the record of truth and the card follows it.
 */
export const cancel = mutation({
  args: { priceCardId: v.id("priceCards") },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const card = await ctx.db.get(args.priceCardId);
    if (!card) throw new MessagingError("not_found", "That price card no longer exists.");
    await requireParticipantConversation(ctx, card.conversationId, viewer._id);

    if (card.creatorId !== viewer._id) {
      throw new MessagingError("not_allowed", "Only the professional who sent this can withdraw it.");
    }
    if (card.status === "booked") {
      throw new MessagingError("invalid", "This price card has already been booked.");
    }
    if (card.status === "cancelled") return "cancelled" as const;

    await ctx.db.patch(card._id, { status: "cancelled", updatedAt: Date.now() });
    // Withdraw the platform mirror too, so it can no longer be booked.
    await ctx.scheduler.runAfter(0, internal.priceCards.syncPlatformCard, {
      priceCardId: card._id,
      status: "cancelled",
      bookingId: null,
    });
    return "cancelled" as const;
  },
});

export const get = query({
  args: { priceCardId: v.id("priceCards") },
  handler: async (ctx, args): Promise<PriceCardView | null> => {
    const viewer = await viewerOrNull(ctx);
    if (!viewer) return null;
    const card = await ctx.db.get(args.priceCardId);
    if (!card) return null;
    const conversation = await ctx.db.get(card.conversationId);
    if (!conversation) return null;
    if (!conversation.participantIds.some((id) => id === viewer._id)) return null;
    return priceCardView(card);
  },
});

export const byConversation = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args): Promise<PriceCardView[]> => {
    const viewer = await viewerOrNull(ctx);
    if (!viewer) return [];
    await requireParticipantConversation(ctx, args.conversationId, viewer._id);
    const cards = await ctx.db
      .query("priceCards")
      .withIndex("by_conversation_created", (q) =>
        q.eq("conversationId", args.conversationId),
      )
      .order("desc")
      .take(50);
    return cards.map(priceCardView);
  },
});

type RawPriceCard = Doc<"priceCards"> & {
  creatorExternalId: string;
  recipientExternalId: string;
};

export const getRaw = internalQuery({
  args: { priceCardId: v.id("priceCards") },
  handler: async (ctx, args): Promise<RawPriceCard | null> => {
    const card = await ctx.db.get(args.priceCardId);
    if (!card) return null;
    const creator = await ctx.db.get(card.creatorId);
    const recipient = await ctx.db.get(card.recipientId);
    if (!creator || !recipient) return null;
    return {
      ...card,
      creatorExternalId: creator.externalId,
      recipientExternalId: recipient.externalId,
    };
  },
});

/**
 * Connects a price card to the booking the customer just made through the
 * EXISTING booking flow.
 *
 * This is the cross-system bridge, so it is verified rather than trusted: the
 * booking is re-read from Postgres with the service role key and every
 * relationship is checked against the price card before anything is written.
 * A client that invents a booking id, or points at someone else's booking, or
 * books at a different price, is rejected here.
 */
export const confirmBooking = action({
  args: {
    priceCardId: v.id("priceCards"),
    bookingId: v.string(),
  },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.subject) {
      throw new MessagingError("unauthenticated", "Sign in to book.");
    }

    const card = await ctx.runQuery(internal.priceCards.getRaw, {
      priceCardId: args.priceCardId,
    });
    if (!card) throw new MessagingError("not_found", "That price card no longer exists.");

    // Only the recipient of the proposal may book from it.
    if (identity.subject !== card.recipientExternalId) {
      throw new MessagingError(
        "not_allowed",
        "Only the customer on this price card can book it.",
      );
    }
    if (card.status === "booked" && card.bookingId === args.bookingId) {
      return { ok: true };
    }
    if (card.status === "booked" || card.status === "cancelled") {
      throw new MessagingError("invalid", "This price card is no longer available to book.");
    }
    if (card.expiresAt !== null && card.expiresAt < Date.now()) {
      throw new MessagingError("invalid", "This price card has expired. Ask for a fresh one.");
    }

    const booking = await fetchBooking(args.bookingId);
    if (!booking) {
      throw new MessagingError("not_found", "That booking could not be found.");
    }
    // The booking must be for this customer...
    if (booking.customerId !== card.recipientExternalId) {
      throw new MessagingError("not_allowed", "That booking does not belong to this conversation.");
    }
    // ...with the professional who sent the card. Role comes from the booking
    // relationship, not from anyone's current app mode.
    if (booking.professionalUserId !== card.creatorExternalId) {
      throw new MessagingError(
        "not_allowed",
        "That booking is not with the professional who sent this price card.",
      );
    }
    if (booking.priceCardId && booking.priceCardId !== args.priceCardId) {
      throw new MessagingError("not_allowed", "That booking belongs to a different price card.");
    }
    // The agreed price is the contract; a mismatch means the flow was subverted.
    if (Math.round(booking.price * 100) !== card.priceMinor) {
      throw new MessagingError("invalid", "The booked price does not match this price card.");
    }

    await ctx.runMutation(internal.priceCards.applyBooking, {
      priceCardId: args.priceCardId,
      bookingId: booking.id,
      bookingStartsAt: new Date(booking.startsAt).getTime(),
      bookingStatus: booking.status,
    });
    return { ok: true };
  },
});

export const applyBooking = internalMutation({
  args: {
    priceCardId: v.id("priceCards"),
    bookingId: v.string(),
    bookingStartsAt: v.number(),
    bookingStatus: v.string(),
  },
  handler: async (ctx, args) => {
    const card = await ctx.db.get(args.priceCardId);
    if (!card) return;
    const now = Date.now();
    await ctx.db.patch(card._id, {
      status: "booked",
      bookingId: args.bookingId,
      bookingStartsAt: args.bookingStartsAt,
      bookingStatus: args.bookingStatus,
      bookingSyncedAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(card.conversationId, {
      lifecycle: "booked",
      bookingId: args.bookingId,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.priceCards.syncPlatformCard, {
      priceCardId: card._id,
      status: "booked",
      bookingId: args.bookingId,
    });
  },
});

/**
 * Mirrors a proposal into Postgres. Runs as an action because it performs a
 * network write; failures are recorded on the card so the professional sees a
 * real error instead of a button that silently does nothing.
 */
export const publishToPlatform = internalAction({
  args: { priceCardId: v.id("priceCards") },
  handler: async (ctx, args) => {
    const card = await ctx.runQuery(internal.priceCards.getRaw, {
      priceCardId: args.priceCardId,
    });
    if (!card) return;
    try {
      await upsertConversationPriceCard({
        id: card._id,
        conversationRef: card.conversationId,
        professionalUserId: card.creatorExternalId,
        customerUserId: card.recipientExternalId,
        serviceName: card.serviceName,
        description: card.description,
        price: card.priceMinor / 100,
        currency: card.currency,
        durationMinutes: card.durationMinutes,
        status: card.status,
        expiresAt: card.expiresAt,
      });
      await ctx.runMutation(internal.priceCards.markPublished, {
        priceCardId: args.priceCardId,
      });
    } catch (error) {
      await ctx.runMutation(internal.priceCards.markPublishFailed, {
        priceCardId: args.priceCardId,
        message:
          error instanceof Error
            ? error.message
            : "This price card could not be published. Try again.",
      });
    }
  },
});

export const markPublished = internalMutation({
  args: { priceCardId: v.id("priceCards") },
  handler: async (ctx, args) => {
    const card = await ctx.db.get(args.priceCardId);
    if (!card) return;
    await ctx.db.patch(card._id, { publishedAt: Date.now(), publishError: null });
  },
});

export const markPublishFailed = internalMutation({
  args: { priceCardId: v.id("priceCards"), message: v.string() },
  handler: async (ctx, args) => {
    const card = await ctx.db.get(args.priceCardId);
    if (!card) return;
    await ctx.db.patch(card._id, { publishError: args.message });
  },
});

/** Keeps the platform mirror in step when the card is withdrawn or booked. */
export const syncPlatformCard = internalAction({
  args: {
    priceCardId: v.id("priceCards"),
    status: v.string(),
    bookingId: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    try {
      await updateConversationPriceCardStatus({
        id: args.priceCardId,
        status: args.status,
        bookingId: args.bookingId,
      });
    } catch (error) {
      console.warn("[Sheree messaging] platform price card sync skipped", error);
    }
  },
});

/**
 * Bookings live in Postgres and keep changing after the sale (cancellations,
 * no-shows, completion). Rather than requiring a write-back webhook from every
 * existing booking path, a scheduled re-verification keeps the price card and
 * thread honest — and drives the conversation towards cleanup once the booking
 * has genuinely finished.
 */
export const syncBookedCards = internalAction({
  args: {},
  handler: async (ctx) => {
    const pending = await ctx.runQuery(internal.priceCards.listUnsyncedBooked, {});
    for (const entry of pending) {
      try {
        const booking = await fetchBooking(entry.bookingId);
        if (!booking) continue;
        await ctx.runMutation(internal.priceCards.applyBookingSync, {
          priceCardId: entry.priceCardId,
          bookingStatus: booking.status,
          paymentStatus: booking.paymentStatus,
        });
      } catch (error) {
        console.warn("[Sheree messaging] booking sync skipped", error);
      }
    }
  },
});

export const listUnsyncedBooked = internalQuery({
  args: {},
  handler: async (ctx): Promise<Array<{ priceCardId: Id<"priceCards">; bookingId: string }>> => {
    const booked = await ctx.db
      .query("priceCards")
      .withIndex("by_status_expiry", (q) => q.eq("status", "booked"))
      .take(100);
    return booked
      .filter((card): card is Doc<"priceCards"> & { bookingId: string } => Boolean(card.bookingId))
      .map((card) => ({ priceCardId: card._id, bookingId: card.bookingId }));
  },
});

const TERMINAL_BOOKING_STATUSES = new Set(["cancelled", "completed", "no_show"]);

export const applyBookingSync = internalMutation({
  args: {
    priceCardId: v.id("priceCards"),
    bookingStatus: v.string(),
    paymentStatus: v.string(),
  },
  handler: async (ctx, args) => {
    const card = await ctx.db.get(args.priceCardId);
    if (!card) return;
    const now = Date.now();
    if (card.bookingStatus !== args.bookingStatus) {
      await ctx.db.patch(card._id, {
        bookingStatus: args.bookingStatus,
        bookingSyncedAt: now,
        updatedAt: now,
      });
    }
    // A finished booking settles the thread. Only `archivedAt` is stamped here;
    // the actual deletion is a separate, later job driven by `conversations`
    // retention rules, so nothing is destroyed while a dispute could still open.
    if (TERMINAL_BOOKING_STATUSES.has(args.bookingStatus)) {
      const conversation = await ctx.db.get(card.conversationId);
      if (conversation && conversation.lifecycle === "booked") {
        await ctx.db.patch(conversation._id, {
          lifecycle: "settled",
          archivedAt: now,
          updatedAt: now,
        });
      }
    }
  },
});
