"use client";

import { Avatar } from "@/components/ui";
import { ProfessionalName } from "@/features/badges/ProfessionalName";
import { fetchCustomerReviews, type CustomerReview } from "@/features/reviews/api";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

const stars = (rating: number) => "★".repeat(rating) + "☆".repeat(Math.max(0, 5 - rating));

/**
 * My reviews, ported from `CustomerReviewsScreen` — including the star glyphs
 * and their amber, which no icon set reproduces exactly.
 */
export default function CustomerReviewsPage() {
  const router = useRouter();
  const [items, setItems] = useState<CustomerReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(false);
    fetchCustomerReviews()
      .then(setItems)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="flex flex-col px-4 pb-12 pt-2">
      <button
        type="button"
        aria-label="Go back"
        onClick={() => router.back()}
        className="mb-6 flex size-11 items-center justify-center rounded-full bg-surface text-ink"
      >
        <span aria-hidden>←</span>
      </button>

      <p className="text-eyebrow text-primary uppercase">Your words</p>
      <h1 className="mt-1 text-page text-ink">My reviews</h1>
      <p className="mt-1 max-w-[340px] text-body text-muted">
        The experiences you’ve shared with the Sheree community.
      </p>

      {loading ? (
        <div className="mt-12 flex justify-center">
          <span className="size-6 animate-spin rounded-full border-2 border-secondary border-t-primary" />
        </div>
      ) : error ? (
        <Empty
          title="Reviews are out of reach"
          body="Check your connection and try again."
          action={load}
        />
      ) : items.length === 0 ? (
        <Empty
          title="No reviews yet"
          body="After a completed appointment, your reviews will live here."
        />
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {items.map((item) => (
            <li key={item.id} className="flex flex-col gap-3 rounded-card bg-surface p-4">
              <div className="flex items-center gap-3">
                <Avatar name={item.professionalName} src={item.avatarUrl} size={44} />
                <div className="min-w-0 flex-1">
                  <ProfessionalName
                    name={item.professionalName}
                    professionalId={item.professionalId}
                    size={15}
                    nameClassName="text-body font-medium text-ink"
                  />
                  <p className="text-[11px] text-muted">
                    {item.serviceName} ·{" "}
                    {new Date(item.createdAt).toLocaleDateString("en-GB", {
                      month: "short",
                      year: "numeric",
                    })}
                  </p>
                </div>
                <p
                  aria-label={`${item.rating} out of 5 stars`}
                  className="shrink-0 text-[11px] tracking-[.5px] text-[#A76A20]"
                >
                  {stars(item.rating)}
                </p>
              </div>
              <p className="text-body text-ink">{item.body}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Empty({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: () => void;
}) {
  return (
    <div className="mt-8 flex flex-col items-center gap-2 rounded-card bg-surface p-8 text-center">
      <span aria-hidden className="text-[27px] text-primary">
        ★
      </span>
      <p className="text-title text-ink">{title}</p>
      <p className="text-caption text-muted">{body}</p>
      {action ? (
        <button
          type="button"
          onClick={action}
          className="mt-2 rounded-full bg-primary px-6 py-2.5 text-caption font-bold text-surface"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}
