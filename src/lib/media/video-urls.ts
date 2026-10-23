/**
 * Cloudinary delivery URLs for feed clips.
 *
 * A post stores the `secure_url` Cloudinary returned from an upload (for example
 * `https://res.cloudinary.com/<cloud>/video/upload/v1727000000/post/<id>.mp4`).
 * That URL is the canonical source. Delivery variants are derived from it:
 *
 *   progressive  …/video/upload/q_auto,w_720,c_limit/<public-id>.mp4
 *   adaptive     …/video/upload/sp_auto/<public-id>.m3u8
 *
 * Everything here is deliberately idempotent: feeding a derived URL back in
 * produces the same URL, so a component can request a delivery form without
 * ever stacking two transformation segments.
 */

const CLOUDINARY_HOST = "res.cloudinary.com";

/** Transformation parameter prefixes Cloudinary uses in a delivery segment. */
const TRANSFORM_PARAM = new RegExp(
  "^(?:a|ac|af|ar|b|bo|br|c|co|cs|d|dl|dn|du|e|eo|f|fl|fn|fps|g|h|if|ki|l|o|p|pg|q|r|so|sp|t|u|vc|vs|w|x|y|z)_[^/]*$",
  "i",
);

/** A delivery extension we strip when recovering a public id. */
const DELIVERY_EXTENSION = /\.(?:mp4|m4v|mov|webm|m3u8|jpe?g|png|webp|gif|avif)$/i;

/** Progressive (MP4) delivery width. Data saver halves it. */
export const PROGRESSIVE_WIDTH = 720;
export const PROGRESSIVE_WIDTH_DATA_SAVER = 480;

export type CloudinaryAsset = {
  /** Cloudinary cloud name, e.g. `sheree`. */
  cloudName: string;
  /** Delivery resource type (`video`, `image`, …). */
  resourceType: string;
  /** Public id without version, transformations or extension. */
  publicId: string;
};

function isTransformSegment(segment: string): boolean {
  if (!segment) return false;
  return segment
    .split(",")
    .filter(Boolean)
    .every((part) => TRANSFORM_PARAM.test(part));
}

function isVersionSegment(segment: string): boolean {
  return /^v\d+$/.test(segment);
}

function encodePublicId(publicId: string): string {
  return publicId.split("/").map(encodeURIComponent).join("/");
}

/**
 * Splits any Cloudinary delivery URL into its cloud, resource type and public
 * id. Returns null for every other host so R2 and legacy Supabase URLs fall
 * through untouched (no Cloudinary transformations are ever added to them).
 */
export function parseCloudinaryUrl(url: string | null | undefined): CloudinaryAsset | null {
  if (!url || typeof url !== "string") return null;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  // Canonical delivery URLs put the cloud name in the first path segment:
  // https://res.cloudinary.com/<cloud>/<resource>/<type>/...
  if (parsed.hostname !== CLOUDINARY_HOST) return null;

  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length < 5) return null;

  const [cloudName, resourceType, deliveryType, ...rest] = segments;
  if (!cloudName) return null;
  if (!["image", "video", "raw"].includes(resourceType)) return null;
  if (!["upload", "private", "fetch", "authenticated"].includes(deliveryType)) return null;

  let index = 0;
  while (index < rest.length) {
    const segment = rest[index];
    if (isVersionSegment(segment)) {
      index += 1;
      break;
    }
    if (isTransformSegment(segment)) {
      index += 1;
      continue;
    }
    break;
  }

  const remainder = rest.slice(index).join("/");
  if (!remainder) return null;

  const publicId = decodeURIComponent(remainder.replace(DELIVERY_EXTENSION, ""));
  if (!publicId) return null;

  return { cloudName, resourceType, publicId };
}

/** True when the URL is served by Cloudinary. */
export function isCloudinaryUrl(url: string | null | undefined): boolean {
  return parseCloudinaryUrl(url) !== null;
}

/**
 * Public id for a Cloudinary URL, including URLs with version segments,
 * delivery transformations, file extensions and HLS playlists.
 * `https://…/video/upload/q_auto,w_720,c_limit/v17/post/a.mp4` → `post/a`
 */
export function cloudinaryPublicId(url: string | null | undefined): string | null {
  return parseCloudinaryUrl(url)?.publicId ?? null;
}

/** Cloud name for a Cloudinary URL, or null for every other provider. */
export function cloudinaryCloudName(url: string | null | undefined): string | null {
  return parseCloudinaryUrl(url)?.cloudName ?? null;
}

/** Cloudinary MP4 delivery URL, capped at `width`. */
export function cloudinaryProgressiveUrl(
  url: string,
  options: { width?: number; dataSaver?: boolean } = {},
): string {
  const asset = parseCloudinaryUrl(url);
  if (!asset) return url;

  const width =
    options.width ??
    (options.dataSaver ? PROGRESSIVE_WIDTH_DATA_SAVER : PROGRESSIVE_WIDTH);
  const safeWidth = Number.isFinite(width) && width > 0 ? Math.round(width) : PROGRESSIVE_WIDTH;

  return `https://${CLOUDINARY_HOST}/${asset.cloudName}/${asset.resourceType}/upload/q_auto,w_${safeWidth},c_limit/${encodePublicId(asset.publicId)}.mp4`;
}

/** Cloudinary adaptive HLS playlist URL. */
export function cloudinaryHlsUrl(url: string): string {
  const asset = parseCloudinaryUrl(url);
  if (!asset) return url;
  return `https://${CLOUDINARY_HOST}/${asset.cloudName}/${asset.resourceType}/upload/sp_auto/${encodePublicId(asset.publicId)}.m3u8`;
}

/**
 * The two delivery forms a feed clip can use. Non-Cloudinary sources (R2 or
 * legacy Supabase URLs) come back unchanged in both slots.
 */
export function videoDeliveryUrls(
  url: string | null | undefined,
  options: { dataSaver?: boolean; hls?: boolean } = {},
): { progressive: string; adaptive: string | null; isCloudinary: boolean } {
  if (!url) return { progressive: "", adaptive: null, isCloudinary: false };
  const asset = parseCloudinaryUrl(url);
  if (!asset) return { progressive: url, adaptive: null, isCloudinary: false };

  return {
    progressive: cloudinaryProgressiveUrl(url, { dataSaver: options.dataSaver }),
    adaptive: options.hls === false ? null : cloudinaryHlsUrl(url),
    isCloudinary: true,
  };
}
