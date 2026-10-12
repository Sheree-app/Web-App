"use client";

import { Skeleton, Spinner, Textarea } from "@/components/ui";
import {
  BookingAvailabilityError,
  bookingAvailabilityAlert,
  fetchAvailability,
  fetchBookingFulfilment,
  fetchBookingSlots,
  initializeDeposit,
  reserveBooking,
  type AvailabilityDay,
  type BookingFulfilment,
  type BookingSlot,
  type DayState,
} from "@/features/booking/api";
import { formatTime12 } from "@/features/booking/time-format";
import { fetchProfessionalName, fetchProfessionalServices } from "@/features/services/api";
import { DEPOSIT_PERCENT, duration, money, type Service } from "@/features/services/data";
import { cn } from "@/lib/utils";
import { useToast } from "@/providers/toast-provider";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  Clock,
  ChevronLeft,
  ChevronRight,
  Home,
  MapPin,
  Phone,
  ShieldCheck,
  Sparkles,
  Store,
  Ticket,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

type Step = "date" | "time" | "summary" | "confirmed";

const STEPS: Step[] = ["date", "time", "summary"];

const pad = (value: number) => String(value).padStart(2, "0");
const iso = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const monthStart = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);
const moveMonth = (date: Date, months: number) =>
  new Date(date.getFullYear(), date.getMonth() + months, 1);
const monthDays = (date: Date) =>
  Array.from(
    { length: new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate() },
    (_, index) => new Date(date.getFullYear(), date.getMonth(), index + 1),
  );
