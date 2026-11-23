"use client";

import { Skeleton } from "@/components/ui";
import { cn } from "@/lib/utils";
import { ArrowLeft, Camera, Images, Plus, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchLooks, type Look, type LookPrompt } from "./api";
import { lookCategory } from "./categories";
import { byMonth, monthLabel } from "./format";
import { LookTile } from "./LookTile";
import { PromptCard } from "./PromptCard";
import { useLookPrompts, useLooksFirstPage } from "./queries";

const NO_PROMPTS: LookPrompt[] = [];

/**
 * My Looks: her look diary as a photo grid, month by month, with a nudge for
 * recent Sheree bookings that don't have a photo yet.
 */
export function LooksScreen() {
  const router = useRouter();
  // The first page and the prompts come from the cache (a revisit paints at
  // once); later pages stay here. A background refresh of the first page
  // keeps them, minus anything it now holds itself.
  const firstPage = useLooksFirstPage();
  const prompts = useLookPrompts().data ?? NO_PROMPTS;
  const [more, setMore] = useState<{ items: Look[]; cursor: string | null } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filter, setFilter] = useState<string | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);

  const first = firstPage.data;
  const looks = useMemo<Look[] | null>(() => {
    if (!first) return null;
    if (!more) return first.items;
    const seen = new Set(first.items.map((l) => l.id));
    return [...first.items, ...more.items.filter((l) => !seen.has(l.id))];
  }, [first, more]);
  const cursor = more ? more.cursor : (first?.next_cursor ?? null);
  const failed = Boolean(firstPage.error) && !first;
  const load = firstPage.refetch;

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchLooks(cursor);
      setMore((current) => ({ items: [...(current?.items ?? []), ...page.items], cursor: page.next_cursor }));
    } catch {
      // Scrolling again (or the button) retries.
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, loadingMore]);

  // The next page loads as the end of the grid scrolls into view.
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !cursor || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [cursor, loadMore]);

  const categories = useMemo(() => {
    const seen = new Map<string, string>();
    for (const l of looks ?? []) if (!seen.has(l.category)) seen.set(l.category, l.category_name);
    return [...seen].map(([slug, name]) => lookCategory(slug, name));
  }, [looks]);
  const visible = useMemo(() => (looks ?? []).filter((l) => !filter || l.category === filter), [looks, filter]);
  const groups = useMemo(() => byMonth(visible), [visible]);

  return (
    <div className="flex flex-col pt-2">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label="Back"
          onClick={() => (window.history.length > 1 ? router.back() : router.push("/profile"))}
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface text-ink transition hover:bg-tint"
        >
          <ArrowLeft aria-hidden className="size-5" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-eyebrow text-primary uppercase">Your diary</p>
          <h1 className="text-[27px] leading-[34px] font-bold text-ink">My looks</h1>
        </div>
        <Link
          href="/looks/new"
          aria-label="Add a look"
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface text-ink transition hover:bg-tint"
        >
          <Plus aria-hidden className="size-6" />
        </Link>
      </div>

      {prompts.length ? (
        <div className="-mx-4 mt-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:grid md:grid-cols-2 md:overflow-visible md:px-0">
          {prompts.map((p) => (
            <PromptCard
              key={p.booking_id}
              prompt={p}
              className={cn("shrink-0 snap-start", prompts.length === 1 ? "w-full md:col-span-2" : "w-[78%] md:w-auto")}
            />
          ))}
        </div>
      ) : null}

      {categories.length > 1 ? (
        <div
          role="toolbar"
          aria-label="Filter by category"
          className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:flex-wrap md:px-0"
        >
          <FilterChip label="All" on={filter === null} onClick={() => setFilter(null)} />
          {categories.map((c) => (
            <FilterChip
              key={c.slug}
              label={c.name}
              icon={c.icon}
              color={c.color}
              on={filter === c.slug}
              onClick={() => setFilter(filter === c.slug ? null : c.slug)}
            />
          ))}
        </div>
      ) : null}

      {looks === null ? (
        failed ? (
          <div className="mt-8 flex flex-col items-start gap-3">
            <p className="text-body text-muted">We couldn’t load your looks.</p>
            <button
              type="button"
              onClick={() => void load()}
              className="rounded-full border border-line bg-surface px-4 py-2 text-caption font-bold text-ink transition hover:bg-tint"
            >
              Try again
            </button>
          </div>
        ) : (
          <div aria-busy="true" aria-label="Loading your looks" className="mt-6 grid grid-cols-3 gap-1 md:grid-cols-4 md:gap-2">
            {Array.from({ length: 9 }, (_, i) => (
              <Skeleton key={i} className="aspect-square rounded-[14px]" />
            ))}
          </div>
        )
      ) : groups.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
          <span className="mb-2 flex size-16 items-center justify-center rounded-full bg-tint text-primary">
            <Images aria-hidden className="size-[30px]" />
          </span>
          <h2 className="text-title font-bold text-ink">{filter ? "No looks here yet" : "Start your look diary"}</h2>
          <p className="max-w-sm text-caption text-muted">
            Save every hairstyle, set of nails and glam moment, with who did it and what it cost, so you can find it
            again or book it again.
          </p>
        </div>
      ) : (
        groups.map((group) => (
          <section key={group.month} aria-label={monthLabel(group.month)} className="mt-6">
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="text-body font-bold text-ink">{monthLabel(group.month)}</h2>
              <p className="text-caption text-muted">
                {group.items.length} {group.items.length === 1 ? "look" : "looks"}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-1 md:grid-cols-4 md:gap-2">
              {group.items.map((look) => (
                <LookTile key={look.id} look={look} />
              ))}
            </div>
          </section>
        ))
      )}

      {cursor ? (
        <div ref={sentinel} className="mt-6 flex justify-center">
          <button
            type="button"
            disabled={loadingMore}
            onClick={() => void loadMore()}
            className="rounded-full border border-line bg-surface px-4 py-2 text-caption text-muted transition hover:text-ink disabled:opacity-60"
          >
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        </div>
      ) : null}

      <div className="pointer-events-none sticky bottom-[calc(96px+env(safe-area-inset-bottom))] mt-8 flex justify-center md:bottom-8">
        <Link
          href="/looks/new"
          className="pointer-events-auto flex h-14 items-center gap-2 rounded-full bg-ink px-6 text-body font-bold text-surface shadow-card transition hover:brightness-110 active:scale-[.98]"
        >
          <Camera aria-hidden className="size-5" />
          Add a look
        </Link>
      </div>
    </div>
  );
}

function FilterChip({
  label,
  icon: Icon,
  color,
  on,
  onClick,
}: {
  label: string;
  icon?: LucideIcon;
  color?: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "flex h-[34px] shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] transition",
        on ? "border-ink bg-ink font-bold text-surface" : "border-line bg-surface font-medium text-ink hover:bg-tint",
      )}
    >
      {Icon ? <Icon aria-hidden className="size-3.5" style={{ color: on ? "#FFFFFF" : color }} /> : null}
      {label}
    </button>
  );
}
