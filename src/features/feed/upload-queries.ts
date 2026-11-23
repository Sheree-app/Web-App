"use client";

import { STALE } from "@/lib/query-cache";
import { useQuery } from "@/lib/use-query";
import { useAuth } from "@/providers/auth-provider";
import {
  getPostCategories,
  getProfessionalPosts,
  getStudioPhotos,
  OWN_POSTS_KEY,
  POST_CATEGORIES_KEY,
  STUDIO_PHOTOS_KEY,
} from "./upload";

/**
 * The studio's own posts and photos (`./upload.ts`). Kept apart from the feed's
 * queries, which belong to the public feed.
 */

/** Every post of the signed-in professional, newest first. */
export function useOwnPosts() {
  const { user } = useAuth();
  return useQuery(user ? OWN_POSTS_KEY : null, getProfessionalPosts, { staleTime: STALE.medium });
}

/** Her studio photos. */
export function useStudioPhotos() {
  const { user } = useAuth();
  return useQuery(user ? STUDIO_PHOTOS_KEY : null, getStudioPhotos, { staleTime: STALE.medium });
}

/** Active categories, A to Z, for the post composer. */
export function usePostCategories() {
  return useQuery(POST_CATEGORIES_KEY, getPostCategories, { staleTime: STALE.long });
}
