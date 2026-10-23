"use client";

import { CardSkeleton, EmptyState, ErrorState } from "@/components/ui";
import { FeedCard } from "@/features/feed/FeedCard";
import { fetchSavedFeed } from "@/features/feed/api";
import type { FeedPost } from "@/features/feed/types";
import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

/**
 * Saved looks, ported from the bookmarks screen: a category rail built from
 * what you've actually saved, and unsaving removes the post from the list
 * immediately — which is the behaviour the app had.
 */
export default function BookmarksPage() {
  const router = useRouter();
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [category, setCategory] = useState("All");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    posts.forEach((post) => counts.set(post.category, (counts.get(post.category) ?? 0) + 1));
    return [...counts]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, count]) => ({ name, count }));
  }, [posts]);

  const visiblePosts = useMemo(
    () => (category === "All" ? posts : posts.filter((post) => post.category === category)),
    [category, posts],
  );

  const load = () => {
    setError(false);
    setLoading(true);
    fetchSavedFeed()
      .then((page) => setPosts(page.items))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  useEffect(() => {
    if (category !== "All" && !categories.some((item) => item.name === category)) {
      setCategory("All");
    }
  }, [categories, category]);

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label="Go back"
          onClick={() => router.back()}
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface text-ink transition active:scale-95"
        >
          <ArrowLeft aria-hidden className="size-[21px]" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-[9px] leading-[14px] font-bold tracking-[1.5px] text-primary uppercase">
            Your collection
          </p>
          <h1 className="text-[27px] leading-[35px] font-bold text-ink">Saved looks</h1>
        </div>
      </div>

      {categories.length > 0 ? (
        <div className="rail mt-8 gap-2 pr-4">
          {[{ name: "All", count: posts.length }, ...categories].map((item) => {
            const active = category === item.name;
            return (
              <button
                key={item.name}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setCategory(item.name)}
                className={
                  active
                    ? "flex min-h-[42px] shrink-0 items-center gap-[9px] rounded-full border border-primary bg-primary pr-[7px] pl-[15px] text-caption font-bold text-surface transition active:scale-[.97]"
                    : "flex min-h-[42px] shrink-0 items-center gap-[9px] rounded-full border border-line bg-surface pr-[7px] pl-[15px] text-caption font-bold text-ink transition active:scale-[.97]"
                }
              >
                {item.name}
                <span
                  className={
                    active
                      ? "flex h-7 min-w-[28px] items-center justify-center rounded-full bg-surface px-[7px] text-[10px] font-bold text-primary"
                      : "flex h-7 min-w-[28px] items-center justify-center rounded-full bg-background px-[7px] text-[10px] font-bold text-muted"
                  }
                >
                  {item.count}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="mt-4">
        {loading ? (
          <div className="flex flex-col gap-3">
            <CardSkeleton lines={2} />
            <CardSkeleton lines={2} />
          </div>
        ) : error ? (
          <ErrorState message="Your saved looks are out of reach — check your connection." onRetry={load} />
        ) : visiblePosts.length === 0 ? (
          <EmptyState
            title="Nothing saved yet"
            message="Tap the bookmark on a Discover post and it lands here, synced to your account."
            actionLabel="Browse Discover"
            actionHref="/home"
          />
        ) : (
          <div className="flex flex-col">
            {visiblePosts.map((post) => (
              <FeedCard
                key={post.id}
                post={post}
                onOpen={(item) => router.push(`/post/${item.slug ?? item.id}`)}
                onCreator={(item) => router.push(`/professional/${item.professionalId}`)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
