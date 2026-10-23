import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetClipRegistry,
  decidePlayback,
  registerClip,
  updateClip,
  type ClipVisibilityEntry,
} from "./video-visibility";

function entry(overrides: Partial<ClipVisibilityEntry> & { id: string }): ClipVisibilityEntry {
  return {
    visible: 0,
    autoplay: true,
    playing: false,
    manual: false,
    ...overrides,
  };
}

describe("clip autoplay coordination", () => {
  it("starts only the most visible autoplay-eligible clip", () => {
    const decision = decidePlayback([
      entry({ id: "a", visible: 0.7 }),
      entry({ id: "b", visible: 0.95 }),
      entry({ id: "c", visible: 0.2 }),
    ]);

    expect(decision.start).toEqual(["b"]);
    expect(decision.pause).toEqual([]);
  });

  it("does not start a clip below the visibility threshold", () => {
    const decision = decidePlayback([entry({ id: "a", visible: 0.4 })]);
    expect(decision.start).toEqual([]);
  });

  it("does not autoplay a clip that opts out", () => {
    const decision = decidePlayback([
      entry({ id: "a", visible: 1, autoplay: false }),
      entry({ id: "b", visible: 0.65, autoplay: true }),
    ]);
    expect(decision.start).toEqual(["b"]);
  });

  it("pauses a playing clip when another becomes the best candidate", () => {
    const decision = decidePlayback([
      entry({ id: "a", visible: 0.2, playing: true }),
      entry({ id: "b", visible: 0.9 }),
    ]);

    expect(decision.start).toEqual(["b"]);
    expect(decision.pause).toEqual(["a"]);
  });

  it("keeps a manually started clip while it is still on screen", () => {
    const decision = decidePlayback([
      entry({ id: "a", visible: 0.75, playing: true, manual: true }),
      entry({ id: "b", visible: 0.95 }),
    ]);

    expect(decision.start).toEqual([]);
    expect(decision.pause).toEqual([]);
  });

  it("pauses a manual clip once it scrolls away and starts the visible one", () => {
    const decision = decidePlayback([
      entry({ id: "a", visible: 0.1, playing: true, manual: true }),
      entry({ id: "b", visible: 0.9 }),
    ]);

    expect(decision.start).toEqual(["b"]);
    expect(decision.pause).toEqual(["a"]);
  });

  it("pauses everything when no clip is visible", () => {
    const decision = decidePlayback([
      entry({ id: "a", visible: 0.1, playing: true }),
      entry({ id: "b", visible: 0.05, playing: true }),
    ]);

    expect(decision.start).toEqual([]);
    expect(decision.pause).toEqual(["a", "b"]);
  });

  it("never starts more than one clip", () => {
    const decision = decidePlayback([
      entry({ id: "a", visible: 0.9 }),
      entry({ id: "b", visible: 0.9 }),
      entry({ id: "c", visible: 0.9 }),
    ]);

    expect(decision.start).toHaveLength(1);
  });

  it("keeps a manually started clip that is only partly on screen", () => {
    // A tap is an explicit request; the autoplay threshold must not cancel it.
    const decision = decidePlayback([
      entry({ id: "a", visible: 0.35, playing: true, manual: true }),
      entry({ id: "b", visible: 0.9 }),
    ]);

    expect(decision.start).toEqual([]);
    expect(decision.pause).toEqual([]);
  });

  it("keeps a manually started clip that has not been measured yet", () => {
    const decision = decidePlayback([
      entry({ id: "a", visible: 0, measured: false, playing: true, manual: true }),
    ]);

    expect(decision.pause).toEqual([]);
  });
});

describe("clip registry", () => {
  beforeEach(() => {
    __resetClipRegistry();
  });

  it("does not pause a tap that lands before the first observation", () => {
    const start = vi.fn();
    const pause = vi.fn();
    registerClip("clip", { start, pause }, { autoplay: false });

    updateClip("clip", { playing: true, manual: true });

    expect(pause).not.toHaveBeenCalled();
  });

  it("pauses a manual clip once it has left the screen", () => {
    const start = vi.fn();
    const pause = vi.fn();
    registerClip("clip", { start, pause }, { autoplay: false });

    updateClip("clip", { visible: 0.8 });
    updateClip("clip", { playing: true, manual: true });
    expect(pause).not.toHaveBeenCalled();

    updateClip("clip", { visible: 0 });
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it("keeps the playback state of a re-registered clip", () => {
    const handlers = { start: vi.fn(), pause: vi.fn() };
    registerClip("clip", handlers, { autoplay: true });
    updateClip("clip", { visible: 0.9, playing: true, manual: true });

    // The registering effect re-runs when the reduced-motion preference lands.
    registerClip("clip", handlers, { autoplay: false });

    expect(handlers.pause).not.toHaveBeenCalled();
    updateClip("clip", { visible: 0.9 });
    expect(handlers.start).not.toHaveBeenCalled();
  });
});
