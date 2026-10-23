"use client";

import { processMediaVariants } from "@/lib/media/processing";
import { mediaAssetFromFile } from "@/lib/media/validation";
import type { Id } from "../../../convex/_generated/dataModel";

/**
 * Browser media pipeline for chat.
 *
 * Images are re-encoded through the existing web canvas pipeline, which strips
 * EXIF (including GPS) and produces a web-ready WebP/JPEG. The bytes then go
 * straight to Convex storage — never to the public R2 bucket used for posts —
 * so a chat photo is only reachable through a participant-gated URL.
 */

export class ChatMediaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatMediaError";
  }
}

export type PreparedImage = {
  file: File;
  previewUrl: string;
  width: number;
  height: number;
  mimeType: string;
  sizeBytes: number;
  /** Releases both the picker's and the processed image's object URLs. */
  dispose: () => void;
};

/** Validates, strips metadata, and downsizes a picked image for sending. */
export async function prepareChatImage(file: File): Promise<PreparedImage> {
  let asset;
  try {
    asset = await mediaAssetFromFile(file);
  } catch (error) {
    throw new ChatMediaError(
      error instanceof Error ? error.message : "That image couldn't be read. Pick another.",
    );
  }

  const variants = await processMediaVariants(asset, { quality: 0.82 });
  const chosen = variants.find((variant) => variant.name === "feed") ?? variants[0];
  if (!chosen) {
    URL.revokeObjectURL(asset.uri);
    throw new ChatMediaError("That image couldn't be prepared. Pick another.");
  }

  for (const variant of variants) {
    if (variant !== chosen) URL.revokeObjectURL(variant.uri);
  }

  const uploadFile = new File([chosen.blob], "sheree-chat.webp", {
    type: chosen.mimeType || "image/webp",
  });

  return {
    file: uploadFile,
    previewUrl: chosen.uri,
    width: chosen.width,
    height: chosen.height,
    mimeType: uploadFile.type,
    sizeBytes: chosen.size,
    dispose: () => {
      URL.revokeObjectURL(chosen.uri);
      URL.revokeObjectURL(asset.uri);
    },
  };
}

/**
 * POSTs a file to a Convex upload URL with progress.
 *
 * `XMLHttpRequest` is used rather than `fetch` because upload progress is part
 * of the product: the composer shows a stepped indicator instead of pretending
 * a large photo sent instantly.
 */
export function uploadToConvex(
  uploadUrl: string,
  file: Blob,
  options: {
    contentType: string;
    onProgress?: (fraction: number) => void;
    signal?: AbortSignal;
  },
): Promise<Id<"_storage">> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", uploadUrl, true);
    request.setRequestHeader("Content-Type", options.contentType || "application/octet-stream");

    const onAbort = () => request.abort();
    options.signal?.addEventListener("abort", onAbort, { once: true });

    request.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      options.onProgress?.(Math.min(1, event.loaded / event.total));
    };

    request.onload = () => {
      options.signal?.removeEventListener("abort", onAbort);
      if (request.status < 200 || request.status >= 300) {
        reject(new ChatMediaError("The file could not be uploaded. Check your connection and try again."));
        return;
      }
      try {
        const body = JSON.parse(request.responseText) as { storageId?: string };
        if (!body.storageId) throw new Error("missing storage id");
        options.onProgress?.(1);
        resolve(body.storageId as Id<"_storage">);
      } catch {
        reject(new ChatMediaError("The upload finished but could not be confirmed. Try again."));
      }
    };

    request.onerror = () => {
      options.signal?.removeEventListener("abort", onAbort);
      reject(new ChatMediaError("The file could not be uploaded. Check your connection and try again."));
    };

    request.onabort = () => {
      options.signal?.removeEventListener("abort", onAbort);
      reject(new ChatMediaError("Upload cancelled."));
    };

    options.onProgress?.(0);
    request.send(file);
  });
}

/** Formats a byte count for progress copy. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
