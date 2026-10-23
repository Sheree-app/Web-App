import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "npm:@aws-sdk/client-s3@3.883.0";
import { getSignedUrl } from "npm:@aws-sdk/s3-request-presigner@3.883.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { corsHeaders } from "../_shared/cors.ts";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB per design document
const PRESIGN_EXPIRES_SECONDS = 60; // short-lived PUT URLs
const CONTENT_TYPE = "image/webp"; // client always uploads optimized WebP

// Purposes map to media_type values and to R2 key prefixes. Professional-only
// purposes require an existing professional_profiles row.
const PURPOSES = {
  profile: { professionalOnly: false },
  post: { professionalOnly: true },
  portfolio: { professionalOnly: true },
  service: { professionalOnly: true },
} as const;
type Purpose = keyof typeof PURPOSES;
const isPurpose = (value: string): value is Purpose => value in PURPOSES;

// Generated variants. The client resizes + re-encodes before upload, so these
// widths are the authoritative upper bounds enforced server-side too.
const VARIANTS = {
  thumbnail: { maxWidth: 320 },
  feed: { maxWidth: 720 },
  original: { maxWidth: 1440 },
} as const;
type VariantName = keyof typeof VARIANTS;
const isVariantName = (value: string): value is VariantName => value in VARIANTS;

