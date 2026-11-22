import { api } from "@/lib/api";
import { errorCode, userMessage } from "@/lib/errors";
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

const RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 700;
const UPLOAD_TIMEOUT_MS = 120_000;

export class MediaUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaUploadError";
  }
}

/**
 * Turns a failed media API call (`sheree-backend/docs/api/media.md`) into a
 * MediaUploadError carrying copy we wrote.
 */
function apiFailure(error: unknown, fallback: string): MediaUploadError {
  switch (errorCode(error)) {
    case "business_profile_required":
      return new MediaUploadError("Finish setting up your professional profile before uploading.");
    case "rate_limited":
      return new MediaUploadError("You've uploaded a lot in the last hour. Please try again later.");
    case "upload_rejected":
      return new MediaUploadError("That file couldn't be used. Try a different photo.");
  }
  return new MediaUploadError(userMessage(error, fallback, "media.api"));
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
  // the Sheree session. A 401/403 here means the upload link is invalid or
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
  try {
    const data = await api.post<PresignedUpload>("/v1/media/uploads", {
      body: { kind: "image", purpose, variants: variantPayload(variants) },
    });
    if (!data?.variants?.length) throw new Error("No upload URLs returned");
    return data;
  } catch (error) {
    throw apiFailure(error, "Cloud media storage is unavailable. Please try again shortly.");
  }
}

/** Confirms every variant landed, persisting metadata in the `media` table. */
async function confirmUpload(
  purpose: MediaPurpose,
  presigned: PresignedUpload,
  variants: ProcessedVariant[],
): Promise<MediaRecord> {
  try {
    const data = await api.post<{ media: MediaRecord }>(
      `/v1/media/uploads/${encodeURIComponent(presigned.mediaId)}/complete`,
      { body: { kind: "image", purpose, variants: variantPayload(variants) } },
    );
    if (!data?.media) throw new Error("No media record returned");
    return data.media;
  } catch (error) {
    throw apiFailure(error, "The image was uploaded but could not be saved. Please try again.");
  }
}

/**
 * Images always go to R2 through the API now; kept for callers that still ask.
 * `NEXT_PUBLIC_MEDIA_STORAGE_PROVIDER` no longer changes anything.
 */
export function isR2Enabled(): boolean {
  return true;
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
 * The backend never sees image bytes. (The old Supabase Storage fallback is
 * gone: the API always stores images on R2.)
 */
export async function uploadMedia(
  purpose: MediaPurpose,
  asset: MediaAsset,
  options: UploadOptions = {},
): Promise<UploadedMedia> {
  if (!isMediaPurpose(purpose)) throw new MediaUploadError("Invalid upload purpose.");
  validateMediaAsset(asset);

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

/** Normalizes a full upload result into something the API can delete. */
function toDeletionTarget(target: MediaDeletionTarget | UploadedMedia): MediaDeletionTarget {
  if ("bucketKey" in target) {
    if (target.mediaId) return { mediaId: target.mediaId };
    return target.provider === "supabase"
      ? { provider: "supabase", bucket: "portfolio", key: target.bucketKey }
      : { provider: "r2", key: target.bucketKey };
  }
  return target;
}

/** Deletes an uploaded object through `/v1/media`. */
export async function deleteMedia(target: MediaDeletionTarget | UploadedMedia): Promise<void> {
  const resolved = toDeletionTarget(target);
  try {
    if ("mediaId" in resolved) {
      await api.delete<void>(`/v1/media/${encodeURIComponent(resolved.mediaId)}`);
      return;
    }
    if (resolved.provider === "cloudinary") {
      await api.post<void>("/v1/media/deletions", {
        body: { provider: "cloudinary", publicId: resolved.publicId },
      });
      return;
    }
    if (resolved.provider === "supabase") {
      // Files from before R2 live in Supabase Storage, which the app can no
      // longer reach. They stay where they are (old rows still reference them).
      return;
    }
    await api.post<void>("/v1/media/deletions", { body: { key: resolved.key } });
  } catch (error) {
    throw new MediaUploadError(
      errorCode(error) === "not_allowed"
        ? "That file isn’t yours to remove."
        : "That image could not be removed.",
    );
  }
}
