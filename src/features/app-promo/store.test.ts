import { describe, expect, it } from "vitest";
import { detectPlatform, storesFor } from "./store";

const UA = {
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  iphoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.0.0 Mobile/15E148 Safari/604.1",
  iphoneInstagram:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 340.0.0.0",
  ipadDesktopMode:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
  androidTablet:
    "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  macChrome:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  windows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  chromebook:
    "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
};

describe("detectPlatform", () => {
  it("recognises iOS in Safari, Chrome and in-app browsers", () => {
    expect(detectPlatform({ userAgent: UA.iphoneSafari })).toBe("ios");
    expect(detectPlatform({ userAgent: UA.iphoneChrome })).toBe("ios");
    expect(detectPlatform({ userAgent: UA.iphoneInstagram })).toBe("ios");
  });

  it("unmasks an iPad that reports itself as a Mac", () => {
    expect(detectPlatform({ userAgent: UA.ipadDesktopMode, maxTouchPoints: 5 })).toBe("ios");
  });

  it("keeps a real Mac a Mac", () => {
    expect(detectPlatform({ userAgent: UA.ipadDesktopMode, maxTouchPoints: 0 })).toBe("mac");
    expect(detectPlatform({ userAgent: UA.macChrome, uaPlatform: "macOS" })).toBe("mac");
  });

  it("recognises Android phones and tablets", () => {
    expect(detectPlatform({ userAgent: UA.androidChrome })).toBe("android");
    expect(detectPlatform({ userAgent: UA.androidTablet })).toBe("android");
  });

  it("trusts client hints over the user-agent string", () => {
    expect(detectPlatform({ userAgent: UA.windows, uaPlatform: "Android" })).toBe("android");
  });

  it("treats Windows, ChromeOS and the unknown as desktop", () => {
    expect(detectPlatform({ userAgent: UA.windows, uaPlatform: "Windows" })).toBe("desktop");
    expect(detectPlatform({ userAgent: UA.chromebook, uaPlatform: "Chrome OS" })).toBe("desktop");
    expect(detectPlatform({ userAgent: "" })).toBe("desktop");
  });
});

describe("storesFor", () => {
  it("shows one store on a phone and both on a computer, likelier first", () => {
    expect(storesFor("ios")).toEqual(["ios"]);
    expect(storesFor("android")).toEqual(["android"]);
    expect(storesFor("mac")).toEqual(["ios", "android"]);
    expect(storesFor("desktop")).toEqual(["android", "ios"]);
  });
});
