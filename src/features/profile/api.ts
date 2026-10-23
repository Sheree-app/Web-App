import { cachedQuery } from '@/lib/query-cache';
import { supabase } from '@/lib/supabase';
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

type Payload = {
  id: string;
  handle?: string;
  name: string;
  business_name: string;
  bio: string;
  location: string;
  verified: boolean;
  avatar: string | null;
  bookings: number;
  rating: number | string;
  review_count: number;
  category: string;
  portfolio: Array<{ id: string; image: string; caption: string; aspect_ratio: number | string }>;
  studio?: Array<{ id: string; image: string; aspect_ratio: number | string }>;
  reviews?: Array<{
    id: string;
    author: string;
    avatar: string | null;
    rating: number | string;
    body: string;
    service: string;
    created_at: string;
  }>;
  socials?: Partial<CreatorSocials>;
};

type StatusRow = {
  is_founding_beautician: boolean | null;
  is_official: boolean | null;
};

/** Resolve a professional handle while keeping legacy UUID links valid. */
export async function resolveProfileId(profileKey: string): Promise<string> {
  const { data, error } = await (supabase.rpc as any)("resolve_profile_id", {
    profile_key: profileKey,
  });
  if (!error && data) return String(data);

  const table = supabase.from("professional_profiles" as never) as any;
  const { data: handleRow } = await table
    .select("id")
    .eq("handle", profileKey.toLowerCase())
    .maybeSingle();
  return handleRow?.id ? String(handleRow.id) : profileKey;
}

export async function fetchCreatorProfile(id: string): Promise<CreatorProfile> {
  return cachedQuery(`creator:${id}`, 5 * 60 * 1000, async () => {
    const resolvedId = await resolveProfileId(id);
    const [profileResult, linksResult, statusResult] = await Promise.all([
      (supabase.rpc as any)('get_creator_profile', { profile_id: resolvedId }),
      supabase
        .from('professional_social_links' as never)
        .select('platform,url')
        .eq('professional_id', resolvedId),
      // The public RPC predates the founding/official flags; read the same
      // server-authoritative booleans the feed uses. A deployment whose column
      // grants lag behind simply shows no badge instead of failing the page.
      (async () => {
        try {
          return await (supabase.from('professional_profiles' as never) as any)
            .select('is_founding_beautician,is_official')
            .eq('id', resolvedId)
            .maybeSingle();
        } catch {
          return { data: null, error: null };
        }
      })(),
    ]);

    if (profileResult.error) throw profileResult.error;
    if (linksResult.error) throw linksResult.error;
    if (!profileResult.data) throw new Error('This professional profile is unavailable.');

    const p = profileResult.data as unknown as Payload;
    const status =
      statusResult && !statusResult.error ? ((statusResult.data ?? null) as StatusRow | null) : null;

    const links = { ...EMPTY_SOCIAL_LINKS };
    for (const row of (linksResult.data ?? []) as unknown as Array<{ platform: string; url: string }>) {
      if (row.platform in links) links[row.platform as keyof SocialLinks] = row.url;
    }

    // The business name is the public name, matching the feed and mobile.
    const businessName = p.business_name?.trim() || p.name;

    return {
      id: p.id,
      handle: p.handle,
      name: businessName,
      businessName,
      bio: p.bio,
      location: p.location,
      verified: Boolean(p.verified),
      founding: Boolean(status?.is_founding_beautician),
      official: Boolean(status?.is_official),
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
        author: x.author,
        avatar: x.avatar,
        rating: Number(x.rating),
        body: x.body,
        service: x.service,
        createdAt: x.created_at,
      })),
      socials: {
        ...links,
        instagram: links.instagram ?? p.socials?.instagram ?? null,
        snapchat: links.snapchat ?? p.socials?.snapchat ?? null,
        whatsapp: p.socials?.whatsapp ?? null,
        telephone: p.socials?.telephone ?? null,
      },
    };
  });
}
