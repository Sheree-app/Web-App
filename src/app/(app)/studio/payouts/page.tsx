"use client";
import { usePricing } from "@/providers/pricing-provider";

import {
  Badge,
  ButtonLink,
  Card,
  CardSkeleton,
  EmptyState,
  ErrorState,
  StatTile,
} from "@/components/ui";
import { fetchPayouts, type Payout, type PayoutsData } from "@/features/account/payoutsApi";
import { useAuth } from "@/providers/auth-provider";
import { formatDay } from "@/lib/utils";
import { useEffect, useState } from "react";

const STATUS_TONE: Record<Payout["status"], "neutral" | "success" | "warning" | "error"> = {
  pending: "warning",
  processing: "warning",
  paid: "success",
  failed: "error",
  reversed: "error",
};

const TYPE_LABEL: Record<Payout["payoutType"], string> = {
  completion: "Completed appointment",
  customer_cancellation: "Customer cancellation",
};

/**
 * Money, told plainly: what's expected, what's landed, what needs attention.
 *
 * The mobile app grouped payouts the same way. Anything marked failed or
 * reversed is surfaced first, because that is the only part that needs action.
 */
export default function PayoutsPage() {
  const { money: formatMoney } = usePricing();
  const { user } = useAuth();
  const [data, setData] = useState<PayoutsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let active = true;
    fetchPayouts(user.id)
      .then((next) => {
        if (active) setData(next);
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : "We couldn’t load your payouts.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [user]);

  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        <CardSkeleton lines={2} />
        <CardSkeleton lines={3} />
      </div>
    );
  }

  if (error || !data) {
    return <ErrorState message={error ?? "Your payouts couldn’t be loaded."} />;
  }

  const needsAttention = data.items.filter((item) => item.status === "failed" || item.status === "reversed");

  return (
    <div className="flex flex-col gap-5">
      <header>
        <p className="text-eyebrow text-primary uppercase">Payouts</p>
        <h1 className="text-page text-ink">What you’ve earned.</h1>
      </header>

      <div className="flex gap-3">
        <StatTile label="Expected" value={formatMoney(data.summary.expected)} />
        <StatTile label="Received" value={formatMoney(data.summary.received)} />
        <StatTile label="Needs attention" value={formatMoney(data.summary.attention)} />
      </div>

      <Card className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-title text-ink">Payout account</h2>
            <p className="text-caption text-muted">
              {data.account?.configured
                ? `${data.account.institutionName ?? "Account"} ····${data.account.last4 ?? ""} (${data.account.accountName ?? ""})`
                : "Not set up yet — completed appointments can’t be paid out until it is."}
            </p>
          </div>
          <ButtonLink href="/studio/payouts/account" size="sm" variant="outline">
            {data.account?.configured ? "Change" : "Set up"}
          </ButtonLink>
        </div>
      </Card>

      {needsAttention.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-section text-ink">Needs attention</h2>
          <ul className="flex flex-col gap-3">
            {needsAttention.map((payout) => (
              <li key={payout.id}>
                <Card className="flex flex-col gap-1 border-l-4 border-danger">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-title text-ink">{payout.serviceName ?? "Appointment"}</p>
                    <Badge label={payout.status} tone={STATUS_TONE[payout.status]} />
                  </div>
                  <p className="text-caption text-muted">
                    {formatMoney(payout.amount)} · {payout.bookingReference ?? ""}
                  </p>
                  {payout.failureReason ? (
                    <p className="text-caption text-danger">{payout.failureReason}</p>
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-section text-ink">History</h2>
        {data.items.length === 0 ? (
          <EmptyState
            title="No payouts yet"
            message="Payouts are created when an appointment is completed or a customer cancels. They’ll appear here with their status."
            actionLabel="Back to studio"
            actionHref="/studio"
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {data.items.map((payout) => (
              <li key={payout.id}>
                <Card className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-title text-ink">
                      {payout.serviceName ?? "Appointment"}
                    </p>
                    <p className="truncate text-caption text-muted">
                      {TYPE_LABEL[payout.payoutType] ?? payout.payoutType} ·{" "}
                      {formatDay(payout.createdAt)}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-title text-ink">{formatMoney(payout.amount)}</span>
                    <Badge label={payout.status} tone={STATUS_TONE[payout.status]} />
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
