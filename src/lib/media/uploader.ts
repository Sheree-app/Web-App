import { env } from "@/lib/env";
import { supabase } from "@/lib/supabase/client";
import { processMediaVariants } from "./processing";
import type {
  MediaAsset,
  MediaDeletionTarget,
  MediaPurpose,
  MediaRecord,
  PresignedUpload,
  ProcessedVariant,
  UploadedMedia,
  UploadOptions,
  UploadProgress,
} from "./types";
import { isMediaPurpose, validateMediaAsset } from "./validation";

const FUNCTION_NAME = "media-storage";
const RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 700;
const UPLOAD_TIMEOUT_MS = 120_000;

export class MediaUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaUploadError";
  }
}

class RetryableStatusError extends Error {
  constructor(public readonly status: number) {
    super(`Retryable status ${status}`);
    this.name = "RetryableStatusError";
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function statusMessage(status: number, variant: string): string {
  // This PUT goes straight to R2 and is authorized by the presigned URL, not by
  // the Supabase session. A 401/403 here means the upload link is invalid or
  // expired — never that the user's session ended.
  if (status === 413) return `${variant} is too large to upload.`;
  if (status === 401 || status === 403) {
    return `The ${variant} image could not be uploaded. Your upload link may have expired; please try again.`;
  }
  return `The ${variant} image could not be uploaded (${status}).`;
}

/** PUTs one processed variant straight to R2, retrying transient failures. */
async function uploadVariant(
  variant: ProcessedVariant,
  uploadUrl: string,
  options: UploadOptions,
): Promise<void> {
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt += 1) {
    if (options.signal?.aborted) throw new MediaUploadError("Upload cancelled.");

    try {
      options.onProgress?.({
        variant: variant.name,
        loaded: 0,
        total: variant.size,
        fraction: 0,
      } satisfies UploadProgress);

      await putVariant(uploadUrl, variant, options);

      options.onProgress?.({
        variant: variant.name,
        loaded: variant.size,
        total: variant.size,
        fraction: 1,
      } satisfies UploadProgress);
      return;
    } catch (error) {
      if (options.signal?.aborted) throw new MediaUploadError("Upload cancelled.");
      if (error instanceof RetryableStatusError) {
        if (attempt >= RETRY_ATTEMPTS) {
          // Status 0 = network/timeout failure that never reached R2.
          throw new MediaUploadError(
            error.status
              ? statusMessage(error.status, variant.name)
              : `The ${variant.name} image could not be uploaded.`,
          );
        }
      } else {
        throw error;
      }
      await delay(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
    }
  }
}

async function putVariant(
  uploadUrl: string,
  variant: ProcessedVariant,
  options: UploadOptions,
): Promise<void> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);

  try {
    const response = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        // The presigned URL signs only `host`, so R2 object metadata comes from
        // these unsigned request headers.
        "Content-Type": variant.mimeType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
      body: variant.blob,
      signal: controller.signal,
    });
    if (response.ok) return;
    if (isRetryableStatus(response.status)) throw new RetryableStatusError(response.status);
    throw new MediaUploadError(statusMessage(response.status, variant.name));
  } catch (error) {
    if (options.signal?.aborted) throw new MediaUploadError("Upload cancelled.");
    if (error instanceof MediaUploadError || error instanceof RetryableStatusError) throw error;
    throw new RetryableStatusError(0);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

function variantPayload(variants: ProcessedVariant[]) {
  return variants.map((v) => ({
    name: v.name,
    mimeType: v.mimeType,
    size: v.size,
    width: v.width,
    height: v.height,
  }));
}

/** Requests short-lived presigned PUT URLs for every variant. */
async function requestPresignedUpload(
  purpose: MediaPurpose,
  variants: ProcessedVariant[],
): Promise<PresignedUpload> {
  const { data, error } = await supabase.functions.invoke<PresignedUpload>(FUNCTION_NAME, {
    body: { action: "create-upload", purpose, variants: variantPayload(variants) },
  });
  if (error || !data?.variants?.length) {
    throw new MediaUploadError(
      error?.message || "Cloud media storage is unavailable. Please try again shortly.",
    );
  }
  return data;
}

/** Confirms every variant landed, persisting metadata in the `media` table. */
async function confirmUpload(
  purpose: MediaPurpose,
  presigned: PresignedUpload,
  variants: ProcessedVariant[],
): Promise<MediaRecord> {
  const { data, error } = await supabase.functions.invoke<{ media: MediaRecord }>(FUNCTION_NAME, {
    body: {
      action: "complete",
      purpose,
      mediaId: presigned.mediaId,
      variants: variantPayload(variants),
    },
  });
  if (error || !data?.media) {
    throw new MediaUploadError(
      error?.message || "The image was uploaded but could not be saved. Please try again.",
    );
  }
  return data.media;
}

function supabaseBucketFor(purpose: MediaPurpose): "avatars" | "portfolio" {
  return purpose === "profile" ? "avatars" : "portfolio";
}

/** True when the project is configured to store media in Cloudflare R2. */
export function isR2Enabled(): boolean {
  return env.mediaStorageProvider === "r2";
}

/**
 * Rollback path: uploads to Supabase Storage when R2 has not been enabled.
 * No variants are generated; the original URL is reused for every delivery size.
 */
async function uploadToSupabase(
  purpose: MediaPurpose,
  asset: MediaAsset,
  options: UploadOptions,
): Promise<UploadedMedia> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new MediaUploadError("Sign in again to upload.");

  const variants = await processMediaVariants(asset, { quality: options.quality });
  const original = variants.find((v) => v.name === "original") ?? variants[0];
  const bucket = supabaseBucketFor(purpose);
  const key = `${user.id}/${crypto.randomUUID()}.webp`;

  const { error } = await supabase.storage
    .from(bucket)
    .upload(key, original.blob, { contentType: original.mimeType, upsert: false });
  if (error) throw new MediaUploadError("Your image could not be uploaded. Please try again.");

  const publicUrl = supabase.storage.from(bucket).getPublicUrl(key).data.publicUrl;
  const variantMap = {} as UploadedMedia["variants"];
  for (const name of ["thumbnail", "feed", "original"] as const) {
    variantMap[name] = { key, publicUrl, width: original.width, height: original.height };
  }
  options.onProgress?.({
    variant: "original",
    loaded: original.size,
    total: original.size,
    fraction: 1,
  });

  return {
    provider: "supabase",
    mediaId: null,
    purpose,
    bucketKey: key,
    width: original.width,
    height: original.height,
    variants: variantMap,
    publicUrl,
  };
}

