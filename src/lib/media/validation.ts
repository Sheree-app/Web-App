import type { MediaAsset, MediaPurpose, MediaVariantName } from "./types";

/** Hard client-side limits. Kept in sync with the Edge Function. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MIN_IMAGE_EDGE = 100; // reject images too small to be useful
export const ALLOWED_INPUT_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  // HEIC/HEIF reach the browser from iPhone photo libraries when Safari decodes
  // them; where the browser can't, we say so plainly instead of failing later.
  "image/heic",
  "image/heif",
]);

export const ALL_PURPOSES: readonly MediaPurpose[] = ["profile", "post", "portfolio", "service"];

export const ALL_VARIANTS: readonly MediaVariantName[] = ["thumbnail", "feed", "original"];

export class MediaValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaValidationError";
  }
}

function mimeFromFileName(fileName?: string | null): string | null {
  if (!fileName) return null;
  const ext = fileName.split(".").pop()?.toLowerCase();
  if (!ext) return null;
  const map: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    heic: "image/heic",
    heif: "image/heif",
  };
  return map[ext] ?? null;
}

/** Validates a picked image before any processing or upload happens. */
export function validateMediaAsset(asset: MediaAsset): void {
  const mime = asset.mimeType || mimeFromFileName(asset.fileName);
  if (!mime) {
    throw new MediaValidationError("Unsupported file. Choose a JPEG, PNG or WebP image.");
  }
  if (!ALLOWED_INPUT_MIME.has(mime)) {
    throw new MediaValidationError("Unsupported file format. Use JPEG, PNG or WebP.");
  }

  if (asset.fileSize != null && asset.fileSize > MAX_IMAGE_BYTES) {
    throw new MediaValidationError("This image is larger than 10 MB. Pick a smaller one.");
  }

  const { width, height } = asset;
  if (width != null && height != null) {
    if (width < MIN_IMAGE_EDGE || height < MIN_IMAGE_EDGE) {
      throw new MediaValidationError("This image is too small. Choose a larger photo.");
    }
    if (width > 12000 || height > 12000) {
      throw new MediaValidationError("This image is too large. Choose a smaller photo.");
    }
  }
}

export function isMediaPurpose(value: unknown): value is MediaPurpose {
  return typeof value === "string" && (ALL_PURPOSES as readonly string[]).includes(value);
}

/**
 * Reads natural dimensions from a browser `File`.
 *
 * The native picker handed the dimensions over for free; a file input does not,
 * so they are decoded once here and reused by validation and processing.
 */
export async function describeImageFile(file: File): Promise<{
  width: number;
  height: number;
  uri: string;
}> {
  const uri = URL.createObjectURL(file);
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      const size = { width: bitmap.width, height: bitmap.height, uri };
      bitmap.close();
      return size;
    } catch {
      /* fall through to the <img> path */
    }
  }

  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight, uri });
    image.onerror = () =>
      reject(new MediaValidationError("That image couldn't be read. Try a different one."));
    image.src = uri;
  });
}

/** Builds a validated `MediaAsset` from an `<input type="file">` selection. */
export async function mediaAssetFromFile(file: File): Promise<MediaAsset> {
  const { width, height, uri } = await describeImageFile(file);
  const asset: MediaAsset = {
    uri,
    file,
    width,
    height,
    fileSize: file.size,
    mimeType: file.type || mimeFromFileName(file.name),
    fileName: file.name,
  };
  validateMediaAsset(asset);
  return asset;
}
