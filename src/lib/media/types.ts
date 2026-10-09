/**
 * Shared types for the Sheree media pipeline.
 *
 * Unchanged from the mobile implementation except that a picked asset now also
 * carries the browser `File`/`Blob` itself, so processing and uploading never
 * have to re-read it from disk.
 *
 * The flow: validate → optimize (WebP, EXIF/GPS stripped by re-encoding, resized
 * variants) → short-lived presigned PUT URLs from the `media-storage` Edge
 * Function → upload straight to Cloudflare R2 → confirm so metadata lands in the
 * `media` table.
 */

/** Where an image is used. Mirrors the `media.media_type` DB check. */
export type MediaPurpose = "profile" | "post" | "portfolio" | "service";

/** Generated delivery sizes. Each maps to a separate R2 object. */
export type MediaVariantName = "thumbnail" | "feed" | "original";

/** Max long-edge pixel size per variant. Kept in sync with the Edge Function. */
export const VARIANT_MAX_EDGE: Record<MediaVariantName, number> = {
  thumbnail: 320,
  feed: 720,
  original: 1440,
};

/** An image picked by the user, before validation/processing. */
export type MediaAsset = {
  /** Object URL for previews, matching the mobile `uri` field. */
  uri: string;
  /** The actual bytes — the browser's `File` or a canvas-produced `Blob`. */
  file?: Blob;
  mimeType?: string | null;
  fileName?: string | null;
  width?: number;
  height?: number;
  fileSize?: number | null;
};

/** A single optimized, ready-to-upload variant. */
export type ProcessedVariant = {
  name: MediaVariantName;
  /** Object URL of the re-encoded WebP (EXIF/GPS stripped). */
  uri: string;
  /** Always `image/webp` after processing. */
  mimeType: string;
  /** The encoded bytes handed to `fetch`. */
  blob: Blob;
  width: number;
  height: number;
  size: number;
};

/** Variant details returned by the Edge Function for a presigned upload. */
export type PresignedVariant = {
  name: MediaVariantName;
  key: string;
  uploadUrl: string;
  publicUrl: string;
  width: number;
  height: number;
};

/** Response from the Edge Function's `create-upload` action. */
export type PresignedUpload = {
  provider: "r2";
  mediaId: string;
  purpose: MediaPurpose;
  bucketKey: string;
  variants: PresignedVariant[];
  expiresIn: number;
};

/** Shape of a row in the `media` table. */
export type MediaRecord = {
  id: string;
  user_id: string;
  bucket_key: string;
  media_type: MediaPurpose;
  mime_type: string;
  width: number;
  height: number;
  variants: Record<string, { bucket_key: string; width: number; height: number }>;
  created_at: string;
};

/** A delivered image, with every variant resolved to a public URL. */
export type UploadedMedia = {
  provider: "r2" | "supabase";
  mediaId: string | null;
  purpose: MediaPurpose;
  bucketKey: string;
  width: number;
  height: number;
  variants: Record<
    MediaVariantName,
    { key: string; publicUrl: string; width: number; height: number }
  >;
  /** Shortcut to the `original` variant URL. */
  publicUrl: string;
};

/** Progress of a single variant upload (bytes + fraction 0..1). */
export type UploadProgress = {
  variant: MediaVariantName;
  loaded: number;
  total: number;
  fraction: number;
};

/** Per-upload configuration. */
export type UploadOptions = {
  onProgress?: (progress: UploadProgress) => void;
  /** Abort all variant uploads. Presigned URLs expire quickly regardless. */
  signal?: AbortSignal;
  /** WebP compression quality 0..1 (default 0.8). */
  quality?: number;
};

/** A media reference that can be deleted. */
export type MediaDeletionTarget =
  | { mediaId: string }
  | { provider: "r2"; key: string }
  | { provider: "supabase"; bucket: "avatars" | "portfolio"; key: string };
