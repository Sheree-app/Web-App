"use client";

import { Avatar, RowSkeleton, Sheet } from "@/components/ui";
import { cancelCustomerBooking, fetchCustomerBookings } from "@/features/booking/api";
import { formatTime12 } from "@/features/booking/time-format";
import { useToast } from "@/providers/toast-provider";
import {
  ArrowLeftRight,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock,
  CloudOff,
  History,
  PlusCircle,
  Receipt,
  Star,
  XCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";

type Booking = Awaited<ReturnType<typeof fetchCustomerBookings>>["items"][number];
type Filter = "upcoming" | "past";

/** Same money as the app's booking list: whole cedi, no pesewas. */
const money = (value: number) =>
  new Intl.NumberFormat("en-GH", {
    style: "currency",
    currency: "GHS",
    maximumFractionDigits: 0,
  }).format(value);

const dayNumber = (value: string) =>
  new Date(value).toLocaleDateString("en-GB", { day: "2-digit" });

const monthShort = (value: string) =>
  new Date(value).toLocaleDateString("en-GB", { month: "short" }).toUpperCase();

const fullDate = (value: string) =>
  new Date(value).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

const STATUS_COPY: Record<string, string> = {
  requested: "Awaiting approval",
  confirmed: "Confirmed",
  cancelled: "Cancelled",
  completed: "Completed",
};

const statusCopy = (status: string) => STATUS_COPY[status] ?? status;

const paymentLabel = (booking: Booking) =>
  booking.paymentStatus === "refund_pending"
    ? "Refund processing"
    : booking.paymentStatus === "refunded"
      ? "Deposit refunded"
      : booking.paymentStatus === "paid"
        ? "Deposit paid"
        : "Balance due";

const paymentValue = (booking: Booking) =>
  booking.paymentStatus === "refunded"
    ? money(booking.depositAmount)
    : booking.paymentStatus === "paid" || booking.paymentStatus === "refund_pending"
      ? money(booking.price)
      : money(booking.balanceAmount);

const TONE: Record<string, string> = {
  confirmed: "bg-success text-success",
  requested: "bg-warning text-warning",
};

const toneOf = (status: string) => TONE[status] ?? "bg-muted text-muted";

const isLive = (booking: Booking) =>
  booking.status === "requested" || booking.status === "confirmed";

/**
 * Bookings, rebuilt from `CustomerBookingsScreen`: the same heading and
 * Upcoming/Past tabs, the featured next appointment, the date-tile cards, and
 * one action sheet per booking with Reschedule, Cancel, Add review and Book
 * again — always available, exactly as the app offers it.
 */
export default function BookingsPage() {
  const router = useRouter();
  const { success, error: showError, toast } = useToast();

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [filter, setFilter] = useState<Filter>("upcoming");
  const [selected, setSelected] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState("");
  const [confirmCancel, setConfirmCancel] = useState<Booking | null>(null);
  // A ticking clock, so "Upcoming" quietly moves lapsed appointments to history
  // without anyone having to reload the page.
  const [clock, setClock] = useState(0);

  useEffect(() => {
    const tick = () => setClock(Date.now());
    tick();
    const timer = window.setInterval(tick, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const load = useCallback(async () => {
    try {
      const page = await fetchCustomerBookings(null, 30);
      setBookings(page.items);
      setError(null);
    } catch {
      setError("We couldn’t load your appointments. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // The app splits by time as well as status, so a lapsed booking never sits in
  // "Upcoming" waiting to be noticed.
  const visible = bookings
    .filter((booking) => {
      const isHistory = booking.status === "cancelled" || booking.status === "completed";
      const settled = clock > 0 && new Date(booking.endsAt).getTime() < clock;
      return filter === "upcoming"
        ? !isHistory && !settled
        : isHistory || settled;
    })
    .sort((a, b) =>
      filter === "upcoming"
        ? +new Date(a.startsAt) - +new Date(b.startsAt)
        : +new Date(b.startsAt) - +new Date(a.startsAt),
    );

  const next = filter === "upcoming" ? visible[0] : undefined;

  const cancel = async (booking: Booking) => {
    setCancelling(booking.id);
    try {
      const result = await cancelCustomerBooking(booking.id);
      await load();
      setConfirmCancel(null);
      setSelected(null);
      if (result.warning) {
        toast("Booking cancelled", { tone: "info", detail: result.warning });
      } else if (result.refund === "needs_attention") {
        toast("Booking cancelled", {
          tone: "info",
          detail:
            "Paystack needs additional account details to complete this refund. Sheree support will follow up.",
        });
      } else if (result.refund === "pending" || result.refund === "processing") {
        toast("Booking cancelled", {
          tone: "success",
          detail: `${money(result.refundAmount ?? booking.depositAmount * 0.9)} is now being refunded. The professional receives ${money(
            result.professionalCompensation ?? booking.depositAmount * 0.1,
          )}.`,
        });
      } else {
        success("Booking cancelled", "The professional can offer this time to someone else.");
      }
    } catch (cause) {
      showError(
        "Booking unchanged",
        cause instanceof Error ? cause.message : "Please try again.",
      );
    } finally {
      setCancelling("");
    }
  };

  const covered = next ? 1 : 0;

  return (
    <div className="flex flex-col">
      <p className="text-eyebrow text-primary uppercase">Your appointments</p>
      <h1 className="text-page text-ink">Bookings</h1>
      <p className="mt-0.5 text-caption text-muted">Everything you’ve planned, all in one place.</p>

      <div role="tablist" className="mt-6 mb-6 flex gap-1 rounded-full bg-tint p-1">
        {(["upcoming", "past"] as Filter[]).map((item) => {
          const active = filter === item;
          return (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setFilter(item)}
              className={
                active
                  ? "min-h-[42px] flex-1 rounded-full bg-raised text-caption font-bold text-ink shadow-card"
                  : "min-h-[42px] flex-1 rounded-full text-caption font-medium text-muted"
              }
            >
              {item[0].toUpperCase() + item.slice(1)}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="flex flex-col gap-3 pt-6">
          <RowSkeleton />
          <RowSkeleton />
          <RowSkeleton />
        </div>
      ) : error ? (
        <State
          icon={<CloudOff aria-hidden className="size-7" />}
          title="Your diary is out of reach"
          body={error}
          action="Try again"
          onAction={() => void load()}
        />
      ) : visible.length === 0 ? (
        <State
          icon={
            filter === "upcoming" ? (
              <CalendarDays aria-hidden className="size-7" />
            ) : (
              <History aria-hidden className="size-7" />
            )
          }
          title={filter === "upcoming" ? "Nothing in the diary yet" : "No past bookings"}
          body={
            filter === "upcoming"
              ? "Find a professional you love and choose a time that works for you."
              : "Completed and cancelled appointments will stay here."
          }
          action={filter === "upcoming" ? "Explore services" : undefined}
          onAction={() => router.push("/explore")}
        />
      ) : (
        <div className="flex flex-col">
          {next ? (
            <BookingCard booking={next} featured onOpen={() => setSelected(next)} />
          ) : null}
          {visible.length > covered ? (
            <p className="mb-3 text-[9px] leading-[14px] font-bold tracking-[1.5px] text-muted uppercase">
              {filter === "upcoming" ? "Later" : "Booking history"}
            </p>
          ) : null}
          {visible.slice(covered).map((booking) => (
            <BookingCard key={booking.id} booking={booking} onOpen={() => setSelected(booking)} />
          ))}
        </div>
      )}

      <Sheet
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected?.serviceName ?? ""}
        description={selected ? "Appointment" : undefined}
      >
        {selected ? (
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <Avatar name={selected.professionalName} src={selected.avatarUrl} size={22} />
              <span className="min-w-0 flex-1 truncate text-caption text-muted">
                {selected.professionalName}
              </span>
              <span
                aria-hidden
                className={`mt-1 size-[9px] shrink-0 rounded-full ${toneOf(selected.status).split(" ")[0]}`}
              />
            </div>

            <Detail icon={<Clock aria-hidden className="size-[18px]" />}>
              {fullDate(selected.startsAt)} · {formatTime12(selected.startsAt)}
            </Detail>
            <Detail
              icon={
                <CheckCircle2
                  aria-hidden
                  className={`size-[18px] ${toneOf(selected.status).split(" ")[1]}`}
                />
              }
              tone={toneOf(selected.status).split(" ")[1]}
            >
              {statusCopy(selected.status)}
            </Detail>
            <Detail icon={<Receipt aria-hidden className="size-[18px]" />}>
              {paymentLabel(selected)} · {paymentValue(selected)}
            </Detail>

            <div className="mt-8 flex flex-col gap-3">
              {isLive(selected) ? (
                <button
                  type="button"
                  onClick={() => {
                    const id = selected.id;
                    setSelected(null);
                    router.push(`/reschedule/${id}`);
                  }}
                  className="flex min-h-[54px] items-center justify-center gap-2 rounded-panel bg-primary text-body font-medium text-surface transition active:scale-[.99]"
                >
                  <ArrowLeftRight aria-hidden className="size-[19px]" />
                  Reschedule
                </button>
              ) : null}

              {isLive(selected) ? (
                <button
                  type="button"
                  disabled={Boolean(cancelling)}
                  onClick={() => {
                    setConfirmCancel(selected);
                    setSelected(null);
                  }}
                  className="flex min-h-[52px] items-center justify-center gap-2 rounded-panel border border-line bg-surface text-body font-medium text-danger transition active:scale-[.99] disabled:opacity-50"
                >
                  <XCircle aria-hidden className="size-[19px]" />
                  Cancel
                </button>
              ) : null}

              {selected.status === "completed" && !selected.reviewed ? (
                <button
                  type="button"
                  onClick={() => {
                    const id = selected.id;
                    setSelected(null);
                    router.push(`/review/${id}`);
                  }}
                  className="flex min-h-[52px] items-center justify-center gap-2 rounded-panel border border-line bg-surface text-body font-medium text-ink transition active:scale-[.99]"
                >
                  <Star aria-hidden className="size-[18px]" />
                  Add review
                </button>
              ) : null}

              <button
                type="button"
                onClick={() => {
                  const id = selected.professionalId;
                  setSelected(null);
                  router.push(`/services/${id}`);
                }}
                className="flex min-h-[52px] items-center justify-center gap-2 rounded-panel border border-line bg-surface text-body font-medium text-ink transition active:scale-[.99]"
              >
                <PlusCircle aria-hidden className="size-[19px]" />
                Book again
              </button>
            </div>
          </div>
        ) : null}
      </Sheet>

      <Sheet
        open={Boolean(confirmCancel)}
        onClose={() => setConfirmCancel(null)}
        title="Cancel this booking?"
        footer={
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setConfirmCancel(null)}
              className="min-h-[54px] flex-1 rounded-panel bg-surface text-body font-medium text-ink"
            >
              Keep booking
            </button>
            <button
              type="button"
              disabled={Boolean(cancelling)}
              onClick={() => confirmCancel && void cancel(confirmCancel)}
              className="min-h-[54px] flex-1 rounded-panel bg-danger text-body font-medium text-surface disabled:opacity-60"
            >
              {cancelling ? "Cancelling…" : "Cancel booking"}
            </button>
          </div>
        }
      >
        {confirmCancel ? (
          <p className="text-body text-muted">
            {confirmCancel.paymentStatus === "paid"
              ? `${money(confirmCancel.depositAmount * 0.9)} will be refunded through Paystack. The professional receives ${money(
                  confirmCancel.depositAmount * 0.1,
                )} for the cancellation.`
              : "This appointment will move to your booking history."}
          </p>
        ) : null}
      </Sheet>
    </div>
  );
}

function BookingCard({
  booking,
  featured = false,
  onOpen,
}: {
  booking: Booking;
  featured?: boolean;
  onOpen: () => void;
}) {
  const [dot, text] = toneOf(booking.status).split(" ");

  return (
    <button
      type="button"
      aria-label={`Open ${booking.serviceName} appointment details`}
      onClick={onOpen}
      className={
        featured
          ? "mb-6 flex flex-col rounded-card bg-tint p-5 text-left transition active:scale-[.995] active:opacity-90"
          : "mb-3 flex flex-col rounded-card bg-surface p-4 text-left shadow-card transition active:scale-[.995] active:opacity-90"
      }
    >
      {featured ? (
        <span className="mb-3 text-[9px] leading-[14px] font-bold tracking-[1.5px] text-primary uppercase">
          Next appointment
        </span>
      ) : null}

      <span className="flex items-center gap-3">
        <span
          className={
            featured
              ? "flex size-14 shrink-0 flex-col items-center justify-center rounded-field bg-ink"
              : "flex size-[56px] shrink-0 flex-col items-center justify-center rounded-field bg-tint"
          }
        >
          <span
            className={
              featured
                ? "text-[9px] leading-[14px] font-bold tracking-[1.1px] text-surface"
                : "text-[9px] leading-[14px] font-bold tracking-[1.1px] text-primary"
            }
          >
            {monthShort(booking.startsAt)}
          </span>
          <span
            className={
              featured
                ? "text-[25px] leading-[28px] font-bold text-surface"
                : "text-[25px] leading-[28px] font-bold text-ink"
            }
          >
            {dayNumber(booking.startsAt)}
          </span>
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-title font-medium text-ink">
            {booking.serviceName}
          </span>
          <span className="mt-1 flex items-center gap-2">
            <Avatar name={booking.professionalName} src={booking.avatarUrl} size={24} />
            <span className="truncate text-caption text-muted">{booking.professionalName}</span>
          </span>
        </span>

        <span aria-hidden className={`mt-1 size-[9px] shrink-0 rounded-full ${dot}`} />
      </span>

      <span aria-hidden className="my-4 h-px w-full bg-line" />

      <span className="mb-[7px] flex items-center gap-2">
        <Clock aria-hidden className="size-[17px] shrink-0 text-primary" />
        <span className="flex-1 truncate text-caption text-ink">
          {fullDate(booking.startsAt)} · {formatTime12(booking.startsAt)}
        </span>
      </span>
      <span className="mb-[7px] flex items-center gap-2">
        <CheckCircle2 aria-hidden className={`size-[17px] shrink-0 ${text}`} />
        <span className={`flex-1 truncate text-caption ${text}`}>{statusCopy(booking.status)}</span>
      </span>

      <span className="mt-2 flex items-end justify-between gap-3">
        <span>
          <span className="block text-[8px] leading-[12px] font-bold tracking-[1.2px] text-muted uppercase">
            {paymentLabel(booking)}
          </span>
          <span className="block text-body font-medium text-ink">{paymentValue(booking)}</span>
        </span>
        <span className="flex size-[34px] shrink-0 items-center justify-center rounded-full bg-tint text-muted">
          <ChevronRight aria-hidden className="size-[17px]" />
        </span>
      </span>
    </button>
  );
}

function Detail({
  icon,
  children,
  tone,
}: {
  icon: ReactNode;
  children: ReactNode;
  tone?: string;
}) {
  return (
    <p className="mt-3 flex items-center gap-2">
      <span className="shrink-0 text-muted">{icon}</span>
      <span className={`flex-1 truncate text-caption ${tone ?? "text-ink"}`}>{children}</span>
    </p>
  );
}

function State({
  icon,
  title,
  body,
  action,
  onAction,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  action?: string;
  onAction: () => void;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <span className="mb-4 flex size-[58px] items-center justify-center rounded-full bg-secondary text-primary">
        {icon}
      </span>
      <p className="text-section text-ink">{title}</p>
      <p className="mt-1 max-w-[280px] text-caption text-muted">{body}</p>
      {action ? (
        <button
          type="button"
          onClick={onAction}
          className="mt-6 min-h-12 rounded-full bg-primary px-6 text-caption font-bold text-surface transition active:scale-[.98]"
        >
          {action}
        </button>
      ) : null}
    </div>
  );
}
