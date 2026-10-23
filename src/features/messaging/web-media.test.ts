import { afterEach, describe, expect, test, vi } from "vitest";
import { formatBytes, uploadToConvex } from "./web-media";
import { isVoiceRecordingSupported } from "./use-voice-recorder";

/**
 * Browser plumbing that can be exercised without a real browser: the upload
 * contract with Convex storage, the progress callback, and the voice-recorder
 * capability check's honest "unsupported" answer outside a DOM.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

class FakeXhr {
  upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
  status = 0;
  responseText = "";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  mediaType = "";

  open() {}
  setRequestHeader() {}
  send() {
    this.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 } as ProgressEvent);
    this.status = 200;
    this.responseText = JSON.stringify({ storageId: "kg2abc" });
    this.onload?.();
  }
  abort() {
    this.onabort?.();
  }
}

describe("Convex upload", () => {
  test("POSTs the file and returns the storage id with progress", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXhr as unknown as typeof XMLHttpRequest);
    const progress: number[] = [];
    const storageId = await uploadToConvex(
      "https://upload.test",
      new Blob(["bytes"], { type: "image/webp" }),
      { contentType: "image/webp", onProgress: (value) => progress.push(value) },
    );

    expect(storageId).toBe("kg2abc");
    expect(progress[0]).toBe(0);
    expect(progress).toContain(0.5);
    expect(progress.at(-1)).toBe(1);
  });

  test("rejects an unreadable upload response instead of inventing an id", async () => {
    class BrokenXhr extends FakeXhr {
      send() {
        this.status = 200;
        this.responseText = "not-json";
        this.onload?.();
      }
    }
    vi.stubGlobal("XMLHttpRequest", BrokenXhr as unknown as typeof XMLHttpRequest);
    await expect(
      uploadToConvex("https://upload.test", new Blob(["x"]), { contentType: "image/webp" }),
    ).rejects.toThrow("could not be confirmed");
  });
});

describe("voice capability", () => {
  test("reports unsupported when MediaRecorder is absent", () => {
    expect(isVoiceRecordingSupported()).toBe(false);
  });
});

describe("byte copy", () => {
  test("uses human units", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});
