"use client";

import { Avatar, ErrorState, LoadingRegion, Skeleton } from "@/components/ui";
import { userMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { useToast } from "@/providers/toast-provider";
import {
  ArrowLeft,
  CalendarDays,
  CalendarPlus,
  Check,
  ChevronLeft,
  ChevronRight,
  Plus,
  SlidersHorizontal,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { setQueryData } from "@/lib/use-query";
import { setUpkeep, UPKEEP_KEY, UPKEEP_TTL_MS, type UpkeepItem, type UpkeepPlan } from "./api";
import { CategoryIcon, upkeepCategory } from "./CategoryIcon";
import { addDays, longDayLabel, monthCells, monthLabel, shiftMonth } from "./dates";
import { cycleLabel, lastDoneLine, progress, rebookHref, statusLine } from "./format";
import { calendarItems, downloadIcs, upkeepIcs } from "./ics";
import { useUpkeep } from "./queries";
import { UpkeepSheet, type UpkeepSheetTarget } from "./UpkeepSheet";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type DayEvent = { item: UpkeepItem; kind: "due" | "booked" };

/**
 * Beauty calendar: what's due when, at a glance on a month grid, then one
 * card per kind of upkeep with "book again" and "done today".
 *
 * Reminders differ from the app: the app schedules device notifications; the
 * web offers an .ics download so her own calendar reminds her (see `ics.ts`).
 */
export function UpkeepScreen() {
  const router = useRouter();
  const { error: showError } = useToast();
  // Cached: a revisit paints at once; it refreshes when stale, including when
  // she comes back to the tab.
  const upkeep = useUpkeep();
  const plan = upkeep.data ?? null;
  const failed = Boolean(upkeep.error) && !plan;
  const load = upkeep.refetch;
  const [month, setMonth] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [sheet, setSheet] = useState<UpkeepSheetTarget | null>(null);
  const [sheetKey, setSheetKey] = useState(0);
  const [doing, setDoing] = useState<string | null>(null);

  // A save returns the whole new calendar: that is the cached plan now.
  const apply = useCallback((next: UpkeepPlan) => {
    setQueryData(UPKEEP_KEY, next, UPKEEP_TTL_MS);
  }, []);

  const today = plan?.today ?? null;
  const shownMonth = month ?? today?.slice(0, 7) ?? null;

  /** Day → what lands on it: due dates (and overdue ones on today) and booked appointments. */
  const events = useMemo(() => {
    const map = new Map<string, DayEvent[]>();
    if (!plan) return map;
    const add = (day: string, item: UpkeepItem, kind: DayEvent["kind"]) =>
      map.set(day, [...(map.get(day) ?? []), { item, kind }]);
    for (const item of plan.items) {
      if (item.status === "booked" && item.booked_for) add(item.booked_for, item, "booked");
      else if (item.next_due) add(item.next_due < plan.today ? plan.today : item.next_due, item, "due");
    }
    return map;
  }, [plan]);

  const doneToday = async (item: UpkeepItem) => {
    if (!today) return;
    setDoing(item.category);
    try {
      apply(await setUpkeep(item.category, { last_done: today }));
    } catch (error) {
      showError("Not saved", userMessage(error, "We couldn't update your calendar. Please try again.", "upkeep.done"));
    } finally {
      setDoing(null);
    }
  };

  const openSheet = (target: UpkeepSheetTarget) => {
    setSheetKey((k) => k + 1);
    setSheet(target);
  };

  const upcoming = plan ? calendarItems(plan.items, plan.today) : [];
  const addToCalendar = () => {
    if (!plan) return;
    downloadIcs(upkeepIcs(plan.items, { today: plan.today, origin: window.location.origin }));
  };

  const selectedEvents = selected ? (events.get(selected) ?? []) : [];

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col px-4 pt-2 pb-12">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label="Go back"
          onClick={() => router.back()}
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface text-ink"
        >
          <ArrowLeft aria-hidden className="size-5" />
        </button>
        <div>
          <p className="text-eyebrow text-primary uppercase">Never miss a touch-up</p>
          <h1 className="text-[27px] leading-[34px] font-bold text-ink">Beauty calendar</h1>
        </div>
      </div>

      {!plan || !today || !shownMonth ? (
        failed ? (
          <div className="mt-6">
            <ErrorState message="We couldn’t load your calendar." onRetry={() => void load()} />
          </div>
        ) : (
          <LoadingRegion label="Loading your calendar" className="mt-4 flex flex-col gap-3">
            <Skeleton className="h-[360px] w-full rounded-card" />
            <Skeleton className="h-[132px] w-full rounded-card" />
            <Skeleton className="h-[132px] w-full rounded-card" />
          </LoadingRegion>
        )
      ) : (
        <>
          <MonthGrid
            month={shownMonth}
            today={today}
            events={events}
            selected={selected}
            onSelect={(d) => setSelected(selected === d ? null : d)}
            onMonth={(next) => {
              setMonth(next);
              setSelected(null);
            }}
          />
          {selected ? (
            <p aria-live="polite" className="mt-2 text-center text-caption font-medium text-ink">
              {selectedEvents.length
                ? selectedEvents
                    .map(
                      (e) =>
                        `${e.item.name} ${e.kind === "booked" ? "booked" : e.item.status === "overdue" ? "overdue" : "due"}`,
                    )
                    .join(" · ")
                : "Nothing due this day"}
            </p>
          ) : null}

          {upcoming.length ? (
            <button
              type="button"
              onClick={addToCalendar}
              className="mt-4 flex items-center gap-3 rounded-panel bg-tint p-4 text-left transition active:scale-[.99]"
            >
              <CalendarPlus aria-hidden className="size-5 shrink-0 text-primary" />
              <span className="min-w-0 flex-1">
                <span className="block text-body font-bold text-ink">Get a heads-up</span>
                <span className="block text-caption text-muted">
                  Add your due dates to your calendar. It’ll remind you two days before something’s due.
                </span>
              </span>
              <span className="shrink-0 text-caption font-bold text-primary">Add to calendar</span>
            </button>
          ) : null}

          {plan.items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
              <span className="mb-2 flex size-16 items-center justify-center rounded-full bg-tint text-primary">
                <CalendarDays aria-hidden className="size-[30px]" />
              </span>
              <h2 className="text-title font-bold text-ink">Your calendar fills itself in</h2>
              <p className="text-caption text-muted">
                Book on Sheree, add a look or log a spend, and we’ll work out when your next refresh is due. Or
                start one below.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col">
              {plan.items.map((item) => (
                <li key={item.category}>
                  <UpkeepCard
                    item={item}
                    today={today}
                    busy={doing === item.category}
                    onEdit={() =>
                      openSheet({
                        category: item.category,
                        name: item.name,
                        cycle_days: item.cycle_days,
                        last_done: item.last_done,
                        adding: false,
                      })
                    }
                    onDone={() => void doneToday(item)}
                  />
                </li>
              ))}
            </ul>
          )}

          {plan.available.length ? (
            <section aria-labelledby="upkeep-more" className="mt-8">
              <h2 id="upkeep-more" className="mb-2 ml-1 text-eyebrow text-muted uppercase">
                Track something else
              </h2>
              <div className="flex flex-wrap gap-2">
                {plan.available.map((a) => {
                  const cat = upkeepCategory(a.category, a.name);
                  const Icon = cat.icon;
                  return (
                    <button
                      key={a.category}
                      type="button"
                      aria-label={`Track ${cat.name.toLowerCase()}`}
                      onClick={() =>
                        openSheet({
                          category: a.category,
                          name: a.name,
                          cycle_days: a.default_cycle_days,
                          last_done: null,
                          adding: true,
                        })
                      }
                      className="flex h-[38px] items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-[13px] font-medium text-ink transition hover:bg-tint active:scale-[.99]"
                    >
                      <Icon aria-hidden className="size-[15px]" style={{ color: cat.color }} />
                      {cat.name}
                      <Plus aria-hidden className="size-[15px] text-muted" />
                    </button>
                  );
                })}
              </div>
            </section>
          ) : null}
        </>
      )}

      {sheet && today ? (
        <UpkeepSheet key={sheetKey} target={sheet} today={today} onClose={() => setSheet(null)} onSaved={apply} />
      ) : null}
    </div>
  );
}

