import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
    ensureViewer,
    viewerOrNull
} from "./lib/identity";
import {
    derivePresence,
    presenceIsVisible,
    presenceRowFor,
    UNKNOWN_PRESENCE,
    type PresenceView,
} from "./lib/presence";
import { peerIdOf } from "./lib/users";

/**
 * Online status and last seen.
 *
 * The shape of this feature is forced by the platform rather than chosen: Convex
 * has no "the socket closed" hook, so presence is a heartbeat the app sends while
 * it is in the foreground (`heartbeat`), a goodbye it sends when it leaves
 * (`goAway`), and a window on the server that decides whether either is still
 * worth believing (`ONLINE_WINDOW_MS`). A force-quit sends no goodbye, which is
 * exactly why staleness is part of the rule and not a bug in it.
 *
 * Nobody is online until they have opened the app at least once: no row, no
 * status, and the app renders nothing rather than inventing a green dot.
 */

/** Mirrors `presenceVisibility` in `schema.ts`. */
const visibilityValidator = v.union(v.literal("everyone"), v.literal("nobody"));

export type PresenceVisibility = "everyone" | "nobody";

export type OwnPresence = PresenceView & { visibility: PresenceVisibility };

/**
 * "I am here, now" — sent when the app comes to the foreground, and every 30
 * seconds after that (`PresenceHeartbeat`). Also the first write for a new
 * account, so the row appears the first time the app is opened.
 *
 * The caller is resolved with `ensureViewer` rather than `requireViewer` so the
 * very first beat of a brand-new session cannot race profile creation.
 */
export const heartbeat = mutation({
  args: {},
  handler: async (ctx): Promise<number> => {
    const viewer = await ensureViewer(ctx);
    const now = Date.now();
    const row = await presenceRowFor(ctx, viewer._id);
    if (row) {
      await ctx.db.patch(row._id, { state: "active", lastSeenAt: now });
      return now;
    }
    await ctx.db.insert("presence", {
      userId: viewer._id,
      state: "active",
      lastSeenAt: now,
      visibility: "everyone",
    });
    return now;
  },
});

/**
 * "I am leaving" — sent when the app goes to the background or the session ends.
 *
 * Worth its own call rather than waiting for the heartbeat to go stale: without
 * it, leaving the app would leave a peer reading "Online" for up to a minute
 * after the person put their phone down, and "last seen" would be equally old.
 * A row is never created here — somebody who has never beaten has nothing to
 * take back.
 */
export const goAway = mutation({
  args: {},
  handler: async (ctx): Promise<number | null> => {
    const viewer = await ensureViewer(ctx);
    const row = await presenceRowFor(ctx, viewer._id);
    if (!row) return null;
    const now = Date.now();
    await ctx.db.patch(row._id, { state: "away", lastSeenAt: now });
    return now;
  },
});

/**
 * The caller's own setting and status, for the settings row.
 *
 * Your own status is always visible to you: hiding it decides what others see,
 * not what you are told about yourself.
 */
export const getMine = query({
  args: {},
  handler: async (ctx): Promise<OwnPresence> => {
    const viewer = await viewerOrNull(ctx);
    if (!viewer) return { visibility: "everyone", ...UNKNOWN_PRESENCE };
    const row = await presenceRowFor(ctx, viewer._id);
    return {
      visibility: row?.visibility ?? "everyone",
      ...derivePresence(row, Date.now()),
    };
  },
});

/**
 * Turns online status and last seen on or off.
 *
 * Nothing is deleted when it is turned off: the heartbeat keeps beating so that
 * switching back on is instant, and the row's existence is not itself a secret —
 * `peerPresence` is where visibility is enforced, on every read.
 */
export const setVisibility = mutation({
  args: { visibility: visibilityValidator },
  handler: async (ctx, args): Promise<PresenceVisibility> => {
    const viewer = await ensureViewer(ctx);
    const row = await presenceRowFor(ctx, viewer._id);
    if (row) {
      await ctx.db.patch(row._id, { visibility: args.visibility });
      return args.visibility;
    }
    // Somebody who has never beaten. `lastSeenAt: 0` is "never seen" (see
    // `derivePresence`), so making this choice cannot accidentally publish a
    // last-seen time of now.
    await ctx.db.insert("presence", {
      userId: viewer._id,
      state: "away",
      lastSeenAt: 0,
      visibility: args.visibility,
    });
    return args.visibility;
  },
});

/**
 * The peer's status for one thread — the only way the app ever learns it.
 *
 * Gated three ways, and each one is load-bearing:
 *
 *   1. the caller must be a participant in the conversation, so a conversation id
 *      cannot be used to probe a stranger's activity;
 *   2. the PEER's setting must allow it;
 *   3. the CALLER's own setting must allow it. This is reciprocity, and it is the
 *      point rather than a side effect: hiding your activity while watching
 *      everyone else's would make the setting a one-way mirror. The settings row
 *      says so out loud, so nobody discovers it by surprise.
 *
 * Null means "you may not see this" — hidden, not a participant, or signed out.
 * A peer who has never opened the app returns `UNKNOWN_PRESENCE` instead, which
 * the app renders as nothing at all.
 */
export const peerPresence = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args): Promise<PresenceView | null> => {
    const viewer = await viewerOrNull(ctx);
    if (!viewer) return null;
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation) return null;
    if (!conversation.participantIds.some((id) => id === viewer._id)) return null;

    const viewerRow = await presenceRowFor(ctx, viewer._id);
    if (!presenceIsVisible(viewerRow)) return null;

    const peerRow = await presenceRowFor(ctx, peerIdOf(conversation, viewer._id));
    if (!presenceIsVisible(peerRow)) return null;

    return derivePresence(peerRow, Date.now());
  },
});
