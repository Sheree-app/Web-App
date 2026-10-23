"use client";

import { MessageCircle } from "lucide-react";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
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

  return (
    <div className="mx-auto flex h-[calc(100dvh-11rem)] min-h-[460px] w-full max-w-[520px] flex-col overflow-hidden rounded-card border border-line bg-surface shadow-card md:h-[calc(100dvh-5.5rem)] md:min-h-[520px] md:max-w-none md:flex-row lg:h-[calc(100dvh-7rem)] lg:min-h-[560px] lg:max-h-[900px] lg:max-w-[1120px]">
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
