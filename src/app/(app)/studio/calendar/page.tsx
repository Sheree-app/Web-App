"use client";

import { ConfirmDialog, Sheet, Skeleton, Spinner } from "@/components/ui";
import {
  fetchBookingRequests,
  fetchSchedule,
  fetchUpcomingAppointments,
  saveSchedule,
  type BookingRequest,
  type CalendarAppointment,
} from "@/features/calendar/api";
import { dayNames, defaultSchedule, isoDate, type Schedule } from "@/features/calendar/data";
import { manageBooking } from "@/features/dashboard/api";
import { useToast } from "@/providers/toast-provider";
import {
  ArrowRight,
  CalendarDays,
  CalendarX2,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Coffee,
  Hourglass,
  Minus,
  Moon,
  Plus,
  Receipt,
  SlidersHorizontal,
  Users,
  X,
  XCircle,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

const addDays = (date: Date, amount: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
};
const startOfWeek = (date: Date) => addDays(date, -date.getDay());
const fullDayNames = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const labelDate = (date: Date) => date.toLocaleDateString("en-GB", { month: "short", day: "numeric" });
const minutesOf = (value: string) => {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
};
const timeOf = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const shiftTime = (value: string, amount: number, min = 0, max = 1439) =>
  timeOf(Math.min(max, Math.max(min, minutesOf(value) + amount)));
// Accepts either a full timestamp or a truncated date, so time off always lines
// up with the right calendar day.
const dayOnly = (value: string) => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value.slice(0, 10) : isoDate(date);
};
const isBlocked = (schedule: Schedule, date: Date) =>
  schedule.blocks.some((block) => {
    const day = isoDate(date);
    return day >= dayOnly(block.startsAt) && day < dayOnly(block.endsAt);
  });

const clock = (value: string) =>
  new Date(value).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const shortDateTime = (value: string) =>
  `${new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} at ${clock(value)}`;
const longDateTime = (value: string) =>
  `${new Date(value).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  })} · ${clock(value)}`;

/**
 * The calendar, rebuilt from `CalendarScreen`: the studio rhythm header with
 * Manage availability, the overview strip, the request queue, the week/month
 * planner, the booking rules snapshot and the diary — plus the two sheets the
 * screen leans on for answering a request and editing hours.
 */
