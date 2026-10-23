import type { Id } from "../../../convex/_generated/dataModel";

/**
 * Wire shapes returned by the Convex messaging API.
 *
 * These mirror `convex/lib/views.ts` deliberately rather than importing it:
 * the client bundle must never pull server modules. Keep both sides in step.
 */

export type MessageKind = "text" | "image" | "voice" | "price_card" | "system";

export type ConversationRole = "customer" | "professional";

export type PresenceView = { online: boolean; lastSeenAt: number | null };

export type ReplyReference = {
  messageId: Id<"messages">;
  authorName: string;
  preview: string;
  /** False when the original was removed; the UI says so instead of breaking. */
  available: boolean;
};

export type MessageImageView = { url: string | null; width: number; height: number };

export type MessageVoiceView = { url: string | null; durationMillis: number };

export type PriceCardStatus = "draft" | "sent" | "booked" | "expired" | "cancelled";

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
  status: PriceCardStatus;
  bookingId: string | null;
  bookingReference: string | null;
  bookingStartsAt: number | null;
  bookingStatus: string | null;
  expiresAt: number | null;
  publishedAt: number | null;
  publishError: string | null;
  createdAt: number;
};

export type MessageView = {
  id: Id<"messages">;
  conversationId: Id<"conversations">;
  authorId: Id<"users">;
  authorName: string;
  kind: MessageKind;
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
  displayName: string;
  username: string;
  avatarUrl: string | null;
  role: ConversationRole;
};

export type ConversationLifecycle = "active" | "booked" | "settled" | "purge_eligible";

export type ConversationSummary = {
  id: Id<"conversations">;
  peer: ConversationPeer;
  lastMessagePreview: string;
  lastMessageAt: number;
  lastMessageKind: MessageKind;
  lastMessageFromMe: boolean;
  unreadCount: number;
  lifecycle: ConversationLifecycle;
  bookingId: string | null;
  originKind: "profile" | "post" | "service" | "custom_service";
  originImageUrl: string | null;
  viewerRole: ConversationRole;
  viewerDisplayName: string;
  context: "professional_contact" | "booking";
  /** Null means "not permitted to see", not "offline". */
  peerPresence: PresenceView | null;
};

export type ConversationReadReceipt = {
  peerLastReadAt: number | null;
  peerLastReadMessageId: Id<"messages"> | null;
  peerName: string;
};

/** A send that has not been acknowledged by the server yet. */
export type PendingMessage = {
  clientMessageId: string;
  body: string;
  createdAt: number;
  replyTo: ReplyReference | null;
  status: "sending" | "failed";
  /** The server id once a send is acknowledged, used to retire the bubble. */
  ackId?: string;
};
