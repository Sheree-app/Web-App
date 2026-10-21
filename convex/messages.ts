import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import {
  ensureViewer,
  MessagingError,
  requireParticipantConversation,
  requireViewer,
  viewerOrNull,
} from "./lib/identity";
import { identityForRole, nameResolverFor, roleIn } from "./lib/roles";
import { peerIdOf } from "./lib/users";
import { enrichMessage, previewFor, type MessageView } from "./lib/views";

const MAX_BODY = 4000;
const MAX_CAPTION = 400;
/** Clamped so a malicious client cannot store absurd dimensions. */
const MAX_IMAGE_EDGE = 8000;
/** Ten minutes: long enough to explain a service, short enough to stay useful. */
const MAX_VOICE_MILLIS = 10 * 60 * 1000;
/** Anything shorter than a second is a mis-tap on the record button. */
const MIN_VOICE_MILLIS = 1000;
/** Matches the recorder's own ceiling; anything larger is a malformed client. */
const MAX_VOICE_BYTES = 12 * 1024 * 1024;

/**
 * Short-lived URL the app PUTs an image to. Chat images go to Convex storage
 * (private, participant-gated) rather than the public R2 CDN used for posts.
 */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireViewer(ctx);
    return ctx.storage.generateUploadUrl();
  },
});

function trimmed(value: string, max: number, label: string): string {
  const clean = value.trim();
  if (clean.length > max) {
    throw new MessagingError("invalid", `${label} is too long.`);
  }
  return clean;
}

/** A reply may only reference a message in the same thread. */
async function validateReplyTarget(
  ctx: MutationCtx,
  conversationId: Id<"conversations">,
  replyToMessageId: Id<"messages"> | undefined,
): Promise<Id<"messages"> | null> {
  if (!replyToMessageId) return null;
  const original = await ctx.db.get(replyToMessageId);
  if (!original || original.conversationId !== conversationId) {
    throw new MessagingError("invalid", "That message is no longer available to reply to.");
  }
  return original._id;
}

/**
 * Applies everything that must happen on every outgoing message: thread
 * denormalisation, the recipient's unread counter, and the notification. Kept in
 * one place so text, image and price-card sends cannot drift apart.
 */
export async function recordOutgoingMessage(
  ctx: MutationCtx,
  conversation: Doc<"conversations">,
  authorId: Id<"users">,
  preview: string,
  kind: "text" | "image" | "voice" | "price_card",
  now: number,
): Promise<void> {
  await ctx.db.patch(conversation._id, {
    lastMessageAt: now,
    lastMessagePreview: preview,
    lastMessageKind: kind,
    lastMessageAuthorId: authorId,
    messageCount: conversation.messageCount + 1,
    updatedAt: now,
  });

  // Incrementing the peer's counter keeps the Messages badge O(1) instead of
  // re-scanning the thread on every render.
  const peerId = peerIdOf(conversation, authorId);
  const state = await ctx.db
    .query("readStates")
    .withIndex("by_conversation_user", (q) =>
      q.eq("conversationId", conversation._id).eq("userId", peerId),
    )
    .unique();
  if (state) {
    await ctx.db.patch(state._id, { unreadCount: state.unreadCount + 1 });
  } else {
    await ctx.db.insert("readStates", {
      conversationId: conversation._id,
      userId: peerId,
      lastReadAt: 0,
      lastReadMessageId: null,
      unreadCount: 1,
    });
  }
}

/**
 * Notifies the other participant, naming the sender by the role they occupy in
 * THIS conversation — so "Ama" receives "Ama's Nails" and Ama's customer enquiry
 * arrives at the professional as "Ama".
 */
async function notifyRecipient(
  ctx: MutationCtx,
  conversation: Doc<"conversations">,
  author: Doc<"users">,
  preview: string,
): Promise<void> {
  const peer = await ctx.db.get(peerIdOf(conversation, author._id));
  if (!peer) return;
  const role = await roleIn(ctx, conversation, author._id);
  await ctx.scheduler.runAfter(0, internal.notifications.notifyMessage, {
    conversationId: conversation._id,
    recipientExternalId: peer.externalId,
    senderName: identityForRole(author, role ?? "customer").displayName,
    preview,
  });
}

/**
 * Sends a text message. `clientMessageId` makes this idempotent, which is what
 * lets the composer render an optimistic bubble and retry a failed send without
 * ever producing a duplicate.
 */