/**
 * The full pipeline:
 *
 *   1. validate the picked asset (type, size, dimensions)
 *   2. process into WebP variants (EXIF/GPS stripped, resized)
 *   3. request short-lived presigned PUT URLs
 *   4. PUT each variant directly to R2 (progress + retry)
 *   5. confirm, persisting metadata in the `media` table
 *
 * The backend never sees image bytes. When R2 is not enabled the upload falls
 * back to Supabase Storage so the app stays operational.
 */
export async function uploadMedia(
  purpose: MediaPurpose,
  asset: MediaAsset,
  options: UploadOptions = {},
): Promise<UploadedMedia> {
  if (!isMediaPurpose(purpose)) throw new MediaUploadError("Invalid upload purpose.");
  validateMediaAsset(asset);

  if (!isR2Enabled()) return uploadToSupabase(purpose, asset, options);

  const variants = await processMediaVariants(asset, { quality: options.quality });
  const presigned = await requestPresignedUpload(purpose, variants);

  for (const variant of variants) {
    const target = presigned.variants.find((item) => item.name === variant.name);
    if (!target) throw new MediaUploadError("The upload could not be prepared. Please try again.");
    await uploadVariant(variant, target.uploadUrl, options);
  }

  const record = await confirmUpload(purpose, presigned, variants);

  const variantMap = {} as UploadedMedia["variants"];
  for (const variant of variants) {
    const target = presigned.variants.find((item) => item.name === variant.name);
    variantMap[variant.name] = {
      key: target?.key ?? presigned.bucketKey,
      publicUrl: target?.publicUrl ?? "",
      width: variant.width,
      height: variant.height,
    };
  }

  return {
    provider: "r2",
    mediaId: record?.id ?? presigned.mediaId,
    purpose,
    bucketKey: presigned.bucketKey,
    width: record?.width ?? variants[0].width,
    height: record?.height ?? variants[0].height,
    variants: variantMap,
    publicUrl: variantMap.original?.publicUrl || variantMap.feed?.publicUrl || "",
  };
}

/** Normalizes a full upload result into something the Edge Function can delete. */
function toDeletionTarget(target: MediaDeletionTarget | UploadedMedia): MediaDeletionTarget {
  if ("bucketKey" in target) {
    // Falling back to the portfolio bucket mirrors the native behaviour: legacy
    // profile images also live there once R2 is off.
    return target.provider === "supabase"
      ? { provider: "supabase", bucket: "portfolio", key: target.bucketKey }
      : { provider: "r2", key: target.bucketKey };
  }
  return target;
}

/** Marks an uploaded object for deletion through the same Edge Function. */
export async function deleteMedia(target: MediaDeletionTarget | UploadedMedia): Promise<void> {
  const { error } = await supabase.functions.invoke(FUNCTION_NAME, {
    body: { action: "delete", ...toDeletionTarget(target) },
  });
  if (error) throw new MediaUploadError(error.message || "That image could not be removed.");
}
