import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Sheree messaging schema.
 *
 * Identity note: a Sheree user has exactly one authenticated account
 * (`users.externalId` mirrors the Supabase `users.id`). Owning a professional
 * profile does NOT make that account a professional everywhere — a user can be
 * the customer in one thread and the professional in another.
 *
 * Roles therefore live on the *conversation*, never on the user and never on the
 * current app mode:
 *
 *   - `customerUserId`     — the participant acting as the customer in THIS thread
 *   - `professionalUserId` — the participant acting as the professional in THIS thread
 *   - `context`            — why the thread exists, e.g. `professional_contact`
 *
 * A single account consequently has two display identities (`customerName` and
 * `professionalName`); which one is rendered depends on the role that account
 * occupies in the conversation being rendered. "Customer Mode" and
 * "Professional Mode" are pure UI *views* over these columns and are absent from
 * the schema, so switching mode can never change ownership of a conversation,
 * message, or price card.
 *
 * Money is stored as integer minor units (`priceMinor`, e.g. pesewas) so that a
 * price card and the booking it produces can never disagree by a rounding step.
 */

export const conversationLifecycle = v.union(
  v.literal("active"),
  v.literal("booked"),
  v.literal("settled"),
  v.literal("purge_eligible"),
);

export const messageKind = v.union(
  v.literal("text"),
  v.literal("image"),
  v.literal("voice"),
  v.literal("price_card"),
  v.literal("system"),
);

export const priceCardStatus = v.union(
  v.literal("draft"),
  v.literal("sent"),
  v.literal("booked"),
  v.literal("expired"),
  v.literal("cancelled"),
);

export const attachmentStatus = v.union(
  v.literal("uploading"),
  v.literal("ready"),
  v.literal("failed"),
);

/**
 * Whether the app is currently beating, and when it last did.
 *
 * `active` means the app told us it was in the foreground; `away` means it said
 * goodbye. Neither is trusted forever — `lib/presence.ts` decides "online" from
 * the timestamp as well, because an app that is force-quit cannot say goodbye.
 */
export const presenceState = v.union(v.literal("active"), v.literal("away"));

/**
 * Who may see this account's online status and last seen time.
 *
 * Two options, and no contacts model to define a third: `everyone` is every
 * participant you already share a conversation with — a thread, not the whole
 * user base, because presence is only ever resolved for a conversation peer.
 */
export const presenceVisibility = v.union(v.literal("everyone"), v.literal("nobody"));

/**
 * Why a conversation exists. The context — not anybody's profile ownership —
 * decides who is the customer and who is the professional in the thread.
 *
 * `professional_contact` is the only context produced today: a customer
 * contacting a professional. `booking` is reserved for a future booking-scoped
 * thread (quotes, price cards, reschedules) and is deliberately not written yet.
 */
export const conversationContext = v.union(
  v.literal("professional_contact"),
  v.literal("booking"),
);

/** The role a participant occupies inside one conversation. */
export const conversationRole = v.union(
  v.literal("customer"),
  v.literal("professional"),
);

