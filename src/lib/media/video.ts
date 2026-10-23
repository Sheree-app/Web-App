import { supabase } from "@/lib/supabase/client";
import type {
  MediaAsset,
  MediaPurpose,
  PreparedVideo,
  UploadedVideo,
  VideoClipMeta,
  VideoPoster,
  VideoUploadTicket,
} from "./types";
import { cloudinaryPublicId } from "./video-urls";

/**
 * Feed clips, ported from the mobile `src/lib/media/video.ts`.
 *
 * Videos are the one media type that does not go through R2: the browser asks
 * the `media-storage` Edge Function for a signed Cloudinary ticket, posts the
 * bytes straight to Cloudinary, then confirms the upload so a `media` row is
 * written. The Cloudinary API secret never leaves the Edge Function.
 *
 * The poster frame is not a special medium either — it is captured locally and
 * pushed through the exact same image pipeline as a normal post picture.
 */

const FUNCTION_NAME = "media-storage";

// ---------------------------------------------------------------------------
// Limits — kept in sync with the Edge Function and `feed_posts_video_check`.
// ---------------------------------------------------------------------------

export const MAX_VIDEO_BYTES = 50 * 1024 * 1024; // 50 MB
export const MIN_VIDEO_DURATION_MS = 500;
export const MAX_VIDEO_DURATION_MS = 12_000;
/** Poster is captured at roughly this fraction of the clip. */
export const POSTER_CAPTURE_RATIO = 0.2;
/** Poster max long edge. Matches the `original` image variant. */
export const POSTER_MAX_EDGE = 1440;

/** Containers the product accepts. WebM/AVI are explicitly rejected. */
export const ALLOWED_VIDEO_MIME = new Set([
  "video/mp4",
  "video/quicktime",
  "video/m4v",
  "video/x-m4v",
  "video/mov",
]);

const MIME_ALIASES: Record<string, string> = {
  "video/m4v": "video/mp4",
  "video/x-m4v": "video/mp4",
  "video/mov": "video/quicktime",
};

const EXTENSION_MIME: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/m4v",
  mov: "video/quicktime",
};

/** Generic MIME values browsers fall back to when they cannot identify a file. */
const GENERIC_MIME = new Set(["", "application/octet-stream", "binary/octet-stream"]);

export const VIDEO_MESSAGES = {
  unsupported: "Clips have to be MP4 or MOV.",
  tooShort: "That clip is too short to show anything.",
  tooLong: "Choose a clip of 12 seconds or less.",
  tooLarge: "That clip is larger than 50 MB.",
  unreadable: "That clip could not be read. Record it again.",
} as const;

export class VideoValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VideoValidationError";
  }
}

export class VideoProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VideoProcessingError";
  }
}

export class VideoUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VideoUploadError";
  }
}

// ---------------------------------------------------------------------------
// Container validation
// ---------------------------------------------------------------------------

function extensionOf(fileName?: string | null): string | null {
  if (!fileName) return null;
  const segment = fileName.split(".").pop()?.toLowerCase();
  return segment && segment !== fileName.toLowerCase() ? segment : null;
}

/**
 * Resolves the container a selected file actually uses.
 *
 * A specific MIME type wins: a file the browser reports as `video/webm` is
 * rejected even if it is named `.mp4`. Only when the browser gives us nothing
 * useful (`""`, `application/octet-stream`) do we trust the extension, and even
 * then only the three supported ones.
 */
export function resolveVideoMime(file: {
  type?: string | null;
  name?: string | null;
}): string | null {
  const raw = (file.type ?? "").split(";")[0].trim().toLowerCase();
  if (raw && !GENERIC_MIME.has(raw)) {
    return ALLOWED_VIDEO_MIME.has(raw) ? (MIME_ALIASES[raw] ?? raw) : null;
  }
  const extension = extensionOf(file.name);
  if (!extension) return null;
  const mime = EXTENSION_MIME[extension];
  if (!mime) return null;
  return MIME_ALIASES[mime] ?? mime;
}

/** True when the file is an accepted MP4/MOV container. */
export function isSupportedVideoFile(file: {
  type?: string | null;
  name?: string | null;
}): boolean {
  return resolveVideoMime(file) !== null;
}

