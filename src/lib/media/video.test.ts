import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  completeVideoUpload,
  deleteCloudinaryVideo,
  formatClipDuration,
  generateVideoPoster,
  MAX_VIDEO_BYTES,
  measureVideo,
  posterAsset,
  posterCaptureTime,
  posterSize,
  requestVideoUploadTicket,
  resolveVideoMime,
  uploadVideo,
  uploadVideoToCloudinary,
  validateVideoClip,
  VideoValidationError,
  VIDEO_MESSAGES,
} from "./video";

const invoke = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  supabase: {
    functions: {
      invoke: (...args: unknown[]) => invoke(...args),
    },
  },
}));

const CLIP = {
  mimeType: "video/mp4",
  size: 1_200_000,
  width: 1080,
  height: 1920,
  durationMs: 8_400,
};

const TICKET = {
  provider: "cloudinary" as const,
  kind: "video" as const,
  mediaId: "media-1",
  purpose: "post" as const,
  cloudName: "sheree",
  uploadUrl: "https://api.cloudinary.com/v1_1/sheree/video/upload",
  fields: {
    api_key: "key",
    timestamp: "1700000000",
    signature: "sig",
    public_id: "post/media-1",
  },
  publicId: "post/media-1",
  expiresIn: 60,
};

beforeEach(() => {
  invoke.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("container validation", () => {
  it("accepts MP4", () => {
    expect(resolveVideoMime({ type: "video/mp4", name: "clip.mp4" })).toBe("video/mp4");
  });

  it("accepts MOV (including the X-M4V variant)", () => {
    expect(resolveVideoMime({ type: "video/quicktime", name: "clip.mov" })).toBe(
      "video/quicktime",
    );
    expect(resolveVideoMime({ type: "video/x-m4v", name: "clip.m4v" })).toBe("video/mp4");
  });

  it("falls back to the extension only for a generic MIME type", () => {
    expect(resolveVideoMime({ type: "", name: "clip.mov" })).toBe("video/quicktime");
    expect(resolveVideoMime({ type: "application/octet-stream", name: "clip.M4V" })).toBe(
      "video/mp4",
    );
  });

  it("rejects WebM, AVI and unknown files", () => {
    expect(resolveVideoMime({ type: "video/webm", name: "clip.webm" })).toBeNull();
    expect(resolveVideoMime({ type: "video/x-msvideo", name: "clip.avi" })).toBeNull();
    expect(resolveVideoMime({ type: "", name: "clip.webm" })).toBeNull();
    expect(resolveVideoMime({ type: "", name: "notes.txt" })).toBeNull();
  });

  it("rejects a WebM file that lies about its extension", () => {
    expect(resolveVideoMime({ type: "video/webm", name: "clip.mp4" })).toBeNull();
  });
});

describe("clip validation", () => {
  it("accepts a valid clip", () => {
    expect(validateVideoClip(CLIP)).toEqual(CLIP);
  });

  it("rejects an unsupported container with the product wording", () => {
    expect(() => validateVideoClip({ ...CLIP, mimeType: "video/webm" })).toThrow(
      VIDEO_MESSAGES.unsupported,
    );
  });

  it("rejects a clip larger than 50 MB", () => {
    expect(() => validateVideoClip({ ...CLIP, size: MAX_VIDEO_BYTES + 1 })).toThrow(
      VIDEO_MESSAGES.tooLarge,
    );
  });

  it("rejects a clip shorter than 500 ms", () => {
    expect(() => validateVideoClip({ ...CLIP, durationMs: 499 })).toThrow(
      VIDEO_MESSAGES.tooShort,
    );
  });

  it("accepts exactly 500 ms", () => {
    expect(validateVideoClip({ ...CLIP, durationMs: 500 }).durationMs).toBe(500);
  });

  it("accepts exactly 12 seconds", () => {
    expect(validateVideoClip({ ...CLIP, durationMs: 12_000 }).durationMs).toBe(12_000);
  });

  it("rejects a clip longer than 12 seconds", () => {
    expect(() => validateVideoClip({ ...CLIP, durationMs: 12_001 })).toThrow(
      VIDEO_MESSAGES.tooLong,
    );
  });

  it("rejects unreadable duration metadata", () => {
    expect(() => validateVideoClip({ ...CLIP, durationMs: Number.NaN })).toThrow(
      VideoValidationError,
    );
    expect(() => validateVideoClip({ ...CLIP, durationMs: Infinity })).toThrow(
      VIDEO_MESSAGES.unreadable,
    );
  });
});

describe("duration label", () => {
  it("formats the feed labels", () => {
    expect(formatClipDuration(7_000)).toBe("0:07");
    expect(formatClipDuration(12_000)).toBe("0:12");
    expect(formatClipDuration(null)).toBe("0:00");
  });
});

describe("poster handoff", () => {
  it("captures the frame at roughly 20% of the clip", () => {
    expect(posterCaptureTime(8_400)).toBeCloseTo(1.68, 5);
    expect(posterCaptureTime(8_400, 0.2)).toBeCloseTo(1.68, 5);
  });

  it("never seeks to the final frame", () => {
    expect(posterCaptureTime(500)).toBeCloseTo(0.1, 5);
    expect(posterCaptureTime(50)).toBe(0);
  });

  it("caps the poster's long edge at 1440px", () => {
    expect(posterSize(2160, 3840)).toEqual({ width: 810, height: 1440 });
    expect(posterSize(1080, 1920)).toEqual({ width: 810, height: 1440 });
    expect(posterSize(4000, 2000)).toEqual({ width: 1440, height: 720 });
    // Smaller sources are never upscaled.
    expect(posterSize(720, 1280)).toEqual({ width: 720, height: 1280 });
  });

  it("maps the captured poster onto the image pipeline asset", () => {
    const blob = new Blob(["poster"], { type: "image/webp" });
    const asset = posterAsset(
      { blob, mimeType: "image/webp", width: 1080, height: 1920, uri: "blob:poster" },
      "poster.webp",
    );
    expect(asset).toMatchObject({
      uri: "blob:poster",
      file: blob,
      fileName: "poster.webp",
      mimeType: "image/webp",
      width: 1080,
      height: 1920,
      fileSize: blob.size,
    });
  });

  it("refuses to read clips without a DOM document", async () => {
    await expect(
      measureVideo(new Blob(["x"], { type: "video/mp4" })),
    ).rejects.toThrow(VIDEO_MESSAGES.unreadable);
    await expect(
      generateVideoPoster(new Blob(["x"], { type: "video/mp4" }), { durationMs: 8_000 }),
    ).rejects.toThrow(VIDEO_MESSAGES.unreadable);
  });
});

describe("signed Cloudinary upload contract", () => {
  it("requests a video ticket from media-storage", async () => {
    invoke.mockResolvedValue({ data: TICKET, error: null });

    const ticket = await requestVideoUploadTicket(CLIP);

    expect(invoke).toHaveBeenCalledTimes(1);
    const [fnName, options] = invoke.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(fnName).toBe("media-storage");
    expect(options.body).toEqual({
      action: "create-upload",
      kind: "video",
      provider: "cloudinary",
      purpose: "post",
      clip: CLIP,
    });
    expect(ticket).toEqual(TICKET);
  });

  it("fails clearly when the ticket is malformed", async () => {
    invoke.mockResolvedValue({ data: { whatever: true }, error: null });
    await expect(requestVideoUploadTicket(CLIP)).rejects.toThrow(/unavailable/i);
  });

  it("posts every signed field plus the file straight to Cloudinary", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        secure_url: "https://res.cloudinary.com/sheree/video/upload/v1/post/media-1.mp4",
        public_id: "post/media-1",
        duration: 8.4,
        width: 1080,
        height: 1920,
        bytes: 1_200_000,
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const file = new Blob(["clip-bytes"], { type: "video/mp4" });
    const result = await uploadVideoToCloudinary(file, TICKET);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(TICKET.uploadUrl);
    expect(init.method).toBe("POST");
    expect(init.headers).toBeUndefined(); // the browser sets the multipart boundary

    const form = init.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    for (const [key, value] of Object.entries(TICKET.fields)) {
      expect(form.get(key)).toBe(value);
    }
    expect(form.get("file")).toBeInstanceOf(Blob);
    expect(form.get("api_secret")).toBeNull();

    expect(result).toMatchObject({
      secureUrl: "https://res.cloudinary.com/sheree/video/upload/v1/post/media-1.mp4",
      publicId: "post/media-1",
      durationMs: 8_400,
      width: 1080,
      height: 1920,
    });
  });

  it("surfaces a Cloudinary rejection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 400,
        json: async () => ({ error: { message: "Invalid Signature" } }),
      })),
    );
    await expect(
      uploadVideoToCloudinary(new Blob(["x"]), TICKET),
    ).rejects.toThrow("Invalid Signature");
  });

  it("confirms the clip with media-storage", async () => {
    invoke.mockResolvedValue({
      data: { provider: "cloudinary", media: { id: "media-1", bucket_key: "post/media-1" } },
      error: null,
    });

    await completeVideoUpload(TICKET, CLIP);

    const [, options] = invoke.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(options.body).toEqual({
      action: "complete",
      kind: "video",
      provider: "cloudinary",
      purpose: "post",
      mediaId: "media-1",
      publicId: "post/media-1",
      clip: CLIP,
    });
  });

  it("deletes the uploaded clip when confirmation fails", async () => {
    invoke
      .mockResolvedValueOnce({ data: TICKET, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "registry down" } })
      .mockResolvedValueOnce({ data: { deleted: true }, error: null });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          secure_url: "https://res.cloudinary.com/sheree/video/upload/v1/post/media-1.mp4",
          public_id: "post/media-1",
          duration: 8.4,
          width: 1080,
          height: 1920,
        }),
      })),
    );

    await expect(uploadVideo(new Blob(["x"], { type: "video/mp4" }), CLIP)).rejects.toThrow(
      "registry down",
    );

    const [, deleteOptions] = invoke.mock.calls[2] as [string, { body: Record<string, unknown> }];
    expect(deleteOptions.body).toEqual({
      action: "delete",
      provider: "cloudinary",
      publicId: "post/media-1",
    });
  });

  it("runs ticket → direct upload → confirmation", async () => {
    invoke.mockResolvedValueOnce({ data: TICKET, error: null }).mockResolvedValueOnce({
      data: { provider: "cloudinary", media: { id: "media-1", bucket_key: "post/media-1" } },
      error: null,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          secure_url: "https://res.cloudinary.com/sheree/video/upload/v1/post/media-1.mp4",
          public_id: "post/media-1",
          duration: 8.4,
          width: 1080,
          height: 1920,
        }),
      })),
    );

    const uploaded = await uploadVideo(new Blob(["x"], { type: "video/mp4" }), CLIP);

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(uploaded).toMatchObject({
      provider: "cloudinary",
      mediaId: "media-1",
      publicId: "post/media-1",
      url: "https://res.cloudinary.com/sheree/video/upload/v1/post/media-1.mp4",
      durationMs: 8_400,
    });
  });
});

describe("clip deletion", () => {
  it("sends the extracted public id to media-storage", async () => {
    invoke.mockResolvedValue({ data: { deleted: true }, error: null });

    await deleteCloudinaryVideo(
      "https://res.cloudinary.com/sheree/video/upload/q_auto,w_720/v3/post/media-1.mp4",
    );

    const [, options] = invoke.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(options.body).toEqual({
      action: "delete",
      provider: "cloudinary",
      publicId: "post/media-1",
    });
  });
});
