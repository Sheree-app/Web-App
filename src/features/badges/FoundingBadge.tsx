"use client";

import { cn } from "@/lib/utils";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FoundingBeauticianArtwork } from "./artwork";
import {
  getCachedFoundingBadge,
  getCachedFoundingBadgeForUser,
  requestFoundingBadge,
  requestFoundingBadgeForUser,
  subscribeFoundingBadges,
  type FoundingBadgeData,
} from "./store";

export type FoundingBadgeProps = {
  /** Known founding status from a feed/search row. Skips the lookup. */
  founding?: boolean | null;
  /** Professional profile id — the preferred lazy lookup key. */
  professionalId?: string | null;
  /** Sheree user id, used by messaging where no profile id is available. */
  userId?: string | null;
  /** Categories the professional was founding in, when already known. */
  categories?: string[] | null;
  /** Icon + text pill instead of the compact icon-only mark. */
  label?: boolean;
  /** Artwork edge length in pixels. */
  size?: number;
  /**
   * Set false inside a link/button that already owns the click (explore tiles,
   * inbox rows). The badge still renders with its accessible label.
   */
  interactive?: boolean;
  className?: string;
};

/** The explanation shown in the badge dialog. */
export const FOUNDING_EXPLANATION =
  "Founding Beautician is an early-era achievement: it marks the first beauticians to qualify in each category on Sheree. It is separate from professional verification — a founding beautician may or may not be verified, and a verified professional is not automatically founding.";

const LABEL = "Founding Beautician";

/**
 * The pink Founding Beautician badge, ported from the mobile component.
 *
 * Renders immediately when `founding` is supplied, otherwise resolves lazily
 * from `professionalId` (or `userId` for messaging) through the shared store.
 * It renders nothing unless the server says the professional is founding.
 */
export function FoundingBadge({
  founding,
  professionalId,
  userId,
  categories,
  label = false,
  size = 16,
  interactive = true,
  className,
}: FoundingBadgeProps) {
  const [resolved, setResolved] = useState<FoundingBadgeData | null | undefined>(() => {
    if (professionalId) return getCachedFoundingBadge(professionalId);
    if (userId) return getCachedFoundingBadgeForUser(userId);
    return undefined;
  });
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();

  // Only look anything up when the caller does not already know the answer.
  useEffect(() => {
    if (founding === true || founding === false) return;
    if (!professionalId && !userId) return;

    let active = true;
    const read = () =>
      professionalId
        ? getCachedFoundingBadge(professionalId)
        : userId
          ? getCachedFoundingBadgeForUser(userId)
          : undefined;

    const cached = read();
    if (cached !== undefined) setResolved(cached);

    const unsubscribe = subscribeFoundingBadges(() => {
      const next = read();
      if (active && next !== undefined) setResolved(next);
    });

    const request =
      userId && !professionalId
        ? requestFoundingBadgeForUser(userId)
        : requestFoundingBadge(professionalId);

    request
      .then((value) => {
        if (active) setResolved(value);
      })
      .catch(() => undefined);

    return () => {
      active = false;
      unsubscribe();
    };
  }, [founding, professionalId, userId]);

  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    panelRef.current?.focus();
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const data: FoundingBadgeData | null | undefined =
    founding === true
      ? {
          professionalId: professionalId ?? "",
          isFounding: true,
          position: null,
          categories: categories ?? [],
          awardedAt: null,
        }
      : founding === false
        ? null
        : resolved;

  if (!data?.isFounding) return null;

  const badgeCategories = data.categories.length ? data.categories : (categories ?? []);

  const artwork = (
    <FoundingBeauticianArtwork
      size={size}
      className={cn("shrink-0", label && size < 16 && "mt-px")}
    />
  );

  const appearance = label
    ? "inline-flex items-center gap-1.5 rounded-full bg-[#FCE3EE] px-2 py-[3px] align-middle text-[10px] leading-[13px] font-bold tracking-[0.2px] text-[#8C2350] ring-1 ring-[#F5BBD3]"
    : "inline-flex items-center justify-center align-middle";

  if (!interactive) {
    return (
      <span
        role="img"
        aria-label={LABEL}
        title={LABEL}
        className={cn(appearance, className)}
      >
        {artwork}
        {label ? <span>{LABEL}</span> : null}
      </span>
    );
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={LABEL}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={LABEL}
        onClick={(event) => {
          // Badges also live inside tappable bylines; don't trigger them too.
          event.stopPropagation();
          setOpen((current) => !current);
        }}
        className={cn(
          appearance,
          "rounded-full transition hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
          className,
        )}
      >
        {artwork}
        {label ? <span>{LABEL}</span> : null}
      </button>

      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed inset-0 z-[80] flex items-center justify-center bg-ink/35 p-4"
              onPointerDown={(event) => {
                if (event.target === event.currentTarget) close();
              }}
            >
              <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
                className="w-full max-w-[340px] rounded-card bg-raised p-5 text-left shadow-lift outline-none"
              >
                <div className="flex items-center gap-2.5">
                  <FoundingBeauticianArtwork size={30} />
                  <h2 id={titleId} className="text-title text-ink">
                    {LABEL}
                  </h2>
                </div>

                <p className="mt-3 text-caption leading-[19px] text-muted">
                  {FOUNDING_EXPLANATION}
                </p>

                {badgeCategories.length ? (
                  <p className="mt-3 text-caption text-ink">
                    <span className="font-bold">Founding category:</span>{" "}
                    {badgeCategories.join(", ")}
                  </p>
                ) : null}

                {data.position ? (
                  <p className="mt-1 text-caption text-ink">
                    <span className="font-bold">Founding position:</span> #{data.position}
                  </p>
                ) : null}

                <button
                  type="button"
                  onClick={close}
                  className="mt-4 min-h-10 w-full rounded-full bg-primary px-5 text-caption font-bold text-surface transition active:scale-[.99]"
                >
                  Close
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
