import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  identityForRole,
  resolveConversationRoles,
  roleForParticipant,
  type ConversationRole,
} from "./roles";

type Ctx = QueryCtx | MutationCtx;

/**
 * Wire shapes returned to the app. The client mirrors these in
 * `src/features/messaging/types.ts` so the UI never has to guess at a shape or
 * reach for `any`.
 */

export type ReplyReference = {
  messageId: Id<"messages">;
  authorName: string;
  preview: string;
  /** False when the original was deleted, so the UI can say so politely. */
  available: boolean;
};

export type MessageImageView = {
  url: string | null;
  width: number;
  height: number;
};

export type MessageVoiceView = {
  url: string | null;
  /** Length in milliseconds, so the bubble can show a timer before it plays. */
  durationMillis: number;
};

export type PriceCardView = {
  id: Id<"priceCards">;
  conversationId: Id<"conversations">;
  creatorId: Id<"users">;
  recipientId: Id<"users">;
  serviceName: string;
  description: string | null;
  priceMinor: number;
  currency: string;
  durationMinutes: number;
  durationLabel: string;
  status: "draft" | "sent" | "booked" | "expired" | "cancelled";
  bookingId: string | null;
  bookingReference: string | null;
  bookingStartsAt: number | null;
  bookingStatus: string | null;
  expiresAt: number | null;
  /** Null until the card is mirrored into Postgres, which BOOK NOW depends on. */
  publishedAt: number | null;
  publishError: string | null;
  createdAt: number;
};

export type MessageView = {
  id: Id<"messages">;
  conversationId: Id<"conversations">;
  authorId: Id<"users">;
  authorName: string;
  kind: "text" | "image" | "voice" | "price_card" | "system";
  body: string;
  createdAt: number;
  isMine: boolean;
  replyTo: ReplyReference | null;
  image: MessageImageView | null;
  voice: MessageVoiceView | null;
  priceCard: PriceCardView | null;
};

export type ConversationPeer = {
  userId: Id<"users">;
  externalId: string;
  /** Display name of the peer in THIS conversation's role, not their account name. */
  displayName: string;
  username: string;
  /** Avatar matching the same role. */
  avatarUrl: string | null;
  /** The role the peer occupies in this conversation. */
  role: ConversationRole;
};

export type ConversationSummary = {
  id: Id<"conversations">;
  peer: ConversationPeer;
  lastMessagePreview: string;
  lastMessageAt: number;
  lastMessageKind: "text" | "image" | "voice" | "price_card" | "system";
  lastMessageFromMe: boolean;
  unreadCount: number;
  lifecycle: "active" | "booked" | "settled" | "purge_eligible";
  bookingId: string | null;
  originKind: "profile" | "post" | "service" | "custom_service";
  originImageUrl: string | null;
  /** The role the caller occupies in this conversation. */
  viewerRole: ConversationRole;
  /** The caller's own display identity for this conversation. */
  viewerDisplayName: string;
  /** Why the thread exists; roles are derived from this, never from a mode. */
  context: "professional_contact" | "booking";
};

export function priceCardView(card: Doc<"priceCards">): PriceCardView {
  return {
    id: card._id,
    conversationId: card.conversationId,
    creatorId: card.creatorId,
    recipientId: card.recipientId,
    serviceName: card.serviceName,
    description: card.description,
    priceMinor: card.priceMinor,
    currency: card.currency,
    durationMinutes: card.durationMinutes,
    durationLabel: card.durationLabel,
    status: card.status,
    bookingId: card.bookingId,
    bookingReference: card.bookingReference,
    bookingStartsAt: card.bookingStartsAt,
    bookingStatus: card.bookingStatus,
    expiresAt: card.expiresAt,
    publishedAt: card.publishedAt,
    publishError: card.publishError,
    createdAt: card.createdAt,
  };
}

/** Short label used for conversation lists and reply previews. */
export function previewFor(message: Doc<"messages">): string {
  if (message.deletedAt) return "Message removed";
  if (message.kind === "image") return message.body.trim() || "Photo";
  if (message.kind === "voice") return "Voice note";
  if (message.kind === "price_card") return message.body.trim() || "Price card";
  return message.body.trim();
}

function truncate(value: string, max = 90): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/**
 * Resolves a message plus everything the chat renders around it. Replies keep
 * only a reference, never a copy of the original, so editing/deleting the
 * original is reflected everywhere it was quoted.
 *
 * `resolveName` must be `nameResolverFor(ctx, conversation)`: a sender's name is
 * always resolved through their role in this conversation, never from a global
 * profile lookup.
 */
