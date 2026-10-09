import { env } from "@/lib/env";
import type { MediaVariantName, UploadedMedia } from "./types";

const CDN_BASE = env.r2PublicBaseUrl.replace(/\/$/, "");
const SUPABASE_SUFFIX = "/storage/v1/object/public/";

function encodeKey(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

/**
 * Builds the public CDN URL for an R2 object key.
 * `https://cdn.getsheree.com/posts/a7c4e1d9/original.webp`
 */
export function r2PublicUrl(key: string): string {
  return CDN_BASE ? `${CDN_BASE}/${encodeKey(key)}` : key;
}

/** Returns the public URL for a specific variant of an uploaded image. */
export function variantUrl(media: UploadedMedia, variant: MediaVariantName): string {
  return media.variants[variant]?.publicUrl ?? media.publicUrl;
}

/** Convenience: the `feed` variant, sized for in-feed display. */
export function feedUrl(media: UploadedMedia): string {
  return variantUrl(media, "feed");
}

/** Convenience: the `thumbnail` variant, sized for profile cards. */
export function thumbnailUrl(media: UploadedMedia): string {
  return variantUrl(media, "thumbnail");
}

type IdentifiedR2 = { provider: "r2"; key: string };
type IdentifiedSupabase = { provider: "supabase"; bucket: "avatars" | "portfolio"; key: string };
export type IdentifiedMedia = IdentifiedR2 | IdentifiedSupabase;

/**
 * Extracts a deletable reference from any known public media URL (R2 CDN or
 * legacy Supabase Storage). Returns null when the URL is not Sheree media.
 */
export function identifyMedia(url: string): IdentifiedMedia | null {
  if (!url) return null;
  if (CDN_BASE && url.startsWith(`${CDN_BASE}/`)) {
    return { provider: "r2", key: decodeURIComponent(url.slice(CDN_BASE.length + 1)) };
  }
  const markerIndex = url.indexOf(SUPABASE_SUFFIX);
  if (markerIndex < 0) return null;
  const rest = url.slice(markerIndex + SUPABASE_SUFFIX.length).split("?")[0];
  const slash = rest.indexOf("/");
  if (slash < 0) return null;
  const bucket = rest.slice(0, slash) as "avatars" | "portfolio";
  return {
    provider: "supabase",
    bucket: bucket === "avatars" || bucket === "portfolio" ? bucket : "portfolio",
    key: decodeURIComponent(rest.slice(slash + 1)),
  };
}

/**
 * Legacy helper kept for compatibility: given a scope (bucket) and a URL,
 * resolve the provider + object key so the object can be deleted later.
 */
export function identifyScopedMedia(
  scope: "avatars" | "portfolio",
  url: string,
): { provider: "r2" | "supabase"; key: string } | null {
  const identified = identifyMedia(url);
  if (!identified) return null;
  if (identified.provider === "r2") return identified;
  if (identified.bucket !== scope) return null;
  return identified;
}
