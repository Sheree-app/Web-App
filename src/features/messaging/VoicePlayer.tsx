"use client";

import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { formatDuration } from "./format";

/**
 * Voice-note playback.
 *
 * A single native `<audio>` element per bubble, with a real button and a
 * keyboard-seekable range. If the URL cannot be resolved (the thread was
 * cleaned up, or access was revoked) the bubble says so instead of pretending
 * to play.
 */
export function VoicePlayer({
  src,
  durationMillis,
  mine,
}: {
  src: string | null;
  durationMillis: number;
  mine: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setPlaying(false);
    setCurrent(0);
    setFailed(false);
  }, [src]);

  if (!src || failed) {
    return (
      <p
        className={cn(
          "flex items-center gap-2 text-caption",
          mine ? "text-surface/85" : "text-muted",
        )}
      >
        Voice note unavailable
      </p>
    );
  }

  const total = durationMillis > 0 ? durationMillis : 0;
  const shown = total > 0 ? Math.min(current, total) : current;

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play().catch(() => setFailed(true));
    } else {
      audio.pause();
    }
  };

  return (
    <div className="flex min-w-[190px] items-center gap-3">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setCurrent(0);
        }}
        onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime * 1000)}
        onError={() => setFailed(true)}
        className="hidden"
      />
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Pause voice note" : "Play voice note"}
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-full transition",
          mine ? "bg-surface/20 text-surface hover:bg-surface/30" : "bg-primary/12 text-primary hover:bg-primary/20",
        )}
      >
        {playing ? <Pause aria-hidden className="size-4" /> : <Play aria-hidden className="size-4" />}
      </button>
      <div className="min-w-0 flex-1">
        <label className="sr-only" htmlFor={`voice-${src.slice(-8)}`}>
          Seek voice note
        </label>
        <input
          id={`voice-${src.slice(-8)}`}
          type="range"
          min={0}
          max={Math.max(total, 1)}
          step={100}
          value={shown}
          onChange={(event) => {
            const audio = audioRef.current;
            const next = Number(event.target.value);
            setCurrent(next);
            if (audio) audio.currentTime = next / 1000;
          }}
          className={cn(
            "h-1.5 w-full cursor-pointer appearance-none rounded-full",
            mine ? "accent-surface bg-surface/30" : "accent-primary bg-primary/20",
          )}
        />
        <div
          className={cn(
            "mt-1 flex justify-between text-[10px] tabular-nums",
            mine ? "text-surface/80" : "text-muted",
          )}
        >
          <span>{formatDuration(shown)}</span>
          <span>{formatDuration(total)}</span>
        </div>
      </div>
    </div>
  );
}
