"use client";
import { usePricing } from "@/providers/pricing-provider";

import { FormError, Spinner } from "@/components/ui";
import {
  getPostCategories,
  publishFeedPost,
  type PostCategory,
  type PublishStage,
} from "@/features/feed/upload";
import { mediaAssetFromFile } from "@/lib/media";
import {
  MAX_VIDEO_BYTES,
  prepareVideo,
  resolveVideoMime,
  VIDEO_MESSAGES,
} from "@/lib/media/video";
import type { MediaAsset } from "@/lib/media/types";
import { useToast } from "@/providers/toast-provider";
import { ArrowRight, Clapperboard, Plus, X } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const MAX_POST_IMAGES = 8;

type DraftVideo = {
  file: File;
  posterUrl: string;
  durationMs: number;
  width: number;
  height: number;
};

const STAGE_COPY: Record<PublishStage, string> = {
  "preparing-video": "Preparing your clip…",
  poster: "Uploading the poster…",
  image: "Uploading pictures…",
  video: "Uploading your clip…",
  saving: "Saving your post…",
};

/**
 * Posting work, rebuilt from the studio's upload tab: the "YOUR PORTFOLIO" head
 * with its intro, the empty picker or the cover-badged preview rail, the capped
 * caption, the category chips, the GHS price field and Publish to Discover.
 *
 * A post is either 1–8 pictures or one clip of 12 seconds or less. A clip is
 * measured and validated here before anything is uploaded; its poster frame is
 * captured locally and uploaded as an ordinary post image.
 */
