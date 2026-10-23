"use client";

import { CardSkeleton, Spinner } from "@/components/ui";
import { FeedCard } from "@/features/feed/FeedCard";
import { fetchFeed } from "@/features/feed/api";
import { fetchUnreadNotificationCount } from "@/features/notifications/api";
import { MessageLink } from "@/features/messaging/MessageLink";
import type { FeedPost } from "@/features/feed/types";
import { useAuth } from "@/providers/auth-provider";
import { Bell, CloudOff, Images } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

const PAGE_SIZE = 10;

/**
 * Discover, rebuilt from the customer tab: "YOUR LOOKBOOK" over "Made for you",
 * a bell when signed in and a Sign in pill when not, two staggered columns in
 * the app's own order, and the same three states in the same words.
 *
 * The original loaded more as you scrolled; the sentinel does that here.
 */
export function DiscoverFeed({ guest = false }: { guest?: boolean }) {
  const router = useRouter();
  const { signedIn, appMode } = useAuth();

  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const cursor = useRef<{ id: string } | null>(null);
  const inFlight = useRef(false);
  // Held in state rather than a ref so the observer attaches as soon as the
  // sentinel actually mounts — it only renders once there are posts.
  const [sentinel, setSentinel] = useState<HTMLDivElement | null>(null);

  const load = useCallback(
    async (reset = false) => {
      if (inFlight.current) return;
      inFlight.current = true;
      if (!reset) setLoadingMore(true);

      try {
        setError(null);
        const [page, count] = await Promise.all([
          fetchFeed(reset ? null : cursor.current, PAGE_SIZE),
          reset && signedIn
            ? fetchUnreadNotificationCount(appMode)
            : Promise.resolve(0),
        ]);

        setPosts((current) =>
          reset ? page.items : [...current, ...page.items],
        );
        cursor.current = page.nextCursor;
        setHasMore(Boolean(page.nextCursor));
        if (reset) setUnread(count);
      } catch {
        setError(
          "We couldn’t load fresh work. Check your connection and try again.",
        );
        setHasMore(false);
      } finally {
        inFlight.current = false;
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [appMode, signedIn],
  );

  useEffect(() => {
    void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!sentinel || !hasMore || error) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void load(false);
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [error, hasMore, load, sentinel]);

  // The observer only fires when the sentinel crosses into range. If a short
  // page leaves it on screen, keep paging until the viewport is actually filled.
  useEffect(() => {
    if (!sentinel || !hasMore || error || loading || loadingMore) return;
    if (sentinel.getBoundingClientRect().top <= window.innerHeight + 600)
      void load(false);
  }, [error, hasMore, load, loading, loadingMore, posts.length, sentinel]);

  const open = (post: FeedPost) => router.push(`/post/${post.id}`);
  const creator = (post: FeedPost) =>
    router.push(`/professional/${post.professionalId}`);

  return (
    <div className="mx-auto flex w-full max-w-[1540px] flex-col pt-2">
      <header className="flex items-center justify-between gap-4">
        <div>
          <p className="text-eyebrow text-primary uppercase">Your lookbook</p>
          <h1 className="text-page text-ink">Made for you</h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href={signedIn ? "/become-professional" : "/sign-in"}
            className="hidden min-h-10 items-center rounded-full border border-primary/50 px-4 text-caption font-bold text-ink transition hover:bg-tint md:flex"
          >
            I’m a professional
          </Link>
          {signedIn ? (
            <div className="flex shrink-0 items-center gap-2 md:hidden">
            <MessageLink className="size-11 transition active:scale-95" iconClassName="size-[23px]" />
            <Link
              href="/notifications"
              aria-label={
                unread > 0 ? `Notifications, ${unread} unread` : "Notifications"
              }
              className="relative flex size-11 shrink-0 items-center justify-center rounded-full bg-surface text-ink transition active:scale-95"
            >
              <Bell aria-hidden className="size-[23px]" />
              {unread > 0 ? (
                <span className="absolute top-[9px] right-[10px] size-[7px] rounded-full border-[1.5px] border-surface bg-primary" />
              ) : null}
            </Link>
            </div>
          ) : (
            <Link
              href="/sign-in"
              className="flex min-h-[42px] shrink-0 items-center rounded-full bg-secondary px-4 text-caption font-bold text-ink md:hidden"
            >
              Sign in
            </Link>
          )}
        </div>
      </header>

      <p className="mt-2 mb-6 max-w-[270px] text-caption text-muted">
        Fresh work from professionals who match your interests.
      </p>

      {error && posts.length === 0 ? (
        <State
          icon={<CloudOff aria-hidden className="size-[29px]" />}
          title="Discover is taking a pause"
          body={error}
          action="Try again"
          onPress={() => void load(true)}
        />
      ) : null}

      {loading && posts.length === 0 ? (
        <div className="mt-2 columns-2 gap-3 md:columns-3 md:gap-5 lg:columns-4 2xl:columns-5">
          {Array.from({ length: 10 }, (_, index) => (
            <div key={index} className="mb-5 break-inside-avoid">
              <CardSkeleton lines={2} />
            </div>
          ))}
        </div>
      ) : null}

      {!loading && !error && posts.length === 0 ? (
        <State
          icon={<Images aria-hidden className="size-[29px]" />}
          title="The lookbook is waiting"
          body="New work from professionals will appear here as soon as they post it."
        />
      ) : null}

      {posts.length > 0 ? (
        <>
          <div className="mt-2 columns-2 gap-3 md:columns-3 md:gap-5 lg:columns-4 2xl:columns-5">
            {posts.map((post) => (
              <FeedCard
                key={post.id}
                post={post}
                onOpen={open}
                onCreator={creator}
              />
            ))}
          </div>

          <div ref={setSentinel} className="flex justify-center py-6">
            {loadingMore ? <Spinner label="Loading more work" /> : null}
            {!hasMore ? (
              <p className="text-caption text-muted">You’re all caught up</p>
            ) : null}
          </div>
        </>
      ) : null}

      {guest ? null : null}
    </div>
  );
}

function State({
  icon,
  title,
  body,
  action,
  onPress,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  action?: string;
  onPress?: () => void;
}) {
  return (
    <div className="mt-8 flex flex-col items-center gap-2 rounded-card bg-surface p-8 text-center">
      <span aria-hidden className="text-primary">
        {icon}
      </span>
      <p className="mt-1 text-title font-medium text-ink">{title}</p>
      <p className="max-w-[270px] text-caption text-muted">{body}</p>
      {action ? (
        <button
          type="button"
          onClick={onPress}
          className="mt-3 rounded-full bg-primary px-6 py-3 text-caption font-bold text-surface"
        >
          {action}
        </button>
      ) : null}
    </div>
  );
}
