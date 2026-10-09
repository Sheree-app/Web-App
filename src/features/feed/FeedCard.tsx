"use client";

import { Avatar } from "@/components/ui";
import { reportPost } from "@/features/feed/api";
import type { FeedPost } from "@/features/feed/types";
import { cn } from "@/lib/utils";
import { BadgeCheck, Ellipsis, Sparkles } from "lucide-react";
import Image from "next/image";
import { memo, useState } from "react";

type Props = {
  post: FeedPost;
  onOpen: (post: FeedPost) => void;
  onCreator: (post: FeedPost) => void;
  onReported?: () => void;
};

const REPORT_REASONS = [
  "Spam or misleading",
  "Inappropriate content",
  "Harassment or safety concern",
] as const;

/**
 * One lookbook pin: the image, its category, and whose work it is.
 *
 * Matches the shipped mobile card — like, save and book live in the post
 * viewer, not on the tile — with the reporting menu promoted from a native
 * action sheet to an inline disclosure so it works with a keyboard too.
 */
function Component({ post, onOpen, onCreator, onReported }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [reported, setReported] = useState(false);
  const [reporting, setReporting] = useState(false);

  // Pin proportions stay honest to the source image, within tasteful bounds.
  // `aspectRatio` is width ÷ height, exactly as the app stores and renders it.
  const ratio = Math.min(1.05, Math.max(0.62, post.aspectRatio || 0.82));

  const submitReport = async (reason: string) => {
    setReporting(true);
    try {
      await reportPost(post.id, reason);
      setReported(true);
      onReported?.();
    } finally {
      setReporting(false);
      setMenuOpen(false);
    }
  };

  return (
    <figure className="mb-4 break-inside-avoid">
      <div
        className="relative overflow-hidden rounded-panel bg-secondary"
        style={{ aspectRatio: `${ratio}` }}
      >
        <button
          type="button"
          onClick={() => onOpen(post)}
          className="absolute inset-0 transition active:scale-[.995]"
          aria-label={`Open ${post.professionalName}'s post`}
        >
          <Image
            src={post.imageUrl}
            alt={post.caption || `${post.category} by ${post.professionalName}`}
            fill
            sizes="(min-width: 1024px) 32vw, (min-width: 768px) 45vw, 48vw"
            className="object-cover"
          />
        </button>
        <span className="pointer-events-none absolute top-2 left-2 flex min-h-[27px] max-w-[78%] items-center gap-1 rounded-full bg-raised/95 px-2.5 py-[5px] backdrop-blur-sm">
          <Sparkles aria-hidden className="size-[11px] shrink-0 text-primary" />
          <span className="truncate text-[10px] leading-[13px] font-bold text-ink">
            {post.category}
          </span>
        </span>
      </div>

      <figcaption className="flex min-h-[42px] items-center gap-2 px-1">
        <button
          type="button"
          onClick={() => onCreator(post)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <Avatar name={post.professionalName} src={post.avatarUrl} size={28} />
          <span className="truncate text-[11px] leading-[15px] font-bold text-ink">
            {post.professionalName}
          </span>
          {post.verified ? (
            <BadgeCheck aria-label="Verified" className="size-3.5 shrink-0 text-success" />
          ) : null}
        </button>

        <div className="relative">
          <button
            type="button"
            aria-label="Post options"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
            className="flex size-9 items-center justify-center rounded-full text-muted transition hover:bg-tint hover:text-ink"
          >
            <Ellipsis aria-hidden className="size-4" />
          </button>
          {menuOpen ? (
            <div className="absolute right-0 bottom-10 z-20 w-56 rounded-field bg-raised p-2 shadow-lift">
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onOpen(post);
                }}
                className="block w-full rounded-tile px-3 py-2 text-left text-caption text-ink hover:bg-tint"
              >
                View post
              </button>
              {reported ? (
                <p className="px-3 py-2 text-caption text-muted">
                  Report received. Our safety team will review this post.
                </p>
              ) : reporting ? (
                <p className="px-3 py-2 text-caption text-muted">Sending report…</p>
              ) : (
                <div className="mt-1 border-t border-line pt-1">
                  <p className="px-3 py-1 text-eyebrow text-muted uppercase">Report post</p>
                  {REPORT_REASONS.map((reason) => (
                    <button
                      key={reason}
                      type="button"
                      onClick={() => void submitReport(reason)}
                      className="block w-full rounded-tile px-3 py-2 text-left text-caption text-ink hover:bg-tint"
                    >
                      {reason}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </figcaption>
    </figure>
  );
}

export const FeedCard = memo(Component);

/** Skeleton with the same rhythm as a loaded pin, so the grid doesn't jump. */
export function FeedCardSkeleton({ tall = false }: { tall?: boolean }) {
  return (
    <div className={cn("mb-3 break-inside-avoid", tall ? "aspect-[4/5]" : "aspect-square")}>
      <div className="size-full animate-shimmer rounded-card bg-skeleton" />
      <div className="mt-2 flex items-center gap-2 px-1">
        <span className="size-7 animate-shimmer rounded-full bg-skeleton" />
        <span className="h-3 w-24 animate-shimmer rounded-tile bg-skeleton" />
      </div>
    </div>
  );
}