function normalizeMime(mimeType?: string | null): string | null {
  const raw = (mimeType ?? "").split(";")[0].trim().toLowerCase();
  if (!raw || GENERIC_MIME.has(raw)) return null;
  return ALLOWED_VIDEO_MIME.has(raw) ? (MIME_ALIASES[raw] ?? raw) : null;
}

/** Throws a friendly error unless the container is MP4/MOV. */
export function assertSupportedVideoContainer(mimeType?: string | null): string {
  const mime = normalizeMime(mimeType);
  if (!mime) throw new VideoValidationError(VIDEO_MESSAGES.unsupported);
  return mime;
}

// ---------------------------------------------------------------------------
// Clip validation — runs before upload, while preparing, and server-side
// ---------------------------------------------------------------------------

export type VideoClipCandidate = {
  mimeType?: string | null;
  size?: number | null;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
};

/**
 * Validates container, size and duration together. Dimensions are optional at
 * this stage; the Edge Function requires them, and `measureVideo` always
 * supplies them before a ticket is requested.
 */
export function validateVideoClip(clip: VideoClipCandidate): VideoClipMeta {
  const mimeType = assertSupportedVideoContainer(clip.mimeType);

  const size = Number(clip.size);
  if (!Number.isFinite(size) || size <= 0) {
    throw new VideoValidationError(VIDEO_MESSAGES.unreadable);
  }
  if (size > MAX_VIDEO_BYTES) {
    throw new VideoValidationError(VIDEO_MESSAGES.tooLarge);
  }

  const durationMs = Number(clip.durationMs);
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new VideoValidationError(VIDEO_MESSAGES.unreadable);
  }
  if (durationMs < MIN_VIDEO_DURATION_MS) {
    throw new VideoValidationError(VIDEO_MESSAGES.tooShort);
  }
  if (durationMs > MAX_VIDEO_DURATION_MS) {
    throw new VideoValidationError(VIDEO_MESSAGES.tooLong);
  }

  const width = Math.round(Number(clip.width));
  const height = Math.round(Number(clip.height));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new VideoValidationError(VIDEO_MESSAGES.unreadable);
  }

  return { mimeType, size, width, height, durationMs: Math.round(durationMs) };
}

/** `0:07`, `0:12` — the duration label the feed shows. */
export function formatClipDuration(durationMs: number | null | undefined): string {
  if (!durationMs || !Number.isFinite(durationMs) || durationMs <= 0) return "0:00";
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Local metadata + poster capture (browser only)
// ---------------------------------------------------------------------------

const METADATA_TIMEOUT_MS = 15_000;
const SEEK_TIMEOUT_MS = 15_000;

function mediaElement(): HTMLVideoElement {
  if (typeof document === "undefined") {
    throw new VideoProcessingError(VIDEO_MESSAGES.unreadable);
  }
  const video = document.createElement("video");
  video.preload = "metadata";
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = "anonymous";
  return video;
}

function disposeElement(video: HTMLVideoElement, objectUrl: string) {
  try {
    video.pause();
    video.removeAttribute("src");
    video.load();
  } catch {
    /* best effort */
  }
  URL.revokeObjectURL(objectUrl);
}

/**
 * Measures the real duration (and dimensions) of a selected file.
 *
 * The picker's own duration metadata is never trusted: a clip can be trimmed or
 * recorded in a container whose header lies, and the database enforces a hard
 * 500 ms – 12 s window.
 */
export async function measureVideo(
  file: Blob & { name?: string },
): Promise<{ durationMs: number; width: number; height: number }> {
  const objectUrl = URL.createObjectURL(file);
  const video = mediaElement();

  try {
    const metadata = await new Promise<{ durationMs: number; width: number; height: number }>(
      (resolve, reject) => {
        const timer = setTimeout(
          () => reject(new VideoValidationError(VIDEO_MESSAGES.unreadable)),
          METADATA_TIMEOUT_MS,
        );

        const finish = () => {
          const durationMs = video.duration * 1000;
          const width = video.videoWidth;
          const height = video.videoHeight;
          clearTimeout(timer);
          if (!Number.isFinite(durationMs) || durationMs <= 0) {
            reject(new VideoValidationError(VIDEO_MESSAGES.unreadable));
            return;
          }
          if (!width || !height) {
            reject(new VideoValidationError(VIDEO_MESSAGES.unreadable));
            return;
          }
          resolve({ durationMs, width, height });
        };

        video.addEventListener("loadedmetadata", finish, { once: true });
        video.addEventListener("durationchange", () => {
          if (Number.isFinite(video.duration) && video.duration > 0) finish();
        });
        video.addEventListener("error", () => {
          clearTimeout(timer);
          reject(new VideoValidationError(VIDEO_MESSAGES.unreadable));
        });
        video.src = objectUrl;
      },
    );
    return metadata;
  } finally {
    disposeElement(video, objectUrl);
  }
}

/** Waits until the element can render a frame at its current time. */
function seekTo(video: HTMLVideoElement, timeSeconds: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new VideoProcessingError(VIDEO_MESSAGES.unreadable)),
      SEEK_TIMEOUT_MS,
    );
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    video.addEventListener("seeked", done, { once: true });
    video.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new VideoProcessingError(VIDEO_MESSAGES.unreadable));
    });
    video.currentTime = timeSeconds;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new VideoProcessingError(VIDEO_MESSAGES.unreadable));
      },
      "image/webp",
      quality,
    );
  });
}

