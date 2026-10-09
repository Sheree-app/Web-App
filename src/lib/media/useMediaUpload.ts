"use client";

import { useCallback, useRef, useState } from "react";
import {
  MediaProcessingError,
} from "./processing";
import type { MediaPurpose, UploadedMedia, UploadProgress } from "./types";
import { MediaUploadError, uploadMedia } from "./uploader";
import { MediaValidationError, mediaAssetFromFile } from "./validation";

export type MediaUploadState = "idle" | "preparing" | "uploading" | "done" | "error";

/**
 * React hook around `uploadMedia`, replacing the native version of the same
 * name. It owns the state machine (preparing → uploading → done/error), keeps
 * the last result, and can cancel an in-flight upload.
 */
export function useMediaUpload() {
  const [state, setState] = useState<MediaUploadState>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [media, setMedia] = useState<UploadedMedia | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setState("idle");
    setProgress(0);
    setError(null);
    setMedia(null);
  }, []);

  const upload = useCallback(
    async (file: File, purpose: MediaPurpose): Promise<UploadedMedia | null> => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;

      setError(null);
      setMedia(null);
      setProgress(0);
      setState("preparing");

      try {
        const asset = await mediaAssetFromFile(file);
        setState("uploading");

        const result = await uploadMedia(purpose, asset, {
          signal: controller.signal,
          onProgress: (update: UploadProgress) => setProgress(update.fraction),
        });

        setMedia(result);
        setProgress(1);
        setState("done");
        return result;
      } catch (uploadError) {
        if (controller.signal.aborted) {
          setState("idle");
          return null;
        }
        const message =
          uploadError instanceof MediaValidationError ||
          uploadError instanceof MediaUploadError ||
          uploadError instanceof MediaProcessingError
            ? uploadError.message
            : "Your image could not be uploaded. Please try again.";
        setError(message);
        setState("error");
        return null;
      }
    },
    [],
  );

  return {
    state,
    progress,
    error,
    media,
    busy: state === "preparing" || state === "uploading",
    upload,
    reset,
    cancel: () => {
      controllerRef.current?.abort();
      controllerRef.current = null;
      setState("idle");
      setProgress(0);
    },
  };
}
