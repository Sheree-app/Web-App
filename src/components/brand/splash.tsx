"use client";

import { Wordmark } from "@/components/brand/wordmark";
import { useEffect, useState } from "react";

const SEEN_KEY = "sheree:splash-shown";

/**
 * The launch canvas, ported from the mobile app's `ShereeSplash`.
 *
 * The native version is a Reanimated orchestration: the wordmark rises into a
 * clip band while a blush stroke sweeps beneath it. On the web the same beats
 * are CSS keyframes on a fixed Warm Ivory surface — which stays ivory in dark
 * mode on purpose, matching the native launch screen so the handoff is invisible.
 *
 * It plays once per browser session, and not at all when the visitor has asked
 * for reduced motion.
 */
export function AppSplash() {
  const [visible, setVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    let seen = false;
    try {
      seen = window.sessionStorage.getItem(SEEN_KEY) === "1";
    } catch {
      seen = true;
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (seen || reduced) return;

    try {
      window.sessionStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* ignore */
    }

    setVisible(true);
    const leave = window.setTimeout(() => setLeaving(true), 1500);
    const done = window.setTimeout(() => setVisible(false), 2000);
    return () => {
      window.clearTimeout(leave);
      window.clearTimeout(done);
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      aria-hidden
      className={`fixed inset-0 z-[100] flex items-center justify-center bg-[#FCFAF8] transition-opacity duration-500 ${
        leaving ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
    >
      <div className="relative flex flex-col items-center">
        <div className="overflow-hidden px-6 pb-1">
          <Wordmark size="xl" className="animate-rise text-[#D98C9D]" />
        </div>
        {/* The blush stroke that sweeps in under the wordmark. */}
        <span className="mt-1 h-[3px] w-[min(220px,52vw)] origin-left animate-[stroke_1.1s_cubic-bezier(.22,.61,.36,1)_both] rounded-full bg-[#F5D6DC]" />
      </div>
      <style>{`@keyframes stroke{from{transform:scaleX(0);opacity:0}to{transform:scaleX(1);opacity:1}}`}</style>
    </div>
  );
}