/**
 * Time (in seconds) to grab the poster frame at. Roughly 20% of the clip and
 * always just short of the final frame, because seeking to `duration` hangs in
 * some browsers.
 */
export function posterCaptureTime(
  durationMs: number,
  atRatio: number = POSTER_CAPTURE_RATIO,
): number {
  const durationSeconds = Math.max(0, durationMs / 1000);
  const ratio = Math.min(1, Math.max(0, atRatio));
  return Math.min(Math.max(durationSeconds * ratio, 0), Math.max(durationSeconds - 0.05, 0));
}

/** Poster pixel size, capped on the long edge (1440px by default). */
export function posterSize(
  width: number,
  height: number,
  maxEdge: number = POSTER_MAX_EDGE,
): { width: number; height: number } {
  if (!width || !height) throw new VideoProcessingError(VIDEO_MESSAGES.unreadable);
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Captures the poster frame at ~20% of the clip, caps its long edge at 1440px
 * and encodes it as WebP so it can go straight into the image pipeline.
 */
export async function generateVideoPoster(
  file: Blob,
  options: {
    durationMs: number;
    atRatio?: number;
    maxEdge?: number;
    quality?: number;
  },
): Promise<VideoPoster> {
  const objectUrl = URL.createObjectURL(file);
  const video = mediaElement();
  video.preload = "auto";

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new VideoProcessingError(VIDEO_MESSAGES.unreadable)),
        METADATA_TIMEOUT_MS,
      );
      video.addEventListener(
        "loadeddata",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      video.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new VideoProcessingError(VIDEO_MESSAGES.unreadable));
      });
      video.src = objectUrl;
    });

    const target = posterCaptureTime(options.durationMs, options.atRatio);
    await seekTo(video, target);

    const { width, height } = posterSize(
      video.videoWidth,
      video.videoHeight,
      options.maxEdge ?? POSTER_MAX_EDGE,
    );

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new VideoProcessingError(VIDEO_MESSAGES.unreadable);

    context.imageSmoothingQuality = "high";
    context.drawImage(video, 0, 0, width, height);

    const blob = await canvasToBlob(canvas, options.quality ?? 0.85);
    canvas.width = 0;
    canvas.height = 0;

    return {
      blob,
      mimeType: blob.type || "image/webp",
      width,
      height,
      uri: URL.createObjectURL(blob),
    };
  } catch (error) {
    if (error instanceof VideoProcessingError || error instanceof VideoValidationError) {
      throw error;
    }
    throw new VideoProcessingError(VIDEO_MESSAGES.unreadable);
  } finally {
    disposeElement(video, objectUrl);
  }
}

/**
 * Full client-side preparation: container/size, measured duration, and poster.
 * Nothing is uploaded until this resolves.
 */
export async function prepareVideo(file: File): Promise<PreparedVideo> {
  const mimeType = resolveVideoMime(file);
  if (!mimeType) throw new VideoValidationError(VIDEO_MESSAGES.unsupported);
  if (file.size > MAX_VIDEO_BYTES) throw new VideoValidationError(VIDEO_MESSAGES.tooLarge);

  const measured = await measureVideo(file);
  const clip = validateVideoClip({
    mimeType,
    size: file.size,
    width: measured.width,
    height: measured.height,
    durationMs: measured.durationMs,
  });

  const poster = await generateVideoPoster(file, { durationMs: clip.durationMs });

  return { file, fileName: file.name ?? null, clip, poster };
}

