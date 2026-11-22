import "server-only";

import { isApiConfigured } from "@/lib/api";
import { cookies } from "next/headers";
import { FEED_SEED_COOKIE, fetchFeedPage, type FeedPage } from "./rows";

/** First page size. Fills a five-column desktop in one request. */
export const FEED_PAGE_SIZE = 24;

/**
 * The first page of the feed, rendered on the server so the first posts (and
 * their images) arrive with the HTML instead of after the JavaScript and a
 * browser round trip.
 *
 * The server never holds the visitor's login (it lives in the browser), so this
 * is the guest view: likes and saves are filled in by the browser afterwards
 * (`DiscoverFeed`), from the same seed and therefore the same order.
 *
 * Returns `null` on any failure: the browser then loads the feed itself, so a
 * server hiccup never costs more than the client-only behaviour.
 */
export async function fetchInitialFeed(): Promise<FeedPage | null> {
  if (!isApiConfigured) return null;
  try {
    const store = await cookies();
    const baseSeed = store.get(FEED_SEED_COOKIE)?.value;
    // No cookie means the proxy didn't run; let the browser pick the seed.
    if (!baseSeed) return null;

    return await fetchFeedPage({ seed: baseSeed, cursor: null, pageSize: FEED_PAGE_SIZE, auth: "none" });
  } catch {
    return null;
  }
}