export async function enrichMessage(
  ctx: Ctx,
  message: Doc<"messages">,
  viewerId: Id<"users">,
  resolveName: (userId: Id<"users">) => Promise<string>,
): Promise<MessageView> {
  let replyTo: ReplyReference | null = null;
  if (message.replyToMessageId) {
    const original = await ctx.db.get(message.replyToMessageId);
    if (original) {
      replyTo = {
        messageId: original._id,
        authorName: await resolveName(original.authorId),
        preview: truncate(previewFor(original)),
        available: !original.deletedAt,
      };
    }
  }

  let image: MessageImageView | null = null;
  let voice: MessageVoiceView | null = null;
  if (message.attachmentId) {
    const attachment = await ctx.db.get(message.attachmentId);
    if (attachment) {
      const url = await ctx.storage.getUrl(attachment.storageId);
      // The media kind decides which metadata matters: a voice note has a
      // duration, an image has dimensions.
      if (attachment.kind === "voice" || message.kind === "voice") {
        voice = { url, durationMillis: attachment.durationMillis ?? 0 };
      } else {
        image = {
          url,
          width: attachment.width ?? 0,
          height: attachment.height ?? 0,
        };
      }
    }
  }

  let priceCard: PriceCardView | null = null;
  if (message.priceCardId) {
    const card = await ctx.db.get(message.priceCardId);
    if (card) priceCard = priceCardView(card);
  }

  return {
    id: message._id,
    conversationId: message.conversationId,
    authorId: message.authorId,
    authorName: await resolveName(message.authorId),
    kind: message.kind,
    body: message.deletedAt ? "" : message.body,
    createdAt: message.createdAt,
    isMine: message.authorId === viewerId,
    replyTo,
    image,
    voice,
    priceCard,
  };
}

/**
 * The other participant, presented in the role they occupy in this
 * conversation. The peer's *account* role is deliberately not used: in Customer
 * Mode the peer is the professional and shows their business identity, while in
 * Professional Mode the peer is the customer and shows their personal identity.
 */
export async function conversationPeer(
  ctx: Ctx,
  conversation: Doc<"conversations">,
  viewerId: Id<"users">,
): Promise<ConversationPeer | null> {
  const roles = await resolveConversationRoles(ctx, conversation);
  if (!roles) return null;
  const viewerRole = roleForParticipant(roles, viewerId);
  if (!viewerRole) return null;
  const peerRole: ConversationRole = viewerRole === "customer" ? "professional" : "customer";
  const peerId = peerRole === "professional" ? roles.professionalId : roles.customerId;
  const user = await ctx.db.get(peerId);
  if (!user) return null;
  const identity = identityForRole(user, peerRole);
  return {
    userId: user._id,
    externalId: user.externalId,
    displayName: identity.displayName,
    username: user.username,
    avatarUrl: identity.avatarUrl,
    role: peerRole,
  };
}

/**
 * How much of a conversation the OTHER participant has read.
 *
 * This is a cursor, never a row per message. The sender answers "has this been
 * read?" by comparing their own message's `createdAt` against `peerLastReadAt`,
 * which is why reading a 500-message thread costs a single write (see
 * `conversations.markRead`) rather than 500.
 */
export type ConversationReadReceipt = {
  /**
   * Server time at which the peer last read this thread. Null when they have
   * never read it — including the placeholder cursor row written when the first
   * message arrives, which is normalised to null so the app has one meaning for
   * "not read yet" instead of two.
   */
  peerLastReadAt: number | null;
  /** The newest message the peer's cursor sits on, when the app reported one. */
  peerLastReadMessageId: Id<"messages"> | null;
  /**
   * The peer's display name IN THIS conversation, so a receipt can be announced
   * as "Read by Ama's Nails" without the app guessing at an identity.
   */
  peerName: string;
};

/**
 * Reads the peer's cursor for one thread. The peer's own name and role come from
 * `conversationPeer`, so a receipt never leaks an identity from another context
 * (the same account is "Ama" in one thread and "Ama's Nails" in another).
 */
export async function conversationReadReceipt(
  ctx: Ctx,
  conversation: Doc<"conversations">,
  viewerId: Id<"users">,
): Promise<ConversationReadReceipt | null> {
  const peer = await conversationPeer(ctx, conversation, viewerId);
  if (!peer) return null;
  const state = await ctx.db
    .query("readStates")
    .withIndex("by_conversation_user", (q) =>
      q.eq("conversationId", conversation._id).eq("userId", peer.userId),
    )
    .unique();
  return {
    peerLastReadAt: state && state.lastReadAt > 0 ? state.lastReadAt : null,
    peerLastReadMessageId: state?.lastReadMessageId ?? null,
    peerName: peer.displayName,
  };
}

/** The caller's own identity and role in a conversation, for the chat header. */
export async function conversationViewer(
  ctx: Ctx,
  conversation: Doc<"conversations">,
  viewerId: Id<"users">,
): Promise<{ role: ConversationRole; displayName: string } | null> {
  const roles = await resolveConversationRoles(ctx, conversation);
  if (!roles) return null;
  const role = roleForParticipant(roles, viewerId);
  if (!role) return null;
  const viewer = await ctx.db.get(viewerId);
  return {
    role,
    displayName: viewer ? identityForRole(viewer, role).displayName : "You",
  };
}
