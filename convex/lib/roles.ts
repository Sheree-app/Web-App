import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type Ctx = QueryCtx | MutationCtx;

/**
 * Conversation roles.
 *
 * The single rule this module enforces:
 *
 *   AUTHENTICATED USER + ROLE WITHIN THIS CONVERSATION
 *
 * ...is the only source of truth for who someone is in a thread. Neither the
 * app's current mode nor "does this account own a professional profile?" may be
 * used to decide it. The same account can be the customer in one conversation
 * and the professional in another, and it must therefore render under a
 * different name in each.
 */

export type ConversationRole = "customer" | "professional";

/**
 * Where a conversation's roles came from. `conversation` is the authoritative
 * case (explicitly stored at creation); the others exist so threads created
 * before roles were stored keep working until the backfill runs.
 */
export type RoleSource =
  | "conversation"
  | "price_card"
  | "profiles"
  | "initiator"
  | "participants";

export type ConversationRoles = {
  customerId: Id<"users">;
  professionalId: Id<"users">;
  source: RoleSource;
};

/** `customerUserId:professionalUserId` — one thread per context, per pair. */
export function contextKeyFor(
  customerId: Id<"users">,
  professionalId: Id<"users">,
): string {
  return `${customerId}:${professionalId}`;
}

export function roleForParticipant(
  roles: ConversationRoles,
  userId: Id<"users">,
): ConversationRole | null {
  if (roles.customerId === userId) return "customer";
  if (roles.professionalId === userId) return "professional";
  return null;
}

/**
 * The role a user occupies according to the conversation's own columns, or null
 * when the conversation predates them. No database reads, so inbox listings can
 * use this as a cheap fast path before falling back to `resolveConversationRoles`.
 */
export function explicitRoleOf(
  conversation: Doc<"conversations">,
  userId: Id<"users">,
): ConversationRole | null {
  if (
    !conversation.customerUserId ||
    !conversation.professionalUserId ||
    conversation.customerUserId === conversation.professionalUserId
  ) {
    return null;
  }
  if (conversation.customerUserId === userId) return "customer";
  if (conversation.professionalUserId === userId) return "professional";
  return null;
}

/**
 * Resolves the customer and the professional for a conversation.
 *
 * Explicit columns win. For conversations created before the role columns
 * existed, the role is recovered from what the thread already carries — never
 * from the caller's mode:
 *
 *   1. `conversation` — the stored columns (authoritative).
 *   2. `price_card`   — a price card already encodes both roles: its creator is
 *                       the provider and its recipient is the customer.
 *   3. `profiles`     — when exactly one participant is a professional account.
 *   4. `initiator`    — the author of the first message started the contact, so
 *                       they are the customer.
 *   5. `participants` — deterministic last resort. Rare; only reachable for a
 *                       thread with no messages between two professional
 *                       accounts. The backfill reports these as ambiguous.
 */
export async function resolveConversationRoles(
  ctx: Ctx,
  conversation: Doc<"conversations">,
): Promise<ConversationRoles | null> {
  const participants = conversation.participantIds;
  if (participants.length !== 2) return null;
  const [first, second] = participants;

  if (
    conversation.customerUserId &&
    conversation.professionalUserId &&
    conversation.customerUserId !== conversation.professionalUserId &&
    participants.includes(conversation.customerUserId) &&
    participants.includes(conversation.professionalUserId)
  ) {
    return {
      customerId: conversation.customerUserId,
      professionalId: conversation.professionalUserId,
      source: "conversation",
    };
  }

  // A price card is a contract between a provider and a customer, so it is the
  // next strongest signal available for a thread that predates the columns.
  const card = await ctx.db
    .query("priceCards")
    .withIndex("by_conversation_created", (q) => q.eq("conversationId", conversation._id))
    .first();
  if (
    card &&
    card.creatorId !== card.recipientId &&
    participants.includes(card.creatorId) &&
    participants.includes(card.recipientId)
  ) {
    return {
      customerId: card.recipientId,
      professionalId: card.creatorId,
      source: "price_card",
    };
  }

  const [one, two] = await Promise.all([ctx.db.get(first), ctx.db.get(second)]);
  const oneIsProfessional = one?.role === "professional";
  const twoIsProfessional = two?.role === "professional";
  if (oneIsProfessional !== twoIsProfessional) {
    return oneIsProfessional
      ? { customerId: second, professionalId: first, source: "profiles" }
      : { customerId: first, professionalId: second, source: "profiles" };
  }

  // Whoever opened the thread was contacting the other one, so they are the
  // customer. Every messaging entry point in the app is customer-initiated.
  const openingMessage = await ctx.db
    .query("messages")
    .withIndex("by_conversation_created", (q) => q.eq("conversationId", conversation._id))
    .order("asc")
    .first();
  if (openingMessage) {
    const initiator = openingMessage.authorId;
    if (initiator === first || initiator === second) {
      const other = initiator === first ? second : first;
      return { customerId: initiator, professionalId: other, source: "initiator" };
    }
  }

  return { customerId: first, professionalId: second, source: "participants" };
}

