import type { MediaAsset, MediaVariantName, ProcessedVariant } from "./types";
import { VARIANT_MAX_EDGE } from "./types";

/**
 * Client-side image optimization, ported from the native pipeline.
 *
 * Mobile used a native encoder to produce stripped, resized WebP variants. On
 * the web the same job is done by drawing the decoded image onto a canvas and
 * re-encoding it: rasterizing discards EXIF (including GPS) by definition, and
 * the canvas handles the resize.
 */
export class MediaProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaProcessingError";
  }
}

const DEFAULT_QUALITY = 0.8;

/** Chromium, Firefox and Safari can all encode WebP now; verify before use. */
const supportsWebp = (() => {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    return canvas.toDataURL("image/webp").startsWith("data:image/webp");
  } catch {
    return false;
  }
})();

async function decode(asset: MediaAsset): Promise<ImageBitmap | HTMLImageElement> {
  const source = asset.file;
  if (!source) throw new MediaProcessingError("That image couldn't be read. Pick it again.");

  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(source);
    } catch {
      /* fall through to <img> decoding */
    }
  }

  const url = asset.uri || URL.createObjectURL(source);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new MediaProcessingError("That image couldn't be read. Try a different one."));
    image.src = url;
  });
}

function sourceSize(decoded: ImageBitmap | HTMLImageElement) {
  if (decoded instanceof HTMLImageElement) {
    return { width: decoded.naturalWidth, height: decoded.naturalHeight };
  }
  return { width: decoded.width, height: decoded.height };
}

function drawToCanvas(
  decoded: ImageBitmap | HTMLImageElement,
  maxEdge: number,
  fill = false,
): { canvas: HTMLCanvasElement; width: number; height: number } {
  const { width, height } = sourceSize(decoded);
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new MediaProcessingError("This browser can't prepare images for upload.");

  context.imageSmoothingQuality = "high";
  context.drawImage(decoded, 0, 0, targetWidth, targetHeight);

  // `fill` keeps a square canvas for avatars; unused today but cheap to keep.
  void fill;
  return { canvas, width: targetWidth, height: targetHeight };
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  const type = supportsWebp ? "image/webp" : "image/jpeg";
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new MediaProcessingError("This image couldn't be prepared for upload."));
      },
      type,
      quality,
    );
  });
}

/**
 * Produces the thumbnail, feed and original variants for one picked image.
 * Every variant is a freshly encoded WebP (or JPEG where WebP is unavailable).
 */
export async function processMediaVariants(
  asset: MediaAsset,
  options: { quality?: number } = {},
): Promise<ProcessedVariant[]> {
  const quality = options.quality ?? DEFAULT_QUALITY;
  const decoded = await decode(asset);

  try {
    const names: MediaVariantName[] = ["thumbnail", "feed", "original"];
    const variants: ProcessedVariant[] = [];

    for (const name of names) {
      const { canvas, width, height } = drawToCanvas(decoded, VARIANT_MAX_EDGE[name]);
      const blob = await canvasToBlob(canvas, quality);
      variants.push({
        name,
        uri: URL.createObjectURL(blob),
        mimeType: blob.type || "image/webp",
        blob,
        width,
        height,
        size: blob.size,
      });
      // The canvas is only needed for the encode that just finished.
      canvas.width = 0;
      canvas.height = 0;
    }

    return variants;
  } catch (error) {
    if (error instanceof MediaProcessingError) throw error;
    throw new MediaProcessingError("That image couldn't be prepared for upload.");
  } finally {
    if (decoded instanceof ImageBitmap) decoded.close();
  }
}