export default function StudioCalendarPage() {
  const { toast, error: showError } = useToast();

  const [schedule, setSchedule] = useState<Schedule>(defaultSchedule);
  const [requests, setRequests] = useState<BookingRequest[]>([]);
  const [appointments, setAppointments] = useState<CalendarAppointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mode, setMode] = useState<"week" | "month">("week");
  const [cursor, setCursor] = useState<Date | null>(null);
  const [requestBusy, setRequestBusy] = useState("");
  const [selected, setSelected] = useState<CalendarAppointment | null>(null);
  const [appointmentBusy, setAppointmentBusy] = useState<"cancel" | "complete" | "">("");
  const [confirmAction, setConfirmAction] = useState<
    { item: CalendarAppointment; action: "cancel" | "complete" } | null
  >(null);

  const load = async () => {
    try {
      const [nextSchedule, nextRequests, nextAppointments] = await Promise.all([
        fetchSchedule(),
        fetchBookingRequests(),
        fetchUpcomingAppointments(),
      ]);
      setSchedule(nextSchedule);
      setRequests(nextRequests);
      setAppointments(nextAppointments);
    } catch {
      showError("Could not refresh", "Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // The planner needs "today", which is not known until after mount.
    setCursor(new Date());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRequest = async (item: BookingRequest, action: "confirm" | "cancel") => {
    setRequestBusy(item.id);
    try {
      await manageBooking(
        item.id,
        action,
        action === "cancel" ? "Request declined by professional" : undefined,
      );
      setRequests((current) => current.filter((request) => request.id !== item.id));
      if (action === "confirm") {
        setAppointments((current) =>
          current.map((appointment) =>
            appointment.id === item.id ? { ...appointment, status: "confirmed" } : appointment,
          ),
        );
      } else {
        setAppointments((current) => current.filter((appointment) => appointment.id !== item.id));
      }
      toast(action === "confirm" ? "Request confirmed" : "Request declined", {
        tone: action === "confirm" ? "success" : "info",
        detail:
          action === "confirm"
            ? "The customer can now see their confirmed appointment."
            : item.paymentStatus === "paid"
              ? "The deposit refund is processing."
              : "The customer has been notified.",
      });
    } catch (cause) {
      showError("Request unchanged", cause instanceof Error ? cause.message : "Try again.");
    } finally {
      setRequestBusy("");
    }
  };

  const persist = async (next: Schedule) => {
    setSaving(true);
    try {
      await saveSchedule(next);
      setSchedule(next);
      setSettingsOpen(false);
      toast("Availability saved", { tone: "success", detail: "Your booking rules are live." });
    } catch (cause) {
      showError(
        "Schedule could not be saved",
        cause instanceof Error ? cause.message : "Try again.",
      );
    } finally {
      setSaving(false);
    }
  };

  const updateAppointment = async (item: CalendarAppointment, action: "cancel" | "complete") => {
    setAppointmentBusy(action);
    try {
      await manageBooking(
        item.id,
        action,
        action === "cancel" ? "Cancelled from the professional calendar" : undefined,
      );
      setAppointments((current) => current.filter((appointment) => appointment.id !== item.id));
      setRequests((current) => current.filter((request) => request.id !== item.id));
      setSelected(null);
      setConfirmAction(null);
      toast(action === "complete" ? "Appointment completed" : "Appointment cancelled", {
        tone: "success",
        detail:
          action === "complete"
            ? "The appointment has been moved out of your upcoming diary."
            : "The customer has been notified. Any deposit refund will be processed.",
      });
    } catch (cause) {
      showError(
        "Appointment unchanged",
        cause instanceof Error ? cause.message : "Try again.",
      );
    } finally {
      setAppointmentBusy("");
    }
  };

  const openDays = schedule.hours.filter((day) => !day.isClosed).length;

  return (
    <div className="flex flex-col">
      <header className="flex items-center justify-between gap-3">
        <div>
          <p className="text-eyebrow text-primary uppercase">Studio rhythm</p>
          <h1 className="text-page text-ink">Calendar</h1>
        </div>
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="flex min-h-11 shrink-0 items-center justify-center gap-[7px] rounded-full bg-primary px-4 text-[11px] font-bold text-surface transition active:scale-95"
        >
          <SlidersHorizontal aria-hidden className="size-[18px]" />
          Manage availability
        </button>
      </header>

      <div className="mt-6 flex min-h-[102px] items-center gap-4 rounded-card bg-[#351F25] p-4">
        <div className="min-w-[68px]">
          <p className="text-[34px] leading-[38px] font-bold text-[#FFF9FB]">
            {appointments.length}
          </p>
          <p className="text-[9px] leading-[14px] font-bold tracking-[1.2px] text-[#D8BFC6] uppercase">
            Upcoming
          </p>
        </div>
        <span aria-hidden className="h-[54px] w-px shrink-0 bg-[#674B53]" />
        <div className="flex flex-1 flex-col items-center gap-[3px]">
          <Hourglass aria-hidden className="size-[18px] text-warning" />
          <p className="text-[17px] font-bold text-[#FFF9FB]">{requests.length}</p>
          <p className="text-[9px] text-[#D8BFC6]">requests</p>
        </div>
        <div className="flex flex-1 flex-col items-center gap-[3px]">
          <CalendarDays aria-hidden className="size-[18px] text-success" />
          <p className="text-[17px] font-bold text-[#FFF9FB]">{openDays}</p>
          <p className="text-[9px] text-[#D8BFC6]">open days</p>
        </div>
      </div>

      {requests.length ? (
        <div className="mt-4 flex flex-col gap-1.5">
          <p className="text-[10px] leading-[14px] font-bold tracking-[1.5px] text-muted uppercase">
            Booking requests
          </p>
          {requests.map((item) => (
            <div
              key={item.id}
              className="flex min-h-[74px] items-center gap-3 rounded-panel bg-raised p-3"
            >
              <span className="flex size-[38px] shrink-0 items-center justify-center rounded-full bg-surface">
                <Hourglass aria-hidden className="size-[19px] text-warning" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body font-medium text-ink">
                  {item.customerName}
                </span>
                <span className="mt-0.5 block truncate text-[10px] text-muted">
                  {item.serviceName} · {shortDateTime(item.startsAt)}
                </span>
                <span className="mt-1 block text-[10px] font-bold tracking-[0.8px] text-primary">
                  {item.bookingReference}
                </span>
              </span>
              <span className="flex shrink-0 gap-1.5">
                <button
                  type="button"
                  aria-label="Decline request"
                  disabled={requestBusy === item.id}
                  onClick={() => void handleRequest(item, "cancel")}
                  className="flex size-[38px] items-center justify-center rounded-field bg-surface transition active:scale-95 disabled:opacity-50"
                >
                  <X aria-hidden className="size-[18px] text-danger" />
                </button>
                <button
                  type="button"
                  aria-label="Confirm request"
                  disabled={requestBusy === item.id}
                  onClick={() => void handleRequest(item, "confirm")}
                  className="flex size-[38px] items-center justify-center rounded-field bg-success text-surface transition active:scale-95 disabled:opacity-50"
                >
                  {requestBusy === item.id ? (
                    <Spinner className="[&>svg]:size-4 [&>svg]:text-surface" label="Confirming" />
                  ) : (
                    <Check aria-hidden className="size-[18px]" />
                  )}
                </button>
              </span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-6 flex self-center rounded-full bg-tint p-[3px]">
        {(["week", "month"] as const).map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={mode === item}
            onClick={() => setMode(item)}
            className={
              mode === item
                ? "rounded-full bg-surface px-[22px] py-2 text-caption font-bold text-ink"
                : "rounded-full px-[22px] py-2 text-caption font-bold text-ink"
            }
          >
            {item === "week" ? "Week" : "Month"}
          </button>
        ))}
      </div>

      <div className="my-6 flex items-center justify-between gap-3">
        <button
          type="button"
          aria-label="Previous period"
          onClick={() => cursor && setCursor(addDays(cursor, mode === "week" ? -7 : -30))}
          className="flex size-9 items-center justify-center rounded-full text-ink transition active:scale-95"
        >
          <ChevronLeft aria-hidden className="size-[22px]" />
        </button>
        <p className="text-body font-medium text-ink">
          {cursor
            ? mode === "week"
              ? `${labelDate(startOfWeek(cursor))} — ${labelDate(addDays(startOfWeek(cursor), 6))}`
              : cursor.toLocaleDateString("en-GB", { month: "long", year: "numeric" })
            : ""}
        </p>
        <button
          type="button"
          aria-label="Next period"
          onClick={() => cursor && setCursor(addDays(cursor, mode === "week" ? 7 : 30))}
          className="flex size-9 items-center justify-center rounded-full text-ink transition active:scale-95"
        >
          <ChevronRight aria-hidden className="size-[22px]" />
        </button>
      </div>

      {loading || !cursor ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-[72px] w-full rounded-panel" />
          <Skeleton className="h-[360px] w-full rounded-card" />
        </div>
      ) : mode === "week" ? (
        <Week schedule={schedule} cursor={cursor} />
      ) : (
        <Month schedule={schedule} cursor={cursor} />
      )}

      <div className="mt-4 flex justify-center gap-4">
        <Legend color="bg-success" label="Open" />
        <Legend color="bg-secondary" label="Break" />
        <Legend color="bg-warning" label="Time off" />
      </div>

      <div className="mt-8 flex flex-col gap-3 rounded-card bg-surface p-4 shadow-card">
        <h2 className="text-title font-medium text-ink">Booking rules</h2>
        <Rule
          icon={<Users aria-hidden className="size-[18px]" />}
          value={`${schedule.preferences.maxAppointmentsPerDay} max / day`}
        />
        <Rule
          icon={<Hourglass aria-hidden className="size-[18px]" />}
          value={`${schedule.preferences.bufferMinutes} min gap`}
        />
        <Rule
          icon={<Zap aria-hidden className="size-[18px]" />}
          value={
            schedule.preferences.approvalMode === "automatic"
              ? "Automatic approval"
              : "Manual approval"
          }
        />
      </div>

      <div className="mt-8 flex items-end justify-between gap-3">
        <div>
          <p className="text-[10px] leading-[14px] font-bold tracking-[1.5px] text-muted uppercase">
            Your diary
          </p>
          <h2 className="text-title font-medium text-ink">Upcoming appointments</h2>
        </div>
        <span className="flex size-7 items-center justify-center rounded-full bg-tint text-[11px] font-bold text-primary">
          {appointments.length}
        </span>
      </div>

      {appointments.length ? (
        <div className="mt-2 flex flex-col gap-3">
          {appointments.map((item) => (
            <AppointmentCard key={item.id} item={item} onOpen={() => setSelected(item)} />
          ))}
        </div>
      ) : (
        <div className="mt-2 flex min-h-[88px] items-center gap-3 rounded-panel bg-surface p-4 shadow-card">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-tint">
            <CalendarX2 aria-hidden className="size-[23px] text-primary" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-body font-medium text-ink">Your diary is clear</span>
            <span className="mt-0.5 block text-caption text-muted">
              New confirmed appointments will appear here.
            </span>
          </span>
        </div>
      )}

      <AvailabilitySheet
        open={settingsOpen}
        value={schedule}
        saving={saving}
        onClose={() => setSettingsOpen(false)}
        onSave={(next) => void persist(next)}
      />

      <Sheet
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected?.serviceName ?? ""}
        description={selected ? "Appointment" : undefined}
      >
        {selected ? (
          <div className="flex flex-col">
            <div className="flex min-h-[42px] items-center gap-3 border-t border-line">
              <Clock aria-hidden className="size-[18px] shrink-0 text-muted" />
              <span className="flex-1 text-caption text-muted">
                {longDateTime(selected.startsAt)} – {clock(selected.endsAt)}
              </span>
            </div>
            <div className="flex min-h-[42px] items-center gap-3 border-t border-line">
              <Receipt aria-hidden className="size-[18px] shrink-0 text-muted" />
              <span className="flex-1 text-caption text-muted">{selected.bookingReference}</span>
            </div>

            {selected.status !== "confirmed" ? (
              <p className="mt-3 text-caption text-muted">
                Confirm this request before marking it complete.
              </p>
            ) : null}

            <div className="mt-6 flex gap-3">
              <button
                type="button"
                disabled={Boolean(appointmentBusy)}
                onClick={() => {
                  setConfirmAction({ item: selected, action: "cancel" });
                }}
                className="flex min-h-[54px] flex-1 items-center justify-center gap-2 rounded-field border border-danger text-body font-medium text-danger transition active:scale-[.99] disabled:opacity-45"
              >
                <XCircle aria-hidden className="size-[19px]" />
                Cancel
              </button>
              <button
                type="button"
                disabled={selected.status !== "confirmed" || Boolean(appointmentBusy)}
                onClick={() => {
                  setConfirmAction({ item: selected, action: "complete" });
                }}
                className="flex min-h-[54px] flex-[1.35] items-center justify-center gap-2 rounded-field bg-success text-body font-medium text-surface transition active:scale-[.99] disabled:opacity-45"
              >
                <CheckCircle2 aria-hidden className="size-[19px]" />
                Mark complete
              </button>
            </div>
          </div>
        ) : null}
      </Sheet>

      <ConfirmDialog
        open={Boolean(confirmAction)}
        title={confirmAction?.action === "complete" ? "Mark as complete?" : "Cancel appointment?"}
        message={
          confirmAction?.action === "complete"
            ? "This will complete the appointment now."
            : "This will remove the appointment from your diary and notify the customer."
        }
        confirmLabel={confirmAction?.action === "complete" ? "Mark complete" : "Cancel appointment"}
        cancelLabel="Keep appointment"
        destructive={confirmAction?.action === "cancel"}
        loading={Boolean(appointmentBusy)}
        onClose={() => setConfirmAction(null)}
        onConfirm={() =>
          confirmAction && void updateAppointment(confirmAction.item, confirmAction.action)
        }
      />
    </div>
  );
}

function Week({ schedule, cursor }: { schedule: Schedule; cursor: Date }) {
  const days = Array.from({ length: 7 }, (_, index) => addDays(startOfWeek(cursor), index));
  return (
    <div className="flex gap-[5px]">
      {days.map((date) => {
        const hours = schedule.hours.find((day) => day.dayOfWeek === date.getDay());
        const blocked = isBlocked(schedule, date);
        const breaks = schedule.breaks.filter((item) => item.dayOfWeek === date.getDay());
        return (
          <div
            key={isoDate(date)}
            className={
              blocked
                ? "flex min-h-[190px] flex-1 flex-col items-center rounded-panel bg-tint py-3"
                : "flex min-h-[190px] flex-1 flex-col items-center rounded-panel bg-surface py-3 shadow-card"
            }
          >
            <span className="text-[9px] font-bold text-muted">{dayNames[date.getDay()]}</span>
            <span className="mt-1.5 text-title font-medium text-ink">{date.getDate()}</span>
            {hours && !hours.isClosed && !blocked ? (
              <>
                <span aria-hidden className="mt-4 size-1.5 rounded-full bg-success" />
                <span className="mt-1.5 text-center text-[9px] leading-[14px] font-medium text-muted">
                  {hours.opensAt}
                  <br />
                  {hours.closesAt}
                </span>
                {breaks.length > 0 ? (
                  <span aria-hidden className="mt-3 h-1 w-[18px] rounded-sm bg-secondary" />
                ) : null}
              </>
            ) : (
              <span className="mt-6 -rotate-90 text-[9px] font-medium whitespace-nowrap text-muted">
                {blocked ? "Away" : "Closed"}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Month({ schedule, cursor }: { schedule: Schedule; cursor: Date }) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const cells = Array.from({ length: 42 }, (_, index) => addDays(first, index - first.getDay()));
  return (
    <div>
      <div className="flex">
        {dayNames.map((name) => (
          <span
            key={name}
            aria-hidden
            className="flex-1 text-center text-[10px] font-bold text-muted"
          >
            {name[0]}
          </span>
        ))}
      </div>
      <div className="mt-1.5 grid grid-cols-7">
        {cells.map((date) => {
          const inMonth = date.getMonth() === cursor.getMonth();
          const hours = schedule.hours.find((day) => day.dayOfWeek === date.getDay());
          const blocked = isBlocked(schedule, date);
          return (
            <div
              key={isoDate(date)}
              className={
                blocked && inMonth
                  ? "flex h-[54px] flex-col items-center justify-center rounded-tile bg-tint"
                  : "flex h-[54px] flex-col items-center justify-center"
              }
            >
              <span className={inMonth ? "text-caption text-ink" : "text-caption text-ink opacity-30"}>
                {date.getDate()}
              </span>
              {inMonth ? (
                <span
                  aria-hidden
                  className={
                    blocked
                      ? "mt-1 size-[5px] rounded-full bg-warning"
                      : hours?.isClosed
                        ? "mt-1 size-[5px] rounded-full bg-line"
                        : "mt-1 size-[5px] rounded-full bg-success"
                  }
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span aria-hidden className={`size-[7px] rounded-full ${color}`} />
      <span className="text-[10px] text-muted">{label}</span>
    </span>
  );
}

function Rule({ icon, value }: { icon: React.ReactNode; value: string }) {
  return (
    <p className="flex items-center gap-2">
      <span className="shrink-0 text-primary">{icon}</span>
      <span className="text-caption text-muted">{value}</span>
    </p>
  );
}

function AppointmentCard({
  item,
  onOpen,
}: {
  item: CalendarAppointment;
  onOpen: () => void;
}) {
  const starts = new Date(item.startsAt);
  return (
    <button
      type="button"
      aria-label={`Open ${item.serviceName} appointment`}
      onClick={onOpen}
      className="flex min-h-[88px] items-center gap-3 rounded-panel bg-surface p-3 text-left shadow-card transition active:scale-[.99] active:opacity-75"
    >
      <span className="flex size-[52px] shrink-0 flex-col items-center justify-center rounded-field bg-tint">
        <span className="text-[8px] font-bold tracking-[1px] text-primary uppercase">
          {starts.toLocaleDateString("en-GB", { month: "short" })}
        </span>
        <span className="text-[22px] leading-[25px] font-bold text-ink">{starts.getDate()}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body font-medium text-ink">{item.serviceName}</span>
        <span className="mt-0.5 block text-caption text-muted">
          {clock(item.startsAt)} – {clock(item.endsAt)}
        </span>
        <span className="mt-1 block text-[9px] font-bold tracking-[0.7px] text-primary">
          {item.bookingReference}
        </span>
      </span>
      <span
        className={
          item.status === "requested"
            ? "shrink-0 rounded-full bg-raised px-2 py-1.5 text-[8px] font-bold text-[#9A6412]"
            : "shrink-0 rounded-full bg-success-surface px-2 py-1.5 text-[8px] font-bold text-success"
        }
      >
        {item.status === "confirmed" ? "Confirmed" : "Pending"}
      </span>
      <ChevronRight aria-hidden className="size-[17px] shrink-0 text-muted" />
    </button>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={
        checked
          ? "relative h-8 w-14 shrink-0 rounded-full bg-primary transition-colors"
          : "relative h-8 w-14 shrink-0 rounded-full bg-secondary transition-colors"
      }
    >
      <span
        aria-hidden
        className={
          checked
            ? "absolute top-1 left-1 size-6 translate-x-6 rounded-full bg-surface transition-transform"
            : "absolute top-1 left-1 size-6 rounded-full bg-surface transition-transform"
        }
      />
    </button>
  );
}

function Stepper({
  label,
  value,
  step,
  suffix = "",
  set,
}: {
  label: string;
  value: number;
  step: number;
  suffix?: string;
  set: (value: number) => void;
}) {
  return (
    <div className="flex min-h-16 items-center justify-between rounded-field bg-surface px-4">
      <span className="text-body font-medium text-ink">{label}</span>
      <span className="flex items-center gap-1.5">
        <button
          type="button"
          aria-label={`Decrease ${label}`}
          onClick={() => set(Math.max(0, value - step))}
          className="flex size-7 items-center justify-center rounded-[10px] bg-tint text-ink transition active:scale-95"
        >
          <Minus aria-hidden className="size-[17px]" />
        </button>
        <span className="min-w-[42px] text-center text-caption font-bold text-ink">
          {value}
          {suffix}
        </span>
        <button
          type="button"
          aria-label={`Increase ${label}`}
          onClick={() => set(value + step)}
          className="flex size-7 items-center justify-center rounded-[10px] bg-tint text-ink transition active:scale-95"
        >
          <Plus aria-hidden className="size-[17px]" />
        </button>
      </span>
    </div>
  );
}

function TimeControl({
  label,
  value,
  onChange,
  min = 0,
  max = 1439,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  min?: number;
  max?: number;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5 rounded-field bg-raised px-1.5 py-1.5">
      <span className="text-center text-[9px] font-bold tracking-[1px] text-muted">{label}</span>
      <span className="flex items-center justify-between gap-[3px]">
        <button
          type="button"
          aria-label={`${label} earlier`}
          onClick={() => onChange(shiftTime(value, -30, min, max))}
          className="flex size-7 shrink-0 items-center justify-center rounded-[10px] bg-surface text-ink transition active:scale-95"
        >
          <Minus aria-hidden className="size-[13px]" />
        </button>
        <span className="min-w-[38px] flex-1 text-center text-[13px] font-bold text-ink">
          {value}
        </span>
        <button
          type="button"
          aria-label={`${label} later`}
          onClick={() => onChange(shiftTime(value, 30, min, max))}
          className="flex size-7 shrink-0 items-center justify-center rounded-[10px] bg-surface text-ink transition active:scale-95"
        >
          <Plus aria-hidden className="size-[13px]" />
        </button>
      </span>
    </div>
  );
}

function AvailabilitySheet({
  open,
  value,
  saving,
  onClose,
  onSave,
}: {
  open: boolean;
  value: Schedule;
  saving: boolean;
  onClose: () => void;
  onSave: (next: Schedule) => void;
}) {
  const [draft, setDraft] = useState(value);
  const wasOpen = useRef(false);

  useEffect(() => {
    // Only adopt the latest schedule when the sheet opens, so edits aren't
    // wiped mid-session by an in-flight fetch.
    if (open && !wasOpen.current) setDraft(value);
    wasOpen.current = open;
  }, [open, value]);

  const pref = (key: keyof Schedule["preferences"], next: number | string) =>
    setDraft((current) => ({ ...current, preferences: { ...current.preferences, [key]: next } }));
  const toggleDay = (day: number) =>
    setDraft((current) => ({
      ...current,
      hours: current.hours.map((item) =>
        item.dayOfWeek === day ? { ...item, isClosed: !item.isClosed } : item,
      ),
    }));
  const setHours = (day: number, key: "opensAt" | "closesAt", time: string) =>
    setDraft((current) => ({
      ...current,
      hours: current.hours.map((item) =>
        item.dayOfWeek === day ? { ...item, [key]: time } : item,
      ),
    }));

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Availability"
      size="lg"
      footer={
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[54px] flex-1 rounded-panel bg-surface text-body text-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => onSave(draft)}
            className="flex min-h-[54px] flex-1 items-center justify-center rounded-panel bg-primary text-body font-medium text-surface disabled:opacity-60"
          >
            {saving ? <Spinner className="[&>svg]:text-surface" label="Saving" /> : "Save"}
          </button>
        </div>
      }
    >
      <p className="text-[10px] leading-[14px] font-bold tracking-[1.5px] text-muted uppercase">
        Working week
      </p>
      <p className="mt-1 mb-1.5 text-caption text-muted">
        Set a different opening and closing time for every day.
      </p>

      <div className="flex flex-col gap-2">
        {draft.hours.map((hour) => (
          <div
            key={hour.dayOfWeek}
            className={
              hour.isClosed
                ? "flex min-h-[110px] flex-col gap-4 rounded-card bg-raised p-4"
                : "flex min-h-[132px] flex-col gap-4 rounded-card bg-surface p-4 shadow-card"
            }
          >
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-3">
                <span className="text-title font-medium text-ink">
                  {fullDayNames[hour.dayOfWeek]}
                </span>
                <span
                  className={
                    hour.isClosed
                      ? "flex items-center gap-1 rounded-full bg-line px-2 py-1.5"
                      : "flex items-center gap-1 rounded-full bg-success-surface px-2 py-1.5"
                  }
                >
                  <span
                    aria-hidden
                    className={
                      hour.isClosed
                        ? "size-1.5 rounded-full bg-muted"
                        : "size-1.5 rounded-full bg-success"
                    }
                  />
                  <span
                    className={
                      hour.isClosed
                        ? "text-[9px] font-bold text-muted"
                        : "text-[9px] font-bold text-success"
                    }
                  >
                    {hour.isClosed ? "Closed" : "Open"}
                  </span>
                </span>
              </span>
              <Toggle
                checked={!hour.isClosed}
                onChange={() => toggleDay(hour.dayOfWeek)}
                label={`${fullDayNames[hour.dayOfWeek]} open`}
              />
            </div>

            {hour.isClosed ? (
              <div className="flex min-h-[42px] items-center gap-2 border-t border-line pt-3">
                <Moon aria-hidden className="size-[17px] shrink-0 text-muted" />
                <span className="text-caption text-muted">Customers cannot book this day.</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <TimeControl
                  label="Opens"
                  value={hour.opensAt}
                  onChange={(next) => setHours(hour.dayOfWeek, "opensAt", next)}
                  max={minutesOf(hour.closesAt) - 30}
                />
                <span className="flex size-[22px] shrink-0 items-center justify-center rounded-full bg-tint">
                  <ArrowRight aria-hidden className="size-4 text-muted" />
                </span>
                <TimeControl
                  label="Closes"
                  value={hour.closesAt}
                  onChange={(next) => setHours(hour.dayOfWeek, "closesAt", next)}
                  min={minutesOf(hour.opensAt) + 30}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      <p className="mt-6 mb-1 text-[10px] leading-[14px] font-bold tracking-[1.5px] text-muted uppercase">
        Daily rhythm
      </p>
      <div className="flex flex-col gap-2">
        <Stepper
          label="Maximum appointments"
          value={draft.preferences.maxAppointmentsPerDay}
          step={1}
          set={(next) => pref("maxAppointmentsPerDay", next)}
        />
        <Stepper
          label="Gap between clients"
          value={draft.preferences.bufferMinutes}
          step={5}
          suffix=" min"
          set={(next) => pref("bufferMinutes", next)}
        />
        <Stepper
          label="Default appointment"
          value={draft.preferences.defaultDurationMinutes}
          step={15}
          suffix=" min"
          set={(next) => pref("defaultDurationMinutes", next)}
        />
        <div className="flex min-h-[72px] items-center gap-3 rounded-field bg-surface px-4">
          <span className="min-w-0 flex-1">
            <span className="block text-body font-medium text-ink">
              Approve bookings manually
            </span>
            <span className="block text-caption text-muted">
              Review each request before it is confirmed
            </span>
          </span>
          <Toggle
            checked={draft.preferences.approvalMode === "manual"}
            onChange={(next) => pref("approvalMode", next ? "manual" : "automatic")}
            label="Approve bookings manually"
          />
        </div>
      </div>

      <p className="mt-6 mb-1 text-[10px] leading-[14px] font-bold tracking-[1.5px] text-muted uppercase">
        Breaks
      </p>
      <div className="flex min-h-[58px] items-center gap-3 rounded-field bg-tint px-4">
        <Coffee aria-hidden className="size-5 shrink-0 text-primary" />
        <span className="text-caption text-ink">Lunch · Mon–Fri · 13:00–14:00</span>
      </div>
    </Sheet>
  );
}
