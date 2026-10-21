import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

/**
 * All messaging background work runs here rather than on the client, so a
 * conversation is never cleaned up only when someone happens to open the app.
 */
const crons = cronJobs();

// Mark price cards whose window passed.
crons.interval(
  "expire stale price cards",
  { hours: 1 },
  internal.lifecycle.expireStalePriceCards,
  {},
);

// Re-read bookings from Postgres so a cancellation or no-show is reflected in
// the chat, and a finished booking settles its thread.
crons.interval(
  "sync booked price cards",
  { hours: 6 },
  internal.priceCards.syncBookedCards,
  {},
);

// Safety net for the role/context migration: threads created before roles were
// stored on the conversation get them materialised. Idempotent and a no-op once
// every row is scoped, so it can safely stay scheduled.
crons.daily(
  "backfill conversation roles",
  { hourUTC: 2, minuteUTC: 45 },
  internal.maintenance.backfillConversationRoles,
  { batchSize: 200 },
);

// Stage 1 of cleanup: settled threads become eligible after the grace period.
crons.daily(
  "flag settled conversations",
  { hourUTC: 3, minuteUTC: 15 },
  internal.lifecycle.flagSettledForCleanup,
  {},
);

// Stage 2 of cleanup: contents are removed, tombstones and bookings kept.
crons.daily(
  "purge eligible conversations",
  { hourUTC: 3, minuteUTC: 45 },
  internal.lifecycle.purgeEligible,
  {},
);

export default crons;
