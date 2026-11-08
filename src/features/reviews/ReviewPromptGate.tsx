"use client";

import { WELCOME_CLOSED_EVENT, WELCOME_SEEN_KEY } from "@/components/shell/welcome-modal";
import { Avatar, Button } from "@/components/ui";
import { ProfessionalName } from "@/features/badges/ProfessionalName";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/auth-provider";
import { Check, Star, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchPendingReview, submitBookingReview, type PendingReview } from "./api";
import {
  REVIEW_PROMPT_WORDS,
  composeReviewBody,
  defaultReviewBody,
  reviewHighlights,
} from "./prompt";

// Gold rather than the brand rose: the one place Sheree borrows the gold of a
// review seal, same as the mobile prompt.
const STAR_COLOR = "#A76A20";

/**
 * The mobile app asks once per launch. A browser has no launch, so the web asks
 * once per tab session, keyed by member so switching accounts can still prompt.
 */
const promptedKey = (userId: string) => `sheree:review-prompted:${userId}`;

function alreadyPrompted(userId: string) {
  try {
    return window.sessionStorage.getItem(promptedKey(userId)) === "1";
  } catch {
    return false;
  }
}

function markPrompted(userId: string) {
  try {
    window.sessionStorage.setItem(promptedKey(userId), "1");
  } catch {
    /* best effort */
  }
}

function welcomeStillPending() {
  try {
    return window.sessionStorage.getItem(WELCOME_SEEN_KEY) !== "1";
  } catch {
    // Without storage the welcome opens every time, so wait for its close event.
    return true;
  }
}

const completedLabel = (value: string) =>
  new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "long" });

/**
 * "Appointment complete": the rating prompt from the mobile app.
 *
 * Opens once per session for a customer with a completed appointment from the
 * last 60 days that has no review. One star tap composes a valid review
 * sentence; highlights and a note refine it. The full review screen stays
 * reachable from Bookings for anyone who wants to write more.
 */
