"use client";
import { CustomerPrice } from "@/providers/pricing-provider";

import { Avatar, Sheet, Spinner, Textarea } from "@/components/ui";
import { ProfessionalName } from "@/features/badges/ProfessionalName";
import {
  createPostComment,
  fetchPostById,
  fetchPostComments,
  fetchPostImages,
  setFeedReaction,
  type PostImage,
} from "@/features/feed/api";
import { FeedVideo } from "@/features/feed/FeedVideo";
import type { FeedPost } from "@/features/feed/types";
import { timeAgo } from "@/lib/utils";
import { useAuth } from "@/providers/auth-provider";
import { useToast } from "@/providers/toast-provider";
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  CalendarDays,
  Heart,
  Images,
  MessageCircle,
  Send,
} from "lucide-react";
import Image from "next/image";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

type Comment = {
  id: string;
  authorName: string;
  avatarUrl: string | null;
  body: string;
  createdAt: string;
};

/** `lg` and up opens the post with the thread beside the media. */
const DESKTOP_QUERY = "(min-width: 1024px)";
/** The inline composer owns this id on desktop so "comment" can focus it. */
const DESKTOP_COMPOSER_ID = "post-comment-composer";

function isDesktopLayout(): boolean {
  return typeof window !== "undefined" && window.matchMedia(DESKTOP_QUERY).matches;
}

/** Puts the caret in the composer that sits beside the media. */
function focusComposer(): void {
  if (typeof document === "undefined") return;
  document.getElementById(DESKTOP_COMPOSER_ID)?.focus();
}

/**
 * The post viewer, ported from `PostViewer` and the customer post screen: the
 * "created by" header with its save control, the swipeable look gallery, the
 * response bar, the caption and the "book with …" dock that leads into the
 * professional's service menu.
 *
 * Phones keep that stacked arrangement. From `lg` up the same pieces are laid
 * out the way Instagram opens a post — media on the left, the creator, the
 * thread and the composer on the right — so a wide window shows the work and
 * the conversation at once instead of a stretched single column.
 */
