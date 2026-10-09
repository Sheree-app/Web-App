"use client";

import { Avatar, Skeleton, Spinner, Sheet } from "@/components/ui";
import {
  PayoutAccountRequiredError,
  fetchProfessionalDashboard,
  manageBooking,
  type ProfessionalDashboard,
  type StudioBooking,
} from "@/features/dashboard/api";
import { fetchUnreadNotificationCount } from "@/features/notifications/api";
import { useToast } from "@/providers/toast-provider";
import { Bell, ChevronRight, Hourglass, Sun, TrendingUp } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

/** Cedi, whole numbers — the same figures the app puts on the metric cards. */
const money = (value: number) =>
  new Intl.NumberFormat("en-GH", {
    style: "currency",
    currency: "GHS",
    maximumFractionDigits: 0,
  }).format(value);

const clock = (value: string) =>
  new Date(value).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

const dayLabel = (value: string) =>
  new Date(value).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

const greeting = () => {
  const hour = new Date().getHours();
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
};

type ActionResult = { warning?: string | null; refund?: string | null } | null;

/**
 * The studio home, rebuilt from the professional dashboard tab: the greeting
 * header with its notification bell, the two pulse metrics, the pending-request
 * banner, today's appointment rail with its confirm/complete/cancel actions,
 * and the coming-up outlook.
 */