export default function NewPostPage() {
  const { config } = usePricing();
  const router = useRouter();
  const { toast, error: showError } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);

  const [categories, setCategories] = useState<PostCategory[]>([]);
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [video, setVideo] = useState<DraftVideo | null>(null);
  const [preparingVideo, setPreparingVideo] = useState(false);
  const [caption, setCaption] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [price, setPrice] = useState("");
  const [error, setError] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState<PublishStage | null>(null);

  useEffect(() => {
    void getPostCategories()
      .then((items) => {
        setCategories(items);
        setCategoryId((current) => current || items[0]?.id || "");
      })
      .catch(() => setCategories([]));
  }, []);

  // Release the local poster object URL when the draft clip changes.
  useEffect(() => {
    const posterUrl = video?.posterUrl;
    return () => {
      if (posterUrl) URL.revokeObjectURL(posterUrl);
    };
  }, [video]);

  const chooseImages = () => {
    if (assets.length >= MAX_POST_IMAGES) return;
    fileInput.current?.click();
  };

  const addFiles = async (files: FileList) => {
    setError("");
    const room = MAX_POST_IMAGES - assets.length;
    const picked = Array.from(files).slice(0, Math.max(0, room));
    for (const file of picked) {
      try {
        const asset = await mediaAssetFromFile(file);
        setAssets((current) => [...current, asset].slice(0, MAX_POST_IMAGES));
        setVideo(null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "That image couldn’t be read.");
      }
    }
  };

  const addVideo = async (file: File) => {
    setError("");

    // Container and size are checked before the browser tries to decode.
    if (!resolveVideoMime(file)) {
      setError(VIDEO_MESSAGES.unsupported);
      return;
    }
    if (file.size > MAX_VIDEO_BYTES) {
      setError(VIDEO_MESSAGES.tooLarge);
      return;
    }

    setPreparingVideo(true);
    try {
      // Measures the real duration and captures the ~20% poster frame.
      const prepared = await prepareVideo(file);
      setAssets([]);
      setVideo({
        file,
        posterUrl: prepared.poster.uri,
        durationMs: prepared.clip.durationMs,
        width: prepared.clip.width,
        height: prepared.clip.height,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : VIDEO_MESSAGES.unreadable);
    } finally {
      setPreparingVideo(false);
    }
  };

  const ready = Boolean(
    (assets.length || video) && caption.trim() && categoryId && !publishing && !preparingVideo,
  );

  const publish = async () => {
    if ((!assets.length && !video) || !caption.trim() || !categoryId) return;
    const amount = price.trim() ? Number(price) : null;
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
      setError("Enter a valid starting price or leave it blank.");
      return;
    }

    setPublishing(true);
    setError("");
    setProgress(0);
    setStage(null);

    try {
      await publishFeedPost(
        {
          assets: video
            ? []
            : assets.map((asset) => ({
                uri: asset.uri,
                mimeType: asset.mimeType ?? null,
                fileName: asset.fileName ?? null,
                width: asset.width ?? 0,
                height: asset.height ?? 0,
              })),
          video: video?.file ?? null,
          caption: caption.trim(),
          interestId: categoryId,
          priceFrom: amount,
        },
        (completed, nextStage) => {
          setProgress(completed);
          if (nextStage) setStage(nextStage);
        },
      );
      setAssets([]);
      setVideo(null);
      setCaption("");
      setPrice("");
      toast("Published", { tone: "success", detail: "Your work is now live in Discover." });
      router.replace("/studio/portfolio");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Try again in a moment.";
      setError(message);
      showError("Couldn’t publish", message);
    } finally {
      setPublishing(false);
      setStage(null);
    }
  };

  const seconds = video ? Math.round(video.durationMs / 100) / 10 : 0;

  return (
    <div className="flex flex-col">
      <p className="text-eyebrow text-primary uppercase">Your portfolio</p>
      <h1 className="text-page text-ink">Post fresh work</h1>
      <p className="mt-1 mb-6 max-w-[340px] text-body text-muted">
        Share up to 8 pictures in one post, or one clip of 12 seconds or less. The first picture,
        or the clip’s poster frame, becomes the cover.
      </p>

      {video ? (
        <>
          <div className="mb-1.5 flex items-center justify-between gap-3">
            <p className="text-caption font-bold text-ink">1/1 clip · {seconds}s</p>
            <button
              type="button"
              onClick={() => setVideo(null)}
              className="text-caption font-bold text-primary"
            >
              Remove
            </button>
          </div>
          <div className="rail">
            <span className="relative block h-[190px] w-[150px] shrink-0 overflow-hidden rounded-panel bg-secondary">
              <Image
                src={video.posterUrl}
                alt="Clip poster frame"
                fill
                sizes="150px"
                className="object-cover"
                unoptimized
              />
              <span className="absolute bottom-2 left-2 rounded-full bg-white/92 px-2 py-1 text-[9px] font-bold tracking-[1px] text-ink">
                CLIP · {seconds}s
              </span>
              <button
                type="button"
                aria-label="Remove clip"
                onClick={() => setVideo(null)}
                className="absolute top-[7px] right-[7px] flex size-7 items-center justify-center rounded-full bg-[rgb(35_28_30/0.72)] text-surface transition active:scale-95"
              >
                <X aria-hidden className="size-[15px]" />
              </button>
            </span>
          </div>
        </>
      ) : assets.length ? (
        <>
          <div className="mb-1.5 flex items-center justify-between gap-3">
            <p className="text-caption font-bold text-ink">{assets.length}/8 pictures</p>
            {assets.length < MAX_POST_IMAGES ? (
              <button
                type="button"
                onClick={chooseImages}
                className="text-caption font-bold text-primary"
              >
                Add more
              </button>
            ) : null}
          </div>
          <div className="rail">
            {assets.map((asset, index) => (
              <span
                key={`${asset.uri}-${index}`}
                className="relative block h-[190px] w-[150px] shrink-0 overflow-hidden rounded-panel bg-secondary"
              >
                <Image src={asset.uri} alt="" fill sizes="150px" className="object-cover" unoptimized />
                {index === 0 ? (
                  <span className="absolute bottom-2 left-2 rounded-full bg-white/92 px-2 py-1 text-[9px] font-bold tracking-[1px] text-ink">
                    COVER
                  </span>
                ) : null}
                <button
                  type="button"
                  aria-label={`Remove picture ${index + 1}`}
                  onClick={() => setAssets((current) => current.filter((_, i) => i !== index))}
                  className="absolute top-[7px] right-[7px] flex size-7 items-center justify-center rounded-full bg-[rgb(35_28_30/0.72)] text-surface transition active:scale-95"
                >
                  <X aria-hidden className="size-[15px]" />
                </button>
              </span>
            ))}
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-3">
          <button
            type="button"
            aria-label="Choose up to 8 pictures"
            onClick={chooseImages}
            disabled={preparingVideo}
            className="flex min-h-[210px] w-full flex-col items-center justify-center rounded-card bg-secondary p-6 transition active:scale-[.995] disabled:opacity-70"
          >
            <span className="mb-3 flex size-[58px] items-center justify-center rounded-full bg-surface">
              {preparingVideo ? (
                <Spinner label="Preparing clip" />
              ) : (
                <Plus aria-hidden className="size-7 text-primary" />
              )}
            </span>
            <span className="text-title font-medium text-ink">
              {preparingVideo ? "Preparing your clip" : "Choose up to 8 pictures"}
            </span>
            <span className="mt-1 text-caption text-muted">
              {preparingVideo
                ? "Measuring the clip and capturing its poster frame"
                : "Select them in the order clients should see them"}
            </span>
          </button>
          <button
            type="button"
            onClick={() => videoInput.current?.click()}
            disabled={preparingVideo}
            className="flex min-h-[64px] w-full items-center justify-center gap-2 rounded-card border border-dashed border-primary/60 bg-surface text-caption font-bold text-ink transition active:scale-[.995] disabled:opacity-70"
          >
            <Clapperboard aria-hidden className="size-[18px] text-primary" />
            Or post a clip (MP4 or MOV, 12 seconds max)
          </button>
        </div>
      )}

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        aria-hidden
        tabIndex={-1}
        className="sr-only"
        onChange={(event) => {
          if (event.target.files) void addFiles(event.target.files);
          event.target.value = "";
        }}
      />

      <input
        ref={videoInput}
        type="file"
        accept="video/mp4,video/quicktime,video/x-m4v,video/m4v,.mp4,.mov,.m4v"
        aria-hidden
        tabIndex={-1}
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void addVideo(file);
          event.target.value = "";
        }}
      />

      <div className="mt-6 flex flex-col gap-1.5">
        <div className="flex justify-between gap-3">
          <span className="text-caption font-bold text-ink">Caption</span>
          <span className="text-caption text-muted">{caption.length}/500</span>
        </div>
        <textarea
          value={caption}
          maxLength={500}
          placeholder="What did you create? Add finish, style or technique."
          onChange={(event) => setCaption(event.target.value.slice(0, 500))}
          className="min-h-[120px] rounded-panel bg-surface p-4 text-body text-ink"
        />
      </div>

      <div className="mt-6 flex flex-col gap-1.5">
        <span className="text-caption font-bold text-ink">Category</span>
        <div className="rail">
          {categories.map((category) => {
            const active = categoryId === category.id;
            return (
              <button
                key={category.id}
                type="button"
                aria-pressed={active}
                onClick={() => setCategoryId(category.id)}
                className={
                  active
                    ? "flex min-h-[42px] shrink-0 items-center rounded-full bg-primary px-4 text-caption font-bold text-surface"
                    : "flex min-h-[42px] shrink-0 items-center rounded-full bg-surface px-4 text-caption font-bold text-ink"
                }
              >
                {category.name}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-1.5">
        <span className="text-caption font-bold text-ink">
          Starting price <span className="font-normal text-muted">optional</span>
        </span>
        <div className="flex min-h-[54px] items-center gap-2 rounded-panel bg-surface px-4">
          <span className="text-caption font-bold text-muted">{config.currency}</span>
          <input
            inputMode="decimal"
            aria-label="Starting price in Ghana cedis"
            placeholder="0.00"
            value={price}
            onChange={(event) =>
              setPrice(
                event.target.value.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1"),
              )
            }
            className="min-w-0 flex-1 bg-transparent text-body text-ink outline-none"
          />
        </div>
      </div>

      {error ? (
        <div className="mt-4">
          <FormError message={error} />
        </div>
      ) : null}
      {publishing ? (
        <p className="mt-4 text-caption text-muted" role="status">
          {stage ? STAGE_COPY[stage] : `Uploading ${Math.max(progress, 1)} of ${assets.length || 1}…`}
        </p>
      ) : null}

      <button
        type="button"
        disabled={!ready}
        onClick={() => void publish()}
        className={
          ready
            ? "mt-6 flex min-h-14 w-full items-center justify-center gap-2 rounded-panel bg-primary text-body font-medium text-surface transition active:scale-[.99]"
            : "mt-6 flex min-h-14 w-full items-center justify-center gap-2 rounded-panel bg-primary text-body font-medium text-surface opacity-45"
        }
      >
        {publishing ? (
          <Spinner className="[&>svg]:text-surface" label="Publishing" />
        ) : (
          <>
            Publish to Discover
            <ArrowRight aria-hidden className="size-[19px]" />
          </>
        )}
      </button>
    </div>
  );
}
