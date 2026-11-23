"use client";

import { STALE } from "@/lib/query-cache";
import { useQuery } from "@/lib/use-query";
import { useAuth } from "@/providers/auth-provider";
import {
  fetchOwnServices,
  fetchProfessionalName,
  fetchProfessionalServices,
  fetchServiceCategories,
  OWN_SERVICES_KEY,
  publicProNameKey,
  publicServicesKey,
} from "./api";

/** Her own menu (active and paused), its practice categories and country. */
export function useOwnServices() {
  const { user } = useAuth();
  return useQuery(user ? OWN_SERVICES_KEY : null, fetchOwnServices, { staleTime: STALE.medium });
}

/** Every active category, for the service editor's picker. */
export function useServiceCategories() {
  return useQuery("pub:service-categories", fetchServiceCategories, { staleTime: STALE.long });
}

/** A professional's public menu, by handle or id. */
export function usePublicServices(profileKey: string | null | undefined) {
  return useQuery(profileKey ? publicServicesKey(profileKey) : null, () => fetchProfessionalServices(profileKey!), {
    staleTime: STALE.medium,
  });
}

/** A professional's display name, by handle or id. */
export function usePublicProName(profileKey: string | null | undefined) {
  return useQuery(profileKey ? publicProNameKey(profileKey) : null, () => fetchProfessionalName(profileKey!), {
    staleTime: STALE.medium,
  });
}
