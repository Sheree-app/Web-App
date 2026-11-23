import { afterEach, describe, expect, it, vi } from "vitest";

// No network and no canvas: the API client and the WebP encoder are stubbed,
// and every PUT goes to a fake `fetch`.
vi.mock("@/lib/api", () => ({ api: {} }));
vi.mock("./processing", () => ({ processMediaVariants: vi.fn() }));

import { processMediaVariants } from "./processing";
import type { MediaAsset, ProcessedVariant } from "./types";
import { MediaUploadError, uploadPresignedImage } from "./uploader";

const asset: MediaAsset = {
  uri: "blob:look",
  file: new Blob(["x"], { type: "image/jpeg" }),
  mimeType: "image/jpeg",
  width: 1200,
  height: 1600,
  fileSize: 1000,
};

const variant = (name: ProcessedVariant["name"], mimeType = "image/webp"): ProcessedVariant => ({
  name,
  uri: `blob:${name}`,
  mimeType,
  blob: new Blob([name], { type: mimeType }),
  width: 100,
  height: 100,
  size: name.length,
});

const ticket = {
  photoId: "p1",
  variants: (["thumbnail", "feed", "original"] as const).map((name) => ({
    name,
    uploadUrl: `https://r2.test/${name}`,
  })),
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(processMediaVariants).mockReset();
});

describe("uploadPresignedImage", () => {
  it("presigns through the caller and PUTs every variant", async () => {
    vi.mocked(processMediaVariants).mockResolvedValue([variant("thumbnail"), variant("feed"), variant("original")]);
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const presign = vi.fn(async () => ticket);

    const result = await uploadPresignedImage(asset, presign);

    expect(presign).toHaveBeenCalledWith([
      { name: "thumbnail", mimeType: "image/webp", size: 9, width: 100, height: 100 },
      { name: "feed", mimeType: "image/webp", size: 4, width: 100, height: 100 },
      { name: "original", mimeType: "image/webp", size: 8, width: 100, height: 100 },
    ]);
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init.method])).toEqual([
      ["https://r2.test/thumbnail", "PUT"],
      ["https://r2.test/feed", "PUT"],
      ["https://r2.test/original", "PUT"],
    ]);
    expect(result.ticket.photoId).toBe("p1");
    expect(result.variants).toHaveLength(3);
  });

  it("refuses non-WebP output before asking for upload URLs", async () => {
    vi.mocked(processMediaVariants).mockResolvedValue([
      variant("thumbnail", "image/jpeg"),
      variant("feed", "image/jpeg"),
      variant("original", "image/jpeg"),
    ]);
    const presign = vi.fn();
    await expect(uploadPresignedImage(asset, presign)).rejects.toBeInstanceOf(MediaUploadError);
    expect(presign).not.toHaveBeenCalled();
  });

  it("turns a failed presign into upload copy", async () => {
    vi.mocked(processMediaVariants).mockResolvedValue([variant("thumbnail"), variant("feed"), variant("original")]);
    const presign = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(uploadPresignedImage(asset, presign)).rejects.toBeInstanceOf(MediaUploadError);
  });
});