/** Adapts the captured poster to the ordinary image upload pipeline. */
export function posterAsset(poster: VideoPoster, fileName = "poster.webp"): MediaAsset {
  return {
    uri: poster.uri,
    file: poster.blob,
    mimeType: poster.mimeType,
    fileName,
    width: poster.width,
    height: poster.height,
    fileSize: poster.blob.size,
  };
}

// ---------------------------------------------------------------------------
// Signed Cloudinary upload
// ---------------------------------------------------------------------------

function normalizeTicket(data: unknown): VideoUploadTicket {
  if (!data || typeof data !== "object") {
    throw new VideoUploadError("Video uploads are unavailable. Please try again shortly.");
  }
  const raw = data as Record<string, unknown>;
  const fields = raw.fields;
  if (
    typeof raw.uploadUrl !== "string" ||
    !raw.uploadUrl ||
    typeof raw.publicId !== "string" ||
    !raw.publicId ||
    !fields ||
    typeof fields !== "object"
  ) {
    throw new VideoUploadError("Video uploads are unavailable. Please try again shortly.");
  }

  return {
    provider: "cloudinary",
    kind: "video",
    mediaId: String(raw.mediaId ?? ""),
    purpose: (raw.purpose as MediaPurpose) ?? "post",
    cloudName: String(raw.cloudName ?? ""),
    uploadUrl: raw.uploadUrl,
    publicId: raw.publicId,
    expiresIn: Number(raw.expiresIn ?? 60),
    fields: Object.fromEntries(
      Object.entries(fields as Record<string, unknown>).map(([key, value]) => [key, String(value)]),
    ),
  };
}

/** Requests the signed ticket from the existing `media-storage` function. */
export async function requestVideoUploadTicket(
  clip: VideoClipMeta,
  options: { purpose?: MediaPurpose; signal?: AbortSignal } = {},
): Promise<VideoUploadTicket> {
  const { data, error } = await supabase.functions.invoke(FUNCTION_NAME, {
    body: {
      action: "create-upload",
      kind: "video",
      provider: "cloudinary",
      purpose: options.purpose ?? "post",
      clip,
    },
  });
  if (error) {
    throw new VideoUploadError(
      error.message || "Video uploads are unavailable. Please try again shortly.",
    );
  }
  return normalizeTicket(data);
}

export type CloudinaryUploadResult = {
  secureUrl: string;
  publicId: string;
  bytes: number | null;
  durationMs: number | null;
  width: number | null;
  height: number | null;
};

function readCloudinaryResponse(payload: unknown): CloudinaryUploadResult {
  if (!payload || typeof payload !== "object") {
    throw new VideoUploadError("That clip could not be uploaded. Try again.");
  }
  const body = payload as Record<string, unknown>;
  const secureUrl = typeof body.secure_url === "string" ? body.secure_url : "";
  if (!secureUrl) {
    const detail =
      (body.error as { message?: string } | undefined)?.message ??
      (typeof body.error === "string" ? body.error : null);
    throw new VideoUploadError(detail || "That clip could not be uploaded. Try again.");
  }
  return {
    secureUrl,
    publicId: String(body.public_id ?? ""),
    bytes: body.bytes == null ? null : Number(body.bytes),
    durationMs: body.duration == null ? null : Math.round(Number(body.duration) * 1000),
    width: body.width == null ? null : Number(body.width),
    height: body.height == null ? null : Number(body.height),
  };
}

/**
 * POSTs the clip straight to Cloudinary with every signed field appended.
 * No application server ever sees the bytes.
 */
