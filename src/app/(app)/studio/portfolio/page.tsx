"use client";

import { ConfirmDialog, Skeleton, Spinner } from "@/components/ui";
import {
  addStudioPhoto,
  deleteProfessionalPost,
  deleteStudioPhoto,
  getProfessionalPosts,
  getStudioPhotos,
  type ProfessionalPost,
  type StudioPhoto,
} from "@/features/feed/upload";
import { useToast } from "@/providers/toast-provider";
import { ArrowLeft, CloudOff, Images, Plus, Store, Trash2 } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

type Tab = "work" | "studio";

const created = (value: string) =>
  new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(
    new Date(value),
  );

/** Dimensions matter: the studio grid stores a real aspect ratio per photo. */
function measure(file: File) {
  return new Promise<{ width: number; height: number }>((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new window.Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => resolve({ width: 0, height: 0 });
    image.src = url;
  });
}

/**
 * Photos, rebuilt from `ProfessionalPostsScreen`: the header with its single
 * add control, the Work/Studio tabs, the posted list with its delete rows and
 * the studio grid with its overlay deletes.
 */
export default function StudioPortfolioPage() {
  const router = useRouter();
  const { toast, error: showError } = useToast();

  const [posts, setPosts] = useState<ProfessionalPost[]>([]);
  const [studio, setStudio] = useState<StudioPhoto[]>([]);
  const [tab, setTab] = useState<Tab>("work");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingPost, setPendingPost] = useState<ProfessionalPost | null>(null);
  const [pendingPhoto, setPendingPhoto] = useState<StudioPhoto | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setError(false);
    setLoading(true);
    try {
      const [nextPosts, nextStudio] = await Promise.all([getProfessionalPosts(), getStudioPhotos()]);
      setPosts(nextPosts);
      setStudio(nextStudio);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (post: ProfessionalPost) => {
    setDeletingId(post.id);
    try {
      await deleteProfessionalPost(post);
      setPosts((current) => current.filter((item) => item.id !== post.id));
      setPendingPost(null);
      toast("Post deleted", { tone: "success", detail: "It is gone from feeds and your portfolio." });
    } catch (cause) {
      showError(
        "Post not deleted",
        cause instanceof Error ? cause.message : "Check your connection and try again.",
      );
    } finally {
      setDeletingId(null);
    }
  };

  const removeStudio = async (photo: StudioPhoto) => {
    setDeletingId(photo.id);
    try {
      await deleteStudioPhoto(photo);
      setStudio((current) => current.filter((item) => item.id !== photo.id));
      setPendingPhoto(null);
    } catch (cause) {
      showError(
        "Photo not deleted",
        cause instanceof Error ? cause.message : "Check your connection and try again.",
      );
    } finally {
      setDeletingId(null);
    }
  };

  const addStudio = async (files: File[]) => {
    if (!files.length) return;
    setUploading(true);
    const added: StudioPhoto[] = [];
    let failed = 0;
    try {
      for (const file of files) {
        try {
          const { width, height } = await measure(file);
          added.push(
            await addStudioPhoto({
              uri: URL.createObjectURL(file),
              mimeType: file.type || "image/jpeg",
              fileName: file.name,
              width,
              height,
            }),
          );
        } catch {
          failed += 1;
        }
      }
      if (added.length) setStudio((current) => [...current, ...added]);
      if (failed) {
        showError(
          added.length ? "Some photos were not added" : "Photos not added",
          added.length
            ? `${added.length} ${added.length === 1 ? "photo was" : "photos were"} added, but ${failed} could not be uploaded.`
            : "Check your connection and try again.",
        );
      }
    } catch (cause) {
      showError(
        "Photos not added",
        cause instanceof Error ? cause.message : "Check your connection and try again.",
      );
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-3 pb-4">
        <button
          type="button"
          aria-label="Go back"
          onClick={() => router.back()}
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface text-ink transition active:scale-95"
        >
          <ArrowLeft aria-hidden className="size-[22px]" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] leading-[14px] font-bold tracking-[1.7px] text-primary uppercase">
            Your profile
          </p>
          <h1 className="text-page text-ink">Photos</h1>
        </div>

        {tab === "work" ? (
          <button
            type="button"
            aria-label="Create a new post"
            disabled={uploading}
            onClick={() => router.push("/studio/posts/new")}
            className="flex size-11 shrink-0 items-center justify-center rounded-field bg-primary text-surface transition active:scale-95 disabled:opacity-60"
          >
            <Plus aria-hidden className="size-[23px]" />
          </button>
        ) : (
          <button
            type="button"
            aria-label="Add studio photos"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            className="flex size-11 shrink-0 items-center justify-center rounded-field bg-primary text-surface transition active:scale-95 disabled:opacity-60"
          >
            {uploading ? (
              <Spinner className="[&>svg]:size-4 [&>svg]:text-surface" label="Uploading" />
            ) : (
              <Plus aria-hidden className="size-[23px]" />
            )}
          </button>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          aria-hidden
          tabIndex={-1}
          className="sr-only"
          onChange={(event) => {
            void addStudio(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />
      </div>

      <div className="flex rounded-full bg-surface p-1">
        {(
          [
            { key: "work", label: `Work · ${posts.length}` },
            { key: "studio", label: `Studio · ${studio.length}` },
          ] as const
        ).map((item) => {
          const active = tab === item.key;
          return (
            <button
              key={item.key}
              type="button"
              aria-pressed={active}
              onClick={() => setTab(item.key)}
              className={
                active
                  ? "min-h-10 flex-1 rounded-full bg-secondary text-caption font-bold text-primary"
                  : "min-h-10 flex-1 rounded-full text-caption font-bold text-muted"
              }
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="mt-4 flex flex-col gap-3">
          <Skeleton className="h-28 w-full rounded-panel" />
          <Skeleton className="h-28 w-full rounded-panel" />
        </div>
      ) : error ? (
        <State
          icon={<CloudOff aria-hidden className="size-7" />}
          title="Photos unavailable"
          detail="Check your connection and try again."
          action="Try again"
          onAction={() => void load()}
        />
      ) : tab === "work" ? (
        posts.length === 0 ? (
          <State
            icon={<Images aria-hidden className="size-7" />}
            title="Your portfolio is ready"
            detail="Share your work to help customers discover you."
            action="Create a post"
            onAction={() => router.push("/studio/posts/new")}
          />
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            {posts.map((post) => (
              <div
                key={post.id}
                className="flex min-h-[112px] items-center gap-3 rounded-panel bg-surface p-1.5 shadow-card"
              >
                <span className="relative h-24 w-[92px] shrink-0 overflow-hidden rounded-field bg-secondary">
                  <Image src={post.imageUrl} alt="" fill sizes="92px" className="object-cover" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-body font-medium text-ink">{post.caption}</span>
                  <span className="mt-1 block text-[11px] text-muted">{created(post.createdAt)}</span>
                </span>
                <button
                  type="button"
                  aria-label={`Delete post: ${post.caption}`}
                  disabled={deletingId === post.id}
                  onClick={() => setPendingPost(post)}
                  className="mr-1 flex size-11 shrink-0 items-center justify-center rounded-field bg-danger-surface text-danger transition active:scale-95 disabled:opacity-60"
                >
                  {deletingId === post.id ? (
                    <Spinner className="[&>svg]:size-4" label="Deleting" />
                  ) : (
                    <Trash2 aria-hidden className="size-5" />
                  )}
                </button>
              </div>
            ))}
          </div>
        )
      ) : studio.length === 0 ? (
        <State
          icon={<Store aria-hidden className="size-7" />}
          title="Show clients your space"
          detail="Add clear photos of your shop, salon or home studio."
          action="Add studio photos"
          onAction={() => fileInputRef.current?.click()}
        />
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3">
          {studio.map((photo) => (
            <div
              key={photo.id}
              className="relative aspect-[0.82] overflow-hidden rounded-panel bg-surface"
            >
              <Image src={photo.imageUrl} alt="" fill sizes="48vw" className="object-cover" />
              <button
                type="button"
                aria-label="Delete studio photo"
                disabled={deletingId === photo.id}
                onClick={() => setPendingPhoto(photo)}
                className="absolute top-2 right-2 flex size-10 items-center justify-center rounded-full bg-[rgb(25_18_22/0.72)] text-surface transition active:scale-95 disabled:opacity-60"
              >
                {deletingId === photo.id ? (
                  <Spinner className="[&>svg]:size-4 [&>svg]:text-surface" label="Deleting" />
                ) : (
                  <Trash2 aria-hidden className="size-5" />
                )}
              </button>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(pendingPost)}
        title="Delete this post?"
        message="It will disappear from your portfolio and customer feeds. This cannot be undone."
        confirmLabel="Delete post"
        cancelLabel="Keep post"
        destructive
        loading={Boolean(deletingId)}
        onConfirm={() => pendingPost && void remove(pendingPost)}
        onClose={() => setPendingPost(null)}
      />
      <ConfirmDialog
        open={Boolean(pendingPhoto)}
        title="Delete this studio photo?"
        message="It will disappear from your public profile."
        confirmLabel="Delete photo"
        cancelLabel="Keep photo"
        destructive
        loading={Boolean(deletingId)}
        onConfirm={() => pendingPhoto && void removeStudio(pendingPhoto)}
        onClose={() => setPendingPhoto(null)}
      />
    </div>
  );
}

function State({
  icon,
  title,
  detail,
  action,
  onAction,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <div className="mt-8 flex flex-col items-center px-4 text-center">
      <span className="mb-3 flex size-14 items-center justify-center rounded-full bg-secondary text-primary">
        {icon}
      </span>
      <p className="text-section text-ink">{title}</p>
      <p className="mt-1 text-caption text-muted">{detail}</p>
      <button
        type="button"
        onClick={onAction}
        className="mt-4 min-h-12 rounded-full bg-primary px-6 text-caption font-bold text-surface transition active:scale-[.98]"
      >
        {action}
      </button>
    </div>
  );
}
