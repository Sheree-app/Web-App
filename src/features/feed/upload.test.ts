import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  uploadMedia: vi.fn(),
  deleteMedia: vi.fn(),
  prepareVideo: vi.fn(),
  uploadVideo: vi.fn(),
  resolveVideoMime: vi.fn(),
  posterAsset: vi.fn(),
  invalidateFeedQueries: vi.fn(),
  supabase: {
    auth: { getUser: vi.fn() },
    from: vi.fn(),
  },
}));

vi.mock("@/lib/media", () => ({
  uploadMedia: mocks.uploadMedia,
  deleteMedia: mocks.deleteMedia,
  feedUrl: (media: { bucketKey: string }) => `https://cdn.test/${media.bucketKey}`,
}));

vi.mock("@/lib/media/video", () => {
  class VideoValidationError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "VideoValidationError";
    }
  }
  return {
    MAX_VIDEO_BYTES: 50 * 1024 * 1024,
    VIDEO_MESSAGES: {
      unsupported: "Clips have to be MP4 or MOV.",
      tooShort: "That clip is too short to show anything.",
      tooLong: "Choose a clip of 12 seconds or less.",
      tooLarge: "That clip is larger than 50 MB.",
      unreadable: "That clip could not be read. Record it again.",
    },
    VideoValidationError,
    resolveVideoMime: mocks.resolveVideoMime,
    prepareVideo: mocks.prepareVideo,
    posterAsset: mocks.posterAsset,
    uploadVideo: mocks.uploadVideo,
  };
});

vi.mock("@/lib/supabase", () => ({ supabase: mocks.supabase }));
vi.mock("./api", () => ({ invalidateFeedQueries: mocks.invalidateFeedQueries }));

import { publishFeedPost } from "./upload";

type Action = { table: string; action: string; payload?: unknown };

const PROFILE = {
  id: "prof-1",
  business_name: "Studio Adjoa",
  onboarding_completed_at: "2026-01-01T00:00:00Z",
  deleted_at: null,
};

const POSTER_MEDIA = {
  provider: "r2" as const,
  mediaId: "poster-media",
  purpose: "post" as const,
  bucketKey: "post/poster-media/original.webp",
  width: 1080,
  height: 1920,
  variants: {
    thumbnail: { key: "t", publicUrl: "https://cdn.test/t", width: 320, height: 568 },
    feed: { key: "f", publicUrl: "https://cdn.test/f", width: 720, height: 1280 },
    original: { key: "o", publicUrl: "https://cdn.test/o", width: 1080, height: 1920 },
  },
  publicUrl: "https://cdn.test/o",
};

const PREPARED = {
  file: new File(["clip"], "clip.mp4", { type: "video/mp4" }),
  fileName: "clip.mp4",
  clip: { mimeType: "video/mp4", size: 1000, width: 1080, height: 1920, durationMs: 8400 },
  poster: {
    blob: new Blob(["poster"], { type: "image/webp" }),
    mimeType: "image/webp",
    width: 1080,
    height: 1920,
    uri: "blob:poster",
  },
};

const CLOUDINARY_VIDEO = {
  provider: "cloudinary" as const,
  mediaId: "media-1",
  publicId: "post/media-1",
  url: "https://res.cloudinary.com/sheree/video/upload/v1/post/media-1.mp4",
  mimeType: "video/mp4",
  durationMs: 8400,
  width: 1080,
  height: 1920,
};

let actions: Action[] = [];

function installSupabase(options: {
  profile?: { data: unknown; error: unknown };
  insertResults?: Record<string, { data: unknown; error: unknown }>;
}) {
  actions = [];
  mocks.supabase.auth.getUser.mockResolvedValue({
    data: { user: { id: "user-1" } },
    error: null,
  });
  mocks.supabase.from.mockImplementation((table: string) => {
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.order = () => chain;
    chain.in = () => chain;
    chain.insert = (payload: unknown) => {
      actions.push({ table, action: "insert", payload });
      chain._result = options.insertResults?.[table] ?? {
        data: { id: `${table}-1` },
        error: null,
      };
      return chain;
    };
    chain.delete = () => {
      actions.push({ table, action: "delete" });
      chain._result = { data: null, error: null };
      return chain;
    };
    chain.single = async () => {
      if (table === "professional_profiles") {
        return options.profile ?? { data: PROFILE, error: null };
      }
      return chain._result ?? { data: { id: "feed_posts-1" }, error: null };
    };
    chain.maybeSingle = async () => chain._result ?? { data: null, error: null };
    chain.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(chain._result ?? { data: null, error: null }).then(resolve, reject);
    return chain;
  });
}

