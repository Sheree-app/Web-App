"use client";

import { Button, ErrorState, FormError, Spinner, SuccessScreen, Textarea, TopBar } from "@/components/ui";
import {
  BookingAvailabilityError,
  bookingAvailabilityAlert,
  fetchAvailability,
  fetchBookingForReschedule,
  fetchBookingSlots,
  rescheduleBooking,
  type AvailabilityDay,
  type BookingSlot,
  type RescheduleBooking,
} from "@/features/booking/api";
import { cn, formatSlot } from "@/lib/utils";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

const DAY_COUNT = 35;

function todayISO() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

/** Same calendar rules as booking — the backend enforces them either way. */
export default function ReschedulePage() {
  const params = useParams<{ bookingId: string }>();
  const bookingId = params.bookingId;

  const [booking, setBooking] = useState<RescheduleBooking | null>(null);
  const [days, setDays] = useState<AvailabilityDay[]>([]);
  const [slots, setSlots] = useState<BookingSlot[]>([]);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    fetchBookingForReschedule(bookingId)
      .then(async (next) => {
        if (!active) return;
        setBooking(next);
        setNotes(next.notes ?? "");
        const calendar = (await fetchAvailability(
          next.professionalId,
          next.serviceId,
          todayISO(),
          DAY_COUNT,
        )) as AvailabilityDay[];
        if (!active) return;
        setDays(calendar);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "This booking isn’t available.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [bookingId]);

  const loadSlots = useCallback(
    async (nextDate: string) => {
      if (!booking) return;
      setLoadingSlots(true);
      setTime("");
      try {
        setSlots(await fetchBookingSlots(booking.professionalId, booking.serviceId, nextDate));
      } catch {
        setSlots([]);
      } finally {
        setLoadingSlots(false);
      }
    },
    [booking],
  );

  useEffect(() => {
    if (date && booking) void loadSlots(date);
  }, [booking, date, loadSlots]);

  const submit = async () => {
    if (!booking || !date || !time) {
      setError("Choose a new date and time.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await rescheduleBooking(
        bookingId,
        new Date(`${date}T${time}:00`).toISOString(),
        notes,
        booking.isMobileService,
      );
      setDone(true);
    } catch (cause) {
      if (cause instanceof BookingAvailabilityError) {
        const alert = bookingAvailabilityAlert(cause.message);
        setError(`${alert.title}. ${alert.message}`);
        void loadSlots(date);
      } else {
        setError(cause instanceof Error ? cause.message : "That change didn’t go through.");
      }
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
        title="Moved."
        message="Both of you will see the new time. Everything else about the booking stays the same."
        actionLabel="Back to bookings"
        actionHref="/bookings"
      />
    );
  }

  if (!booking) {
    return (
      <div className="flex flex-col gap-4">
        <TopBar title="Reschedule" backTo="/bookings" />
        <ErrorState message={error || "This booking isn’t available."} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <TopBar title="Reschedule" subtitle={booking.serviceName} backTo="/bookings" />

      <div className="rounded-card bg-surface p-4 shadow-card">
        <p className="text-caption text-muted">Currently booked for</p>
        <p className="text-title text-ink">{formatSlot(booking.startsAt)}</p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-section text-ink">Pick a new day</h2>
        <div className="rail -mx-4 px-4">
          {days.map((day) => {
            const value = new Date(`${day.date}T12:00:00`);
            const disabled = day.state === "full" || day.state === "closed";
            return (
              <button
                key={day.date}
                type="button"
                disabled={disabled}
                aria-pressed={date === day.date}
                onClick={() => setDate(day.date)}
                className={cn(
                  "flex w-16 flex-col items-center gap-0.5 rounded-panel px-2 py-3 text-caption transition",
                  disabled ? "bg-surface text-muted opacity-45" : "bg-surface text-ink shadow-card",
                  date === day.date && "ring-2 ring-primary",
                )}
              >
                <span className="text-muted">
                  {new Intl.DateTimeFormat("en-GB", { weekday: "short" }).format(value)}
                </span>
                <span className="text-title text-ink">
                  {new Intl.DateTimeFormat("en-GB", { day: "numeric" }).format(value)}
                </span>
                <span className="text-muted">
                  {new Intl.DateTimeFormat("en-GB", { month: "short" }).format(value)}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-section text-ink">Pick a time</h2>
        {loadingSlots ? (
          <p className="text-caption text-muted">Checking open times…</p>
        ) : !date ? (
          <p className="text-caption text-muted">Choose a day first.</p>
        ) : slots.length === 0 ? (
          <p className="text-caption text-muted">No times left on that day. Try another.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {slots.map((slot) => (
              <button
                key={slot.time}
                type="button"
                disabled={!slot.available}
                title={slot.reason ?? undefined}
                aria-pressed={time === slot.time}
                onClick={() => setTime(slot.time)}
                className={cn(
                  "min-w-20 rounded-field px-4 py-3 text-caption transition",
                  slot.available
                    ? time === slot.time
                      ? "bg-primary text-surface"
                      : "bg-surface text-ink shadow-card"
                    : "cursor-not-allowed bg-surface text-muted opacity-45",
                )}
              >
                {slot.time}
              </button>
            ))}
          </div>
        )}
      </section>

      <Textarea
        label="Update the notes? (optional)"
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
      />

      {error ? <FormError message={error} /> : null}

      <Button size="lg" loading={saving} disabled={!date || !time} onClick={() => void submit()}>
        Move my appointment
      </Button>
    </div>
  );
}
