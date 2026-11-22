/**
 * The feed request and row mapping, shared by the browser (`api.ts`) and the
 * server (`server.ts`). Nothing in here touches `window` or `document` except
 * `readFeedSeedCookie`, which guards for it: the server renders the first page
 * and the browser carries on from the same cursor.
 */
import { api, type AuthMode, type Page } from "@/lib/api";
import type { FeedPost } from "./types";

/** A feed item from `GET /v1/feed` (`sheree-backend/docs/api/feed.md`). */
export type FeedRow = {
  id: string;
  professional_id: string;
  professional_name: string;
  avatar_url: string | null;
  image_url: string;
  video_url: string | null;
  video_duration_ms: number | null;
  service_id: string | null;
  caption: string | null;
  category: string;
  location: string | null;
  price_from: number | null;
  rating: number | null;
  rating_count: number | null;
  is_verified: boolean;
  founding: boolean;
  is_official: boolean;
  like_count: number;
  comment_count: number;
  is_liked: boolean;
  is_saved: boolean;
  aspect_ratio: number | null;
  created_at: string;
};

/** Opaque, from the API: pass it back as it came. It carries the shuffle seed. */
export type FeedCursor = string;
export type FeedPage = { items: FeedPost[]; nextCursor: FeedCursor | null };

/* ------------------------------------ Seed ------------------------------------ */

/**
 * The feed is shuffled per browser, and the shuffle must stay stable across
 * refreshes and pages. The seed lives in a first-party cookie (set by the
 * proxy) rather than only in localStorage, so the server can render the first
 * page in the same order the browser will continue in.
 */
export const FEED_SEED_COOKIE = "sheree-feed-seed";

/**
 * The seed sent to the API (8–64 chars). It used to mix in the member id, but
 * the server render never knows who is signed in any more, and both sides must
 * send the same seed to get the same order.
 */
export function feedSeedFor(baseSeed: string) {
  const seed = baseSeed.trim().slice(0, 64);
  return seed.length >= 8 ? seed : `${seed}--------`.slice(0, 8);
}

export function newFeedSeed() {
  return `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

/** Reads the seed cookie from `document.cookie` (browser only). */
export function readFeedSeedCookie(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${FEED_SEED_COOKIE}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/* ----------------------------------- Mapping ----------------------------------- */

/**
 * Maps API feed rows into the client model. The API already returns the public
 * business name, clip fields and both badges, which used to take two extra
 * lookups per page. Feed items carry no share slug; links fall back to the id.
 */
export function toFeedPost(row: FeedRow): FeedPost {
  return {
    id: row.id,
    professionalId: row.professional_id,
    professionalName: row.professional_name,
    avatarUrl: row.avatar_url,
    imageUrl: row.image_url,
    videoUrl: row.video_url ?? null,
    videoDurationMs: row.video_duration_ms == null ? null : Number(row.video_duration_ms),
    caption: row.caption ?? "",
    category: row.category,
    location: row.location ?? "Accra",
    priceFrom: row.price_from,
    serviceId: row.service_id ?? null,
    rating: Number(row.rating ?? 0),
    ratingCount: row.rating_count ?? 0,
    verified: Boolean(row.is_verified),
    founding: Boolean(row.founding),
    official: Boolean(row.is_official),
    likeCount: row.like_count,
    commentCount: row.comment_count,
    liked: row.is_liked,
    saved: row.is_saved,
    aspectRatio: Number(row.aspect_ratio ?? 0.82),
    createdAt: row.created_at,
  };
}

/* ------------------------------------ Query ------------------------------------ */

/** One page of the "Made for you" feed. */
export async function fetchFeedPage({
  seed,
  cursor,
  pageSize,
  auth = "optional",
}: {
  seed: string;
  cursor: FeedCursor | null;
  pageSize: number;
  auth?: AuthMode;
}): Promise<FeedPage> {
  const page = await api.get<Page<FeedRow>>("/v1/feed", {
    auth,
    // The cursor carries its seed, so the seed only matters on the first page.
    query: {
      cursor: cursor ?? undefined,
      page_size: Math.min(30, Math.max(1, pageSize)),
      seed: cursor ? undefined : feedSeedFor(seed),
    },
  });
  return { items: page.items.map(toFeedPost), nextCursor: page.next_cursor };
}
