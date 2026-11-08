import "server-only";

import { isSupabaseConfigured } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { FEED_SEED_COOKIE, feedSeedFor, fetchFeedPage, type FeedClient, type FeedPage } from "./rows";

/** First page size. Fills a five-column desktop in one request. */
export const FEED_PAGE_SIZE = 24;

/**
 * The first page of the feed, rendered on the server with the visitor's own
 * session, so the first posts (and their images) arrive with the HTML instead
 * of after the JavaScript, the session check and a browser round trip.
 *
 * Returns `null` on any failure: the browser then loads the feed itself, as it
 * did before, so a server hiccup never costs more than the old behaviour.
 */
export async function fetchInitialFeed(): Promise<FeedPage | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const store = await cookies();
    const baseSeed = store.get(FEED_SEED_COOKIE)?.value;
    // No cookie means the proxy didn't run; let the browser pick the seed.
    if (!baseSeed) return null;

    const supabase = await createSupabaseServerClient();
    // Verified locally against the project's JWKS: no Auth round trip.
    const { data } = await supabase.auth.getClaims();
    const userId = typeof data?.claims?.sub === "string" ? data.claims.sub : null;

    return await fetchFeedPage(supabase as unknown as FeedClient, {
      seed: feedSeedFor(baseSeed, userId),
      cursor: null,
      pageSize: FEED_PAGE_SIZE,
    });
  } catch {
    return null;
  }
}
