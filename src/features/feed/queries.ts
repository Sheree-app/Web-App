"use client";

import { peekCached, queryStore, STALE } from "@/lib/query-cache";
import { prefetchQuery, setQueryData, useQuery } from "@/lib/use-query";
import { useAuth } from "@/providers/auth-provider";
import type { FeedPage } from "./rows";
import type { FeedPost } from "./types";
import {
  FEED_KEY,
  fetchFeed,
  fetchPostComments,
  fetchSavedFeed,
  loadPostDetail,
  postCommentsKey,
  postKey,
  SAVED_KEY,
  type PostDetail,
} from "./api";

/** Posts per feed request; matches the server-rendered first page. */
export const FEED_PAGE_SIZE = 24;

/**
 * The first page of "Made for you". Later pages stay in the screen and are
 * dropped when this one refreshes. It doesn't refetch on focus: a feed that
 * reshuffles under you when you come back to the tab is worse than one that's
 * a few minutes old (it still refreshes on the next visit once stale).
 */
export function useFeedFirstPage() {
  return useQuery(FEED_KEY, () => fetchFeed(null, FEED_PAGE_SIZE), {
    staleTime: STALE.short,
    refetchOnFocus: false,
  });
}

/**
 * A guest's first page rendered on the server is exactly what the browser
 * would ask for (same seed, no likes or saves), so it goes straight into the
 * cache instead of being fetched again. Call before `useFeedFirstPage` mounts.
 * Signed-in members still fetch theirs, which fills in their likes and saves.
 */
export function seedFeedFirstPage(page: FeedPage | null) {
  if (!page || queryStore.scope() !== null || peekCached(FEED_KEY) !== undefined) return;
  setQueryData(FEED_KEY, page, STALE.short);
}

/** One post with its pictures, by the key in its URL (slug or UUID). */
export function usePostDetail(key: string | null) {
  return useQuery(key ? postKey(key) : null, () => loadPostDetail(key!), { staleTime: STALE.short });
}

export const prefetchPostDetail = (key: string) =>
  prefetchQuery(postKey(key), () => loadPostDetail(key), STALE.short);

/**
 * Opening a post from a card: the card already holds the post, so the viewer
 * can paint it at once. It goes in already stale, so the viewer still fetches
 * the full post (and its other pictures) straight away.
 */
export function seedPostDetail(post: FeedPost) {
  const key = postKey(post.slug ?? post.id);
  if (peekCached(key) === undefined) setQueryData<PostDetail>(key, { post, images: [] }, 0);
}

/** The first page of a post's comments; later pages stay in the screen. */
export function usePostComments(key: string | null) {
  return useQuery(key ? postCommentsKey(key) : null, () => fetchPostComments(key!, null, 30), {
    staleTime: STALE.short,
  });
}

/** The first page of her saved posts. */
export function useSavedPosts() {
  const { user } = useAuth();
  return useQuery(user ? SAVED_KEY : null, () => fetchSavedFeed(), { staleTime: STALE.medium });
}
