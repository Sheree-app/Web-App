import { describe, expect, it } from "vitest";
import {
  cloudinaryHlsUrl,
  cloudinaryProgressiveUrl,
  cloudinaryPublicId,
  isCloudinaryUrl,
  parseCloudinaryUrl,
  videoDeliveryUrls,
} from "./video-urls";

const CLOUD = "https://res.cloudinary.com/sheree";
const PUBLIC_ID = "post/3f0b6d0e-1b0f-4a1e-9a5e-2d4b8c9f1a2b";

describe("Cloudinary public id extraction", () => {
  it("reads a plain secure_url", () => {
    expect(cloudinaryPublicId(`${CLOUD}/video/upload/v1727000000/${PUBLIC_ID}.mp4`)).toBe(PUBLIC_ID);
  });

  it("ignores delivery transformations", () => {
    expect(
      cloudinaryPublicId(`${CLOUD}/video/upload/q_auto,w_720,c_limit/${PUBLIC_ID}.mp4`),
    ).toBe(PUBLIC_ID);
  });

  it("handles transformations before the version segment", () => {
    expect(
      cloudinaryPublicId(`${CLOUD}/video/upload/q_auto,w_720/v1727000000/${PUBLIC_ID}.mp4`),
    ).toBe(PUBLIC_ID);
  });

  it("reads HLS playlists", () => {
    expect(cloudinaryPublicId(`${CLOUD}/video/upload/sp_auto/${PUBLIC_ID}.m3u8`)).toBe(PUBLIC_ID);
  });

  it("returns null for non-Cloudinary URLs", () => {
    expect(cloudinaryPublicId("https://cdn.getsheree.com/post/abc/feed.webp")).toBeNull();
    expect(
      cloudinaryPublicId(
        "https://abc.supabase.co/storage/v1/object/public/portfolio/user/clip.mp4",
      ),
    ).toBeNull();
    expect(cloudinaryPublicId("")).toBeNull();
  });

  it("exposes the cloud name and resource type", () => {
    expect(parseCloudinaryUrl(`${CLOUD}/video/upload/${PUBLIC_ID}.mp4`)).toEqual({
      cloudName: "sheree",
      resourceType: "video",
      publicId: PUBLIC_ID,
    });
  });
});

describe("progressive delivery", () => {
  it("builds the 720px MP4 rendition", () => {
    expect(cloudinaryProgressiveUrl(`${CLOUD}/video/upload/v1/${PUBLIC_ID}.mp4`)).toBe(
      `${CLOUD}/video/upload/q_auto,w_720,c_limit/${PUBLIC_ID}.mp4`,
    );
  });

  it("uses 480px when data saver is on", () => {
    expect(
      cloudinaryProgressiveUrl(`${CLOUD}/video/upload/${PUBLIC_ID}.mp4`, { dataSaver: true }),
    ).toBe(`${CLOUD}/video/upload/q_auto,w_480,c_limit/${PUBLIC_ID}.mp4`);
  });

  it("is idempotent", () => {
    const once = cloudinaryProgressiveUrl(`${CLOUD}/video/upload/${PUBLIC_ID}.mp4`);
    const twice = cloudinaryProgressiveUrl(once);
    expect(twice).toBe(once);
  });

  it("replaces an existing transformation instead of stacking one", () => {
    const hls = cloudinaryHlsUrl(`${CLOUD}/video/upload/${PUBLIC_ID}.mp4`);
    const progressive = cloudinaryProgressiveUrl(hls);
    expect(progressive).toBe(`${CLOUD}/video/upload/q_auto,w_720,c_limit/${PUBLIC_ID}.mp4`);
    expect(progressive.match(/q_auto/g)).toHaveLength(1);
  });
});

describe("adaptive delivery", () => {
  it("builds the sp_auto HLS playlist", () => {
    expect(cloudinaryHlsUrl(`${CLOUD}/video/upload/v9/${PUBLIC_ID}.mp4`)).toBe(
      `${CLOUD}/video/upload/sp_auto/${PUBLIC_ID}.m3u8`,
    );
  });

  it("is idempotent", () => {
    const once = cloudinaryHlsUrl(`${CLOUD}/video/upload/${PUBLIC_ID}.mp4`);
    expect(cloudinaryHlsUrl(once)).toBe(once);
  });
});

describe("provider detection", () => {
  it("leaves R2 and legacy Supabase URLs untouched", () => {
    const r2 = "https://cdn.getsheree.com/post/abc/feed.webp";
    expect(isCloudinaryUrl(r2)).toBe(false);
    expect(videoDeliveryUrls(r2, { hls: true })).toEqual({
      progressive: r2,
      adaptive: null,
      isCloudinary: false,
    });
  });

  it("returns both delivery forms for Cloudinary clips", () => {
    const source = `${CLOUD}/video/upload/v1/${PUBLIC_ID}.mov`;
    expect(videoDeliveryUrls(source, { hls: true })).toEqual({
      progressive: `${CLOUD}/video/upload/q_auto,w_720,c_limit/${PUBLIC_ID}.mp4`,
      adaptive: `${CLOUD}/video/upload/sp_auto/${PUBLIC_ID}.m3u8`,
      isCloudinary: true,
    });
  });

  it("omits HLS when the caller disables it", () => {
    expect(
      videoDeliveryUrls(`${CLOUD}/video/upload/${PUBLIC_ID}.mp4`, { hls: false }).adaptive,
    ).toBeNull();
  });
});
