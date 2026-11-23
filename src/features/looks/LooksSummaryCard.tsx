"use client";

import { cn } from "@/lib/utils";
import { ChevronRight, Images, Plus } from "lucide-react";
import Link from "next/link";
import { useLookPrompts, useLooksFirstPage } from "./queries";
import { PromptCard } from "./PromptCard";

/** The Me page's look diary teaser: the latest looks and any booking waiting for a photo. */
export function LooksSummaryCard({ className }: { className?: string }) {
  // Cached (and kept from the last visit); failures leave a plain entry point.
  const { data: page } = useLooksFirstPage();
  const prompt = useLookPrompts().data?.[0] ?? null;

  const looks = page?.items ?? [];
  const latest = looks.slice(0, 4);
  const count = looks.length ? `${looks.length}${page?.next_cursor ? "+" : ""}` : null;

  return (
    <section className={cn("rounded-card bg-surface p-4 shadow-card", className)}>
      <Link href="/looks" aria-label="Open my looks" className="flex items-center gap-3 rounded-panel">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-tint text-primary">
          <Images aria-hidden className="size-[21px]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-eyebrow text-primary">MY LOOKS{count ? ` · ${count}` : ""}</span>
          <span className="block text-title font-bold text-ink">
            {latest.length ? "Your look diary" : "Start your look diary"}
          </span>
        </span>
        <ChevronRight aria-hidden className="size-[18px] text-muted" />
      </Link>

      {latest.length ? (
        <div className="mt-3 grid grid-cols-4 gap-1.5">
          {latest.map((look) => (
            <Link
              key={look.id}
              href={`/looks/${look.id}`}
              aria-label={look.title}
              className="relative aspect-square overflow-hidden rounded-tile bg-tint"
            >
              {look.photos[0] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={look.photos[0].thumbnail}
                  alt=""
                  loading="lazy"
                  className="absolute inset-0 size-full object-cover"
                />
              ) : null}
            </Link>
          ))}
          {latest.length < 4 ? (
            <Link
              href="/looks/new"
              aria-label="Add a look"
              className="flex aspect-square items-center justify-center rounded-tile border-[1.5px] border-dashed border-primary text-primary transition hover:bg-tint"
            >
              <Plus aria-hidden className="size-6" />
            </Link>
          ) : null}
        </div>
      ) : (
        <p className="mt-2 text-caption text-muted">
          Save every hairstyle and set of nails with who did it, so you can find it, or book it, again.
        </p>
      )}

      {prompt ? <PromptCard prompt={prompt} className="mt-3" /> : null}
    </section>
  );
}