export function ReviewPromptGate() {
  const { user, appMode, role, onboardingCompleted, loading } = useAuth();
  const userId = user?.id ?? null;
  // A professional browsing in customer mode is asked too, but only about
  // appointments she booked as a customer (the query filters on customer_id).
  const customerMode = role === "customer" || appMode === "customer";
  const ready = Boolean(userId && onboardingCompleted && !loading && customerMode);

  const [pending, setPending] = useState<PendingReview | null>(null);
  const [rating, setRating] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ready || !userId || alreadyPrompted(userId)) return;
    let cancelled = false;
    let timer: number | undefined;

    const decide = () => {
      // A short beat lets a notification link finish landing: a completion push
      // already opens /review/<id>, and covering it with the same question is
      // redundant.
      timer = window.setTimeout(() => {
        if (cancelled || alreadyPrompted(userId)) return;
        markPrompted(userId);
        // Read at decision time so it sees wherever a deep link has landed.
        if (window.location.pathname.startsWith("/review")) return;
        // A failed lookup must never interrupt the visit; the prompt stays shut.
        void fetchPendingReview(userId)
          .catch(() => null)
          .then((review) => {
            if (cancelled || !review) return;
            setRating(0);
            setSelected([]);
            setNote("");
            setError("");
            setDone(false);
            setPending(review);
          });
      }, 700);
    };

    // Never stack on the first-visit welcome; take the turn after it closes.
    if (welcomeStillPending()) {
      window.addEventListener(WELCOME_CLOSED_EVENT, decide, { once: true });
    } else {
      decide();
    }
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.removeEventListener(WELCOME_CLOSED_EVENT, decide);
    };
  }, [ready, userId]);

  const close = useCallback(() => {
    setPending(null);
    setError("");
  }, []);

  const open = pending !== null;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [close, open]);

  useEffect(() => {
    if (!done) return;
    const timer = window.setTimeout(close, 1800);
    return () => window.clearTimeout(timer);
  }, [close, done]);

  const highlights = useMemo(() => reviewHighlights(rating), [rating]);
  const selectedLabels = useMemo(
    () => highlights.filter((item) => selected.includes(item.id)).map((item) => item.label),
    [highlights, selected],
  );
  const sharedBody = useMemo(
    () => composeReviewBody({ rating, highlights: selectedLabels, note }),
    [rating, selectedLabels, note],
  );

  const chooseRating = (value: number) => {
    if (rating === value) return;
    setRating(value);
    // Highlights belong to a rating band, so a band change starts over.
    setSelected([]);
  };

  const toggleHighlight = (id: string) =>
    setSelected((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );

  const submit = async () => {
    if (!pending || rating === 0 || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await submitBookingReview(pending.bookingId, rating, sharedBody);
      setDone(true);
    } catch (value) {
      setError(value instanceof Error ? value.message : "Your review could not be shared. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!pending) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={close}
        className="absolute inset-0 animate-fade bg-overlay"
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`Rate your appointment with ${pending.professionalName}`}
        className="relative flex max-h-[92dvh] w-full max-w-[420px] animate-rise flex-col rounded-card border border-line bg-surface px-6 pt-6 pb-2 shadow-card outline-none"
      >
        {done ? (
          <div role="status" className="flex flex-col items-center gap-2 py-8 text-center">
            <span className="flex size-16 items-center justify-center rounded-full bg-success-surface">
              <Check aria-hidden className="size-[30px] text-success" />
            </span>
            <p className="font-script text-[34px] leading-[44px] text-ink">Thank you, lovely.</p>
            <p className="text-caption text-muted">
              Your review for {pending.professionalName} is live.
            </p>
          </div>
        ) : (
          <>
            <button
              type="button"
              aria-label="Close"
              onClick={close}
              className="absolute top-3 right-3 z-10 flex size-8 items-center justify-center rounded-full bg-tint text-muted transition hover:text-ink"
            >
              <X aria-hidden className="size-[18px]" />
            </button>

            <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pb-1">
              <p className="text-center text-eyebrow text-primary uppercase">Appointment complete</p>
              <h2 className="-mt-0.5 text-center font-script text-[34px] leading-[44px] font-normal text-ink">
                {rating ? REVIEW_PROMPT_WORDS[rating] : "How did it feel?"}
              </h2>

              <div className="flex items-center gap-3 rounded-panel bg-background p-3">
                <span className="rounded-full border border-secondary p-0.5">
                  <Avatar src={pending.avatarUrl} name={pending.professionalName} size={52} />
                </span>
                <div className="min-w-0 flex-1">
                  <ProfessionalName
                    name={pending.professionalName}
                    professionalId={pending.professionalId}
                    verified={pending.verified}
                    founding={pending.founding}
                    size={15}
                    nameClassName="text-body font-medium text-ink"
                  />
                  <p className="truncate text-caption text-muted">
                    {pending.serviceName} · {completedLabel(pending.completedAt)}
                  </p>
                </div>
              </div>

              <div className="flex flex-col items-center gap-2 rounded-card bg-tint py-4">
                <div role="radiogroup" aria-label="Rating" className="flex gap-2">
                  {[1, 2, 3, 4, 5].map((value) => {
                    const on = value <= rating;
                    return (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={value === rating}
                        aria-label={`${value} star${value === 1 ? "" : "s"}`}
                        onClick={() => chooseRating(value)}
                        className="rounded-full p-0.5 transition hover:scale-110"
                      >
                        <Star
                          aria-hidden
                          className={cn("size-10", on ? "" : "text-line")}
                          style={on ? { color: STAR_COLOR, fill: STAR_COLOR } : undefined}
                          strokeWidth={on ? 1.5 : 1.75}
                        />
                      </button>
                    );
                  })}
                </div>
                <p className="text-center text-caption text-muted">
                  {rating === 0
                    ? "Tap a star — one tap is enough."
                    : "Tap another star to change your rating."}
                </p>
              </div>

              {rating > 0 ? (
                <>
                  <div className="flex flex-wrap gap-2">
                    {highlights.map((item) => {
                      const on = selected.includes(item.id);
                      return (
                        <button
                          key={item.id}
                          type="button"
                          aria-pressed={on}
                          onClick={() => toggleHighlight(item.id)}
                          className={cn(
                            "flex items-center gap-1 rounded-full border px-4 py-2 text-caption transition",
                            on
                              ? "border-primary bg-secondary font-bold text-ink"
                              : "border-line bg-background text-muted hover:text-ink",
                          )}
                        >
                          {on ? <Check aria-hidden className="size-[13px]" /> : null}
                          {item.label}
                        </button>
                      );
                    })}
                  </div>

                  <label htmlFor="review-prompt-note" className="text-caption font-bold text-ink">
                    Anything else?
                  </label>
                  <textarea
                    id="review-prompt-note"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    maxLength={600}
                    autoCapitalize="sentences"
                    placeholder="Add a note (optional)"
                    className="min-h-[84px] resize-none rounded-panel border border-line bg-background p-3 text-body text-ink outline-none placeholder:text-muted focus:border-primary"
                  />
                  <p className="text-center text-caption text-muted">
                    {selectedLabels.length || note.trim().length >= 10
                      ? "This is what will be shared."
                      : `Leave it blank and we'll share “${defaultReviewBody(rating)}”`}
                  </p>
                </>
              ) : null}

              {error ? (
                <p role="alert" className="text-caption text-danger">
                  {error}
                </p>
              ) : null}

              <Button disabled={rating === 0} loading={submitting} onClick={() => void submit()}>
                Share review
              </Button>
            </div>

            <button
              type="button"
              onClick={close}
              className="self-center px-4 py-3 text-caption text-muted transition hover:text-ink"
            >
              Maybe later
            </button>
          </>
        )}
      </div>
    </div>
  );
}
