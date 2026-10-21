import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { ensureUserFromClaims } from "./users";

type Ctx = QueryCtx | MutationCtx;

export class MessagingError extends Error {
  constructor(
    public readonly code:
      | "unauthenticated"
      | "not_participant"
      | "not_allowed"
      | "not_found"
      | "invalid",
    message: string,
  ) {
    super(message);
    this.name = "MessagingError";
  }
}

/**
 * The authenticated Sheree user id (Supabase `users.id`), taken from the
 * verified JWT `sub` claim. This is the only identity the messaging backend
 * trusts — never a client-supplied id, and never the current app mode.
 */
export async function requireExternalUserId(ctx: Ctx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.subject) {
    throw new MessagingError("unauthenticated", "Sign in to use messages.");
  }
  return identity.subject;
}

/** Resolves the local Convex user row for the authenticated caller. */
export async function requireViewer(ctx: Ctx): Promise<Doc<"users">> {
  const externalId = await requireExternalUserId(ctx);
  const user = await ctx.db
    .query("users")
    .withIndex("by_external_id", (q) => q.eq("externalId", externalId))
    .unique();
  if (!user) {
    throw new MessagingError(
      "unauthenticated",
      "Your messaging profile is still being set up. Try again in a moment.",
    );
  }
  return user;
}

/**
 * Mutation-side viewer resolution that guarantees a local row exists. Using this
 * instead of `requireViewer` means the very first message can be sent even if
 * the background profile sync has not completed yet.
 */
export async function ensureViewer(ctx: MutationCtx): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.subject) {
    throw new MessagingError("unauthenticated", "Sign in to use messages.");
  }
  return ensureUserFromClaims(ctx, {
    subject: identity.subject,
    name: identity.name,
    picture: identity.picture,
    username: (identity as unknown as Record<string, unknown>).username,
  });
}

/** Sorted key that makes a 1-to-1 thread deterministic regardless of order. */
export function participantKeyFor(a: string, b: string): string {
  return [a, b].sort().join(":");
}

/** Sorted pair used for the index-friendly `participantOne/Two` columns. */
export function orderedParticipants(a: string, b: string): [string, string] {
  const [one, two] = [a, b].sort();
  return [one, two];
}

export function assertParticipant(
  conversation: Doc<"conversations">,
  userId: Id<"users">,
): void {
  if (!conversation.participantIds.some((id) => id === userId)) {
    throw new MessagingError(
      "not_participant",
      "You do not have access to this conversation.",
    );
  }
}

/**
 * Loads a conversation and proves the caller is a participant in one step.
 * Every query and mutation that touches a conversation goes through here so a
 * client-supplied conversation id can never reach another user's data.
 */
export async function requireParticipantConversation(
  ctx: Ctx,
  conversationId: Id<"conversations">,
  userId: Id<"users">,
): Promise<Doc<"conversations">> {
  const conversation = await ctx.db.get(conversationId);
  if (!conversation) {
    throw new MessagingError("not_found", "This conversation is no longer available.");
  }
  assertParticipant(conversation, userId);
  return conversation;
}

/** Runs an action body as the authenticated caller, mapping auth failures. */
export async function viewerOrNull(ctx: Ctx): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.subject) return null;
  return ctx.db
    .query("users")
    .withIndex("by_external_id", (q) => q.eq("externalId", identity.subject))
    .unique();
}
