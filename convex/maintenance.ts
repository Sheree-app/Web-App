import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalMutation, mutation } from "./_generated/server";
import { MessagingError } from "./lib/identity";
import { resolveConversationRoles, roleFieldsFor } from "./lib/roles";

/**
 * One-off data migration for the role/context model.
 *
 * Why it is needed
 * ----------------
 * Conversations created before this change stored only the two account ids, so
 * nothing in the row said which account was the customer. Reading those threads
 * by "does this user own a professional profile?" is exactly the bug this work
 * removes, so the roles are materialised onto the row instead — once.
 *
 * How it is safe
 * --------------
 *  - The schema declares the new columns as optional, so the schema can be
 *    pushed before this runs; nothing has to be valid mid-migration.
 *  - It is idempotent and paginated: it only writes rows that are still missing
 *    their roles, and it reports the cursor so it can be resumed.
 *  - It never touches messages, read state, timestamps, price cards or bookings.
 *  - Ambiguous rows (see `source: "participants"`) are reported rather than
 *    silently guessed, so they can be reviewed.
 *
 * Run it with:
 *
 *   npx convex run maintenance:migrateConversationRoles \
 *     '{"key":"<MESSAGING_MAINTENANCE_KEY>","batchSize":100,"resetProfileSync":true}'
 *
 * and repeat while `nextCursor` is not null. `resetProfileSync: true` also marks
 * mirrored profiles for a refresh, so identities recorded before the
 * customer/professional split (business name stored in the display name) are
 * rewritten from Postgres on each user's next app open.
 *
 * A daily cron calls the internal version without `resetProfileSync`, so threads
 * still missing roles converge even if nobody runs the command.
 */

type BackfillArgs = {
  batchSize?: number;
  cursor?: string | null;
  resetProfileSync?: boolean;
  dryRun?: boolean;
};

/**
 * The migration body, shared by the internal and operator entry points. Kept out
 * of the two mutations so neither has to reference the other through the
 * generated `internal` API (which would be a circular type reference).
 */
async function runBackfill(ctx: MutationCtx, args: BackfillArgs) {
  const batchSize = Math.min(Math.max(Math.round(args.batchSize ?? 100) || 100, 1), 200);
  const dryRun = args.dryRun === true;

  const page = await ctx.db
    .query("conversations")
    .paginate({ cursor: args.cursor ?? null, numItems: batchSize });

  let migrated = 0;
  let alreadyScoped = 0;
  let skipped = 0;
  let ambiguous = 0;
  const ambiguousIds: string[] = [];

  for (const conversation of page.page as Doc<"conversations">[]) {
    if (conversation.customerUserId && conversation.professionalUserId) {
      alreadyScoped += 1;
      continue;
    }
    const roles = await resolveConversationRoles(ctx, conversation);
    if (!roles) {
      skipped += 1;
      continue;
    }
    if (roles.source === "participants") {
      ambiguous += 1;
      if (ambiguousIds.length < 20) ambiguousIds.push(conversation._id);
    }
    if (!dryRun) {
      await ctx.db.patch(conversation._id, roleFieldsFor(roles));
    }
    migrated += 1;
  }

  let profilesMarkedStale = 0;
  if (args.resetProfileSync && !dryRun) {
    // Marks a batch of mirrors for a refresh from Postgres, which is what
    // rewrites rows whose `displayName` still holds a business name. Rows already
    // at `syncedAt: 0` are left alone, so this is safe to re-run.
    const users = await ctx.db.query("users").take(200);
    for (const user of users) {
      if (user.syncedAt !== 0) {
        await ctx.db.patch(user._id, { syncedAt: 0 });
        profilesMarkedStale += 1;
      }
    }
  }

  return {
    scanned: page.page.length,
    migrated,
    alreadyScoped,
    skipped,
    ambiguous,
    ambiguousIds,
    profilesMarkedStale,
    dryRun,
    isDone: page.isDone,
    nextCursor: page.isDone ? null : page.continueCursor,
  };
}

export const backfillConversationRoles = internalMutation({
  args: {
    batchSize: v.optional(v.number()),
    cursor: v.optional(v.union(v.string(), v.null())),
    /** Marks mirrored profiles stale so identities re-sync from Postgres. */
    resetProfileSync: v.optional(v.boolean()),
    /** Reports what would change without writing anything. */
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => runBackfill(ctx, args),
});

/**
 * Operator entry point for the migration above.
 *
 * A *public* function because that is what `npx convex run` can execute, so it is
 * gated on a deployment secret instead: with `MESSAGING_MAINTENANCE_KEY` unset it
 * refuses to run at all, and it never rewrites roles a conversation already
 * stores. It grants no access to any conversation — it only materialises columns.
 */
export const migrateConversationRoles = mutation({
  args: {
    key: v.string(),
    batchSize: v.optional(v.number()),
    cursor: v.optional(v.union(v.string(), v.null())),
    resetProfileSync: v.optional(v.boolean()),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const expected = process.env.MESSAGING_MAINTENANCE_KEY;
    if (!expected) {
      throw new MessagingError(
        "not_allowed",
        "Set MESSAGING_MAINTENANCE_KEY on this Convex deployment to run the migration.",
      );
    }
    if (args.key !== expected) {
      throw new MessagingError("not_allowed", "The maintenance key is not valid.");
    }
    return runBackfill(ctx, args);
  },
});
