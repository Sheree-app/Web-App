import { cachedQuery, STALE } from '@/lib/query-cache';
import { api } from '@/lib/api';
import { EMPTY_SOCIAL_LINKS, type SocialLinks } from './socials';

export type CreatorWork = { id: string; image: string; caption: string; aspectRatio: number };
export type CreatorStudioPhoto = { id: string; image: string; aspectRatio: number };
export type CreatorReview = {
  id: string;
  author: string;
  avatar: string | null;
  rating: number;
  body: string;
  service: string;
  createdAt: string;
};
export type CreatorSocials = SocialLinks & { whatsapp: string | null; telephone: string | null };

export type CreatorProfile = {
  id: string;
  handle?: string;
  name: string;
  businessName: string;
  bio: string;
  location: string;
  verified: boolean;
  /** `professional_profiles.is_founding_beautician` — never derived from verified. */
  founding: boolean;
  /** `professional_profiles.is_official` — separate from both other statuses. */
  official: boolean;
  avatar: string | null;
  bookings: number;
  rating: number;
  reviewCount: number;
  category: string;
  portfolio: CreatorWork[];
  studio: CreatorStudioPhoto[];
  reviews: CreatorReview[];
  socials: CreatorSocials;
};

/** `GET /v1/professionals/:key` (`sheree-backend/docs/api/profiles.md`). */
type Payload = {
  id: string;
  handle: string;
  name: string;
  business_name: string | null;
  bio: string;
  location: string;
  verified: boolean;
  founding: boolean;
  official: boolean;
  avatar: string | null;
  bookings: number;
  rating: number;
  review_count: number;
  category: string;
  portfolio: Array<{ id: string; image: string; caption: string; aspect_ratio: number }>;
  studio: Array<{ id: string; image: string; aspect_ratio: number }>;
  reviews: Array<{
    id: string;
    author: string | null;
    avatar: string | null;
    rating: number;
    body: string;
    service: string;
    created_at: string;
  }>;
  socials: Partial<CreatorSocials>;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Cache key for a public profile, by the key it was opened with (handle or UUID). */
export const creatorProfileKey = (key: string) => `pub:pro:${key.trim()}`;
export const CREATOR_PROFILE_PREFIX = 'pub:pro:';

/**
 * Resolve a professional handle while keeping legacy UUID links valid. The API
 * resolves either form, so a UUID needs no request at all.
 */
export async function resolveProfileId(profileKey: string): Promise<string> {
  if (UUID_RE.test(profileKey.trim())) return profileKey.trim();
  try {
    return (await fetchCreatorProfile(profileKey)).id;
  } catch {
    // As before: an unresolvable key is passed on, and the next read reports it.
    return profileKey;
  }
}

/** The profile from the cache when fresh, otherwise from the network. */
export async function fetchCreatorProfile(id: string): Promise<CreatorProfile> {
  return cachedQuery(creatorProfileKey(id), STALE.medium, () => loadCreatorProfile(id));
}

/** `GET /v1/professionals/:key`, shaped for the profile page; always a network read. */
export async function loadCreatorProfile(id: string): Promise<CreatorProfile> {
  const p = await api.get<Payload>(`/v1/professionals/${encodeURIComponent(id.trim())}`, { auth: 'optional' });

  // The business name is the public name, matching the feed and mobile.
  const businessName = p.business_name?.trim() || p.name;
  // TODO(api): the API's socials have no `youtube`; it stays empty until added.
  const socials = p.socials ?? {};

  return {
    id: p.id,
    handle: p.handle,
    name: businessName,
    businessName,
    bio: p.bio,
    location: p.location,
    verified: Boolean(p.verified),
    founding: Boolean(p.founding),
    official: Boolean(p.official),
    avatar: p.avatar,
    bookings: p.bookings,
    rating: Number(p.rating),
    reviewCount: p.review_count,
    category: p.category,
    portfolio: p.portfolio.map((x) => ({
      id: x.id,
      image: x.image,
      caption: x.caption,
      aspectRatio: Number(x.aspect_ratio),
    })),
    studio: (p.studio ?? []).map((x) => ({
      id: x.id,
      image: x.image,
      aspectRatio: Number(x.aspect_ratio),
    })),
    reviews: (p.reviews ?? []).map((x) => ({
      id: x.id,
      author: x.author ?? 'Sheree member',
      avatar: x.avatar,
      rating: Number(x.rating),
      body: x.body,
      service: x.service,
      createdAt: x.created_at,
    })),
    socials: {
      ...EMPTY_SOCIAL_LINKS,
      ...Object.fromEntries(
        Object.keys(EMPTY_SOCIAL_LINKS).map((key) => [key, socials[key as keyof SocialLinks] ?? null]),
      ),
      whatsapp: socials.whatsapp ?? null,
      telephone: socials.telephone ?? null,
    } as CreatorSocials,
  };
}
