"use client";

import { FeedSkeleton, LoadingRegion, Spinner } from "@/components/ui";
import { AppPromoTile } from "@/features/app-promo/AppPromo";
import { FeedCard } from "@/features/feed/FeedCard";
import { fetchFeed } from "@/features/feed/api";
import {
  FEED_PAGE_SIZE,
  seedFeedFirstPage,
  seedPostDetail,
  useFeedFirstPage,
} from "@/features/feed/queries";
import { useUnreadNotificationCount } from "@/features/notifications/queries";
import { MessageLink } from "@/features/messaging/MessageLink";
import type { FeedCursor, FeedPage } from "@/features/feed/rows";
import type { FeedPost } from "@/features/feed/types";
import { useAuth } from "@/providers/auth-provider";
import { Bell, CloudOff, Images } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";

/**
 * Pins after which the app invitation appears. Two, spaced well apart, so a
 * longer scroll meets it once more without it ever feeling like every other tile.
 *
 * The masonry is CSS columns, which fill top-to-bottom, so a slot that is a
 * multiple of the column height lands at the *top* of a column, in the first
 * screen. With a 24-pin page, 10 and 22 sit mid-column at 2, 3, 4 and 5 columns.
 */
const PROMO_AFTER = new Set([10, 22]);

/**
 * Posts per request. Matches the server's first page, so a five-column
 * desktop is filled in one request instead of immediately asking for more.
 */
const PAGE_SIZE = FEED_PAGE_SIZE;

/** Above-the-fold pins whose images load eagerly, for a faster first paint. */
const EAGER_IMAGES = 4;

const NO_POSTS: FeedPost[] = [];

/**
 * Discover, rebuilt from the customer tab: "YOUR LOOKBOOK" over "Made for you",
 * a bell when signed in and a Sign in pill when not, two staggered columns in
 * the app's own order, and the same three states in the same words.
 *
 * The original loaded more as you scrolled; the sentinel does that here.
 */
export function DiscoverFeed({
  guest = false,
  initialPage = null,
}: {
  guest?: boolean;
  /** First page rendered on the server. `null` means load it in the browser. */
  initialPage?: FeedPage | null;
}) {
  const router = useRouter();
  const { signedIn, appMode } = useAuth();

  // A guest's server-rendered page goes into the cache as-is (declared before
  // the query so it runs first and saves a refetch of the same page).
  useEffect(() => {
    seedFeedFirstPage(initialPage);
  }, [initialPage]);

  // The first page is cached: a revisit paints the last feed at once (likes and
  // saves included) and refreshes it behind. Until the cache answers, the
  // server-rendered page shows.
  const feed = useFeedFirstPage();
  const refetchFeed = feed.refetch;
  const firstPage = feed.data ?? initialPage;
  const unread = useUnreadNotificationCount(appMode).data ?? 0;

  // Later pages stay here. They belong to the first page they followed, and
  // are dropped when a refresh brings different posts (not just new likes).
  const base = firstPage?.items.map((post) => post.id).join(",") ?? "";
  const [more, setMore] = useState<{
    base: string;
    items: FeedPost[];
    nextCursor: FeedCursor | null;
    failed: boolean;
  } | null>(null);
  const extra = more?.base === base ? more : null;
  const posts = firstPage ? (extra ? [...firstPage.items, ...extra.items] : firstPage.items) : NO_POSTS;
  const nextCursor = extra ? extra.nextCursor : (firstPage?.nextCursor ?? null);
  const loading = !firstPage && feed.isLoading;
  const error =
    (feed.error && !firstPage) || extra?.failed
      ? "We couldn’t load fresh work. Check your connection and try again."
      : null;
  const hasMore = firstPage ? Boolean(nextCursor) && !extra?.failed : true;
  const [loadingMore, setLoadingMore] = useState(false);

  const inFlight = useRef(false);
  // Held in state rather than a ref so the observer attaches as soon as the
  // sentinel actually mounts — it only renders once there are posts.
  const [sentinel, setSentinel] = useState<HTMLDivElement | null>(null);

  const load = useCallback(
    async (reset = false) => {
      if (reset) {
        setMore(null);
        await refetchFeed();
        return;
      }
      if (inFlight.current || !nextCursor) return;
      inFlight.current = true;
      setLoadingMore(true);

      try {
        const page = await fetchFeed(nextCursor, PAGE_SIZE);
        setMore((current) => ({
          base,
          items: [...(current?.base === base ? current.items : []), ...page.items],
          nextCursor: page.nextCursor,
          failed: false,
        }));
      } catch {
        setMore((current) => ({
          base,
          items: current?.base === base ? current.items : [],
          nextCursor,
          failed: true,
        }));
      } finally {
        inFlight.current = false;
        setLoadingMore(false);
      }
    },
    [base, nextCursor, refetchFeed],
  );

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

  const open = (post: FeedPost) => {
    // The viewer paints this post at once and fetches the rest behind it.
    seedPostDetail(post);
    router.push(`/post/${post.slug ?? post.id}`);
  };
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
        <LoadingRegion label="Loading work">
          <FeedSkeleton />
        </LoadingRegion>
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
            {posts.map((post, index) => (
              <Fragment key={post.id}>
                <FeedCard
                  post={post}
                  onOpen={open}
                  onCreator={creator}
                  priority={index < EAGER_IMAGES}
                />
                {/* One invitation, a few pins in, met at scrolling pace. */}
                {PROMO_AFTER.has(index + 1) ? <AppPromoTile /> : null}
              </Fragment>
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