export default defineSchema({
  /**
   * Mirror of the authenticated Sheree user. Only the fields messaging needs to
   * render a thread are denormalised here; Supabase remains the source of truth
   * and `syncProfiles` refreshes these from Postgres.
   */
  users: defineTable({
    externalId: v.string(),
    username: v.string(),
    /**
     * The account's *personal* identity, used whenever this user acts as the
     * customer. Kept alongside the professional identity rather than replaced by
     * it, because the same account can be the customer in one thread and the
     * professional in another.
     */
    customerName: v.optional(v.string()),
    /**
     * Business name, used ONLY when this user is the professional in a thread.
     * Null clears it when the professional profile is removed.
     */
    professionalName: v.optional(v.union(v.string(), v.null())),
    /** Professional profile photo, used ONLY in the professional role. */
    professionalAvatarUrl: v.optional(v.union(v.string(), v.null())),
    /**
     * Personal (customer-facing) display name and avatar. Never overwritten with
     * a business name — that was the bug that made "Ama" render as "Ama's Nails".
     */
    displayName: v.string(),
    avatarUrl: v.union(v.string(), v.null()),
    /** Account-level role: informational only, never conversation role. */
    role: v.union(v.literal("customer"), v.literal("professional")),
    syncedAt: v.number(),
  }).index("by_external_id", ["externalId"]),

  /**
   * Exactly two participants for V1.
   *
   * `participantKey` is the sorted pair of external ids and identifies the two
   * *accounts*; it is no longer the uniqueness key, because the same pair can
   * legitimately hold two contexts (A contacting B, and B contacting A).
   *
   * `contextKey` is `customerUserId:professionalUserId` and is what makes
   * "find or create the thread for THIS context" deterministic — the same input
   * always resolves to one thread, whatever mode either user is browsing in.
   *
   * `customerUserId` / `professionalUserId` / `context` are the source of truth
   * for roles and for inbox placement. They are optional so this schema can be
   * pushed before the backfill runs (see `maintenance.backfillConversationRoles`);
   * rows written by the current code always set them.
   */
  conversations: defineTable({
    participantIds: v.array(v.id("users")),
    participantKey: v.string(),
    /** Sorted participant external ids, mirrored for index-friendly queries. */
    participantOne: v.string(),
    participantTwo: v.string(),
    /** The participant acting as the customer in this conversation. */
    customerUserId: v.optional(v.id("users")),
    /** The participant acting as the professional in this conversation. */
    professionalUserId: v.optional(v.id("users")),
    /** `${customerUserId}:${professionalUserId}` — unique per context. */
    contextKey: v.optional(v.string()),
    /** Why the thread exists. Roles are read from the context, not from profiles. */
    context: v.optional(conversationContext),
    lifecycle: conversationLifecycle,
    lastMessageAt: v.number(),
    lastMessagePreview: v.string(),
    lastMessageKind: messageKind,
    lastMessageAuthorId: v.id("users"),
    messageCount: v.number(),
    /** Set when a price card in this thread becomes a real booking. */
    bookingId: v.union(v.string(), v.null()),
    archivedAt: v.union(v.number(), v.null()),
    /** Context that started the thread, e.g. an inspo post. */
    originKind: v.union(v.literal("profile"), v.literal("post"), v.literal("service"), v.literal("custom_service")),
    originPostId: v.union(v.string(), v.null()),
    originImageUrl: v.union(v.string(), v.null()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_participant_key", ["participantKey"])
    .index("by_participant_one", ["participantOne", "lastMessageAt"])
    .index("by_participant_two", ["participantTwo", "lastMessageAt"])
    .index("by_context_key", ["contextKey"])
    /** Customer Mode inbox: only threads where the caller is the customer. */
    .index("by_customer_last_message", ["customerUserId", "lastMessageAt"])
    /** Professional Mode inbox: only threads where the caller is the professional. */
    .index("by_professional_last_message", ["professionalUserId", "lastMessageAt"])
    .index("by_lifecycle_last_message", ["lifecycle", "lastMessageAt"]),

  /**
   * Online status and last seen, one row per account.
   *
   * Kept out of `users` deliberately: that table is a mirror of Postgres that
   * `syncProfiles` overwrites wholesale, so a heartbeat written there would be
   * clobbered by the next profile sync. It also keeps a 30-second write off the
   * row every conversation read depends on.
   *
   * "Online" is derived on read (`state === "active"` and a fresh `lastSeenAt`),
   * never stored as a boolean, because a client that is killed mid-session can
   * never write the "offline" that a stored boolean would need.
   */
  presence: defineTable({
    userId: v.id("users"),
    state: presenceState,
    /**
     * The last heartbeat while active; the moment they left when away. Either
     * way it is the truth for "last seen", which is why it is one field.
     */
    lastSeenAt: v.number(),
    /** Absent on rows written before the setting existed: those are visible. */
    visibility: v.optional(presenceVisibility),
  }).index("by_user", ["userId"]),

  /**
   * Conversation-level read cursor. `unreadCount` is maintained on write so the
   * Messages badge never has to scan a thread to render a number.
   */
  readStates: defineTable({
    conversationId: v.id("conversations"),
    userId: v.id("users"),
    lastReadAt: v.number(),
    lastReadMessageId: v.union(v.id("messages"), v.null()),
    unreadCount: v.number(),
  })
    .index("by_conversation_user", ["conversationId", "userId"])
    .index("by_user", ["userId"]),

  messages: defineTable({
    conversationId: v.id("conversations"),
    authorId: v.id("users"),
    kind: messageKind,
    body: v.string(),
    attachmentId: v.union(v.id("attachments"), v.null()),
    replyToMessageId: v.union(v.id("messages"), v.null()),
    priceCardId: v.union(v.id("priceCards"), v.null()),
    /** Set when the author deletes; the row survives so replies still resolve. */
    deletedAt: v.union(v.number(), v.null()),
    createdAt: v.number(),
    clientSentAt: v.number(),
  })
    .index("by_conversation_created", ["conversationId", "createdAt"])
    .index("by_price_card", ["priceCardId"]),

  /**
   * Chat media lives in Convex file storage rather than the public R2 CDN used
   * for posts: those objects are world-readable, which is unacceptable for
   * private conversations. Access is gated by a participant check in the query
   * that resolves the storage URL.
   *
   * Images and voice notes share this table because their storage, ownership and
   * access rules are identical — only the metadata differs. Images carry
   * dimensions, voice notes carry a duration, and `kind` says which a row is.
   */
  attachments: defineTable({
    conversationId: v.id("conversations"),
    ownerId: v.id("users"),
    storageId: v.id("_storage"),
    status: attachmentStatus,
    /** Unset on rows written before voice notes existed: those are all images. */
    kind: v.optional(v.union(v.literal("image"), v.literal("voice"))),
    mimeType: v.string(),
    /** Pixels, for images. Unset on voice notes. */
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    /** Length of a voice note in milliseconds, so the bubble can render a timer. */
    durationMillis: v.optional(v.number()),
    sizeBytes: v.number(),
    createdAt: v.number(),
  })
    .index("by_conversation", ["conversationId"])
    .index("by_owner", ["ownerId"]),

  /**
   * A conversation-only custom service proposal. It is never inserted into
   * `professional_services`, so it cannot surface on the professional's public
   * profile, in search, or in the catalogue. Once booked, the booking row in
   * Postgres is the durable business record.
   */
  priceCards: defineTable({
    conversationId: v.id("conversations"),
    /** Professional who authored the proposal. Determines who may edit/cancel. */
    creatorId: v.id("users"),
    /** The customer. Determines who may book. */
    recipientId: v.id("users"),
    serviceName: v.string(),
    description: v.union(v.string(), v.null()),
    priceMinor: v.number(),
    currency: v.string(),
    durationMinutes: v.number(),
    /** Free-text duration as the professional typed it, e.g. "2 hours". */
    durationLabel: v.string(),
    status: priceCardStatus,
    messageId: v.union(v.id("messages"), v.null()),
    // Populated only after the recipient completes the existing booking flow.
    bookingId: v.union(v.string(), v.null()),
    bookingReference: v.union(v.string(), v.null()),
    bookingStartsAt: v.union(v.number(), v.null()),
    bookingStatus: v.union(v.string(), v.null()),
    bookingSyncedAt: v.union(v.number(), v.null()),
    expiresAt: v.union(v.number(), v.null()),
    /**
     * Set once the card has been mirrored into Postgres. The booking RPC reads
     * that mirror, so BOOK NOW stays disabled until this is non-null.
     */
    publishedAt: v.union(v.number(), v.null()),
    publishError: v.union(v.string(), v.null()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_conversation_created", ["conversationId", "createdAt"])
    .index("by_message", ["messageId"])
    .index("by_booking", ["bookingId"])
    .index("by_status_expiry", ["status", "expiresAt"]),

  /**
   * Idempotency guard so a retried `sendText` (network retry, optimistic UI
   * re-send) cannot double-post. Keyed by the client's own message id.
   */
  sendReceipts: defineTable({
    conversationId: v.id("conversations"),
    authorId: v.id("users"),
    clientMessageId: v.string(),
    messageId: v.id("messages"),
    createdAt: v.number(),
  }).index("by_client_message_id", ["authorId", "clientMessageId"]),
});