// Clips. Mirrors `feed_posts_video_check`, the device-side validator and the
// `media` table constraints: 500 ms – 12 s, 50 MB, MP4/MOV only.
const VIDEO_MAX_BYTES = 50 * 1024 * 1024;
const VIDEO_MIN_DURATION_MS = 500;
const VIDEO_MAX_DURATION_MS = 12_000;
const VIDEO_TICKET_EXPIRES_SECONDS = 60;
const CLOUDINARY_MIME = new Set(["video/mp4", "video/quicktime"]);
const VIDEO_MIME_ALIASES: Record<string, string> = {
  "video/m4v": "video/mp4",
  "video/x-m4v": "video/mp4",
  "video/mov": "video/quicktime",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function uuid(): string {
  return crypto.randomUUID();
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function publicUrlFor(baseUrl: string, key: string): string {
  return `${baseUrl}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

function makeS3(accountId: string, accessKeyId: string, secretAccessKey: string) {
  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
    // AWS SDK v3.600+ adds a CRC32 checksum to PutObject by default
    // (requestChecksumCalculation: "WHEN_SUPPORTED"). During presigning the
    // body is empty, so the SDK signs a checksum of an EMPTY payload
    // (`x-amz-checksum-crc32=AAAAAA==` in the URL). R2 cannot verify that
    // against the real uploaded bytes and rejects the PUT. Restore the
    // pre-3.600 behavior so presigned URLs carry no checksum parameters.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

interface VariantInput {
  name: string;
  mimeType: string;
  size: number;
  width: number;
  height: number;
}

interface VideoClipInput {
  mimeType: string;
  size: number;
  width: number;
  height: number;
  durationMs: number;
}

function normalizeVideoMime(raw: unknown): string | null {
  const value = String(raw ?? "").split(";")[0].trim().toLowerCase();
  if (!value) return null;
  const mime = VIDEO_MIME_ALIASES[value] ?? value;
  return CLOUDINARY_MIME.has(mime) ? mime : null;
}

/**
 * The server-side boundary for clips. The browser validates and measures too,
 * but a hand-rolled call must not be able to publish a WebM, a 40-second clip,
 * or a 90 MB file.
 */
function validateVideoClip(input: unknown): VideoClipInput | string {
  if (!input || typeof input !== "object") return "clip is required";
  const clip = input as Record<string, unknown>;

  const mimeType = normalizeVideoMime(clip.mimeType);
  if (!mimeType) return "Clips have to be MP4 or MOV";

  const size = Number(clip.size);
  if (!Number.isFinite(size) || size <= 0) return "clip size is invalid";
  if (size > VIDEO_MAX_BYTES) return "That clip is larger than 50 MB";

  const durationMs = Number(clip.durationMs);
  if (!Number.isFinite(durationMs) || durationMs <= 0) return "clip duration is invalid";
  if (durationMs < VIDEO_MIN_DURATION_MS) return "That clip is too short to show anything";
  if (durationMs > VIDEO_MAX_DURATION_MS) return "Choose a clip of 12 seconds or less";

  const width = Math.round(Number(clip.width));
  const height = Math.round(Number(clip.height));
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    return "clip dimensions are invalid";
  }

  return { mimeType, size, width, height, durationMs: Math.round(durationMs) };
}

interface CloudinaryConfig {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

function cloudinaryConfig(): CloudinaryConfig | null {
  const cloudName = Deno.env.get("CLOUDINARY_CLOUD_NAME");
  const apiKey = Deno.env.get("CLOUDINARY_API_KEY");
  const apiSecret = Deno.env.get("CLOUDINARY_API_SECRET");
  if (!cloudName || !apiKey || !apiSecret) return null;
  return { cloudName, apiKey, apiSecret };
}

async function sha1Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Cloudinary signatures are SHA-1 over alphabetically sorted `key=value` pairs
 * (excluding `file`, `api_key` and `resource_type`) followed by the API secret.
 * The secret never leaves this function.
 */
async function cloudinarySignature(
  params: Record<string, string>,
  apiSecret: string,
): Promise<string> {
  const toSign = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
  return sha1Hex(`${toSign}${apiSecret}`);
}

function cloudinaryAuthHeader(config: CloudinaryConfig): string {
  return `Basic ${btoa(`${config.apiKey}:${config.apiSecret}`)}`;
}

/** Confirms Cloudinary actually holds the asset before we persist metadata. */
async function cloudinaryVideoExists(
  config: CloudinaryConfig,
  publicId: string,
): Promise<boolean> {
  const endpoint =
    `https://api.cloudinary.com/v1_1/${config.cloudName}/resources/video/upload/` +
    encodeURIComponent(publicId);
  const response = await fetch(endpoint, {
    headers: { Authorization: cloudinaryAuthHeader(config) },
  });
  return response.ok;
}

/** Destroys one Cloudinary clip. Deleting a missing asset is a success. */
async function cloudinaryDestroy(
  config: CloudinaryConfig,
  publicId: string,
): Promise<void> {
  const params = {
    invalidate: "true",
    public_id: publicId,
    timestamp: String(Math.floor(Date.now() / 1000)),
  };
  const body = new URLSearchParams({
    ...params,
    api_key: config.apiKey,
    signature: await cloudinarySignature(params, config.apiSecret),
  });
  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${config.cloudName}/video/destroy`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    },
  );
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const message =
      (payload as { error?: { message?: string } } | null)?.error?.message ??
      `Cloudinary destroy failed (${response.status})`;
    // "not found" is the desired end state.
    if (/not found/i.test(message)) return;
    throw new Error(message);
  }
}

function validateVariant(input: unknown): VariantInput | string {
  if (!input || typeof input !== "object") return "Each variant must be an object";
  const v = input as Record<string, unknown>;
  const name = String(v.name ?? "");
  const mimeType = String(v.mimeType ?? "");
  const size = Number(v.size);
  const width = Number(v.width);
  const height = Number(v.height);

  if (!isVariantName(name)) return `Unknown variant "${name}"`;
  if (mimeType !== CONTENT_TYPE) return `Variant "${name}" must be ${CONTENT_TYPE}`;
  if (!Number.isFinite(size) || size < 1 || size > MAX_BYTES) {
    return `Variant "${name}" must be between 1 byte and 10 MB`;
  }
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
    return `Variant "${name}" has invalid dimensions`;
  }
  // Cap the long edge so tall/portrait images cannot bypass the size limit.
  if (Math.max(width, height) > VARIANTS[name].maxWidth) {
    return `Variant "${name}" exceeds ${VARIANTS[name].maxWidth}px`;
  }
  return { name, mimeType, size, width, height };
}

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const accountId = Deno.env.get("R2_ACCOUNT_ID");
  const accessKeyId = Deno.env.get("R2_ACCESS_KEY_ID");
  const secretAccessKey = Deno.env.get("R2_SECRET_ACCESS_KEY");
  const bucket = Deno.env.get("R2_BUCKET");
  const publicBaseUrl = Deno.env.get("R2_PUBLIC_BASE_URL")?.replace(/\/$/, "");
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicBaseUrl) {
    return json({ error: "R2 is not configured" }, 503);
  }

  const authorization = request.headers.get("Authorization");
  if (!authorization) return json({ error: "Authentication required" }, 401);

  // Supabase client running as the caller: RLS keeps every DB read/write
  // scoped to the authenticated user.
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authorization } } },
  );
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return json({ error: "Invalid session" }, 401);

  const s3 = makeS3(accountId, accessKeyId, secretAccessKey);

  try {
    const body = await request.json();
    const action = String(body.action || "");

    if (action === "create-upload") {
      const purpose = String(body.purpose || "");
      if (!isPurpose(purpose)) return json({ error: "Invalid media purpose" }, 400);

      // Permission gate: professional-only purposes require a business profile.
      if (PURPOSES[purpose].professionalOnly) {
        const { data: profile, error: profileError } = await supabase
          .from("professional_profiles")
          .select("id")
          .eq("user_id", user.id)
          .maybeSingle();
        if (profileError) throw profileError;
        if (!profile) return json({ error: "Business profile required for this upload" }, 403);
      }

      // Clips get a signed Cloudinary ticket instead of R2 presigned URLs.
      // Only the signature, timestamp and public id are signed; the secret
      // stays here and is never returned to the browser.
      if (String(body.kind || "") === "video") {
        if (String(body.provider || "cloudinary") !== "cloudinary") {
          return json({ error: "Clips are stored in Cloudinary" }, 400);
        }
        const config = cloudinaryConfig();
        if (!config) return json({ error: "Cloudinary is not configured" }, 503);

        const clip = validateVideoClip(body.clip);
        if (typeof clip === "string") return json({ error: clip }, 400);

        const mediaId = uuid();
        const publicId = `${purpose}/${mediaId}`;
        const timestamp = String(Math.floor(Date.now() / 1000));
        const signature = await cloudinarySignature(
          { public_id: publicId, timestamp },
          config.apiSecret,
        );

        return json({
          provider: "cloudinary",
          kind: "video",
          mediaId,
          purpose,
          cloudName: config.cloudName,
          uploadUrl: `https://api.cloudinary.com/v1_1/${config.cloudName}/video/upload`,
          fields: {
            api_key: config.apiKey,
            timestamp,
            signature,
            public_id: publicId,
          },
          publicId,
          expiresIn: VIDEO_TICKET_EXPIRES_SECONDS,
        });
      }

      const rawVariants = Array.isArray(body.variants) ? body.variants : [];
      if (!rawVariants.length) return json({ error: "At least one variant is required" }, 400);

      const variants: VariantInput[] = [];
      for (const raw of rawVariants) {
        const checked = validateVariant(raw);
        if (typeof checked === "string") return json({ error: checked }, 400);
        variants.push(checked);
      }

      // Unique, unpredictable object id. Never derived from user input.
      const mediaId = uuid();
      const results = [];
      for (const variant of variants) {
        const key = `${purpose}/${mediaId}/${variant.name}.webp`;
        const uploadUrl = await getSignedUrl(
          s3,
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            ContentType: CONTENT_TYPE,
          }),
          {
            expiresIn: PRESIGN_EXPIRES_SECONDS,
            // Sign ONLY the `host` header. Setting `ContentLength` on the
            // command (as before) pinned a `content-length: <size>` value into
            // the signature, but React Native's XHR uploads with a different
            // Content-Length (0/omitted), so R2 rejected every PUT with
            // SignatureDoesNotMatch. With only `host` signed, the device may
            // send any Content-Length/Content-Type. The device sets
            // Content-Type and the immutable Cache-Control as unsigned request
            // headers (see src/lib/media/uploader.ts).
            signableHeaders: new Set(["host"]),
          },
        );
        results.push({
          name: variant.name,
          key,
          uploadUrl,
          publicUrl: publicUrlFor(publicBaseUrl, key),
          width: variant.width,
          height: variant.height,
        });
      }

      return json({
        provider: "r2",
        mediaId,
        purpose,
        bucketKey: `${purpose}/${mediaId}/original.webp`,
        variants: results,
        expiresIn: PRESIGN_EXPIRES_SECONDS,
      });
    }

    if (action === "complete") {
      const purpose = String(body.purpose || "");
      const mediaId = String(body.mediaId || "");
      if (!isPurpose(purpose)) return json({ error: "Invalid media purpose" }, 400);
      if (!mediaId) return json({ error: "mediaId is required" }, 400);

      if (String(body.kind || "") === "video") {
        const config = cloudinaryConfig();
        if (!config) return json({ error: "Cloudinary is not configured" }, 503);

        const publicId = String(body.publicId || "");
        if (!publicId) return json({ error: "publicId is required" }, 400);
        // Only ids this function issued for this purpose are accepted.
        if (!publicId.startsWith(`${purpose}/`)) {
          return json({ error: "Invalid publicId" }, 400);
        }

        const clip = validateVideoClip(body.clip);
        if (typeof clip === "string") return json({ error: clip }, 400);

        // Never persist metadata for an asset Cloudinary does not actually hold.
        const exists = await cloudinaryVideoExists(config, publicId);
        if (!exists) return json({ error: "The clip was not uploaded" }, 409);

        // Retried confirmations are idempotent.
        const { data: existing, error: existingError } = await supabase
          .from("media")
          .select()
          .eq("id", mediaId)
          .maybeSingle();
        if (existingError) throw existingError;
        if (existing) return json({ provider: "cloudinary", media: existing });

        const { data: record, error: insertError } = await supabase
          .from("media")
          .insert({
            id: mediaId,
            user_id: user.id,
            provider: "cloudinary",
            bucket_key: publicId,
            media_type: purpose,
            mime_type: clip.mimeType,
            width: clip.width,
            height: clip.height,
            duration_ms: clip.durationMs,
            variants: {
              original: {
                bucket_key: publicId,
                width: clip.width,
                height: clip.height,
              },
            },
          })
          .select()
          .single();
        if (insertError) throw insertError;

        return json({ provider: "cloudinary", media: record });
      }

      const rawVariants = Array.isArray(body.variants) ? body.variants : [];
      if (!rawVariants.length) return json({ error: "At least one variant is required" }, 400);

      // Rebuild the exact keys that were issued in create-upload and confirm
      // the objects actually exist before persisting metadata.
      const variantsJson: Record<string, { bucket_key: string; width: number; height: number }> = {};
      for (const raw of rawVariants) {
        const checked = validateVariant(raw);
        if (typeof checked === "string") return json({ error: checked }, 400);
        const key = `${purpose}/${mediaId}/${checked.name}.webp`;
        let exists = true;
        try {
          await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        } catch {
          exists = false;
        }
        if (!exists) {
          return json({ error: `Variant "${checked.name}" was not uploaded` }, 409);
        }
        variantsJson[checked.name] = {
          bucket_key: key,
          width: checked.width,
          height: checked.height,
        };
      }

      const original = variantsJson.original;
      const { data: record, error: insertError } = await supabase
        .from("media")
        .insert({
          id: mediaId,
          user_id: user.id,
          bucket_key: original?.bucket_key ?? `${purpose}/${mediaId}/original.webp`,
          media_type: purpose,
          mime_type: CONTENT_TYPE,
          width: original?.width ?? 1440,
          height: original?.height ?? 1440,
          variants: variantsJson,
        })
        .select()
        .single();
      if (insertError) throw insertError;

      return json({ provider: "r2", media: record });
    }

    if (action === "delete") {
      const mediaId = String(body.mediaId || "");
      const key = String(body.key || "");
      const provider = String(body.provider || "");

      // Cloudinary clips are deleted through the Admin API, never through R2.
      if (provider === "cloudinary") {
        const config = cloudinaryConfig();
        if (!config) return json({ error: "Cloudinary is not configured" }, 503);

        const publicId = String(body.publicId || "");
        if (!publicId) return json({ error: "publicId is required" }, 400);

        // Public ids are `{purpose}/{media id}`. The `media` row is readable
        // only by its owner, so a hit proves ownership.
        const mediaIdFromPublicId = publicId.split("/")[1];
        if (isUuid(mediaIdFromPublicId ?? "")) {
          const { data: row, error: rowError } = await supabase
            .from("media")
            .select("id,bucket_key,provider")
            .eq("id", mediaIdFromPublicId)
            .maybeSingle();
          if (rowError) throw rowError;

          if (row) {
            if (row.provider !== "cloudinary" && row.bucket_key !== publicId) {
              return json({ error: "You cannot delete this asset" }, 403);
            }
            await cloudinaryDestroy(config, publicId);
            const { error: deleteError } = await supabase
              .from("media")
              .delete()
              .eq("id", row.id);
            if (deleteError) throw deleteError;
            return json({ deleted: true });
          }

          // No row: a `complete` that never landed (or a rolled-back post).
          // Removing the unguessable clip is the correct cleanup.
          await cloudinaryDestroy(config, publicId);
          return json({ deleted: true });
        }

        return json({ error: "You cannot delete this asset" }, 403);
      }

      // Preferred: delete by media id. RLS restricts the lookup to the owner.
      if (mediaId) {
        const { data: record, error: recordError } = await supabase
          .from("media")
          .select("bucket_key,variants,provider")
          .eq("id", mediaId)
          .maybeSingle();
        if (recordError) throw recordError;
        if (!record) {
          // No media row — e.g. a create-upload whose PUT failed before
          // `complete` persisted metadata. Deletes are idempotent: nothing to
          // remove, so return success and let client-side best-effort cleanup
          // finish silently instead of surfacing "Media not found".
          return json({ deleted: true });
        }

        if (record.provider === "cloudinary") {
          const config = cloudinaryConfig();
          if (!config) return json({ error: "Cloudinary is not configured" }, 503);
          await cloudinaryDestroy(config, record.bucket_key);
          const { error: deleteError } = await supabase.from("media").delete().eq("id", mediaId);
          if (deleteError) throw deleteError;
          return json({ deleted: true });
        }

        const keys = new Set<string>([record.bucket_key]);
        const variants = (record.variants ?? {}) as Record<string, { bucket_key?: string }>;
        for (const variant of Object.values(variants)) {
          if (variant?.bucket_key) keys.add(variant.bucket_key);
        }
        await Promise.allSettled(
          [...keys].map((objectKey) =>
            s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }))
          ),
        );
        const { error: deleteError } = await supabase.from("media").delete().eq("id", mediaId);
        if (deleteError) throw deleteError;
        return json({ deleted: true });
      }

      // Delete by a single object key. New-format keys embed the media id as
      // the second path segment (posts/{uuid}/feed.webp), so ownership can be
      // proven with a media-table lookup that runs under the caller's RLS.
      if (key) {
        const mediaIdFromKey = key.split("/")[1];
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(mediaIdFromKey ?? "")) {
          const { data: byKey, error: byKeyError } = await supabase
            .from("media")
            .select("id,bucket_key,variants")
            .eq("id", mediaIdFromKey)
            .maybeSingle();
          if (byKeyError) throw byKeyError;
          if (byKey) {
            const keys = new Set<string>([byKey.bucket_key]);
            const variants = (byKey.variants ?? {}) as Record<string, { bucket_key?: string }>;
            for (const variant of Object.values(variants)) {
              if (variant?.bucket_key) keys.add(variant.bucket_key);
            }
            await Promise.allSettled(
              [...keys].map((objectKey) =>
                s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }))
              ),
            );
            const { error: deleteError } = await supabase.from("media").delete().eq("id", byKey.id);
            if (deleteError) throw deleteError;
            return json({ deleted: true });
          }
          // Row not found → falls through to the legacy check below.
        }

        // Legacy format: object path embeds the caller's user id.
        const legacyPrefixes = [`avatars/${user.id}/`, `portfolio/${user.id}/`];
        const owned = legacyPrefixes.some((prefix) => key.startsWith(prefix));
        if (!owned) return json({ error: "You cannot delete this object" }, 403);
        await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
        return json({ deleted: true });
      }

      return json({ error: "mediaId or key is required" }, 400);
    }

    return json({ error: "Unknown action" }, 400);
  } catch (error) {
    console.error("media-storage", error);
    return json({ error: "Media storage request failed" }, 500);
  }
});
