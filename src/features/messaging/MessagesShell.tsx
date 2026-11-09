"use client";

import { MessageCircle } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Inbox } from "./Inbox";
import { conversationIdFromPath } from "./routes";

/**
 * The messages screen on a wide window, laid out the way Instagram opens its
 * inbox: the conversation list owns a fixed left pane, the open thread fills the
 * rest, and an empty pane asks the viewer to pick a conversation when nothing is
 * open yet.
 *
 * Phones keep the two-screen flow they already had — the list at `/messages`,
 * the thread at `/messages/[id]` — because both routes still render their own
 * child here; only the arrangement changes at `lg`.
 */
export function MessagesShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const activeId = conversationIdFromPath(pathname);
  const frameRef = useVisibleViewport();

  return (
    // Phone: pinned to all four edges, so it is always exactly full height (no
    // computed height to come up short). The bottom edge lifts by the keyboard
    // while typing, so the composer stays visible. From `md` up: the card.
    <div
      ref={frameRef}
      className="fixed inset-x-0 top-[var(--vv-top,0px)] bottom-[var(--kb-inset,0px)] z-30 flex w-full flex-col overflow-hidden overscroll-none bg-surface md:static md:mx-auto md:h-[calc(100dvh-5.5rem)] md:min-h-[520px] md:flex-row md:rounded-card md:border md:border-line md:shadow-card lg:h-[calc(100dvh-7rem)] lg:min-h-[560px] lg:max-h-[900px] lg:max-w-[1120px]"
    >
      {/* The list is always on screen once there is room for two panes; on a
          phone it yields to the thread. */}
      <div
        className={cn(
          "md:flex md:min-h-0 md:w-[300px] md:shrink-0 md:flex-none md:flex-col md:border-r md:border-line lg:w-[340px] xl:w-[380px]",
          activeId ? "hidden" : "flex min-h-0 flex-1 flex-col",
        )}
      >
        <Inbox activeId={activeId} />
      </div>

      {/* Thread pane. Without a conversation this is the placeholder, which is
          only ever shown beside the list. */}
      <div
        className={cn(
          "md:flex md:min-h-0 md:flex-1 md:flex-col",
          activeId ? "flex min-h-0 flex-1 flex-col" : "hidden md:flex",
        )}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Keeps the phone frame inside the part of the screen the keyboard leaves free.
 *
 * Neither `100dvh` nor the layout viewport shrink for the on-screen keyboard
 * (and iOS Safari pans the page instead), so the frame's top follows the
 * visible viewport's offset and its bottom rises by the keyboard's height. With
 * no keyboard both are 0 and the frame is simply `inset: 0`, full height.
 *
 * While Messages is open on a phone the page behind it can't scroll either:
 * a scrolling page under a fixed frame is what makes iOS shift it around.
 */
function useVisibleViewport() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    const phone = window.matchMedia("(max-width: 767px)");
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    const lockPage = () => {
      root.style.overflow = phone.matches ? "hidden" : previousOverflow;
    };
    lockPage();
    phone.addEventListener("change", lockPage);

    const viewport = window.visualViewport;
    let frameId = 0;
    const update = () => {
      if (!viewport) return;
      cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() => {
        const top = Math.max(0, viewport.offsetTop);
        const keyboard = Math.max(0, window.innerHeight - viewport.height - top);
        frame.style.setProperty("--vv-top", `${top}px`);
        frame.style.setProperty("--kb-inset", `${keyboard}px`);
      });
    };
    update();
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frameId);
      phone.removeEventListener("change", lockPage);
      root.style.overflow = previousOverflow;
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  return ref;
}

/** What sits in the thread pane until a conversation is opened. */
export function MessagesPlaceholder() {
  return (
    <div className="hidden h-full flex-col items-center justify-center gap-3 p-10 text-center md:flex">
      <span className="flex size-24 items-center justify-center rounded-full border-2 border-line">
        <MessageCircle aria-hidden className="size-11 text-ink" />
      </span>
      <h2 className="mt-2 text-title text-ink">Your messages</h2>
      <p className="max-w-[280px] text-caption text-muted">
        Pick a conversation to keep talking, or start a new one from a professional’s profile.
      </p>
    </div>
  );
}
