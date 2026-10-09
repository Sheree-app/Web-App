"use client";

import {
  Avatar,
  Button,
  ButtonLink,
  Card,
  ErrorState,
  Spinner,
  SuccessScreen,
  Textarea,
  TopBar,
} from "@/components/ui";
import { createReview, fetchReviewContext, type ReviewContext } from "@/features/reviews/api";
import { cn, formatDay } from "@/lib/utils";
import { Star } from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

const RATING_LABELS: Record<number, string> = {
  1: "Not what was promised",
  2: "Below what I expected",
  3: "Fine, nothing memorable",
  4: "Really good",
  5: "I would book again tomorrow",
};

/**
 * Leaving a review.
 *
 * Reviews are only offered once a booking is completed, and the wording of the
 * rating scale matters more than the number: it gives people language for what
 * they actually felt, which is what makes reviews useful to the next customer.
 */
export default function ReviewPage() {
  const params = useParams<{ bookingId: string }>();
  const bookingId = params.bookingId;

  const [context, setContext] = useState<ReviewContext | null>(null);
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchReviewContext(bookingId)
      .then((next) => {
        if (!active) return;
        setContext(next);
        if (next.existingReview) {
          setRating(next.existingReview.rating);
          setBody(next.existingReview.body);
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : "This review isn’t available.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [bookingId]);

  const submit = async () => {
    if (!context || rating < 1) {
      setError("Pick a star rating first.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await createReview(context, rating, body.trim());
      setDone(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That review couldn’t be saved.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[50dvh] items-center justify-center">
        <Spinner label="Loading your booking" />
      </div>
    );
  }

  if (done) {
    return (
      <SuccessScreen
        title="Thank you for the review."
        message="It’s on their profile now, and it helps the next person choose well."
        actionLabel="Back to bookings"
        actionHref="/bookings"
      />
    );
  }

  if (error && !context) {
    return (
      <div className="flex flex-col gap-4">
        <TopBar title="Review" backTo="/bookings" />
        <ErrorState message={error} onRetry={() => window.location.reload()} />
      </div>
    );
  }

  if (!context) return null;

  const editable = !context.existingReview;

  return (
    <div className="flex flex-col gap-4">
      <TopBar title="Review" subtitle={context.serviceName} backTo="/bookings" />

      <Card className="flex items-center gap-3">
        <Avatar name={context.professionalName} src={context.avatarUrl} size={48} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-title text-ink">{context.professionalName}</p>
          <p className="text-caption text-muted">
            {context.serviceName}
            {context.completedAt ? ` · ${formatDay(context.completedAt)}` : ""}
          </p>
        </div>
      </Card>

      <fieldset className="flex flex-col gap-3" disabled={!editable}>
        <legend className="text-caption text-muted">How was it?</legend>
        <div className="flex items-center gap-2">
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              type="button"
              aria-label={`${value} star${value === 1 ? "" : "s"}`}
              aria-pressed={rating === value}
              onClick={() => {
                setRating(value);
                setError(null);
              }}
              className={cn(
                "flex size-12 items-center justify-center rounded-full transition",
                value <= rating ? "bg-secondary text-primary" : "bg-surface text-muted shadow-card",
              )}
            >
              <Star aria-hidden className={cn("size-6", value <= rating && "fill-primary")} />
            </button>
          ))}
        </div>
        {rating > 0 ? (
          <p className="text-caption text-ink">{RATING_LABELS[rating]}</p>
        ) : (
          <p className="text-caption text-muted">Tap a star to rate.</p>
        )}
      </fieldset>

      <Textarea
        label="What should the next customer know?"
        placeholder="How the result turned out, timing, how they handled the appointment…"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        disabled={!editable}
      />

      {error ? (
        <p role="alert" className="rounded-field bg-danger-surface p-3 text-caption text-ink">
          {error}
        </p>
      ) : null}

      {editable ? (
        <Button size="lg" loading={saving} onClick={() => void submit()}>
          Publish review
        </Button>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="rounded-field bg-success-surface p-3 text-caption text-ink">
            You’ve already reviewed this appointment.
          </p>
          <ButtonLink href="/bookings" variant="ghost">
            Back to bookings
          </ButtonLink>
        </div>
      )}
    </div>
  );
}