/** The role a user occupies in a conversation, explicit columns first. */
export async function roleIn(
  ctx: Ctx,
  conversation: Doc<"conversations">,
  userId: Id<"users">,
): Promise<ConversationRole | null> {
  const explicit = explicitRoleOf(conversation, userId);
  if (explicit) return explicit;
  const roles = await resolveConversationRoles(ctx, conversation);
  if (!roles) return null;
  return roleForParticipant(roles, userId);
}

/** True when the stored columns already describe this conversation's roles. */
export function rolesAreExplicit(conversation: Doc<"conversations">): boolean {
  return Boolean(conversation.customerUserId && conversation.professionalUserId);
}

/**
 * The fields that make a conversation's roles and context explicit. Used both at
 * creation and when healing a thread that was created before the columns existed.
 */
export function roleFieldsFor(roles: ConversationRoles) {
  return {
    customerUserId: roles.customerId,
    professionalUserId: roles.professionalId,
    contextKey: contextKeyFor(roles.customerId, roles.professionalId),
    context: "professional_contact" as const,
  };
}

export type DisplayIdentity = {
  displayName: string;
  avatarUrl: string | null;
};

/**
 * Context-aware display identity.
 *
 * The same account renders as "Ama" in a thread where it is the customer and as
 * "Ama's Nails" in a thread where it is the professional. Callers must pass the
 * role the user occupies in the conversation being rendered.
 */
export function identityForRole(
  user: Doc<"users">,
  role: ConversationRole,
): DisplayIdentity {
  if (role === "professional") {
    return {
      displayName:
        nonEmpty(user.professionalName) ??
        nonEmpty(user.displayName) ??
        nonEmpty(user.username) ??
        "Sheree member",
      avatarUrl: user.professionalAvatarUrl ?? user.avatarUrl ?? null,
    };
  }
  // Personal identity first. `username` is preferred over `displayName` because
  // rows written before the split stored the business name in `displayName`.
  return {
    displayName:
      nonEmpty(user.customerName) ??
      nonEmpty(user.username) ??
      nonEmpty(user.displayName) ??
      "Sheree member",
    avatarUrl: user.avatarUrl ?? null,
  };
}

function nonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Builds a user-id → display name function for one conversation, resolved
 * against each author's role in that specific thread and memoised per call.
 * Message rendering and reply previews both go through this, so a sender can
 * never be labelled with the wrong identity.
 */
export async function nameResolverFor(
  ctx: Ctx,
  conversation: Doc<"conversations">,
): Promise<(userId: Id<"users">) => Promise<string>> {
  const roles = await resolveConversationRoles(ctx, conversation);
  const cache = new Map<Id<"users">, string>();

  return async (userId: Id<"users">): Promise<string> => {
    const cached = cache.get(userId);
    if (cached !== undefined) return cached;
    const user = await ctx.db.get(userId);
    const role = roles ? roleForParticipant(roles, userId) : null;
    const name = user
      ? identityForRole(user, role ?? "customer").displayName
      : "Sheree member";
    cache.set(userId, name);
    return name;
  };
}
