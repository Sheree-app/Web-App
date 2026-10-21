import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type Ctx = QueryCtx | MutationCtx;

/**
 * Online status and last seen.
 *
 * Two facts, deliberately kept apart:
 *
 *   - what the app CLAIMED (`state`) — it is beating, or it said goodbye;
 *   - when it last said anything (`lastSeenAt`).
 *
 * "Online" is derived from both on every read. Storing a boolean instead would
 * be unrepairable: a force-quit, a lost network or a dead battery never gets to
 * write "offline", so a stored flag would leave somebody online forever. The
 * same reasoning as the read cursor in `views.ts`: store the cheapest durable
 * fact, derive the rest where it is used.
 */

/**
 * How long a heartbeat is believed.
 *
 * Two and a half times the app's 30-second beat (`HEARTBEAT_INTERVAL_MS` in the
 * client's `presence.ts` — the two must stay in step). The slack means one
 * dropped or delayed beat cannot blink somebody offline mid-conversation, and it
 * is also the honest bound on how stale "last seen" can be after a force-quit:
 * at most this long past the last beat.
 */
export const ONLINE_WINDOW_MS = 75_000;

export type PresenceView = {
  /** True only when the app claimed to be active AND recently enough to believe. */
  online: boolean;
  /**
   * When they were last known to be there. Null when they never have been —
   * which is what a row written by a settings change carries, and why the
   * zeroed timestamp below is normalised rather than passed through.
   */
  lastSeenAt: number | null;
};

/** The "we have never seen this person" answer, also used for an absent row. */
export const UNKNOWN_PRESENCE: PresenceView = { online: false, lastSeenAt: null };

/**
 * The whole rule, in one place.
 *
 * A row that has never held a heartbeat (`lastSeenAt: 0`) reads as never seen
 * rather than as 1970, so the app can treat "unknown" as one thing instead of
 * pattern-matching a magic number.
 */
export function derivePresence(row: Doc<"presence"> | null, now: number): PresenceView {
  if (!row || row.lastSeenAt <= 0) return UNKNOWN_PRESENCE;
  const fresh = now - row.lastSeenAt <= ONLINE_WINDOW_MS;
  return {
    online: row.state === "active" && fresh,
    lastSeenAt: row.lastSeenAt,
  };
}

/**
 * Whether an account's status may be shown to the people they talk to.
 *
 * An absent row, or a row written before the setting existed, is visible: the
 * default is the behaviour people already have, and hiding is a choice you make
 * rather than one made for you.
 */
export function presenceIsVisible(row: Doc<"presence"> | null): boolean {
  return (row?.visibility ?? "everyone") === "everyone";
}

/** One indexed read. Callers decide what the row's visibility means to them. */
export async function presenceRowFor(
  ctx: Ctx,
  userId: Id<"users">,
): Promise<Doc<"presence"> | null> {
  return ctx.db
    .query("presence")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}
