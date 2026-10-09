/**
 * Backward-compatibility shim.
 *
 * The shared media pipeline lives in `@/lib/media`. This module keeps the
 * previous scope-based signatures (`avatars` / `portfolio`) working so callers
 * that predate it — including the ported feature modules — need no changes.
 */
import {
  deleteMedia as removeMedia,
  identifyScopedMedia,
  uploadMedia,
} from "@/lib/media";
import type { MediaAsset, MediaPurpose, UploadedMedia } from "@/lib/media/types";

export type PublicMediaScope = "avatars" | "portfolio";

type MediaRef = { provider: "r2" | "supabase"; key: string };

function purposeForScope(scope: PublicMediaScope): MediaPurpose {
  return scope === "avatars" ? "profile" : "portfolio";
}

function toMediaRef(media: UploadedMedia): MediaRef {
  return { provider: media.provider, key: media.bucketKey };
}

/**
 * Uploads a public image under the legacy scope mapping. Returns the resolved
 * public URL plus the underlying provider + object key for later cleanup.
 */
export async function uploadPublicMedia(
  _userId: string,
  scope: PublicMediaScope,
  asset: MediaAsset,
  options?: { upsert?: boolean; namePrefix?: string },
): Promise<MediaRef & { publicUrl: string }> {
  const media = await uploadMedia(purposeForScope(scope), asset, {
    quality: options?.upsert ? 0.8 : undefined,
  });
  return { ...toMediaRef(media), publicUrl: media.publicUrl };
}

/** Deletes a previously uploaded media reference. */
export async function deletePublicMedia(
  scope: PublicMediaScope,
  media: { provider: "r2" | "supabase"; key: string; mediaId?: string | null },
): Promise<void> {
  if (media.mediaId) {
    await removeMedia({ mediaId: media.mediaId });
    return;
  }
  if (media.provider === "supabase") {
    await removeMedia({ provider: "supabase", bucket: scope, key: media.key });
    return;
  }
  await removeMedia({ provider: "r2", key: media.key });
}

/** Resolves a public URL back to its provider + object key (if Sheree media). */
export function identifyPublicMedia(
  scope: PublicMediaScope,
  url: string,
): { provider: "r2" | "supabase"; key: string } | null {
  return identifyScopedMedia(scope, url);
}
