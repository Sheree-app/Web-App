import { api } from "@/lib/api";
import { setCached } from "@/lib/query-cache";

export type UpkeepStatus = "booked" | "overdue" | "due_soon" | "fresh";

/** One kind of upkeep on her calendar (nails, braids, ...). */
export type UpkeepItem = {
  category: string;
  name: string;
  cycle_days: number;
  last_done: string | null;
  last_source: "booking" | "look" | "spend" | "manual" | null;
  next_due: string | null;
  days_left: number | null;
  status: UpkeepStatus;
  booked_for: string | null;
  /** Her latest Sheree booking in this category: who and what to book again. */
  rebook: {
    professional_id: string;
    professional_name: string | null;
    avatar_url: string | null;
    service: {
      id: string;
      name: string;
      price: number;
      duration_minutes: number;
    } | null;
  } | null;
};

export type UpkeepPlan = {
  today: string;
  items: UpkeepItem[];
  available: Array<{
    category: string;
    name: string;
    default_cycle_days: number;
  }>;
};

export type UpkeepChange = {
  /** 3 to 180. Defaults server-side to the category's usual cycle. */
  cycle_days?: number;
  /** `false` takes it off the calendar (history stays). */
  tracking?: boolean;
  /** `YYYY-MM-DD`, up to today ("I did it myself"); `null` clears it. */
  last_done?: string | null;
};

/** Cache key (the cache belongs to the signed-in person). */
export const UPKEEP_KEY = "me:upkeep";
export const UPKEEP_TTL_MS = 5 * 60_000;

const remember = (plan: UpkeepPlan) => setCached(UPKEEP_KEY, plan, UPKEEP_TTL_MS);

/** `GET /v1/me/upkeep`, always fresh; refreshes the cached copy. */
export const fetchUpkeep = () => api.get<UpkeepPlan>("/v1/me/upkeep").then(remember);

/**
 * `PUT /v1/me/upkeep/:category`: starts, adjusts or stops tracking a category.
 * Resolves to the whole new calendar (and keeps the cache in step).
 */
export const setUpkeep = (category: string, change: UpkeepChange) =>
  api
    .put<UpkeepPlan>(`/v1/me/upkeep/${encodeURIComponent(category)}`, { body: change })
    .then(remember);
