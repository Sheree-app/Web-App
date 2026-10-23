/**
 * Sheree media service — public API.
 *
 * Pipeline: validate → optimize (WebP, EXIF/GPS stripped, resized variants) →
 * short-lived presigned PUT URLs → direct-to-R2 upload → persist metadata.
 *
 * The client never holds R2 credentials and the backend never receives image
 * bytes; uploads go straight from the browser to Cloudflare R2.
 */
export { MediaProcessingError, processMediaVariants } from "./processing";
export * from "./types";
export { deleteMedia, isR2Enabled, MediaUploadError, uploadMedia } from "./uploader";
export { feedUrl, identifyMedia, identifyScopedMedia, r2PublicUrl, thumbnailUrl, variantUrl } from "./urls";
export { useMediaUpload } from "./useMediaUpload";
export type { MediaUploadState } from "./useMediaUpload";
export {
  describeImageFile,
  isMediaPurpose,
  mediaAssetFromFile,
  MediaValidationError,
  validateMediaAsset,
} from "./validation";

// Feed clips (Cloudinary) — the poster still travels through `uploadMedia`.
export {
  cloudinaryHlsUrl,
  cloudinaryProgressiveUrl,
  cloudinaryPublicId,
  isCloudinaryUrl,
  parseCloudinaryUrl,
  videoDeliveryUrls,
  PROGRESSIVE_WIDTH,
  PROGRESSIVE_WIDTH_DATA_SAVER,
} from "./video-urls";
export {
  completeVideoUpload,
  deleteCloudinaryVideo,
  formatClipDuration,
  generateVideoPoster,
  isSupportedVideoFile,
  MAX_VIDEO_BYTES,
  MAX_VIDEO_DURATION_MS,
  MIN_VIDEO_DURATION_MS,
  measureVideo,
  posterAsset,
  posterCaptureTime,
  posterSize,
  prepareVideo,
  requestVideoUploadTicket,
  resolveVideoMime,
  uploadVideo,
  uploadVideoToCloudinary,
  validateVideoClip,
  VideoProcessingError,
  VideoUploadError,
  VideoValidationError,
  VIDEO_MESSAGES,
} from "./video";