export const sendText = mutation({
  args: {
    conversationId: v.id("conversations"),
    body: v.string(),
    clientMessageId: v.string(),
    replyToMessageId: v.optional(v.id("messages")),
  },
  handler: async (ctx, args) => {
    const viewer = await ensureViewer(ctx);
    const conversation = await requireParticipantConversation(
      ctx,
      args.conversationId,
      viewer._id,
    );

    const receipt = await ctx.db
      .query("sendReceipts")
      .withIndex("by_client_message_id", (q) =>
        q.eq("authorId", viewer._id).eq("clientMessageId", args.clientMessageId),
      )
      .unique();
    if (receipt) {
      const existing = await ctx.db.get(receipt.messageId);
      return {
        messageId: receipt.messageId,
        createdAt: existing?.createdAt ?? Date.now(),
        duplicate: true,
      };
    }

    const body = trimmed(args.body, MAX_BODY, "That message");
    if (!body) {
      throw new MessagingError("invalid", "Type a message first.");
    }
    const replyToMessageId = await validateReplyTarget(
      ctx,
      conversation._id,
      args.replyToMessageId,
    );

    const now = Date.now();
    const messageId = await ctx.db.insert("messages", {
      conversationId: conversation._id,
      authorId: viewer._id,
      kind: "text",
      body,
      attachmentId: null,
      replyToMessageId,
      priceCardId: null,
      deletedAt: null,
      createdAt: now,
      clientSentAt: now,
    });
    await ctx.db.insert("sendReceipts", {
      conversationId: conversation._id,
      authorId: viewer._id,
      clientMessageId: args.clientMessageId,
      messageId,
      createdAt: now,
    });
    await recordOutgoingMessage(ctx, conversation, viewer._id, body, "text", now);
    await notifyRecipient(ctx, conversation, viewer, body);

    return { messageId, createdAt: now, duplicate: false };
  },
});

/**
 * Records an image that has already been PUT to Convex storage and posts it as
 * a message. The upload happens before this call, so a slow upload never blocks
 * the chat: the composer shows progress, and only a finished upload becomes a
 * message.
 */
export const sendImage = mutation({
  args: {
    conversationId: v.id("conversations"),
    storageId: v.id("_storage"),
    width: v.number(),
    height: v.number(),
    mimeType: v.string(),
    sizeBytes: v.number(),
    caption: v.optional(v.string()),
    clientMessageId: v.string(),
    replyToMessageId: v.optional(v.id("messages")),
  },
  handler: async (ctx, args) => {
    const viewer = await ensureViewer(ctx);
    const conversation = await requireParticipantConversation(
      ctx,
      args.conversationId,
      viewer._id,
    );

    const receipt = await ctx.db
      .query("sendReceipts")
      .withIndex("by_client_message_id", (q) =>
        q.eq("authorId", viewer._id).eq("clientMessageId", args.clientMessageId),
      )
      .unique();
    if (receipt) {
      const existing = await ctx.db.get(receipt.messageId);
      return {
        messageId: receipt.messageId,
        createdAt: existing?.createdAt ?? Date.now(),
        duplicate: true,
      };
    }

    if (!args.mimeType.startsWith("image/")) {
      throw new MessagingError("invalid", "Only images can be shared in a conversation.");
    }
    const replyToMessageId = await validateReplyTarget(
      ctx,
      conversation._id,
      args.replyToMessageId,
    );
    const caption = args.caption ? trimmed(args.caption, MAX_CAPTION, "That caption") : "";

    const now = Date.now();
    const attachmentId = await ctx.db.insert("attachments", {
      conversationId: conversation._id,
      ownerId: viewer._id,
      storageId: args.storageId,
      status: "ready",
      mimeType: args.mimeType,
      width: Math.min(Math.max(Math.round(args.width) || 1, 1), MAX_IMAGE_EDGE),
      height: Math.min(Math.max(Math.round(args.height) || 1, 1), MAX_IMAGE_EDGE),
      sizeBytes: Math.max(Math.round(args.sizeBytes) || 0, 0),
      createdAt: now,
    });

    const messageId = await ctx.db.insert("messages", {
      conversationId: conversation._id,
      authorId: viewer._id,
      kind: "image",
      body: caption,
      attachmentId,
      replyToMessageId,
      priceCardId: null,
      deletedAt: null,
      createdAt: now,
      clientSentAt: now,
    });
    await ctx.db.insert("sendReceipts", {
      conversationId: conversation._id,
      authorId: viewer._id,
      clientMessageId: args.clientMessageId,
      messageId,
      createdAt: now,
    });
    await recordOutgoingMessage(
      ctx,
      conversation,
      viewer._id,
      caption || "Photo",
      "image",
      now,
    );
    await notifyRecipient(ctx, conversation, viewer, caption || "Sent a photo");

    return { messageId, createdAt: now, duplicate: false };
  },
});

/**
 * Records a voice note that has already been PUT to Convex storage.
 *
 * Voice notes reuse the image attachments table — same private, participant-gated
 * storage — but carry a duration instead of dimensions. The message body stays
 * empty: a voice note is the message, so there is nothing to caption. Length and
 * size are both clamped here rather than trusted from the client, so a malformed
 * or hostile client cannot store an unbounded recording.
 */