export default function StudioPage() {
  const { toast, error: showError } = useToast();

  const [data, setData] = useState<ProfessionalDashboard | null>(null);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState("");
  const [confirmCancel, setConfirmCancel] = useState<StudioBooking | null>(null);

  const load = useCallback(async (refresh = false) => {
    if (!refresh) setLoading(true);
    try {
      const [dashboard, notificationCount] = await Promise.all([
        fetchProfessionalDashboard(),
        fetchUnreadNotificationCount("professional"),
      ]);
      setData(dashboard);
      setUnread(notificationCount);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const update = async (item: StudioBooking, action: "confirm" | "complete" | "cancel") => {
    setBusy(item.id);
    try {
      const result = (await manageBooking(
        item.id,
        action,
        action === "cancel" ? "Cancelled by the professional" : undefined,
      )) as ActionResult;
      setConfirmCancel(null);
      await load(true);
      toast(
        action === "cancel"
          ? "Appointment cancelled"
          : action === "complete"
            ? "Appointment completed"
            : "Appointment confirmed",
        {
          tone: "success",
          detail: result?.warning
            ? result.warning
            : result?.refund === "pending" || result?.refund === "processing"
              ? `A ${money(item.depositAmount)} deposit refund is now processing.`
              : "The customer’s booking has been updated.",
        },
      );
    } catch (cause) {
      if (cause instanceof PayoutAccountRequiredError) {
        showError("Add a payout account first", "Money has nowhere to land yet.");
      } else {
        showError(
          "Appointment unchanged",
          cause instanceof Error ? cause.message : "Please try again.",
        );
      }
    } finally {
      setBusy("");
    }
  };

  const firstName = data?.name ? data.name.split(" ")[0] : "";

  return (
    <div className="flex flex-col">
      <header className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-eyebrow text-primary uppercase">Studio pulse</p>
          <h1 className="truncate text-[28px] leading-[36px] font-bold text-ink">
            {greeting()}
            {firstName ? `, ${firstName}` : ""}
          </h1>
          <p className="truncate text-caption text-muted">
            {data?.businessName ?? "Your studio at a glance"}
          </p>
        </div>
        <Link
          href="/notifications"
          aria-label={
            unread ? `Open studio notifications, ${unread} unread` : "Open studio notifications"
          }
          className="relative flex size-11 shrink-0 items-center justify-center rounded-field bg-surface text-ink transition active:scale-95"
        >
          <Bell aria-hidden className="size-[22px]" />
          {unread > 0 ? (
            <span className="absolute top-[9px] right-[10px] size-[7px] rounded-full bg-primary ring-[1.5px] ring-surface" />
          ) : null}
        </Link>
      </header>

      {loading ? (
        <div className="flex flex-col items-center gap-3 pt-8">
          <Skeleton className="h-7 w-[54%]" />
          <Skeleton className="h-[108px] w-full rounded-card" />
          <Skeleton className="h-20 w-full rounded-card" />
          <Skeleton className="h-20 w-full rounded-card" />
        </div>
      ) : error || !data ? (
        <State
          title="Your studio pulse couldn’t load"
          body="Check your connection, then try again."
          action="Try again"
          onAction={() => void load()}
        />
      ) : (
        <>
          <div className="mt-8 flex gap-3">
            <Metric
              label="Today"
              value={`${data.todayCount}`}
              detail={data.todayCount === 1 ? "appointment" : "appointments"}
              accent
            />
            <Metric
              label="This month"
              value={money(data.monthRevenue)}
              detail="completed revenue"
            />
          </div>

          {data.pendingCount > 0 ? (
            <Link
              href="/studio/calendar"
              className="mt-3 flex items-center gap-3 rounded-panel bg-raised p-4 transition active:scale-[.995]"
            >
              <span className="flex size-[38px] shrink-0 items-center justify-center rounded-full bg-surface">
                <Hourglass aria-hidden className="size-[19px] text-warning" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-caption font-bold text-ink">
                  {data.pendingCount}{" "}
                  {data.pendingCount === 1 ? "request needs" : "requests need"} attention
                </span>
                <span className="block text-[11px] text-muted">Review your booking calendar</span>
              </span>
              <ChevronRight aria-hidden className="size-[19px] shrink-0 text-muted" />
            </Link>
          ) : null}

          <div className="mt-8 mb-4 flex items-end justify-between gap-3">
            <div>
              <p className="text-[9px] leading-[14px] font-bold tracking-[1.4px] text-primary uppercase">
                Today’s chair
              </p>
              <h2 className="text-[20px] leading-[28px] font-bold text-ink">
                {data.today.length ? "Your appointment rail" : "The day is open"}
              </h2>
            </div>
            <Link href="/studio/calendar" className="text-caption font-bold text-primary">
              Calendar
            </Link>
          </div>

          {data.today.length ? (
            <div>
              {data.today.map((item, index) => (
                <Appointment
                  key={item.id}
                  item={item}
                  last={index === data.today.length - 1}
                  busy={busy === item.id}
                  onUpdate={(action) =>
                    action === "cancel" ? setConfirmCancel(item) : void update(item, action)
                  }
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center rounded-card bg-surface p-6 text-center shadow-card">
              <span className="mb-3 flex size-[54px] items-center justify-center rounded-full bg-secondary">
                <Sun aria-hidden className="size-7 text-primary" />
              </span>
              <p className="text-title font-medium text-ink">
                {data.nextBooking ? "Your next client is coming up" : "No appointments booked yet"}
              </p>
              <p className="mt-1 max-w-[290px] text-caption text-muted">
                {data.nextBooking
                  ? `${dayLabel(data.nextBooking.startsAt)} at ${clock(
                      data.nextBooking.startsAt,
                    )} · ${data.nextBooking.customerName}`
                  : "Share your work and keep your availability current so customers can find a time."}
              </p>
            </div>
          )}

          <div className="mt-3 flex items-center justify-between rounded-card bg-success-surface p-4">
            <span>
              <span className="block text-[9px] leading-[14px] font-bold tracking-[1.3px] text-muted uppercase">
                Coming up
              </span>
              <span className="block text-body font-medium text-ink">
                {data.upcomingCount} booked
              </span>
            </span>
            <TrendingUp aria-hidden className="size-[25px] text-success" />
          </div>
        </>
      )}

      <Sheet
        open={Boolean(confirmCancel)}
        onClose={() => setConfirmCancel(null)}
        title="Cancel this appointment?"
        footer={
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setConfirmCancel(null)}
              className="min-h-[54px] flex-1 rounded-panel bg-surface text-body font-medium text-ink"
            >
              Keep appointment
            </button>
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => confirmCancel && void update(confirmCancel, "cancel")}
              className="min-h-[54px] flex-1 rounded-panel bg-danger text-body font-medium text-surface disabled:opacity-60"
            >
              {busy ? <Spinner className="[&>svg]:text-surface" label="Cancelling" /> : "Cancel appointment"}
            </button>
          </div>
        }
      >
        {confirmCancel ? (
          <p className="text-body text-muted">
            {confirmCancel.paymentStatus === "paid"
              ? `The customer will receive a full ${money(
                  confirmCancel.depositAmount,
                )} refund through Paystack.`
              : "The customer will see the cancellation immediately."}
          </p>
        ) : null}
      </Sheet>
    </div>
  );
}

function Metric({
  label,
  value,
  detail,
  accent,
}: {
  label: string;
  value: string;
  detail: string;
  accent?: boolean;
}) {
  return (
    <div
      className={
        accent
          ? "flex min-h-[148px] flex-1 flex-col rounded-card bg-tint p-4"
          : "flex min-h-[148px] flex-1 flex-col rounded-card bg-surface p-4 shadow-card"
      }
    >
      <p className="text-[10px] leading-[14px] font-bold tracking-[1.4px] text-muted uppercase">
        {label}
      </p>
      <p className="mt-auto truncate text-[36px] leading-[43px] font-bold text-ink">{value}</p>
      <p className="text-[13px] leading-[19px] text-muted">{detail}</p>
    </div>
  );
}

function Appointment({
  item,
  last,
  busy,
  onUpdate,
}: {
  item: StudioBooking;
  last: boolean;
  busy: boolean;
  onUpdate: (action: "confirm" | "complete" | "cancel") => void;
}) {
  const next = item.status === "requested" ? "confirm" : "complete";

  return (
    <div className="flex gap-3">
      <div className="flex w-12 flex-col items-center">
        <span className="text-[11px] font-bold text-ink">{clock(item.startsAt)}</span>
        {!last ? <span className="my-[5px] min-h-5 w-px flex-1 bg-line" /> : null}
      </div>

      <div className="mb-3 min-w-0 flex-1 rounded-card bg-surface p-4 shadow-card">
        <div className="flex items-center gap-3">
          <Avatar name={item.customerName} src={item.customerAvatar} size={40} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-body font-medium text-ink">{item.customerName}</p>
            <p className="truncate text-caption text-muted">{item.serviceName}</p>
            <p className="mt-0.5 text-[10px] font-bold tracking-[0.7px] text-primary">
              {item.bookingReference}
            </p>
          </div>
          <span className="flex shrink-0 items-center gap-1.5 self-start rounded-full bg-tint px-2 py-1.5">
            <span
              aria-hidden
              className={
                item.status === "confirmed"
                  ? "size-[7px] rounded-full bg-success"
                  : "size-[7px] rounded-full bg-warning"
              }
            />
            <span className="text-[9px] font-bold text-muted">
              {item.status === "confirmed" ? "Confirmed" : "Requested"}
            </span>
          </span>
        </div>

        <div className="mt-4 flex justify-between border-t border-line pt-3">
          <span className="text-[11px] text-muted">
            {clock(item.startsAt)} – {clock(item.endsAt)}
          </span>
          <span className="text-caption font-bold text-ink">{money(item.price)}</span>
        </div>

        <div className="mt-3 flex gap-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={() => onUpdate("cancel")}
            className="flex min-h-[42px] items-center justify-center rounded-full bg-tint px-4 text-caption font-bold text-danger transition active:scale-[.98] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onUpdate(next)}
            className="flex min-h-[42px] flex-1 items-center justify-center rounded-full bg-primary text-caption font-bold text-surface transition active:scale-[.98] disabled:opacity-50"
          >
            {busy ? (
              <Spinner className="[&>svg]:size-4 [&>svg]:text-surface" label="Updating" />
            ) : next === "confirm" ? (
              "Confirm"
            ) : (
              "Mark complete"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function State({
  title,
  body,
  action,
  onAction,
}: {
  title: string;
  body: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <div className="mt-8 flex flex-col items-center rounded-card bg-surface p-6 text-center shadow-card">
      <span className="mb-3 flex size-[54px] items-center justify-center rounded-full bg-secondary">
        <Sun aria-hidden className="size-7 text-primary" />
      </span>
      <p className="text-title font-medium text-ink">{title}</p>
      <p className="mt-1 max-w-[290px] text-caption text-muted">{body}</p>
      <button
        type="button"
        onClick={onAction}
        className="mt-4 min-h-[42px] rounded-full bg-primary px-6 text-caption font-bold text-surface transition active:scale-[.98]"
      >
        {action}
      </button>
    </div>
  );
}