function inserts(table: string): Array<Record<string, unknown>> {
  return actions
    .filter((action) => action.table === table && action.action === "insert")
    .map((action) => action.payload as Record<string, unknown>);
}

beforeEach(() => {
  Object.values(mocks).forEach((value) => {
    if (typeof value === "function" && "mockReset" in value) value.mockReset();
  });
  mocks.supabase.from.mockReset();
  mocks.supabase.auth.getUser.mockReset();
  mocks.deleteMedia.mockResolvedValue(undefined);
  mocks.resolveVideoMime.mockReturnValue("video/mp4");
  mocks.uploadMedia.mockResolvedValue(POSTER_MEDIA);
  mocks.prepareVideo.mockResolvedValue(PREPARED);
  mocks.posterAsset.mockReturnValue({ uri: "blob:poster" });
  mocks.uploadVideo.mockResolvedValue(CLOUDINARY_VIDEO);
  installSupabase({});
});

const baseInput = {
  caption: "Fresh knotless braids",
  interestId: "interest-1",
  priceFrom: 100,
};

describe("publishing a video post", () => {
  it("uploads the poster through the image pipeline, then the clip to Cloudinary", async () => {
    const onProgress = vi.fn();
    await publishFeedPost({ ...baseInput, video: PREPARED.file }, onProgress);

    // The poster went through the ordinary image pipeline...
    expect(mocks.uploadMedia).toHaveBeenCalledTimes(1);
    expect(mocks.uploadMedia.mock.calls[0][0]).toBe("post");
    expect(mocks.posterAsset).toHaveBeenCalledWith(PREPARED.poster, "poster.webp");

    // ...the bytes went straight to Cloudinary...
    expect(mocks.uploadVideo).toHaveBeenCalledWith(PREPARED.file, PREPARED.clip, {
      purpose: "post",
    });

    // ...and the post row carries the clip metadata.
    const [post] = inserts("feed_posts");
    expect(post).toMatchObject({
      professional_id: "prof-1",
      interest_id: "interest-1",
      image_url: "https://cdn.test/post/poster-media/original.webp",
      caption: "Fresh knotless braids",
      price_from: 100,
      aspect_ratio: 0.5625,
      video_url: CLOUDINARY_VIDEO.url,
      video_duration_ms: 8400,
    });
    expect(onProgress).toHaveBeenCalledWith(1, "video");
    expect(onProgress).toHaveBeenCalledWith(1, "saving");
  });

  it("never inserts feed_post_images for a clip", async () => {
    await publishFeedPost({ ...baseInput, video: PREPARED.file });
    expect(inserts("feed_post_images")).toHaveLength(0);
  });

  it("clamps the aspect ratio to the product bounds", async () => {
    mocks.prepareVideo.mockResolvedValue({
      ...PREPARED,
      clip: { ...PREPARED.clip, width: 400, height: 2000 }, // 0.2 → clamped to 0.4
    });

    await publishFeedPost({ ...baseInput, video: PREPARED.file });

    expect(inserts("feed_posts")[0].aspect_ratio).toBe(0.4);
  });

  it("rejects a post containing both pictures and a clip", async () => {
    await expect(
      publishFeedPost({
        ...baseInput,
        video: PREPARED.file,
        assets: [{ uri: "blob:a", width: 100, height: 100 }],
      }),
    ).rejects.toThrow(/either pictures or one clip/i);

    expect(mocks.uploadMedia).not.toHaveBeenCalled();
  });

  it("rejects an unsupported container before any upload", async () => {
    mocks.resolveVideoMime.mockReturnValue(null);

    await expect(publishFeedPost({ ...baseInput, video: PREPARED.file })).rejects.toThrow(
      "Clips have to be MP4 or MOV.",
    );

    expect(mocks.prepareVideo).not.toHaveBeenCalled();
    expect(mocks.uploadMedia).not.toHaveBeenCalled();
  });
});

