import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

const DEFAULT_USERNAME = "Sheree member";

/**
 * The verified JWT claims Convex exposes for a Supabase access token. Only
 * `subject` is authoritative (it is Supabase `auth.uid()`); the rest are used
 * as a first-paint fallback and corrected from Postgres by `syncProfiles`.
 */
type IdentityClaims = {
  subject: string;
  name?: unknown;
  picture?: unknown;
  username?: unknown;
};

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function usernameFromClaims(identity: IdentityClaims): string {
  return readString(identity.username) ?? readString(identity.name) ?? DEFAULT_USERNAME;
}

export function avatarFromClaims(identity: IdentityClaims): string | null {
  return readString(identity.picture);
}

/**
 * Finds or creates the local mirror of the authenticated Sheree user, seeded
 * from JWT claims. Safe to call on every conversation entry point: it never
 * duplicates a row, and it never needs the Supabase service key.
 */
export async function ensureUserFromClaims(
  ctx: MutationCtx,
  identity: IdentityClaims,
): Promise<Doc<"users">> {
  const existing = await ctx.db
    .query("users")
    .withIndex("by_external_id", (q) => q.eq("externalId", identity.subject))
    .unique();
  if (existing) return existing;

  const username = usernameFromClaims(identity);
  const id = await ctx.db.insert("users", {
    externalId: identity.subject,
    username,
    // The claims describe a person, never a business, so this seeds the
    // *customer* identity only. `syncProfiles` fills in the professional side if
    // this account owns a professional profile — it never overwrites this one.
    customerName: username,
    professionalName: null,
    professionalAvatarUrl: null,
    displayName: username,
    avatarUrl: avatarFromClaims(identity),
    // Corrected by `syncProfiles`; claims carry no Sheree role.
    role: "customer",
    syncedAt: 0,
  });
  const created = await ctx.db.get(id);
  if (!created) throw new Error("Messaging identity could not be created.");
  return created;
}

/**
 * Ensures a row exists for a peer we only know by id (the recipient of a new
 * conversation). Display fields are filled in by `syncProfiles`.
 */
export async function ensurePlaceholderUser(
  ctx: MutationCtx,
  externalId: string,
): Promise<Doc<"users">> {
  const existing = await ctx.db
    .query("users")
    .withIndex("by_external_id", (q) => q.eq("externalId", externalId))
    .unique();
  if (existing) return existing;

  const id = await ctx.db.insert("users", {
    externalId,
    username: DEFAULT_USERNAME,
    customerName: DEFAULT_USERNAME,
    professionalName: null,
    professionalAvatarUrl: null,
    displayName: DEFAULT_USERNAME,
    avatarUrl: null,
    role: "customer",
    syncedAt: 0,
  });
  const created = await ctx.db.get(id);
  if (!created) throw new Error("Messaging participant could not be created.");
  return created;
}

export async function findUserByExternalId(
  ctx: MutationCtx,
  externalId: string,
): Promise<Doc<"users"> | null> {
  return ctx.db
    .query("users")
    .withIndex("by_external_id", (q) => q.eq("externalId", externalId))
    .unique();
}

export function peerIdOf(
  conversation: Doc<"conversations">,
  viewerId: Id<"users">,
): Id<"users"> {
  const peer = conversation.participantIds.find((id) => id !== viewerId);
  if (!peer) {
    throw new Error("Conversation does not have exactly two participants.");
  }
  return peer;
}
