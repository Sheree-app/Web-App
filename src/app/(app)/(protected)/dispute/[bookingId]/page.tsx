"use client";
import { formatMoney, bookingDueNow, toCedis } from "@/lib/pricing";

import {
  Button,
  Chip,
  ErrorState,
  FormError,
  Input,
  Spinner,
  SuccessScreen,
  Textarea,
  TopBar,
} from "@/components/ui";
import {
  fetchBookingForDispute,
  submitBookingDispute,
  type DisputeBooking,
  type DisputeCategory,
} from "@/features/booking/api";
import { formatSlot } from "@/lib/utils";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

const CATEGORIES: Array<{ value: DisputeCategory; label: string }> = [
  { value: "service_quality", label: "The result wasn’t right" },
  { value: "no_show", label: "They didn’t show up" },
  { value: "cancellation", label: "Cancelled on me" },
  { value: "payment", label: "A payment problem" },
  { value: "conduct", label: "How I was treated" },
  { value: "other", label: "Something else" },
];

/**
 * Reporting a problem with a booking.
 *
 * The mirror of the review flow — same shape, different intent. Asking for a
 * category first means the safety team gets a triaged report, and the customer
 * gets an explanation of what happens next rather than a blank box.
 */
export default function DisputePage() {
  const params = useParams<{ bookingId: string }>();
  const bookingId = params.bookingId;

  const [booking, setBooking] = useState<DisputeBooking | null>(null);
  const [category, setCategory] = useState<DisputeCategory | "">("");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [refund, setRefund] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetchBookingForDispute(bookingId)
      .then((next) => {
        if (active) setBooking(next);
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : "This booking isn’t available.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [bookingId]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!category) {
      setError("Choose what went wrong.");
      return;
    }
    if (subject.trim().length < 3) {
      setError("Add a short subject so the team knows what this is about.");
      return;
    }
    if (description.trim().length < 20) {
      setError("Tell us what happened in a little more detail.");
      return;
    }

    const requestedRefund = refund.trim() ? Number(refund) : null;
    if (requestedRefund !== null && (!Number.isFinite(requestedRefund) || requestedRefund < 0)) {
      setError("A refund request has to be a number.");
      return;
    }

    setSaving(true);
    setError("");

    try {
      await submitBookingDispute({
        bookingId,
        category,
        subject: subject.trim(),
        description: description.trim(),
        requestedRefund,
      });
      setDone(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That report couldn’t be sent.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[50dvh] items-center justify-center">
        <Spinner label="Loading booking" />
      </div>
    );
  }

  if (done) {
    return (
      <SuccessScreen
        title="Report received."
        message="Our safety team reads every report. You’ll get an update on this booking, and you can still cancel separately if you need to."
        actionLabel="Back to bookings"
        actionHref="/bookings"
      />
    );
  }

  if (!booking) {
    return (
      <div className="flex flex-col gap-4">
        <TopBar title="Report a problem" backTo="/bookings" />
        <ErrorState message={error || "This booking isn’t available."} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <TopBar title="Report a problem" subtitle={booking.professionalName} backTo="/bookings" />

      <div className="rounded-card bg-surface p-4 shadow-card">
        <p className="text-title text-ink">{booking.serviceName}</p>
        <p className="text-caption text-muted">{formatSlot(booking.startsAt)}</p>
        <p className="text-caption text-muted">
          Deposit paid: {formatMoney(toCedis(bookingDueNow({deposit_amount: booking.depositAmount, sheree_fee_amount: booking.shereeFeeAmount})), booking.currency)} · {booking.status}
        </p>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-3">
          <legend className="text-caption text-muted">What went wrong?</legend>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((option) => (
              <Chip
                key={option.value}
                label={option.label}
                selected={category === option.value}
                onClick={() => {
                  setCategory(option.value);
                  setError("");
                }}
              />
            ))}
          </div>
        </fieldset>

        <Input
          label="Subject"
          placeholder="e.g. Appointment started an hour late"
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          maxLength={120}
        />

        <Textarea
          label="What happened?"
          placeholder="Dates, what was agreed, what actually happened, anyone else involved."
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />

        <Input
          label="Refund you’re asking for (optional)"
          inputMode="decimal"
          placeholder="0.00"
          value={refund}
          onChange={(event) => setRefund(event.target.value)}
          hint="Leave this blank if you just want the problem on record."
        />

        {error ? <FormError message={error} /> : null}

        <Button type="submit" size="lg" loading={saving}>
          Send report
        </Button>
      </form>
    </div>
  );
}