describe("rollback", () => {
  it("does not upload the clip when the poster fails", async () => {
    mocks.uploadMedia.mockRejectedValue(new Error("poster upload failed"));

    await expect(publishFeedPost({ ...baseInput, video: PREPARED.file })).rejects.toThrow(
      "poster upload failed",
    );

    expect(mocks.uploadVideo).not.toHaveBeenCalled();
    expect(inserts("feed_posts")).toHaveLength(0);
  });

  it("deletes the poster when the Cloudinary upload fails", async () => {
    mocks.uploadVideo.mockRejectedValue(new Error("cloudinary down"));

    await expect(publishFeedPost({ ...baseInput, video: PREPARED.file })).rejects.toThrow(
      "cloudinary down",
    );

    expect(mocks.deleteMedia).toHaveBeenCalledWith(POSTER_MEDIA);
    expect(inserts("feed_posts")).toHaveLength(0);
  });

  it("deletes the clip and the poster when the post insert fails", async () => {
    installSupabase({
      insertResults: { feed_posts: { data: null, error: { message: "insert failed" } } },
    });

    await expect(publishFeedPost({ ...baseInput, video: PREPARED.file })).rejects.toMatchObject({
      message: "insert failed",
    });

    expect(mocks.deleteMedia).toHaveBeenCalledWith(POSTER_MEDIA);
    expect(mocks.deleteMedia).toHaveBeenCalledWith({
      provider: "cloudinary",
      publicId: "post/media-1",
    });
  });

  it("still surfaces the original error when cleanup also fails", async () => {
    mocks.uploadVideo.mockRejectedValue(new Error("cloudinary down"));
    mocks.deleteMedia.mockRejectedValue(new Error("cleanup failed"));

    await expect(publishFeedPost({ ...baseInput, video: PREPARED.file })).rejects.toThrow(
      "cloudinary down",
    );
  });
});

describe("publishing a picture post", () => {
  it("inserts the post and its attachments", async () => {
    await publishFeedPost({
      ...baseInput,
      assets: [
        { uri: "blob:a", width: 1000, height: 1250 },
        { uri: "blob:b", width: 1000, height: 1000 },
      ],
    });

    expect(mocks.uploadMedia).toHaveBeenCalledTimes(2);
    const [post] = inserts("feed_posts");
    expect(post).toMatchObject({ image_url: `https://cdn.test/${POSTER_MEDIA.bucketKey}` });
    const imageBatches = inserts("feed_post_images");
    expect(imageBatches).toHaveLength(1);
    const images = imageBatches[0] as unknown as Array<Record<string, unknown>>;
    expect(images).toHaveLength(2);
    expect(images[0]).toMatchObject({ post_id: "feed_posts-1", sort_order: 0 });
  });

  it("removes the post row when attachments fail", async () => {
    installSupabase({
      insertResults: {
        feed_post_images: { data: null, error: { message: "attachment failed" } },
      },
    });

    await expect(
      publishFeedPost({
        ...baseInput,
        assets: [{ uri: "blob:a", width: 1000, height: 1250 }],
      }),
    ).rejects.toMatchObject({ message: "attachment failed" });

    expect(
      actions.some((action) => action.table === "feed_posts" && action.action === "delete"),
    ).toBe(true);
    expect(mocks.deleteMedia).toHaveBeenCalledWith(POSTER_MEDIA);
  });

  it("enforces the 1–8 picture limit", async () => {
    await expect(publishFeedPost({ ...baseInput, assets: [] })).rejects.toThrow(
      /between 1 and 8 pictures/i,
    );

    await expect(
      publishFeedPost({
        ...baseInput,
        assets: Array.from({ length: 9 }, () => ({ uri: "blob:a", width: 100, height: 100 })),
      }),
    ).rejects.toThrow(/between 1 and 8 pictures/i);
  });
});
