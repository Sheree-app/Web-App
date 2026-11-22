import { api } from "@/lib/api";

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
/** `GET /v1/search` (`sheree-backend/docs/api/discovery.md`). */
type Row = {
  kind: SearchKind;
  id: string;
  professional_id: string | null;
  title: string;
  subtitle: string;
  category: string;
  location: string;
  image: string | null;
  price: number | null;
  rating: number;
  review_count: number;
  verified: boolean;
  available: boolean;
  aspect_ratio: number | null;
  created_at: string;
  rank: number;
};

/**
 * One list of professionals, services, posts and categories. The API labels
 * rows with the public business name and turns stored service photo paths into
 * URLs, which this module used to do itself.
 */
export async function searchMarketplace(
  query: string,
  pricing: SearchPricing,
  minimumRating: number,
): Promise<SearchResult[]> {
  const rows = await api.get<Row[]>("/v1/search", {
    auth: "optional",
    query: {
      q: query,
      limit: 100,
      min_price: pricing.minimum,
      max_price: pricing.maximum,
      min_rating: minimumRating,
      sort: pricing.sort,
      include_unpriced: pricing.includeUnpriced,
    },
  });
  return rows.map((row) => ({
    kind: row.kind,
    id: row.id,
    professionalId: row.professional_id,
    title: row.title,
    subtitle: row.subtitle,
    category: row.category,
    location: row.location,
    image: row.image,
    price: row.price === null ? null : Number(row.price),
    rating: Number(row.rating),
    reviewCount: Number(row.review_count),
    verified: row.verified,
    available: row.available,
    aspectRatio: row.aspect_ratio === null ? null : Number(row.aspect_ratio),
    createdAt: row.created_at,
    rank: row.rank,
  }));
}