const longDate = (value: string) =>
  new Date(`${value}T12:00:00`).toLocaleDateString("en-GB", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

/** Availability is a traffic light, on both clients. */
const DAY_DOT: Record<DayState, string> = {
  available: "bg-success",
  limited: "bg-warning",
  full: "bg-danger",
  closed: "bg-line",
};

const EMPTY_FULFILMENT: BookingFulfilment = {
  offersMobile: false,
  travelFee: 0,
  businessAddress: null,
  countryCode: "GH",
  depositRequired: true,
  phone: null,
};

/**
 * Booking, in the three decisions the app asks for: which day, which time, and
 * a last look at the money. The deposit handoff is identical — reserve
 * server-side, hand off to Paystack, and let `/booking/return` confirm.
 */
export function BookingFlow({ professionalId }: { professionalId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const serviceId = searchParams.get("service") ?? "";

  const [step, setStep] = useState<Step>("date");
  const [services, setServices] = useState<Service[]>([]);
  const [professionalName, setProfessionalName] = useState("");
  const [fulfilment, setFulfilment] = useState<BookingFulfilment>(EMPTY_FULFILMENT);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const [days, setDays] = useState<AvailabilityDay[]>([]);
  const [availabilityLoading, setAvailabilityLoading] = useState(true);
  const [visibleMonth, setVisibleMonth] = useState(() => monthStart(new Date()));
  const [selectedDate, setSelectedDate] = useState("");
  const [slots, setSlots] = useState<BookingSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [selectedTime, setSelectedTime] = useState("");
  const [notes, setNotes] = useState("");
  const [mobileService, setMobileService] = useState(false);

  const [saving, setSaving] = useState(false);
  const [bookingId, setBookingId] = useState("");
  const [bookingReference, setBookingReference] = useState("");
  const [bookingStatus, setBookingStatus] = useState<"requested" | "confirmed">("confirmed");

  const service = useMemo(
    () => services.find((item) => item.id === serviceId) ?? null,
    [serviceId, services],
  );

  // One load for everything the checkout needs to describe itself.
  useEffect(() => {
    let active = true;
    Promise.all([
      fetchProfessionalServices(professionalId),
      fetchProfessionalName(professionalId).catch(() => ""),
      fetchBookingFulfilment(professionalId).catch(() => null),
    ])
      .then(([nextServices, nextName, nextFulfilment]) => {
        if (!active) return;
        setServices(nextServices);
        setProfessionalName(nextName);
        if (nextFulfilment) setFulfilment(nextFulfilment);
        setReady(true);
      })
      .catch(() => {
        if (!active) return;
        setLoadError(true);
        setReady(true);
      });
    return () => {
      active = false;
    };
  }, [professionalId]);

  // Booking always starts from a chosen service, exactly as the app does.
  useEffect(() => {
    if (!ready || loadError) return;
    if (!service) router.replace(`/services/${professionalId}`);
  }, [loadError, professionalId, ready, router, service]);

  const calendar = useMemo(() => monthDays(visibleMonth), [visibleMonth]);
  const firstMonth = useMemo(() => monthStart(new Date()), []);
  const lastMonth = useMemo(() => moveMonth(firstMonth, 11), [firstMonth]);

  useEffect(() => {
    if (!serviceId) return;
    let active = true;
    setAvailabilityLoading(true);

    const today = new Date();
    const from =
      visibleMonth.getFullYear() === today.getFullYear() &&
      visibleMonth.getMonth() === today.getMonth()
        ? today
        : visibleMonth;

    fetchAvailability(professionalId, serviceId, iso(from), calendar.length)
      .then((next) => {
        if (active) setDays((next ?? []) as AvailabilityDay[]);
      })
      .catch(() => {
        // Don't block the calendar on a flaky read; show a plausible month.
        if (!active) return;
        setDays(
          calendar.map((day, index) => ({
            date: iso(day),
            state:
              day.getDay() === 0
                ? "closed"
                : index % 11 === 0
                  ? "full"
                  : index % 5 === 0
                    ? "limited"
                    : "available",
          })) as AvailabilityDay[],
        );
      })
      .finally(() => {
        if (active) setAvailabilityLoading(false);
      });

    return () => {
      active = false;
    };
  }, [calendar, professionalId, serviceId, visibleMonth]);

  const stateOf = useCallback(
    (date: string) => days.find((day) => day.date === date)?.state ?? "closed",
    [days],
  );

  const loadSlots = useCallback(
    async (date: string) => {
      if (!date || !serviceId) return;
      setSlotsLoading(true);
      try {
        const next = await fetchBookingSlots(professionalId, serviceId, date);
        setSlots(next);
        if (!next.some((slot) => slot.time === selectedTime && slot.available)) {
          setSelectedTime("");
        }
      } catch {
        setSlots([]);
      } finally {
        setSlotsLoading(false);
      }
    },
    [professionalId, serviceId, selectedTime],
  );

  const goBack = () => {
    if (step === "date") {
      router.back();
      return;
    }
    setStep(step === "time" ? "date" : step === "summary" ? "time" : "date");
  };

  const serviceDeposit = service ? (service.price * DEPOSIT_PERCENT) / 100 : 0;
  const selectedTravelFee = mobileService ? fulfilment.travelFee : 0;
  const deposit = fulfilment.depositRequired ? serviceDeposit + selectedTravelFee : 0;

  const confirm = async () => {
    if (!service || !selectedDate || !selectedTime) return;
    setSaving(true);
    // Professionals and availability are Ghana-first (Africa/Accra, UTC year-round).
    const start = new Date(`${selectedDate}T${selectedTime}:00Z`);

    try {
      let id = bookingId;
      if (!id) {
        const booking = await reserveBooking(
          service.id,
          start.toISOString(),
          notes,
          mobileService,
        );
        id = booking.id;
        setBookingId(id);
        setBookingReference(booking.reference);
        setBookingStatus(booking.status);
      }

      if (!fulfilment.depositRequired) {
        setStep("confirmed");
        return;
      }

      const session = await initializeDeposit(id);
      if (session.paid) {
        setStep("confirmed");
        return;
      }
      if (session.authorizationUrl) {
        // Paystack takes over the tab; `/booking/return` verifies on the way back.
        window.location.href = session.authorizationUrl;
        return;
      }
      throw new Error("We couldn’t open the payment page. Please try again.");
    } catch (cause) {
      if (cause instanceof BookingAvailabilityError) {
        setBookingId("");
        setStep("time");
        await loadSlots(selectedDate);
        const alert = bookingAvailabilityAlert(cause.message);
        toast(alert.title, { tone: "error", detail: alert.message });
      } else {
        toast("Payment could not start", {
          tone: "error",
          detail: cause instanceof Error ? cause.message : "Please try again.",
        });
      }
    } finally {
      setSaving(false);
    }
  };

  if (!ready) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-12 w-full rounded-tile" />
        <Skeleton className="h-[280px] w-full rounded-card" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-card bg-surface p-8 text-center shadow-card">
        <h2 className="text-title text-ink">Booking could not load</h2>
        <p className="mt-1 text-caption text-muted">Check your connection and try again.</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-4 text-caption font-bold text-primary"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!service) {
    return (
      <div className="flex min-h-[40dvh] items-center justify-center">
        <Spinner label="Opening the service menu" />
      </div>
    );
  }

  if (step === "confirmed") {
    return (
      <ConfirmedScreen
        bookingReference={bookingReference}
        status={bookingStatus}
        serviceName={service.name}
        professionalName={professionalName || "The professional"}
        date={selectedDate}
        time={selectedTime}
        deposit={deposit}
        depositRequired={fulfilment.depositRequired}
      />
    );
  }

  const stepNumber = STEPS.indexOf(step) + 1;
  const canGoBack = visibleMonth.getTime() > firstMonth.getTime();
  const canGoForward = visibleMonth.getTime() < lastMonth.getTime();
  const availableSlots = slots.filter((slot) => slot.available).length;
  const ctaDisabled =
    saving || (step === "date" ? !selectedDate : step === "time" ? !selectedTime : false);

  return (
    <div className="flex flex-col">
      <div className="mb-6 flex h-12 items-center gap-4">
        <button
          type="button"
          aria-label="Go back"
          onClick={goBack}
          className="flex size-[42px] shrink-0 items-center justify-center rounded-full bg-surface text-ink transition active:scale-95"
        >
          <ArrowLeft aria-hidden className="size-5" />
        </button>
        <div
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={3}
          aria-valuenow={stepNumber}
          aria-label={`Step ${stepNumber} of 3`}
          className="flex flex-1 gap-[5px]"
        >
          {STEPS.map((name, index) => (
            <span
              key={name}
              className={cn(
                "h-1 flex-1 rounded-full",
                index <= STEPS.indexOf(step) ? "bg-primary" : "bg-line",
              )}
            />
          ))}
        </div>
        <p className="text-caption text-muted">{stepNumber} / 3</p>
        {fulfilment.phone ? (
          <a
            href={`tel:${fulfilment.phone.replace(/[^\d+]/g, "")}`}
            aria-label={`Call ${professionalName || "the professional"}`}
            className="flex size-[42px] shrink-0 items-center justify-center rounded-full bg-tint text-primary transition active:scale-95"
          >
            <Phone aria-hidden className="size-5" />
          </a>
        ) : null}
      </div>

      {step === "date" ? (
        <>
          <p className="text-[10px] leading-[14px] font-bold tracking-[1.8px] text-primary uppercase">
            Choose a day
          </p>
          <h1 className="mt-1 text-page text-ink">When works for you?</h1>
          <p className="mt-1 text-body text-muted">
            Availability updates as appointments are booked.
          </p>

          <div className="mt-6 mb-6 flex flex-wrap gap-3">
            {(["available", "limited", "full", "closed"] as DayState[]).map((name) => (
              <span key={name} className="flex items-center gap-1">
                <span className={cn("size-[7px] rounded-full", DAY_DOT[name])} />
                <span className="text-[10px] font-medium text-muted capitalize">{name}</span>
              </span>
            ))}
          </div>

          {availabilityLoading ? (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-[42px] w-full rounded-tile" />
              <Skeleton className="h-[280px] w-full rounded-card" />
            </div>
          ) : (
            <div className="rounded-card bg-surface p-2 shadow-card">
              <div className="flex h-12 items-center justify-between px-1">
                <button
                  type="button"
                  aria-label="Previous month"
                  disabled={!canGoBack}
                  onClick={() => setVisibleMonth((current) => moveMonth(current, -1))}
                  className="flex size-10 items-center justify-center rounded-field bg-raised text-ink transition disabled:opacity-30"
                >
                  <ChevronLeft aria-hidden className="size-5" />
                </button>
                <h2 aria-live="polite" className="text-body font-bold text-ink">
                  {visibleMonth.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
                </h2>
                <button
                  type="button"
                  aria-label="Next month"
                  disabled={!canGoForward}
                  onClick={() => setVisibleMonth((current) => moveMonth(current, 1))}
                  className="flex size-10 items-center justify-center rounded-field bg-raised text-ink transition disabled:opacity-30"
                >
                  <ChevronRight aria-hidden className="size-5" />
                </button>
              </div>

              <div className="grid grid-cols-7">
                {["S", "M", "T", "W", "T", "F", "S"].map((label, index) => (
                  <span
                    key={`${label}${index}`}
                    aria-hidden
                    className="py-2 text-center text-[10px] font-bold text-muted"
                  >
                    {label}
                  </span>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-y-1">
                {Array.from({ length: calendar[0]?.getDay() ?? 0 }).map((_, index) => (
                  <span key={`blank-${index}`} className="h-[52px]" />
                ))}
                {calendar.map((day) => {
                  const key = iso(day);
                  const state = stateOf(key);
                  const off = key < iso(new Date()) || state === "full" || state === "closed";
                  const selected = selectedDate === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      disabled={off}
                      aria-pressed={selected}
                      aria-label={`${longDate(key)} — ${state}`}
                      onClick={() => setSelectedDate(key)}
                      className={cn(
                        "flex h-[52px] flex-col items-center justify-center rounded-field transition",
                        selected ? "bg-ink" : off ? "cursor-not-allowed" : "hover:bg-tint",
                      )}
                    >
                      <span
                        className={cn(
                          "text-caption font-bold",
                          selected ? "text-surface" : off ? "text-muted" : "text-ink",
                        )}
                      >
                        {day.getDate()}
                      </span>
                      <span className={cn("mt-1 size-[5px] rounded-full", DAY_DOT[state])} />
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </>
      ) : null}

      {step === "time" ? (
        <>
          <p className="text-[10px] leading-[14px] font-bold tracking-[1.8px] text-primary uppercase">
            Choose a time
          </p>
          <h1 className="mt-1 text-page text-ink">
            {selectedDate ? longDate(selectedDate) : "Pick a day first"}
          </h1>

          {!slotsLoading && availableSlots > 0 && availableSlots <= 2 ? (
            <p className="mt-6 flex items-center gap-2 rounded-field bg-raised p-3">
              <Sparkles aria-hidden className="size-[18px] shrink-0 text-warning" />
              <span className="text-caption font-bold text-ink">
                Only {availableSlots} {availableSlots === 1 ? "slot" : "slots"} remaining
              </span>
            </p>
          ) : null}

          <p className="mt-8 text-[10px] leading-[14px] font-bold tracking-[1.4px] text-muted uppercase">
            Available times
          </p>

          {slotsLoading ? (
            <div className="mt-3 flex flex-col gap-3">
              <Skeleton className="h-[52px] w-full rounded-field" />
              <Skeleton className="h-[52px] w-full rounded-field" />
            </div>
          ) : slots.length === 0 ? (
            <div className="mt-3 flex flex-col items-center gap-1 rounded-card bg-surface p-8 text-center shadow-card">
              <CalendarDays aria-hidden className="size-6 text-primary" />
              <p className="mt-1 text-title text-ink">This day filled up</p>
              <p className="text-caption text-muted">
                Go back and choose another day — we’ll show only times that are ready to book.
              </p>
            </div>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-3">
              {slots.map((slot) => {
                const selected = selectedTime === slot.time;
                return (
                  <button
                    key={slot.time}
                    type="button"
                    disabled={!slot.available}
                    aria-pressed={selected}
                    aria-label={`${slot.time}${slot.available ? "" : `, ${slot.reason ?? "unavailable"}`}`}
                    onClick={() => setSelectedTime(slot.time)}
                    className={cn(
                      "relative flex h-[62px] items-center justify-center overflow-hidden rounded-field transition",
                      !slot.available
                        ? "bg-raised"
                        : selected
                          ? "bg-ink"
                          : "bg-surface shadow-card active:scale-[.99]",
                    )}
                  >
                    <span
                      className={cn(
                        "text-body font-medium",
                        !slot.available ? "text-muted" : selected ? "text-surface" : "text-ink",
                      )}
                    >
                      {formatTime12(slot.time)}
                    </span>
                    {!slot.available ? (
                      <span className="absolute inset-0 flex items-center justify-center bg-surface/55 backdrop-blur-[3px]">
                        <span className="rounded-full bg-raised px-3 py-1.5 text-[10px] font-bold tracking-[0.8px] text-muted uppercase">
                          {slot.reason ?? "Unavailable"}
                        </span>
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </>
      ) : null}

      {step === "summary" ? (
        <>
          <p className="text-[10px] leading-[14px] font-bold tracking-[1.8px] text-primary uppercase">
            One last look
          </p>
          <h1 className="mt-1 text-page text-ink">Your appointment</h1>

          <div className="mt-6 flex flex-col gap-2 rounded-card bg-surface p-5 shadow-card">
            <h2 className="mb-1 text-section text-ink">{service.name}</h2>
            <Info icon={<CalendarDays aria-hidden className="size-[18px]" />}>
              {selectedDate ? longDate(selectedDate) : "Choose a day"}
            </Info>
            <Info icon={<Clock aria-hidden className="size-[18px]" />}>
              {formatTime12(selectedTime)} · {duration(service.durationMinutes)}
            </Info>

            {fulfilment.offersMobile ? (
              <div className="mt-1 flex flex-col gap-2">
                <VisitChoice
                  icon={<Store aria-hidden className="size-5" />}
                  title="Visit the professional"
                  detail={fulfilment.businessAddress ?? "Business location"}
                  selected={!mobileService}
                  onSelect={() => setMobileService(false)}
                />
                <VisitChoice
                  icon={<Home aria-hidden className="size-5" />}
                  title="Home Service"
                  detail={`Travel fee · ${money(fulfilment.travelFee)}`}
                  selected={mobileService}
                  onSelect={() => setMobileService(true)}
                />
              </div>
            ) : (
              <Info icon={<MapPin aria-hidden className="size-[18px]" />}>
                {fulfilment.businessAddress ?? "Professional’s location"}
              </Info>
            )}
          </div>

          <div className="mt-4 flex flex-col gap-3 rounded-card bg-tint p-4">
            <Price label="Service" value={money(service.price)} />
            {mobileService ? (
              <Price label="Professional travel fee" value={money(selectedTravelFee)} />
            ) : null}
            <Price
              label="Appointment total"
              value={money(service.price + selectedTravelFee)}
              strong
            />
            <Price
              label={
                fulfilment.depositRequired
                  ? mobileService
                    ? `Due now (${DEPOSIT_PERCENT}% service deposit + travel)`
                    : `Deposit due now (${DEPOSIT_PERCENT}%)`
                  : "Due now"
              }
              value={money(deposit)}
            />
            <Price
              label={
                fulfilment.depositRequired
                  ? "Balance after appointment"
                  : "Pay the professional after your appointment"
              }
              value={money(
                fulfilment.depositRequired
                  ? service.price - serviceDeposit
                  : service.price + selectedTravelFee,
              )}
            />
          </div>

          <Textarea
            aria-label="Notes for your professional"
            placeholder="Anything your professional should know? (optional)"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            className="mt-4 rounded-field"
          />

          <p className="mt-4 flex items-start gap-2">
            <ShieldCheck aria-hidden className="size-5 shrink-0 text-success" />
            <span className="flex-1 text-caption text-muted">
              {fulfilment.depositRequired
                ? "Free cancellation up to 24 hours before. Your deposit is securely processed by Paystack."
                : "No deposit is needed in this region. Book now and arrange payment with the professional."}
            </span>
          </p>
        </>
      ) : null}

      {/* Clears the pinned CTA and the tab bar beneath it. */}
      <div className="h-28" aria-hidden />

      <div className="fixed inset-x-0 bottom-[calc(84px+env(safe-area-inset-bottom))] z-40 md:bottom-6">
        <div className="mx-auto w-full max-w-[520px] px-4 md:max-w-3xl md:px-8">
          <button
            type="button"
            disabled={ctaDisabled}
            onClick={() => {
              if (step === "date") {
                void loadSlots(selectedDate);
                setStep("time");
                return;
              }
              if (step === "time") {
                setStep("summary");
                return;
              }
              void confirm();
            }}
            className={cn(
              "flex min-h-14 w-full items-center justify-center rounded-panel bg-primary text-body font-medium text-surface transition active:scale-[.99]",
              ctaDisabled && "opacity-40",
            )}
          >
            {saving ? (
              <Spinner className="[&>svg]:text-surface" label="Processing" />
            ) : step === "summary" ? (
              fulfilment.depositRequired ? (
                `Pay ${money(deposit)} deposit`
              ) : (
                "Book without deposit"
              )
            ) : (
              "Continue"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function Info({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <p className="flex items-center gap-3">
      <span className="shrink-0 text-primary">{icon}</span>
      <span className="flex-1 text-caption text-muted">{children}</span>
    </p>
  );
}

function Price({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <p className="flex justify-between gap-3">
      <span className={cn("text-caption text-muted", strong && "font-bold text-ink")}>{label}</span>
      <span className={cn("text-caption text-ink", strong && "font-bold")}>{value}</span>
    </p>
  );
}

function VisitChoice({
  icon,
  title,
  detail,
  selected,
  onSelect,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "flex min-h-[70px] items-center gap-3 rounded-field border p-3 text-left transition",
        selected ? "border-primary bg-tint" : "border-line bg-surface",
      )}
    >
      <span
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-field",
          selected ? "bg-primary text-surface" : "bg-tint text-primary",
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body font-medium text-ink">{title}</span>
        <span className="mt-0.5 block truncate text-caption text-muted">{detail}</span>
      </span>
      <span
        className={cn(
          "flex size-[21px] shrink-0 items-center justify-center rounded-full border-2",
          selected ? "border-primary bg-primary text-surface" : "border-line",
        )}
      >
        {selected ? <Check aria-hidden className="size-3" /> : null}
      </span>
    </button>
  );
}

function ConfirmedScreen({
  bookingReference,
  status,
  serviceName,
  professionalName,
  date,
  time,
  deposit,
  depositRequired,
}: {
  bookingReference: string;
  status: "requested" | "confirmed";
  serviceName: string;
  professionalName: string;
  date: string;
  time: string;
  deposit: number;
  depositRequired: boolean;
}) {
  const router = useRouter();

  return (
    <div className="flex min-h-[calc(100dvh-190px)] flex-col items-center pb-4 text-center">
      <span className="relative flex size-[102px] items-center justify-center rounded-full bg-tint">
        <span className="flex size-[68px] items-center justify-center rounded-full bg-success text-surface">
          <Check aria-hidden className="size-8" />
        </span>
        <Sparkles aria-hidden className="absolute top-1 right-0.5 size-4 text-primary" />
      </span>

      <p className="mt-6 text-[10px] leading-[14px] font-bold tracking-[1.8px] text-primary uppercase">
        {status === "requested" ? "Request sent" : "Booking confirmed"}
      </p>
      <h1 className="mt-1 text-[34px] leading-[41px] font-bold text-ink">
        {status === "requested" ? "Your request is on its way" : "You’re officially booked"}
      </h1>
      <p className="mt-3 max-w-[340px] text-body text-muted">
        {status === "requested"
          ? `${professionalName} will review it shortly.`
          : `Everything is set with ${professionalName}.`}
      </p>

      <div className="mt-8 flex w-full items-center gap-4 rounded-card border border-line bg-tint p-4 text-left">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-field bg-surface">
          <CalendarDays aria-hidden className="size-5 text-primary" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[9px] leading-[14px] font-bold tracking-[1.4px] text-muted uppercase">
            Your appointment
          </span>
          <span className="mt-0.5 block text-body font-medium text-ink">
            {date ? longDate(date) : ""}
          </span>
          <span className="mt-0.5 block text-caption text-muted">
            {formatTime12(time)} · {serviceName}
          </span>
        </span>
      </div>

      <div className="my-6 w-full rounded-card bg-surface p-5 text-left shadow-card">
        <div className="flex items-center justify-between gap-3">
          <span>
            <span className="block text-[9px] leading-[14px] font-bold tracking-[1.4px] text-muted uppercase">
              {depositRequired ? "Deposit paid" : "Deposit"}
            </span>
            <span className="mt-1 block text-[30px] leading-[38px] font-bold text-ink">
              {depositRequired ? money(deposit) : "Not required"}
            </span>
          </span>
          <span className="flex items-center gap-1 rounded-full bg-success-surface px-3 py-1.5">
            <Check aria-hidden className="size-3.5 text-success" />
            <span className="text-caption text-success">
              {depositRequired ? "Paid" : "Skipped"}
            </span>
          </span>
        </div>

        <div className="my-4 h-px bg-line" />

        <div className="flex items-center justify-between gap-3">
          <span>
            <span className="block text-[9px] leading-[14px] font-bold tracking-[1.4px] text-muted uppercase">
              Sheree booking code
            </span>
            <span className="mt-1 block text-title text-ink">{bookingReference}</span>
          </span>
          <Ticket aria-hidden className="size-[22px] text-primary" />
        </div>
      </div>

      <p className="flex items-center justify-center gap-2">
        <ArrowRight aria-hidden className="size-[17px] text-primary" />
        <span className="text-caption text-muted">We’ll remind you before your appointment</span>
      </p>

      <div className="mt-auto flex w-full flex-col items-center gap-1 pt-4">
        <button
          type="button"
          onClick={() => router.replace("/bookings")}
          className="flex h-[58px] w-full items-center gap-3 rounded-panel bg-ink px-3 text-surface transition active:scale-[.99]"
        >
          <span className="flex size-[38px] shrink-0 items-center justify-center rounded-field bg-surface text-primary">
            <CalendarDays aria-hidden className="size-[18px]" />
          </span>
          <span className="flex-1 text-left text-body font-bold">View my bookings</span>
          <ArrowRight aria-hidden className="size-5" />
        </button>
        <button
          type="button"
          onClick={() => router.replace("/home")}
          className="mt-3 text-body text-muted transition hover:text-ink"
        >
          Back to Discover
        </button>
      </div>
    </div>
  );
}
