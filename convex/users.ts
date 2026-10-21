import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalAction,
  internalMutation,
  mutation,
  query,
} from "./_generated/server";
import { MessagingError, viewerOrNull } from "./lib/identity";
import { fetchProfileSnapshots } from "./lib/supabase";
import { ensureUserFromClaims } from "./lib/users";

/** The signed-in user's messaging identity, or null before first sync. */
export const viewer = query({
  args: {},
  handler: async (ctx) => viewerOrNull(ctx),
});

/** How long a mirrored identity is trusted before it is refreshed from Postgres. */
const PROFILE_STALE_MS = 6 * 3_600_000;

/**
 * Creates the local mirror on first use, then asks the backend to refresh
 * display fields from Postgres. Called once when the messaging provider mounts.
 *
 * The refresh also covers rows written before identities were split (they still
 * carry a business name in `displayName`), so an existing professional's mirror
 * converges on the personal/professional pair without a manual step. A failed
 * refresh is harmless: the Ctx-level `syncedAt` stays old and it is retried on a
 * later launch.
 */
export const ensureSelf = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.subject) {
      throw new MessagingError("unauthenticated", "Sign in to use messages.");
    }
    const user = await ensureUserFromClaims(ctx, {
      subject: identity.subject,
      name: identity.name,
      picture: identity.picture,
      username: (identity as unknown as Record<string, unknown>).username,
    });

    if (user.syncedAt === 0 || Date.now() - user.syncedAt > PROFILE_STALE_MS) {
      await ctx.scheduler.runAfter(0, internal.users.syncProfiles, {
        externalIds: [user.externalId],
      });
    }
    return user._id;
  },
});

/**
 * Refreshes identities from Postgres. Idempotent; safe to call any time.
 *
 * Both identities are stored side by side and neither overwrites the other. The
 * previous version wrote `business_name` into `displayName`, which is precisely
 * why a customer who happened to own a professional profile was introduced to
 * the other side of the conversation as their business.
 */
export const syncProfiles = internalAction({
  args: { externalIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    const unique: string[] = Array.from(new Set<string>(args.externalIds)).slice(0, 10);
    if (unique.length === 0) return;
    const snapshots = await fetchProfileSnapshots(unique);
    if (snapshots.length === 0) return;
    await ctx.runMutation(internal.users.applyProfiles, {
      snapshots: snapshots.map((snapshot) => ({
        externalId: snapshot.userId,
        username: snapshot.username,
        customerName: snapshot.username,
        professionalName: snapshot.professionalName,
        avatarUrl: snapshot.personalAvatarUrl,
        professionalAvatarUrl: snapshot.professionalAvatarUrl,
        role: snapshot.role,
      })),
    });
  },
});

export const applyProfiles = internalMutation({
  args: {
    snapshots: v.array(
      v.object({
        externalId: v.string(),
        username: v.string(),
        customerName: v.string(),
        professionalName: v.union(v.string(), v.null()),
        avatarUrl: v.union(v.string(), v.null()),
        professionalAvatarUrl: v.union(v.string(), v.null()),
        role: v.union(v.literal("customer"), v.literal("professional")),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    for (const snapshot of args.snapshots) {
      const identity = {
        username: snapshot.username,
        customerName: snapshot.customerName,
        professionalName: snapshot.professionalName,
        avatarUrl: snapshot.avatarUrl,
        professionalAvatarUrl: snapshot.professionalAvatarUrl,
        // Personal identity. The professional identity lives in
        // `professionalName` and is only used in the professional role.
        displayName: snapshot.customerName,
        role: snapshot.role,
        syncedAt: now,
      };
      const existing = await ctx.db
        .query("users")
        .withIndex("by_external_id", (q) => q.eq("externalId", snapshot.externalId))
        .unique();
      if (existing) {
        await ctx.db.patch(existing._id, identity);
      } else {
        await ctx.db.insert("users", {
          externalId: snapshot.externalId,
          ...identity,
        });
      }
    }
  },
});

