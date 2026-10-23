"use client";

import { useMutation } from "convex/react";
import { useEffect } from "react";
import { api } from "../../../convex/_generated/api";

const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Presence heartbeat for the web.
 *
 * Online means "this tab is visible and focused, and it said so recently". A
 * hidden tab marks the account away immediately rather than waiting for the
 * stale window, and a final goodbye is sent when the page is hidden or unloaded
 * so a peer does not keep reading "Online" after someone walks away.
 *
 * Failures are swallowed: presence is a courtesy, never a reason for the
 * messaging surface to show an error.
 */
export function usePresenceHeartbeat(enabled: boolean) {
  const heartbeat = useMutation(api.presence.heartbeat);
  const goAway = useMutation(api.presence.goAway);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    let disposed = false;
    const beat = () => {
      if (disposed) return;
      if (document.visibilityState !== "visible" || !document.hasFocus()) return;
      void heartbeat({}).catch(() => undefined);
    };
    const away = () => {
      if (disposed) return;
      void goAway({}).catch(() => undefined);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") beat();
      else away();
    };
    const onFocus = () => beat();
    const onBlur = () => away();
    const onPageHide = () => away();

    beat();
    const interval = window.setInterval(beat, HEARTBEAT_INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    window.addEventListener("pagehide", onPageHide);

    return () => {
      disposed = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("pagehide", onPageHide);
      away();
    };
  }, [enabled, goAway, heartbeat]);
}
