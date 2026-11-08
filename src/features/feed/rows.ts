/**
 * The feed query and row mapping, shared by the browser (`api.ts`) and the
 * server (`server.ts`). Nothing in here touches a specific Supabase client,
 * `window` or `document`: the caller passes the client, so the server can
 * render the first page with the visitor's own session and the browser can
 * carry on from the same cursor.
 */
import type { FeedPost } from "./types";

export type FeedRow = {
  id: string;
  professional_id: string;
  professional_name: string;
  avatar_url: string | null;
  image_url: string;
  caption: string | null;
  category: string;
  location: string | null;
  price_from: number | null;
  rating: number | null;
  rating_count: number | null;
  is_verified: boolean;
  like_count: number;
  comment_count: number;
  is_liked: boolean;
  is_saved: boolean;
  aspect_ratio: number | null;
  created_at: string;
};

/** Columns the feed RPCs do not return, fetched once per page. */
type PostMetaRow = {
  id: string;
  slug?: string;
  video_url: string | null;
  video_duration_ms: number | null;
  service_id: string | null;
};

type ProfileMetaRow = {
  id: string;
  business_name: string | null;
  is_founding_beautician: boolean | null;
  is_official: boolean | null;
};

export type FeedCursor = { id: string };
export type FeedPage = { items: FeedPost[]; nextCursor: FeedCursor | null };

type QueryResult = { data: unknown; error: { message?: string; code?: string } | null };

/** The slice of a Supabase client the feed needs, browser or server. */
export type FeedClient = {
  rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<QueryResult>;
  from: (table: string) => {
    select: (columns: string) => { in: (column: string, values: string[]) => PromiseLike<QueryResult> };
  };
};

/* ------------------------------------ Seed ------------------------------------ */

/**
 * The feed is shuffled per person, and the shuffle must stay stable across
 * refreshes and pages. The seed lives in a first-party cookie (set by the
 * proxy) rather than only in localStorage, so the server can render the first
 * page in the same order the browser will continue in.
 */
export const FEED_SEED_COOKIE = "sheree-feed-seed";

/** Mixes in the member id so two accounts on one browser get different feeds. */
export function feedSeedFor(baseSeed: string, userId: string | null) {
  return `${baseSeed}:${userId ?? "anon"}`;
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

async function optionalRows<T>(query: PromiseLike<QueryResult>): Promise<T[]> {
  try {
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []) as T[];
  } catch {
    // The feed is still readable without the enrichment columns.
    return [];
  }
}

/**
 * Maps feed RPC rows into the client model.
 *
 * The feed RPCs predate clips, so video metadata and the founding/official
 * flags are read in two batched lookups per page — never once per card.
 */
export async function mapFeedRows(client: FeedClient, rows: FeedRow[]): Promise<FeedPost[]> {
  if (!rows.length) return [];

  const postIds = [...new Set(rows.map((row) => row.id))];
  const profileIds = [...new Set(rows.map((row) => row.professional_id))];

  const [postMeta, profileMeta] = await Promise.all([
    optionalRows<PostMetaRow>(
      client.from("feed_posts").select("id,slug,video_url,video_duration_ms,service_id").in("id", postIds),
    ),
    optionalRows<ProfileMetaRow>(
      client
        .from("professional_profiles")
        .select("id,business_name,is_founding_beautician,is_official")
        .in("id", profileIds),
    ),
  ]);

  const posts = new Map(postMeta.map((row) => [row.id, row]));
  const profiles = new Map(profileMeta.map((row) => [row.id, row]));

  return rows.map((row) => {
    const meta = posts.get(row.id);
    const profile = profiles.get(row.professional_id);
    const businessName = profile?.business_name?.trim();
    return {
      id: row.id,
      slug: meta?.slug,
      professionalId: row.professional_id,
      // Mobile shows the business name as the public professional name.
      professionalName: businessName || row.professional_name,
      avatarUrl: row.avatar_url,
      imageUrl: row.image_url,
      videoUrl: meta?.video_url ?? null,
      videoDurationMs: meta?.video_duration_ms == null ? null : Number(meta.video_duration_ms),
      caption: row.caption ?? "",
      category: row.category,
      location: row.location ?? "Accra",
      priceFrom: row.price_from,
      serviceId: meta?.service_id ?? null,
      rating: Number(row.rating ?? 0),
      ratingCount: row.rating_count ?? 0,
      verified: Boolean(row.is_verified),
      founding: Boolean(profile?.is_founding_beautician),
      official: Boolean(profile?.is_official),
      likeCount: row.like_count,
      commentCount: row.comment_count,
      liked: row.is_liked,
      saved: row.is_saved,
      aspectRatio: Number(row.aspect_ratio ?? 0.82),
      createdAt: row.created_at,
    };
  });
}

/* ------------------------------------ Query ------------------------------------ */

/** One page of the "Made for you" feed. Same RPCs and fallbacks as before. */
export async function fetchFeedPage(
  client: FeedClient,
  { seed, cursor, pageSize }: { seed: string; cursor: FeedCursor | null; pageSize: number },
): Promise<FeedPage> {
  const { data, error } = await client.rpc("get_made_for_you_feed", {
    cursor_id: cursor?.id ?? null,
    page_size: pageSize,
    feed_seed: seed,
  });
  if (error) {
    // Keep deployed clients working while the migration rolls out: if the
    // randomized RPC is missing, fall back to the deterministic feed.
    if (!cursor && (/get_made_for_you_feed/i.test(error.message ?? "") || error.code === "PGRST202")) {
      const page = await client.rpc("get_feed_page", {
        cursor_created_at: null,
        cursor_id: null,
        page_size: pageSize,
      });
      if (!page.error) return { items: await mapFeedRows(client, (page.data ?? []) as FeedRow[]), nextCursor: null };
      const legacy = await client.rpc("get_personalized_feed", { page_number: 0, page_size: pageSize });
      if (legacy.error) throw legacy.error;
      return { items: await mapFeedRows(client, (legacy.data ?? []) as FeedRow[]), nextCursor: null };
    }
    throw error;
  }
  const rows = (data ?? []) as FeedRow[];
  const last = rows.at(-1);
  return {
    items: await mapFeedRows(client, rows),
    nextCursor: rows.length === pageSize && last ? { id: last.id } : null,
  };
}
