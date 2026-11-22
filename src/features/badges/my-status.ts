import { api } from "@/lib/api";

/**
 * The logged-in professional's detailed founding status.
 *
 * The public profile only carries the fast `is_founding_beautician` boolean.
 * The account view needs the categories, positions and open opportunities, so
 * it calls `GET /v1/me/founding-status` instead of inferring anything client-side.
 */

export type MyFoundingBadge = {
  category: string;
  slug: string;
  position: number | null;
  awardedAt: string | null;
  qualifyingAt: string | null;
};

export type FoundingOpportunity = {
  category: string;
  slug: string;
  claimed: number;
  spots: number;
  remaining: number;
  ready: boolean;
};

export type MyFoundingStatus = {
  isFounding: boolean;
  approved: boolean;
  badges: MyFoundingBadge[];
  opportunities: FoundingOpportunity[];
};

type RawBadge = {
  category?: string | null;
  slug?: string | null;
  position?: number | null;
  awarded_at?: string | null;
  qualifying_at?: string | null;
};

type RawOpportunity = {
  category?: string | null;
  slug?: string | null;
  claimed?: number | null;
  spots?: number | null;
  remaining?: number | null;
  ready?: boolean | null;
};

function mapStatus(payload: Record<string, unknown>): MyFoundingStatus {
  const badges = Array.isArray(payload.badges) ? (payload.badges as RawBadge[]) : [];
  const opportunities = Array.isArray(payload.opportunities)
    ? (payload.opportunities as RawOpportunity[])
    : [];

  return {
    isFounding: Boolean(payload.is_founding),
    approved: Boolean(payload.approved),
    badges: badges.map((badge) => ({
      category: badge.category ?? "",
      slug: badge.slug ?? "",
      position: badge.position == null ? null : Number(badge.position),
      awardedAt: badge.awarded_at ?? null,
      qualifyingAt: badge.qualifying_at ?? null,
    })),
    opportunities: opportunities.map((item) => ({
      category: item.category ?? "",
      slug: item.slug ?? "",
      claimed: Number(item.claimed ?? 0),
      spots: Number(item.spots ?? 0),
      remaining: Number(item.remaining ?? 0),
      ready: Boolean(item.ready),
    })),
  };
}

/**
 * Returns null for customers and for signed-out visitors (the API answers with
 * an empty body when the caller has no professional profile). Throws on
 * transport errors so the caller can decide whether to surface them.
 */
export async function fetchMyFoundingStatus(): Promise<MyFoundingStatus | null> {
  if (!(await api.session.ready())) return null;
  const data = await api.get<Record<string, unknown> | null | undefined>("/v1/me/founding-status");
  if (!data || typeof data !== "object") return null;
  return mapStatus(data);
}
