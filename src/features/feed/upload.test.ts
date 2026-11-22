import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  uploadMedia: vi.fn(),
  deleteMedia: vi.fn(),
  prepareVideo: vi.fn(),
  uploadVideo: vi.fn(),
  resolveVideoMime: vi.fn(),
  posterAsset: vi.fn(),
  invalidateFeedQueries: vi.fn(),
  apiPost: vi.fn(),
  fetchAccount: vi.fn(),
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

vi.mock("@/lib/api", () => ({ api: { post: mocks.apiPost } }));
vi.mock("@/features/auth/api", () => ({ fetchAccount: mocks.fetchAccount }));
vi.mock("@/features/explore/api", () => ({ fetchExploreCategories: vi.fn() }));
vi.mock("./api", () => ({ invalidateFeedQueries: mocks.invalidateFeedQueries }));

import { publishFeedPost } from "./upload";

const ACCOUNT = {
  onboarding_completed: true,
  professional: { id: "prof-1", business_name: "Studio Adjoa" },
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

/** Bodies sent to `POST /v1/posts`. */
function postBodies(): Array<Record<string, unknown>> {
  return mocks.apiPost.mock.calls
    .filter(([path]) => path === "/v1/posts")
    .map(([, options]) => (options as { body: Record<string, unknown> }).body);
}

beforeEach(() => {
  Object.values(mocks).forEach((value) => {
    if (typeof value === "function" && "mockReset" in value) value.mockReset();
  });
  mocks.deleteMedia.mockResolvedValue(undefined);
  mocks.resolveVideoMime.mockReturnValue("video/mp4");
  mocks.uploadMedia.mockResolvedValue(POSTER_MEDIA);
  mocks.prepareVideo.mockResolvedValue(PREPARED);
  mocks.posterAsset.mockReturnValue({ uri: "blob:poster" });
  mocks.uploadVideo.mockResolvedValue(CLOUDINARY_VIDEO);
  mocks.fetchAccount.mockResolvedValue(ACCOUNT);
  mocks.apiPost.mockResolvedValue({ id: "post-1" });
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

    // ...and the post is built from the two upload ids.
    expect(postBodies()).toEqual([
      {
        caption: "Fresh knotless braids",
        interest_id: "interest-1",
        price_from: 100,
        service_id: null,
        video: { clip_media_id: "media-1", poster_media_id: "poster-media" },
      },
    ]);
    expect(onProgress).toHaveBeenCalledWith(1, "video");
    expect(onProgress).toHaveBeenCalledWith(1, "saving");
  });

  it("refuses before any upload when the business profile is unfinished", async () => {
    mocks.fetchAccount.mockResolvedValue({ ...ACCOUNT, onboarding_completed: false });

    await expect(publishFeedPost({ ...baseInput, video: PREPARED.file })).rejects.toThrow(
      /finish your business profile/i,
    );
    expect(mocks.uploadMedia).not.toHaveBeenCalled();
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
    expect(postBodies()).toHaveLength(0);
  });

  it("deletes the poster when the Cloudinary upload fails", async () => {
    mocks.uploadVideo.mockRejectedValue(new Error("cloudinary down"));

    await expect(publishFeedPost({ ...baseInput, video: PREPARED.file })).rejects.toThrow(
      "cloudinary down",
    );

    expect(mocks.deleteMedia).toHaveBeenCalledWith(POSTER_MEDIA);
    expect(postBodies()).toHaveLength(0);
  });

  it("deletes the clip and the poster when creating the post fails", async () => {
    mocks.apiPost.mockRejectedValue(new Error("insert failed"));

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
  it("creates the post from the picture upload ids, in order", async () => {
    mocks.uploadMedia
      .mockResolvedValueOnce({ ...POSTER_MEDIA, mediaId: "pic-1" })
      .mockResolvedValueOnce({ ...POSTER_MEDIA, mediaId: "pic-2" });

    await publishFeedPost({
      ...baseInput,
      assets: [
        { uri: "blob:a", width: 1000, height: 1250 },
        { uri: "blob:b", width: 1000, height: 1000 },
      ],
    });

    expect(mocks.uploadMedia).toHaveBeenCalledTimes(2);
    expect(postBodies()).toEqual([
      {
        caption: "Fresh knotless braids",
        interest_id: "interest-1",
        price_from: 100,
        service_id: null,
        image_media_ids: ["pic-1", "pic-2"],
      },
    ]);
    expect(mocks.invalidateFeedQueries).toHaveBeenCalled();
  });

  it("deletes the uploaded pictures when creating the post fails", async () => {
    mocks.apiPost.mockRejectedValue(new Error("post failed"));

    await expect(
      publishFeedPost({
        ...baseInput,
        assets: [{ uri: "blob:a", width: 1000, height: 1250 }],
      }),
    ).rejects.toMatchObject({ message: "post failed" });

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