export default function PostPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { signedIn } = useAuth();
  const { toast, error: showError } = useToast();

  const postId = params.id;

  const [post, setPost] = useState<FeedPost | null>(null);
  const [images, setImages] = useState<PostImage[]>([]);
  const [activeImage, setActiveImage] = useState(0);
  const [comments, setComments] = useState<Comment[]>([]);
  const [cursor, setCursor] = useState<{ createdAt: string; id: string } | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [reactionPending, setReactionPending] = useState<"like" | "save" | null>(null);
  const galleryRef = useRef<HTMLDivElement>(null);

  const loadComments = useCallback(
    async (reset = false) => {
      try {
        const page = await fetchPostComments(postId, reset ? null : cursor, 30);
        setComments((current) => (reset ? page.items : [...current, ...page.items]));
        setCursor(page.nextCursor);
      } catch {
        /* The post is the point; comments can fail quietly. */
      }
    },
    [cursor, postId],
  );

  useEffect(() => {
    let active = true;
    setLoading(true);

    fetchPostById(postId)
      .then((next) => {
        if (!active) return;
        setPost(next);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : "This post is unavailable right now.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    void fetchPostImages(postId)
      .then((next) => {
        if (active) setImages(next);
      })
      .catch(() => undefined);

    void loadComments(true);

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId]);

  useEffect(() => {
    if (searchParams.get("comment") !== "1") return;
    if (isDesktopLayout()) {
      focusComposer();
      return;
    }
    setCommentsOpen(true);
  }, [searchParams]);

  const react = async (kind: "like" | "save") => {
    if (!post || reactionPending) return;
    if (!signedIn) {
      router.push(`/sign-in?next=/post/${post.id}`);
      return;
    }
    const active = kind === "like" ? !post.liked : !post.saved;
    setReactionPending(kind);
    setPost((current) =>
      current
        ? kind === "like"
          ? { ...current, liked: active, likeCount: current.likeCount + (active ? 1 : -1) }
          : { ...current, saved: active }
        : current,
    );
    try {
      await setFeedReaction(post.id, kind, active);
    } catch {
      setPost((current) =>
        current
          ? kind === "like"
            ? { ...current, liked: !active, likeCount: current.likeCount + (active ? -1 : 1) }
            : { ...current, saved: !active }
          : current,
      );
    } finally {
      setReactionPending(null);
    }
  };

  const openComments = () => {
    if (!signedIn) {
      router.push(`/sign-in?next=/post/${postId}?comment=1`);
      return;
    }
    // On a wide window the thread is already on screen, so the comment control
    // simply puts the caret where the reply is typed.
    if (isDesktopLayout()) {
      focusComposer();
      return;
    }
    setCommentsOpen(true);
  };

  const openCreator = () =>
    post ? router.push(`/professional/${post.professionalId}`) : undefined;

  const openServices = () => {
    if (!post) return;
    if (!signedIn) {
      router.push(`/sign-in?next=/services/${post.professionalId}`);
      return;
    }
    router.push(`/services/${post.professionalId}`);
  };

  const share = async () => {
    const url = typeof window === "undefined" ? "" : window.location.href;
    if (typeof navigator !== "undefined" && navigator.share) {
      await navigator
        .share({
          title: `${post?.professionalName ?? "This look"} on Sheree`,
          text: post?.caption || post?.category,
          url,
        })
        .catch(() => undefined);
      return;
    }
    await navigator.clipboard?.writeText(url).catch(() => undefined);
    toast("Link copied", { detail: "Paste it wherever you’re sharing." });
  };

  const submitComment = async (event: React.FormEvent) => {
    event.preventDefault();
    const body = commentBody.trim();
    if (!body || !post) return;

    setPosting(true);
    const optimistic: Comment = {
      id: `pending-${Date.now()}`,
      authorName: "You",
      avatarUrl: null,
      body,
      createdAt: new Date().toISOString(),
    };
    setComments((current) => [optimistic, ...current]);
    setCommentBody("");

    try {
      await createPostComment(post.id, body, null);
      setPost((current) => (current ? { ...current, commentCount: current.commentCount + 1 } : current));
      await loadComments(true);
    } catch (cause) {
      setComments((current) => current.filter((item) => item.id !== optimistic.id));
      setCommentBody(body);
      showError("Comment not posted", cause instanceof Error ? cause.message : "Try again.");
    } finally {
      setPosting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-3">
        <Spinner label="Loading story" />
        <p className="text-caption text-muted">Loading story…</p>
      </div>
    );
  }

  if (error || !post) {
    return (
      <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-3 text-center">
        <h1 className="text-title text-ink">Story unavailable</h1>
        <p className="max-w-sm text-caption text-muted">
          {error ?? "This story is unavailable right now."}
        </p>
        <button
          type="button"
          onClick={() => router.back()}
          className="text-caption font-bold text-primary"
        >
          Return to your feed
        </button>
      </div>
    );
  }

  const gallery: PostImage[] = images.length
    ? images
    : [
        {
          id: `cover-${post.id}`,
          imageUrl: post.imageUrl,
          aspectRatio: post.aspectRatio,
          sortOrder: 0,
        },
      ];

  // Honest to the source image, within the bounds the app settled on.
  const ratio = Math.min(1.02, Math.max(0.68, gallery[activeImage]?.aspectRatio ?? post.aspectRatio));
  const firstName = post.professionalName.split(" ")[0];

  const onGalleryScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const node = event.currentTarget;
    if (!node.clientWidth) return;
    setActiveImage(Math.round(node.scrollLeft / node.clientWidth));
  };

  /** The thread itself — inline on a wide window, inside the sheet on a phone. */
  const renderThread = () => (
    <>
      {comments.length === 0 ? (
        <p className="text-caption text-muted">
          No comments yet. Ask about pricing, timing or how the look wears.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {comments.map((comment) => (
            <li key={comment.id} className="flex gap-3">
              <Avatar name={comment.authorName} src={comment.avatarUrl} size={36} />
              <div className="min-w-0 flex-1">
                <p className="text-caption font-medium text-ink">
                  {comment.authorName}
                  <span className="ml-2 font-normal text-muted">{timeAgo(comment.createdAt)}</span>
                </p>
                <p className="text-body text-ink">{comment.body}</p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {cursor ? (
        <button
          type="button"
          onClick={() => void loadComments(false)}
          className="mt-4 text-caption font-bold text-primary"
        >
          Load more comments
        </button>
      ) : null}
    </>
  );

  const renderComposer = (id?: string) => (
    <form onSubmit={submitComment} className="flex items-end gap-2">
      <div className="flex-1">
        <Textarea
          id={id}
          aria-label="Add a comment"
          placeholder={`Ask ${firstName} something`}
          value={commentBody}
          onChange={(event) => setCommentBody(event.target.value)}
          className="min-h-20"
        />
      </div>
      <button
        type="submit"
        disabled={posting || !commentBody.trim()}
        aria-label="Post comment"
        className="flex size-14 shrink-0 items-center justify-center rounded-panel bg-primary text-surface disabled:opacity-50"
      >
        <Send aria-hidden className="size-5" />
      </button>
    </form>
  );

  const renderSignedOutComposer = () => (
    <button
      type="button"
      onClick={() => router.push(`/sign-in?next=/post/${post.id}?comment=1`)}
      className="min-h-[54px] w-full rounded-panel bg-primary text-body font-medium text-surface"
    >
      Sign in to comment
    </button>
  );

  return (
    <div className="mx-auto flex w-full max-w-[520px] flex-col pb-4 md:max-w-[720px] lg:max-w-[1120px] lg:pb-0">
      {/*
        One element tree, two arrangements. Below `lg` it is the phone stack
        (header, media, response bar, caption, dock). From `lg` up each block is
        pinned to an explicit grid cell: media in the left column across both
        rows, creator header then thread/composer in the right column.
      */}
      <div className="lg:grid lg:h-[calc(100dvh-7rem)] lg:min-h-[560px] lg:max-h-[860px] lg:grid-cols-[minmax(0,1fr)_minmax(340px,400px)] lg:grid-rows-[auto_minmax(0,1fr)] lg:overflow-hidden lg:rounded-card lg:border lg:border-line lg:bg-surface lg:shadow-card">
        <div className="flex min-h-[74px] items-center gap-2 pb-2 lg:col-start-2 lg:row-start-1 lg:min-h-[64px] lg:border-b lg:border-line lg:px-4 lg:pb-0">
          <button
            type="button"
            aria-label="Go back"
            onClick={() => router.back()}
            className="flex size-[42px] shrink-0 items-center justify-center rounded-full bg-surface text-ink transition active:scale-95"
          >
            <ArrowLeft aria-hidden className="size-5" />
          </button>

          <button
            type="button"
            onClick={openCreator}
            className="flex min-w-0 flex-1 items-center gap-3 text-left transition active:opacity-70"
          >
            <Avatar name={post.professionalName} src={post.avatarUrl} size={38} />
            <span className="min-w-0 flex-1">
              <span className="block text-[9px] leading-[14px] font-bold tracking-[1.5px] text-muted uppercase">
                Created by
              </span>
              <ProfessionalName
                name={post.professionalName}
                professionalId={post.professionalId}
                verified={post.verified}
                founding={post.founding}
                official={post.official}
                size={15}
                interactive={false}
                nameClassName="text-[14px] leading-[19px] font-bold text-ink"
              />
            </span>
          </button>

          <button
            type="button"
            aria-label={post.saved ? "Remove from saved" : "Save story"}
            aria-pressed={post.saved}
            disabled={reactionPending !== null}
            onClick={() => void react("save")}
            className="flex size-[42px] shrink-0 items-center justify-center rounded-full bg-surface text-ink transition active:scale-95 disabled:opacity-65"
          >
            {reactionPending === "save" ? (
              <Spinner className="size-5" />
            ) : (
              <Bookmark
                aria-hidden
                className={post.saved ? "size-5 fill-current" : "size-5"}
              />
            )}
          </button>
        </div>

        {/* Media: a clip replaces the gallery, poster first, then a player with
            native transport controls and sound. On desktop it fills the left
            column and is letterboxed against the dark stage. */}
        <div className="lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:flex lg:min-h-0 lg:items-center lg:justify-center lg:overflow-hidden lg:bg-ink">
          {post.videoUrl ? (
            <div className="-mx-4 flex w-[calc(100%+2rem)] items-center justify-center md:mx-auto md:w-full md:max-w-3xl lg:mx-0 lg:h-full lg:w-full lg:max-w-none">
              <FeedVideo
                posterUrl={post.imageUrl}
                videoUrl={post.videoUrl}
                durationMs={post.videoDurationMs}
                aspectRatio={post.aspectRatio}
                autoplay={false}
                controls
                className="w-full md:rounded-card lg:h-full lg:w-auto lg:max-w-full lg:rounded-none"
              />
            </div>
          ) : (
            /* Full-bleed gallery, exactly as the phone renders it. */
            <div
              className="relative aspect-[var(--media-ratio)] -mx-4 max-h-[650px] min-h-[430px] w-[calc(100%+2rem)] overflow-hidden bg-secondary md:mx-auto md:w-full md:max-w-3xl md:rounded-card lg:mx-0 lg:aspect-auto lg:h-full lg:max-h-none lg:min-h-0 lg:w-full lg:max-w-none lg:rounded-none lg:bg-ink"
              style={{ "--media-ratio": ratio } as React.CSSProperties}
            >
              <div
                ref={galleryRef}
                onScroll={onGalleryScroll}
                className="no-scrollbar flex size-full snap-x snap-mandatory overflow-x-auto"
              >
                {gallery.map((item, index) => (
                  <div key={item.id} className="relative size-full shrink-0 snap-center">
                    <Image
                      src={item.imageUrl}
                      alt={`${post.caption || post.category} — picture ${index + 1} of ${gallery.length}`}
                      fill
                      sizes="(min-width: 1024px) 720px, 100vw"
                      priority={index === 0}
                      className="object-cover lg:object-contain"
                    />
                  </div>
                ))}
              </div>

              {gallery.length > 1 ? (
                <>
                  <span className="absolute top-3 right-3 flex h-[30px] items-center gap-1.5 rounded-full bg-[rgb(35_28_38/0.68)] px-2.5 text-[11px] font-bold text-background">
                    <Images aria-hidden className="size-3.5" />
                    {activeImage + 1}/{gallery.length}
                  </span>
                  <span className="absolute inset-x-0 bottom-3 flex justify-center gap-1.5">
                    {gallery.map((item, index) => (
                      <span
                        key={item.id}
                        className={
                          index === activeImage
                            ? "h-1.5 w-[18px] rounded-full bg-background"
                            : "size-1.5 rounded-full bg-white/55"
                        }
                      />
                    ))}
                  </span>
                </>
              ) : null}
            </div>
          )}
        </div>

        {/* Right-hand column body: the thread scrolls, the response bar and the
            composer stay pinned to the bottom. On phones this is simply the
            rest of the stack. */}
        <div className="lg:col-start-2 lg:row-start-2 lg:flex lg:min-h-0 lg:flex-col">
          {/* Thread — desktop only; the sheet carries it on a phone. */}
          <div className="hidden lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:gap-3 lg:overflow-y-auto lg:px-4 lg:py-4">
            {renderThread()}
          </div>

          <div className="px-2 lg:mt-auto lg:shrink-0 lg:border-t lg:border-line lg:px-4">
            <div className="flex min-h-[58px] items-center border-y border-line lg:border-t-0">
              <button
                type="button"
                aria-label={post.liked ? "Unlike story" : "Like story"}
                aria-pressed={post.liked}
                disabled={reactionPending !== null}
                onClick={() => void react("like")}
                className="flex min-h-12 items-center gap-[7px] pr-4 transition active:opacity-70 disabled:opacity-65"
              >
                <Heart
                  aria-hidden
                  className={
                    post.liked ? "size-[22px] fill-current text-primary" : "size-[22px] text-ink"
                  }
                />
                <span className="text-caption font-bold text-ink">{post.likeCount}</span>
              </button>
              <button
                type="button"
                aria-label="View comments"
                onClick={openComments}
                className="flex min-h-12 items-center gap-[7px] pr-4 transition active:opacity-70"
              >
                <MessageCircle aria-hidden className="size-5 text-ink" />
                <span className="text-caption font-bold text-ink">{post.commentCount}</span>
              </button>
              <span className="flex-1" />
              <button
                type="button"
                aria-label="Share story"
                onClick={() => void share()}
                className="flex min-h-12 items-center gap-[7px] transition active:opacity-70"
              >
                <span className="text-[11px] text-ink">Send to someone</span>
                <Send aria-hidden className="size-4 text-ink" />
              </button>
            </div>

            <p className="pt-3.5 pb-3 text-[14px] leading-[21px] text-ink">{post.caption}</p>

            <button
              type="button"
              onClick={openServices}
              aria-label={`See services and availability from ${post.professionalName}`}
              className="mb-1 flex min-h-[78px] w-full items-center gap-3 rounded-field border border-line bg-surface p-3 text-left transition active:scale-[.98] active:opacity-75"
            >
              <span className="flex size-[46px] shrink-0 items-center justify-center rounded-field bg-secondary">
                <CalendarDays aria-hidden className="size-5 text-primary" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-[8px] leading-[12px] font-bold tracking-[1.3px] text-muted uppercase">
                  Book with {firstName}
                </span>
                <span className="truncate text-body font-medium text-ink">
                  {post.priceFrom !== null ? `From ${<CustomerPrice value={post.priceFrom} />}` : "Explore services"}
                </span>
              </span>
              <span className="flex size-10 shrink-0 items-center justify-center rounded-field bg-ink text-background">
                <ArrowRight aria-hidden className="size-[18px]" />
              </span>
            </button>
          </div>

          {/* Composer — desktop only, so the thread reads like a conversation. */}
          <div className="hidden lg:block lg:shrink-0 lg:border-t lg:border-line lg:px-4 lg:py-3">
            {signedIn ? renderComposer(DESKTOP_COMPOSER_ID) : renderSignedOutComposer()}
          </div>
        </div>
      </div>

      <Sheet
        open={commentsOpen}
        onClose={() => setCommentsOpen(false)}
        title="Comments"
        footer={signedIn ? renderComposer() : renderSignedOutComposer()}
      >
        {renderThread()}
      </Sheet>
    </div>
  );
}