function MonthGrid({
  month,
  today,
  events,
  selected,
  onSelect,
  onMonth,
}: {
  month: string;
  today: string;
  events: Map<string, DayEvent[]>;
  selected: string | null;
  onSelect: (day: string) => void;
  onMonth: (month: string) => void;
}) {
  const cells = monthCells(month);
  const gridRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<string | null>(null);
  // One day takes Tab focus; arrow keys move between days (and across months).
  const anchor =
    selected?.startsWith(month) ? selected : today.startsWith(month) ? today : `${month}-01`;

  useEffect(() => {
    const day = pendingFocus.current;
    if (!day) return;
    pendingFocus.current = null;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${day}"]`)?.focus();
  });

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const from = (event.target as HTMLElement).dataset.day;
    if (!from) return;
    const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
    if (!delta) return;
    event.preventDefault();
    const to = addDays(from, delta);
    pendingFocus.current = to;
    if (!to.startsWith(month)) onMonth(to.slice(0, 7));
    onSelect(to);
  };

  return (
    <div className="mt-4 rounded-card bg-surface p-3 shadow-card">
      <div className="mb-1 flex items-center justify-between">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => onMonth(shiftMonth(month, -1))}
          className="flex size-9 items-center justify-center rounded-full bg-tint text-ink"
        >
          <ChevronLeft aria-hidden className="size-[18px]" />
        </button>
        <h2 aria-live="polite" className="text-body font-bold text-ink">
          {monthLabel(month)}
        </h2>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => onMonth(shiftMonth(month, 1))}
          className="flex size-9 items-center justify-center rounded-full bg-tint text-ink"
        >
          <ChevronRight aria-hidden className="size-[18px]" />
        </button>
      </div>
      <div className="grid grid-cols-7" aria-hidden>
        {WEEKDAYS.map((d) => (
          <span key={d} className="py-1 text-center text-[11px] font-bold text-muted">
            <span className="md:hidden">{d[0]}</span>
            <span className="hidden md:inline">{d}</span>
          </span>
        ))}
      </div>
      <div ref={gridRef} className="grid grid-cols-7" onKeyDown={onKeyDown}>
        {cells.map((day, i) => {
          if (!day) return <span key={`pad-${i}`} className="min-h-[46px]" />;
          const list = events.get(day) ?? [];
          const isToday = day === today;
          const on = day === selected;
          const label = [
            isToday ? `Today, ${longDayLabel(day)}` : longDayLabel(day),
            ...list.map((e) => `${e.item.name} ${e.kind === "booked" ? "booked" : "due"}`),
          ].join(", ");
          return (
            <button
              key={day}
              type="button"
              data-day={day}
              tabIndex={day === anchor ? 0 : -1}
              aria-label={label}
              aria-pressed={on}
              onClick={() => onSelect(day)}
              className="group flex min-h-[46px] flex-col items-center rounded-tile py-[3px] outline-none md:min-h-14"
            >
              <span
                className={cn(
                  "flex size-8 items-center justify-center rounded-full text-sm font-medium transition group-hover:bg-tint group-focus-visible:ring-2 group-focus-visible:ring-primary md:size-9",
                  day < today ? "text-muted" : "text-ink",
                  isToday && "border-[1.5px] border-primary font-bold text-primary",
                  on && "border-ink bg-ink text-surface group-hover:bg-ink",
                )}
              >
                {Number(day.slice(8))}
              </span>
              <span className="mt-0.5 flex h-[7px] gap-[3px]">
                {list.slice(0, 3).map((e) => {
                  const color = upkeepCategory(e.item.category, e.item.name).color;
                  return (
                    <span
                      key={e.item.category}
                      className="size-[7px] rounded-full"
                      style={
                        e.kind === "booked" ? { border: `1.5px solid ${color}` } : { backgroundColor: color }
                      }
                    />
                  );
                })}
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-1 flex items-center justify-center gap-1.5 text-[11px] text-muted">
        <span className="size-[7px] rounded-full bg-primary" />
        <span className="mr-2">Due</span>
        <span className="size-[7px] rounded-full border-[1.5px] border-primary" />
        <span>Booked</span>
      </div>
    </div>
  );
}

function UpkeepCard({
  item,
  today,
  busy,
  onEdit,
  onDone,
}: {
  item: UpkeepItem;
  today: string;
  busy: boolean;
  onEdit: () => void;
  onDone: () => void;
}) {
  const cat = upkeepCategory(item.category, item.name);
  const tone =
    item.status === "overdue"
      ? "bg-danger-surface text-danger"
      : item.status === "due_soon"
        ? "bg-tint text-primary"
        : item.status === "booked"
          ? "bg-success-surface text-success"
          : "bg-background text-muted";
  const done = lastDoneLine(item, today);
  const pct = Math.round(progress(item) * 100);
  const href = item.status !== "booked" ? rebookHref(item) : null;
  return (
    <article aria-label={cat.name} className="mt-4 rounded-card bg-surface p-4">
      <div className="flex items-center gap-3">
        <CategoryIcon category={cat} size={44} />
        <div className="min-w-0 flex-1">
          <h3 className="text-body font-bold text-ink">{cat.name}</h3>
          <p className="text-caption text-muted">{[cycleLabel(item.cycle_days), done].filter(Boolean).join(" · ")}</p>
        </div>
        <button
          type="button"
          aria-label={`${cat.name} settings`}
          onClick={onEdit}
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-background text-muted transition hover:text-ink"
        >
          <SlidersHorizontal aria-hidden className="size-[19px]" />
        </button>
      </div>

      <div
        role="progressbar"
        aria-label={`${cat.name} cycle`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="mt-4 h-2 overflow-hidden rounded-full bg-tint"
      >
        <div
          className="h-2 rounded-full"
          style={{
            width: `${Math.max(pct, 3)}%`,
            backgroundColor: item.status === "overdue" ? "var(--color-danger)" : cat.color,
          }}
        />
      </div>
      <p className={cn("mt-3 inline-block rounded-full px-2.5 py-1 text-xs font-bold", tone)}>
        {statusLine(item, today)}
      </p>

      <div className="mt-4 flex gap-2">
        {href && item.rebook ? (
          <Link
            href={href}
            className="flex h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-full bg-primary px-3 text-sm font-bold text-surface transition hover:brightness-[1.04] active:scale-[.99]"
          >
            <Avatar src={item.rebook.avatar_url} name={item.rebook.professional_name ?? "Sheree"} size={24} />
            <span className="truncate">Book {item.rebook.professional_name ?? "again"}</span>
          </Link>
        ) : null}
        {item.last_done ? (
          item.last_done !== today ? (
            <button
              type="button"
              onClick={onDone}
              disabled={busy}
              aria-busy={busy || undefined}
              className="flex h-11 items-center justify-center gap-1.5 rounded-full border border-line px-4 text-sm font-bold text-ink transition hover:bg-tint disabled:opacity-45"
            >
              <Check aria-hidden className="size-[17px]" />
              Done today
            </button>
          ) : null
        ) : (
          <button
            type="button"
            onClick={onEdit}
            className="flex h-11 items-center justify-center gap-1.5 rounded-full border border-line px-4 text-sm font-bold text-ink transition hover:bg-tint"
          >
            <CalendarDays aria-hidden className="size-[17px]" />
            Add last time
          </button>
        )}
      </div>
    </article>
  );
}
