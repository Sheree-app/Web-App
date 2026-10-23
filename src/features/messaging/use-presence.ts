"use client";

import { useMutation } from "convex/react";
import { useCallback, useEffect, useRef } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

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

/**
 * Debounced typing state.
 *
 * At most one write every two seconds while the person keeps typing, and an
 * explicit stop on send, blur, navigation, or after a short idle period. The
 * server row expires anyway; this keeps the indicator responsive without
 * turning keystrokes into writes.
 */
export function useTypingIndicator(
  conversationId: Id<"conversations">,
  options: { enabled?: boolean } = {},
) {
  const enabled = options.enabled ?? true;
  const setTyping = useMutation(api.typing.setTyping);
  const typingRef = useRef(false);
  const lastBeatRef = useRef(0);
  const idleRef = useRef<number | null>(null);

  const clearIdle = useCallback(() => {
    if (idleRef.current !== null) {
      window.clearTimeout(idleRef.current);
      idleRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    clearIdle();
    if (!typingRef.current) return;
    typingRef.current = false;
    void setTyping({ conversationId, typing: false }).catch(() => undefined);
  }, [clearIdle, conversationId, setTyping]);

  const ping = useCallback(
    (hasText: boolean) => {
      if (!enabled) return;
      if (!hasText) {
        stop();
        return;
      }
      const now = Date.now();
      if (!typingRef.current || now - lastBeatRef.current > 2_000) {
        typingRef.current = true;
        lastBeatRef.current = now;
        void setTyping({ conversationId, typing: true }).catch(() => undefined);
      }
      clearIdle();
      idleRef.current = window.setTimeout(stop, 3_000);
    },
    [clearIdle, conversationId, enabled, setTyping, stop],
  );

  // Leaving the thread (route change, tab close) must not leave a stale marker.
  useEffect(
    () => () => {
      clearIdle();
      if (typingRef.current) {
        void setTyping({ conversationId, typing: false }).catch(() => undefined);
      }
    },
    [clearIdle, conversationId, setTyping],
  );

  return { ping, stop };
}
