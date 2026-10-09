import { supabase } from "@/lib/supabase";

export type SearchKind = "professional" | "service" | "post" | "category";
export type SearchResult = {
  kind: SearchKind;
  id: string;
  professionalId: string | null;
  title: string;
  subtitle: string;
  category: string;
  location: string;
  image: string | null;
  price: number | null;
  rating: number;
  reviewCount: number;
  verified: boolean;
  available: boolean;
  aspectRatio: number | null;
  createdAt: string;
  rank: number;
};
export type PriceSort = "relevance" | "low_to_high" | "high_to_low";
export type SearchPricing = {
  minimum: number | null;
  maximum: number | null;
  sort: PriceSort;
  includeUnpriced: boolean;
};
type Row = {
  kind: SearchKind;
  id: string;
  professional_id: string | null;
  title: string;
  subtitle: string;
  category: string;
  location: string;
  image: string | null;
  price: number | string | null;
  rating: number | string;
  review_count: number;
  verified: boolean;
  available: boolean;
  aspect_ratio: number | string | null;
  created_at: string;
  rank: number;
};

export async function searchMarketplace(
  query: string,
  pricing: SearchPricing,
  minimumRating: number,
) {
  const { data, error } = await supabase.rpc(
    "search_marketplace" as never,
    {
      query_text: query,
      result_limit: 100,
      minimum_price: pricing.minimum,
      maximum_price: pricing.maximum,
      minimum_rating: minimumRating,
      price_sort: pricing.sort,
      include_unpriced: pricing.includeUnpriced,
    } as never,
  );
  if (error) throw error;
  return ((data ?? []) as Row[]).map((row) => ({
    ...row,
    professionalId: row.professional_id,
    price: row.price === null ? null : Number(row.price),
    rating: Number(row.rating),
    reviewCount: Number(row.review_count),
    aspectRatio: row.aspect_ratio === null ? null : Number(row.aspect_ratio),
    image: serviceImage(row.kind, row.image),
    createdAt: row.created_at,
  }));
}
function serviceImage(kind: SearchKind, value: string | null) {
  if (!value || kind !== "service" || /^https?:\/\//.test(value)) return value;
  return supabase.storage.from("profile-media").getPublicUrl(value).data
    .publicUrl;
}
