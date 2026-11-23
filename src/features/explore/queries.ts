"use client";

import { STALE } from "@/lib/query-cache";
import { prefetchQuery, useQuery } from "@/lib/use-query";
import {
  CATEGORIES_KEY,
  categoryProsKey,
  EXPLORE_PROS_KEY,
  fetchMapProfessionals,
  fetchNearbyProfessionals,
  fetchProfessionalsByCategory,
  loadExploreCategories,
  loadExploreProfessionals,
  mapProsKey,
  nearbyProsKey,
} from "./api";

/** The trades (rarely change). */
export function useExploreCategories() {
  return useQuery(CATEGORIES_KEY, loadExploreCategories, { staleTime: STALE.long });
}

/** Explore's professionals list (also "See all"). */
export function useExploreProfessionals() {
  return useQuery(EXPLORE_PROS_KEY, loadExploreProfessionals, { staleTime: STALE.medium });
}

/** One trade's professionals. */
export function useCategoryProfessionals(slug: string | null) {
  return useQuery(slug ? categoryProsKey(slug) : null, () => fetchProfessionalsByCategory(slug!), {
    staleTime: STALE.medium,
  });
}

export const prefetchCategoryProfessionals = (slug: string) =>
  prefetchQuery(categoryProsKey(slug), () => fetchProfessionalsByCategory(slug), STALE.medium);

type Point = { latitude: number; longitude: number };

/** Professionals pinned on the map around `at` (null = wait). */
export function useMapProfessionals(at: Point | null) {
  return useQuery(
    at ? mapProsKey(at.latitude, at.longitude) : null,
    () => fetchMapProfessionals(at!.latitude, at!.longitude, 500),
    { staleTime: STALE.medium },
  );
}

/** Professionals within `radiusMetres` of `at` (null = wait). */
export function useNearbyProfessionals(at: Point | null, radiusMetres: number) {
  return useQuery(
    at ? nearbyProsKey(at.latitude, at.longitude, radiusMetres) : null,
    () => fetchNearbyProfessionals(at!.latitude, at!.longitude, radiusMetres, 20),
    { staleTime: STALE.medium },
  );
}