export const sendVoice = mutation({
  args: {
    conversationId: v.id("conversations"),
    storageId: v.id("_storage"),
    durationMillis: v.number(),
    mimeType: v.string(),
    sizeBytes: v.number(),
    clientMessageId: v.string(),
    replyToMessageId: v.optional(v.id("messages")),
  },
  handler: async (ctx, args) => {
    const viewer = await ensureViewer(ctx);
    const conversation = await requireParticipantConversation(
      ctx,
      args.conversationId,
      viewer._id,
    );

    const receipt = await ctx.db
      .query("sendReceipts")
      .withIndex("by_client_message_id", (q) =>
        q.eq("authorId", viewer._id).eq("clientMessageId", args.clientMessageId),
      )
      .unique();
    if (receipt) {
      const existing = await ctx.db.get(receipt.messageId);
      return {
        messageId: receipt.messageId,
        createdAt: existing?.createdAt ?? Date.now(),
        duplicate: true,
      };
    }

    if (!args.mimeType.startsWith("audio/")) {
      throw new MessagingError("invalid", "Only audio can be sent as a voice note.");
    }
    const durationMillis = Math.round(args.durationMillis) || 0;
    if (durationMillis < MIN_VOICE_MILLIS) {
      throw new MessagingError("invalid", "That voice note is too short to send.");
    }
    if (durationMillis > MAX_VOICE_MILLIS) {
      throw new MessagingError("invalid", "Voice notes can be up to 10 minutes long.");
    }
    const sizeBytes = Math.max(Math.round(args.sizeBytes) || 0, 0);
    if (sizeBytes > MAX_VOICE_BYTES) {
      throw new MessagingError("invalid", "That voice note is too large to send.");
    }

    const replyToMessageId = await validateReplyTarget(
      ctx,
      conversation._id,
      args.replyToMessageId,
    );

    const now = Date.now();
    const attachmentId = await ctx.db.insert("attachments", {
      conversationId: conversation._id,
      ownerId: viewer._id,
      storageId: args.storageId,
      kind: "voice",
      status: "ready",
      mimeType: args.mimeType,
      durationMillis,
      sizeBytes,
      createdAt: now,
    });

    const messageId = await ctx.db.insert("messages", {
      conversationId: conversation._id,
      authorId: viewer._id,
      kind: "voice",
      body: "",
      attachmentId,
      replyToMessageId,
      priceCardId: null,
      deletedAt: null,
      createdAt: now,
      clientSentAt: now,
    });
    await ctx.db.insert("sendReceipts", {
      conversationId: conversation._id,
      authorId: viewer._id,
      clientMessageId: args.clientMessageId,
      messageId,
      createdAt: now,
    });
    await recordOutgoingMessage(ctx, conversation, viewer._id, "Voice note", "voice", now);
    await notifyRecipient(ctx, conversation, viewer, "Sent a voice note");

    return { messageId, createdAt: now, duplicate: false };
  },
});

/**
 * Paginated history, newest first. The chat reverses each page for display and
 * walks `continueCursor` upward, so opening a long thread never loads it all
 * into memory and never jumps from the top of the list to the bottom.
 */
export const list = query({
  args: {
    conversationId: v.id("conversations"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const conversation = await requireParticipantConversation(
      ctx,
      args.conversationId,
      viewer._id,
    );

    const page = await ctx.db
      .query("messages")
      .withIndex("by_conversation_created", (q) =>
        q.eq("conversationId", args.conversationId),
      )
      .order("desc")
      .paginate(args.paginationOpts);

    // Names come from the sender's role in this conversation, never from their
    // account profile, so the same user can be "Ama" here and "Ama's Nails"
    // in a thread where they are the professional.
    const resolveName = await nameResolverFor(ctx, conversation);

    const enriched: MessageView[] = [];
    for (const message of page.page) {
      enriched.push(await enrichMessage(ctx, message, viewer._id, resolveName));
    }

    return { ...page, page: enriched };
  },
});

/**
 * Resolves a single message by id, used when the app jumps to a replied-to
 * message that is older than the pages already loaded.
 */
export const byId = query({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args): Promise<MessageView | null> => {
    const viewer = await viewerOrNull(ctx);
    if (!viewer) return null;
    const message = await ctx.db.get(args.messageId);
    if (!message) return null;
    const conversation = await ctx.db.get(message.conversationId);
    if (!conversation) return null;
    if (!conversation.participantIds.some((id) => id === viewer._id)) return null;
    const resolveName = await nameResolverFor(ctx, conversation);
    return enrichMessage(ctx, message, viewer._id, resolveName);
  },
});

/**
 * Soft-deletes a message. The row survives so replies that reference it still
 * render — the UI shows "Message removed" instead of breaking the thread.
 */
export const remove = mutation({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const message = await ctx.db.get(args.messageId);
    if (!message) throw new MessagingError("not_found", "That message no longer exists.");
    await requireParticipantConversation(ctx, message.conversationId, viewer._id);
    if (message.authorId !== viewer._id) {
      throw new MessagingError("not_allowed", "You can only remove your own messages.");
    }
    await ctx.db.patch(message._id, { deletedAt: Date.now() });
    return previewFor({ ...message, deletedAt: Date.now() });
  },
});