export async function uploadVideoToCloudinary(
  file: Blob,
  ticket: VideoUploadTicket,
  options: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
): Promise<CloudinaryUploadResult> {
  const form = new FormData();
  for (const [key, value] of Object.entries(ticket.fields)) form.append(key, value);
  form.append("file", file, ticket.publicId.split("/").pop() || "clip");

  if (options.onProgress && typeof XMLHttpRequest !== "undefined") {
    return uploadWithProgress(ticket.uploadUrl, form, options);
  }

  const response = await fetch(ticket.uploadUrl, {
    method: "POST",
    body: form,
    signal: options.signal,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = (payload as { error?: { message?: string } } | null)?.error?.message;
    throw new VideoUploadError(detail || "That clip could not be uploaded. Try again.");
  }
  return readCloudinaryResponse(payload);
}

function uploadWithProgress(
  url: string,
  form: FormData,
  options: { onProgress?: (fraction: number) => void; signal?: AbortSignal },
): Promise<CloudinaryUploadResult> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", url);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) options.onProgress?.(event.loaded / event.total);
    };
    request.onload = () => {
      let payload: unknown = null;
      try {
        payload = JSON.parse(request.responseText);
      } catch {
        payload = null;
      }
      if (request.status >= 200 && request.status < 300) {
        try {
          resolve(readCloudinaryResponse(payload));
        } catch (error) {
          reject(error);
        }
        return;
      }
      const detail = (payload as { error?: { message?: string } } | null)?.error?.message;
      reject(new VideoUploadError(detail || "That clip could not be uploaded. Try again."));
    };
    request.onerror = () =>
      reject(new VideoUploadError("That clip could not be uploaded. Check your connection."));
    request.onabort = () => reject(new VideoUploadError("Upload cancelled."));
    options.signal?.addEventListener("abort", () => request.abort(), { once: true });
    request.send(form);
  });
}

/** Records the clip in the `media` registry after Cloudinary accepted it. */
export async function completeVideoUpload(
  ticket: VideoUploadTicket,
  clip: VideoClipMeta,
): Promise<{ mediaId: string; publicId: string }> {
  const { data, error } = await supabase.functions.invoke(FUNCTION_NAME, {
    body: {
      action: "complete",
      kind: "video",
      provider: "cloudinary",
      purpose: ticket.purpose,
      mediaId: ticket.mediaId,
      publicId: ticket.publicId,
      clip,
    },
  });
  if (error) {
    throw new VideoUploadError(
      error.message || "The clip uploaded but could not be saved. Please try again.",
    );
  }
  const media = (data as { media?: { id?: string; bucket_key?: string } } | null)?.media;
  return {
    mediaId: media?.id ?? ticket.mediaId,
    publicId: media?.bucket_key ?? ticket.publicId,
  };
}

export type UploadVideoOptions = {
  purpose?: MediaPurpose;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
};

/**
 * Ticket → direct Cloudinary upload → confirmation. The caller owns cleanup:
 * see `deleteCloudinaryVideo`.
 */
export async function uploadVideo(
  file: Blob,
  clip: VideoClipMeta,
  options: UploadVideoOptions = {},
): Promise<UploadedVideo> {
  const ticket = await requestVideoUploadTicket(clip, {
    purpose: options.purpose,
    signal: options.signal,
  });

  let uploaded: CloudinaryUploadResult | null = null;
  try {
    uploaded = await uploadVideoToCloudinary(file, ticket, {
      onProgress: options.onProgress,
      signal: options.signal,
    });
    const completed = await completeVideoUpload(ticket, clip);

    return {
      provider: "cloudinary",
      mediaId: completed.mediaId,
      publicId: uploaded.publicId || completed.publicId,
      url: uploaded.secureUrl,
      mimeType: clip.mimeType,
      durationMs: uploaded.durationMs ?? clip.durationMs,
      width: uploaded.width ?? clip.width,
      height: uploaded.height ?? clip.height,
    };
  } catch (error) {
    // The bytes reached Cloudinary but the registry never recorded them.
    // Remove the orphan here so callers do not have to know about it.
    if (uploaded) {
      await deleteCloudinaryVideo({
        publicId: uploaded.publicId || ticket.publicId,
        url: uploaded.secureUrl,
      }).catch(() => undefined);
    }
    throw error;
  }
}

/** Best-effort removal of a Cloudinary clip through `media-storage`. */
export async function deleteCloudinaryVideo(
  target: string | { publicId?: string | null; url?: string | null },
): Promise<void> {
  const publicId =
    typeof target === "string"
      ? cloudinaryPublicId(target) ?? target
      : target.publicId || (target.url ? cloudinaryPublicId(target.url) : null);
  if (!publicId) return;

  const { error } = await supabase.functions.invoke(FUNCTION_NAME, {
    body: { action: "delete", provider: "cloudinary", publicId },
  });
  if (error) throw new VideoUploadError(error.message || "That clip could not be removed.");
}
