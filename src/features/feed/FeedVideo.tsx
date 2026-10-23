"use client";

import { Spinner } from "@/components/ui";
import { formatClipDuration } from "@/lib/media/video";
import { videoDeliveryUrls } from "@/lib/media/video-urls";
import { cn } from "@/lib/utils";
import { Play, RotateCcw, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { registerClip, unregisterClip, updateClip } from "./video-visibility";

/**
 * Feed clip player, ported from the mobile `FeedVideo`.
 *
 * States: idle → loading → ready, or failed. The poster is the first thing
 * rendered and stays visible until the first frame arrives, so a card never
 * flashes black. No `<video>` element exists until playback is requested —
 * either by the viewer or by the autoplay coordinator choosing this clip as
 * the most visible one.
 */

type Props = {
  posterUrl: string;
  videoUrl: string;
  durationMs: number | null;
  /** Poster/video aspect ratio (width ÷ height), clamped by the caller. */
  aspectRatio: number;
  /** Allow this card to autoplay when it is the most visible clip. */
  autoplay?: boolean;
  /** Use the 480px progressive rendition instead of 720px. */
  dataSaver?: boolean;
  /** Show native transport controls (post viewer, not the grid). */
  controls?: boolean;
  onOpen?: () => void;
  className?: string;
};

const MIN_RATIO = 0.62;
const MAX_RATIO = 1.05;

/** How long a clip may sit in `loading` before it is treated as failed. */
const STALL_TIMEOUT_MS = 15_000;

/** A play() interrupted by pause() rejects with this; it is not a failure. */
function isAbortError(cause: unknown): boolean {
  return cause instanceof DOMException
    ? cause.name === "AbortError"
    : (cause as { name?: string } | null)?.name === "AbortError";
}

function canPlayHls(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const video = document.createElement("video");
    return Boolean(
      video.canPlayType("application/vnd.apple.mpegurl") ||
        video.canPlayType("application/x-mpegURL"),
    );
  } catch {
    return false;
  }
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function FeedVideo({
  posterUrl,
  videoUrl,
  durationMs,
  aspectRatio,
  autoplay = true,
  dataSaver,
  controls = false,
  onOpen,
  className,
}: Props) {
  const clipId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // Mirrors `wantsPlayback` for the async `play()` rejection path, where the
  // state captured by the effect is already stale.
  const wantsRef = useRef(false);

  const [started, setStarted] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [wantsPlayback, setWantsPlayback] = useState(false);
  const [muted, setMuted] = useState(true);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [frameReady, setFrameReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [hlsSupported, setHlsSupported] = useState(false);
  const [saveData, setSaveData] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  /** Falls back to the progressive MP4 when the HLS playlist misbehaves. */
  const [delivery, setDelivery] = useState<"auto" | "progressive">("auto");

  useEffect(() => {
    setHlsSupported(canPlayHls());
    setReducedMotion(prefersReducedMotion());
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    setSaveData(Boolean(connection?.saveData));
  }, []);

  const ratio = Math.min(MAX_RATIO, Math.max(MIN_RATIO, aspectRatio || 0.82));
  const autoplayEnabled = autoplay && !reducedMotion;

  const progressiveUrl = useMemo(
    () =>
      videoDeliveryUrls(videoUrl, { dataSaver: dataSaver ?? saveData, hls: false }).progressive,
    [dataSaver, saveData, videoUrl],
  );

  const source = useMemo(() => {
    if (delivery === "progressive") return progressiveUrl;
    const forms = videoDeliveryUrls(videoUrl, {
      dataSaver: dataSaver ?? saveData,
      hls: hlsSupported,
    });
    return forms.adaptive ?? forms.progressive;
  }, [dataSaver, delivery, hlsSupported, progressiveUrl, saveData, videoUrl]);

  const failPlayback = useCallback(
    (reason: string) => {
      setStatus("failed");
      setWantsPlayback(false);
      wantsRef.current = false;
      setError(reason);
      updateClip(clipId, { playing: false, manual: false, autoplay: false });
    },
    [clipId],
  );

  const startPlayback = useCallback(
    (options: { muted: boolean; manual: boolean }) => {
      setStarted(true);
      setError(null);
      setStatus((current) => (current === "ready" ? "ready" : "loading"));
      setMuted(options.muted);
      setWantsPlayback(true);
      wantsRef.current = true;
      // When the element already exists, play from inside the tap so the user
      // gesture is preserved and the clip can start with sound. The effect
      // below stays the single source of truth for the mounted-but-idle case.
      const video = videoRef.current;
      if (video && options.manual) {
        video.muted = options.muted;
        void video.play().catch(() => undefined);
      }
      updateClip(clipId, { playing: true, manual: options.manual });
    },
    [clipId],
  );

  const pausePlayback = useCallback(() => {
    wantsRef.current = false;
    videoRef.current?.pause();
    setWantsPlayback(false);
    updateClip(clipId, { playing: false, manual: false });
  }, [clipId]);

  // Register with the page-wide coordinator so only one clip ever autoplays.
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    registerClip(
      clipId,
      {
        start: () => startPlayback({ muted: true, manual: false }),
        pause: pausePlayback,
      },
      { autoplay: autoplayEnabled },
    );

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        updateClip(clipId, { visible: entry.intersectionRatio });
      },
      { threshold: [0, 0.25, 0.5, 0.6, 0.75, 1] },
    );
    observer.observe(node);

    return () => {
      observer.disconnect();
      unregisterClip(clipId);
    };
  }, [autoplayEnabled, clipId, pausePlayback, startPlayback]);

  // Drive the element from state rather than from click handlers, so autoplay
  // and manual playback share exactly one code path.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.muted = muted;
    if (!wantsPlayback) {
      video.pause();
      return;
    }

    let cancelled = false;
    const play = async () => {
      try {
        await video.play();
      } catch (cause) {
        if (cancelled) return;
        // `pause()` landing mid-start rejects with AbortError. That is the
        // coordinator handing playback to another card, not a broken clip, so
        // it must never surface as "Clip unavailable".
        if (isAbortError(cause) || !wantsRef.current) return;
        // Autoplay policies can block sound; retry muted before failing.
        if (!muted) {
          try {
            video.muted = true;
            setMuted(true);
            await video.play();
            if (!cancelled) setStatus("ready");
            return;
          } catch {
            /* fall through to the failed state */
          }
        }
        if (cancelled || !wantsRef.current) return;
        failPlayback("This clip couldn’t play. Check your connection and try again.");
      }
    };
    void play();

    return () => {
      cancelled = true;
    };
  }, [attempt, failPlayback, muted, started, wantsPlayback]);

  // A clip that asks to play but never reaches a frame is a stuck player, not a
  // slow one. Fail it so the retry control appears instead of a dead spinner.
  useEffect(() => {
    if (!wantsPlayback || status === "ready" || status === "failed") return;
    const timer = window.setTimeout(() => {
      failPlayback("This clip is taking too long to load. Check your connection and try again.");
    }, STALL_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [failPlayback, status, wantsPlayback]);

  const replay = () => {
    setError(null);
    setFrameReady(false);
    setStatus("loading");
    setAttempt((current) => current + 1);
    setStarted(true);
    setWantsPlayback(true);
    wantsRef.current = true;
    updateClip(clipId, { playing: true, manual: true, autoplay: false });
  };

  const duration = formatClipDuration(durationMs);
  const showPlayButton = !wantsPlayback;

  return (
    <div
      ref={containerRef}
      className={cn("relative overflow-hidden rounded-panel bg-secondary", className)}
      style={{ aspectRatio: `${ratio}` }}
    >
      {/* Poster: placeholder, first visible frame and playback fallback. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={posterUrl}
        alt=""
        aria-hidden
        className="absolute inset-0 size-full object-cover"
        draggable={false}
      />

      {started ? (
        <video
          key={attempt}
          ref={videoRef}
          src={source}
          poster={posterUrl}
          muted={muted}
          playsInline
          preload="auto"
          controls={controls}
          aria-label="Clip"
          className="absolute inset-0 size-full object-cover"
          onLoadedData={() => {
            setFrameReady(true);
            setStatus("ready");
          }}
          onPlaying={() => {
            setFrameReady(true);
            setStatus("ready");
          }}
          onWaiting={() => {
            if (wantsPlayback) setStatus("loading");
          }}
          onEnded={() => {
            wantsRef.current = false;
            setWantsPlayback(false);
            updateClip(clipId, { playing: false, manual: false });
          }}
          onError={() => {
            // Cloudinary HLS (`sp_auto`) needs a streaming profile on the
            // account. When the playlist is missing the MP4 still plays, so
            // drop to the progressive rendition exactly once before failing.
            if (delivery !== "progressive" && progressiveUrl && source !== progressiveUrl) {
              setDelivery("progressive");
              setFrameReady(false);
              setStatus("loading");
              setAttempt((current) => current + 1);
              return;
            }
            console.warn("[feed-video] playback failed", { src: source });
            failPlayback("This clip couldn’t play. Check your connection and try again.");
          }}
        />
      ) : null}

      {/* Keeps the poster on top until a real frame is available. */}
      {started && !frameReady && status !== "failed" ? (
        <span aria-hidden className="absolute inset-0 bg-ink/5" />
      ) : null}

      {status === "loading" && wantsPlayback ? (
        <span className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-ink/15">
          <Spinner label="Loading clip" />
        </span>
      ) : null}

      {showPlayButton && status !== "failed" ? (
        <button
          type="button"
          aria-label="Play clip"
          onClick={() => startPlayback({ muted: false, manual: true })}
          className="absolute inset-0 z-20 flex items-center justify-center"
        >
          <span className="flex size-12 items-center justify-center rounded-full bg-raised/90 shadow-lift backdrop-blur-sm transition active:scale-95">
            <Play aria-hidden className="ml-0.5 size-5 text-ink" />
          </span>
        </button>
      ) : !controls && status !== "failed" ? (
        <button
          type="button"
          aria-label="Pause clip"
          onClick={pausePlayback}
          className="absolute inset-0 z-10"
        />
      ) : null}

      {status === "failed" ? (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-ink/55 p-4 text-center text-surface">
          <p className="text-caption font-bold">Clip unavailable</p>
          <p className="max-w-[220px] text-[11px] leading-[15px] opacity-90">
            {error ?? "This clip couldn’t play. Check your connection and try again."}
          </p>
          <button
            type="button"
            onClick={replay}
            className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-surface px-3.5 py-2 text-[11px] font-bold text-ink"
          >
            <RotateCcw aria-hidden className="size-3.5" />
            Try again
          </button>
        </div>
      ) : null}

      <span className="pointer-events-none absolute bottom-2 left-2 z-20 rounded-full bg-[rgb(35_28_30/0.72)] px-2 py-0.5 text-[10px] leading-[14px] font-bold text-surface tabular-nums">
        {duration}
      </span>

      {wantsPlayback ? (
        <button
          type="button"
          aria-label={muted ? "Unmute clip" : "Mute clip"}
          onClick={() => setMuted((current) => !current)}
          className="absolute right-2 bottom-2 z-20 flex size-7 items-center justify-center rounded-full bg-[rgb(35_28_30/0.72)] text-surface transition active:scale-95"
        >
          {muted ? (
            <VolumeX aria-hidden className="size-3.5" />
          ) : (
            <Volume2 aria-hidden className="size-3.5" />
          )}
        </button>
      ) : null}

      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          className="absolute top-2 right-2 z-20 rounded-full bg-raised/90 px-2.5 py-1 text-[10px] font-bold text-ink backdrop-blur-sm"
        >
          View post
        </button>
      ) : null}
    </div>
  );
}
