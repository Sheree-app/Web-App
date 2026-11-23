"use client";

import { Avatar, Button, ConfirmDialog, Sheet, Skeleton } from "@/components/ui";
import { userMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { useToast } from "@/providers/toast-provider";
import { ArrowLeft, ChevronLeft, ChevronRight, Flag, Plus, Share, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { updateQueryData } from "@/lib/use-query";
import { deleteSpendEntry, spendKey, type SpendItem, type SpendMonth } from "./api";
import { BudgetSheet } from "./BudgetSheet";
import { spendCategory } from "./categories";
import { CategoryIcon } from "./CategoryIcon";
import {
  changeLabel,
  changePercent,
  currentMonth,
  dayLabel,
  money,
  monthLabel,
  plural,
  shares,
  shiftMonth,
} from "./format";
import { markSpendVisited, useBackOrProfile } from "./navigation";
import { CategoryBar, TrendBars } from "./SpendCharts";
import { SpendShareSheet } from "./SpendShareSheet";
import { useSpendMonth } from "./queries";

// The hero card is always the deep espresso, in light and dark mode alike.
const HERO = "#2E2326";
const HERO_SOFT = "#BFA9B0";

/**
 * Beauty spend: where her beauty money went this month. One glance for the
 * total and budget, then categories, the six-month trend and every treat.
 * The month lives in the URL (`/spend?month=YYYY-MM`) so coming back from
 * "Add a spend" or reloading keeps her place.
 */
export function SpendScreen({ initialMonth }: { initialMonth: string }) {
  const goBack = useBackOrProfile();
  const { error: toastError } = useToast();
  const [month, setMonth] = useState(initialMonth);
  // Each month is cached under its own key, so switching back to one (or
  // coming back to the screen) paints at once and refreshes behind it.
  const monthQuery = useSpendMonth(month);
  const data = monthQuery.data ?? null;
  const [sheet, setSheet] = useState<"budget" | "share" | null>(null);
  const [selected, setSelected] = useState<SpendItem | null>(null);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    markSpendVisited();
  }, []);

  const isCurrent = month >= currentMonth();
  const goMonth = (delta: number) => {
    const next = shiftMonth(month, delta);
    setMonth(next);
    window.history.replaceState(null, "", next === currentMonth() ? "/spend" : `/spend?month=${next}`);
  };
  const retry = () => void monthQuery.refetch();

  const remove = async (item: SpendItem) => {
    setRemoving(true);
    try {
      // Invalidates every month, so this one refetches.
      await deleteSpendEntry(item.id);
      setSelected(null);
    } catch (error) {
      toastError("Not removed", userMessage(error, "We couldn't remove that. Please try again.", "spend.delete"));
    } finally {
      setRemoving(false);
    }
  };

  const days = useMemo(() => {
    const groups: Array<{ day: string; items: SpendItem[] }> = [];
    for (const item of data?.entries ?? []) {
      const last = groups[groups.length - 1];
      if (last && last.day === item.date) last.items.push(item);
      else groups.push({ day: item.date, items: [item] });
    }
    return groups;
  }, [data]);

  // Data is per month, so a month never shows another month's numbers.
  const loadFailed = Boolean(monthQuery.error) && !data;
  const showSkeleton = !loadFailed && data === null;
  const ready = data && !showSkeleton && !loadFailed ? data : null;
  const change = ready ? changePercent(ready.total, ready.previous_total) : null;
  const pct = shares((ready?.categories ?? []).map((c) => c.amount));
  const canShare = Boolean(ready && ready.total > 0);

  return (
    <div className="flex flex-col px-4 pt-2 md:px-0">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label="Go back"
          onClick={goBack}
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface text-ink transition hover:bg-tint"
        >
          <ArrowLeft aria-hidden className="size-5" />
        </button>
        <h1 className="flex-1 text-[27px] leading-[35px] font-bold text-ink">Beauty spend</h1>
        <button
          type="button"
          aria-label="Share my beauty month"
          title="Share my beauty month"
          disabled={!canShare}
          onClick={() => setSheet("share")}
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface text-ink transition hover:bg-tint disabled:pointer-events-none disabled:opacity-35"
        >
          <Share aria-hidden className="size-5" />
        </button>
      </div>

      <div className="mt-4 flex items-center gap-2 self-center rounded-full bg-surface p-1">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => goMonth(-1)}
          className="flex size-9 items-center justify-center rounded-full bg-tint text-ink transition hover:brightness-95"
        >
          <ChevronLeft aria-hidden className="size-[18px]" />
        </button>
        <p aria-live="polite" className="min-w-[140px] text-center text-body font-bold text-ink">
          {monthLabel(month)}
        </p>
        <button
          type="button"
          aria-label="Next month"
          disabled={isCurrent}
          onClick={() => goMonth(1)}
          className="flex size-9 items-center justify-center rounded-full bg-tint text-ink transition hover:brightness-95 disabled:pointer-events-none disabled:opacity-35"
        >
          <ChevronRight aria-hidden className="size-[18px]" />
        </button>
      </div>

      {/* Hero: total, change vs last month, budget */}
      <section
        aria-label="Total"
        style={{ backgroundColor: HERO }}
        className="relative mt-4 overflow-hidden rounded-[30px] p-6 shadow-card"
      >
        <span
          aria-hidden
          className="absolute -top-[110px] -right-[70px] size-[220px] rounded-full bg-[#D98C9D] opacity-35"
        />
        <span
          aria-hidden
          className="absolute -bottom-[60px] -left-[30px] size-[120px] rounded-full bg-[#F5D6DC] opacity-[0.12]"
        />
        <div className="relative">
          <p className="text-eyebrow uppercase" style={{ color: HERO_SOFT }}>
            {isCurrent ? "Spent so far" : "You spent"}
          </p>
          {showSkeleton ? (
            <div className="mt-1.5 flex flex-col gap-2.5">
              <Skeleton className="h-[42px] w-[56%] opacity-30" />
              <Skeleton className="h-3.5 w-[40%] opacity-30" />
            </div>
          ) : loadFailed ? (
            <div className="mt-2 flex flex-col items-start gap-3">
              <p className="text-body text-white">We couldn’t load your spend.</p>
              <button
                type="button"
                onClick={retry}
                className="h-9 rounded-full bg-white/[.12] px-3.5 text-[13px] font-bold text-white transition hover:bg-white/20"
              >
                Try again
              </button>
            </div>
          ) : ready ? (
            <>
              <p className="mt-1 truncate text-[clamp(34px,11vw,44px)] leading-[54px] font-bold text-white">
                {money(ready.total)}
              </p>
              <p className="text-[13px] font-medium text-[#F5D6DC]">
                {change === null
                  ? ready.total > 0
                    ? `${plural(ready.entries.length, "treat")} this month`
                    : "Your beauty month starts here"
                  : changeLabel(month, change)}
              </p>
              <BudgetMeter data={ready} onOpen={() => setSheet("budget")} />
            </>
          ) : null}
        </div>
      </section>

      {ready && ready.total === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
          <span className="mb-2 flex size-16 items-center justify-center rounded-full bg-tint text-primary">
            <Sparkles aria-hidden className="size-[30px]" />
          </span>
          <h2 className="text-title font-bold text-ink">
            Nothing tracked for {monthLabel(month, { year: false })} yet
          </h2>
          <p className="max-w-sm text-caption text-muted">
            Your Sheree bookings show up here on their own. Add anything else, like a salon visit, lashes or a new
            serum, to see your full beauty month.
          </p>
        </div>
      ) : null}

      {ready && ready.total > 0 ? (
        <>
          <div className="mt-4 grid gap-4 md:grid-cols-2 md:items-start">
            <section className="rounded-card bg-surface p-4">
              <h2 className="text-body font-bold text-ink">Where it went</h2>
              <CategoryBar categories={ready.categories} height={14} className="mt-3" />
              <ul className="mt-4 flex flex-col gap-3">
                {ready.categories.map((c, i) => {
                  const cat = spendCategory(c.slug, c.name);
                  return (
                    <li key={c.slug} className="flex items-center gap-3">
                      <CategoryIcon category={cat} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-body font-medium text-ink">{cat.name}</p>
                        <p className="text-caption text-muted">
                          {plural(c.count, "treat")} · {pct[i]}%
                        </p>
                      </div>
                      <p className="text-body font-bold text-ink">{money(c.amount)}</p>
                    </li>
                  );
                })}
              </ul>
            </section>

            <section className="rounded-card bg-surface p-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-body font-bold text-ink">Last 6 months</h2>
                {ready.booked_total > 0 ? (
                  <p className="text-caption text-muted">{money(ready.booked_total)} via Sheree</p>
                ) : null}
              </div>
              <div className="mt-4">
                <TrendBars trend={ready.trend} selected={month} />
              </div>
            </section>
          </div>

          <h2 className="mt-8 ml-1 text-eyebrow text-muted uppercase">Every treat</h2>
          {days.map((group) => (
            <section key={group.day} className="mt-2 flex flex-col gap-1.5">
              <h3 className="ml-1 text-caption font-bold text-ink">{dayLabel(group.day)}</h3>
              <ul className="overflow-hidden rounded-panel bg-surface">
                {group.items.map((item, index) => (
                  <li key={`${item.source}-${item.id}`} className={cn(index > 0 && "border-t border-line")}>
                    <SpendRow item={item} onOpen={() => setSelected(item)} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      ) : null}

      <div className="pointer-events-none sticky bottom-[calc(96px+env(safe-area-inset-bottom))] z-10 mt-8 flex justify-center md:bottom-8">
        <Link
          href={`/spend/add?month=${month}`}
          className="pointer-events-auto flex h-14 items-center gap-2 rounded-full bg-ink px-6 text-body font-bold text-surface shadow-card transition hover:brightness-110 active:scale-[.98]"
        >
          <Plus aria-hidden className="size-[22px]" />
          Add a spend
        </Link>
      </div>

      <BudgetSheet
        open={sheet === "budget"}
        budget={data?.budget ?? null}
        onClose={() => setSheet(null)}
        onSaved={(budget) => updateQueryData<SpendMonth>(spendKey(month), (d) => ({ ...d, budget }))}
      />
      {ready ? <SpendShareSheet open={sheet === "share"} data={ready} onClose={() => setSheet(null)} /> : null}

      <ConfirmDialog
        open={selected?.source === "manual"}
        title={selected?.title ?? ""}
        message={selected ? `${money(selected.amount)} · ${dayLabel(selected.date)}` : ""}
        confirmLabel="Remove"
        cancelLabel="Keep"
        destructive
        loading={removing}
        onConfirm={() => selected && void remove(selected)}
        onClose={() => setSelected(null)}
      />
      <Sheet
        open={selected?.source === "booking"}
        onClose={() => setSelected(null)}
        title={selected?.title ?? ""}
        footer={
          <Button variant="outline" className="w-full" onClick={() => setSelected(null)}>
            OK
          </Button>
        }
      >
        <p className="text-body text-muted">
          Booked on Sheree{selected?.professional_name ? ` with ${selected.professional_name}` : ""}. Sheree bookings
          are added for you automatically.
        </p>
      </Sheet>
    </div>
  );
}

function BudgetMeter({ data, onOpen }: { data: SpendMonth; onOpen: () => void }) {
  if (!data.budget) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="mt-6 flex h-9 items-center gap-1.5 rounded-full bg-white/[.12] px-3.5 text-[13px] font-bold text-white transition hover:bg-white/20"
      >
        <Flag aria-hidden className="size-[15px]" />
        Set a monthly budget
      </button>
    );
  }
  const used = Math.min(data.total / data.budget, 1);
  const over = data.total > data.budget;
  const left = data.budget - data.total;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${over ? `${money(-left)} over budget` : `${money(left)} left`} of ${money(data.budget)}. Change your monthly budget`}
      className="group mt-6 flex w-full flex-col gap-2 rounded-tile text-left"
    >
      <span className="h-2.5 w-full overflow-hidden rounded-full bg-white/15">
        <span
          className={cn("block h-2.5 rounded-full", over ? "bg-warning" : "bg-primary")}
          style={{ width: `${Math.max(used * 100, 3)}%` }}
        />
      </span>
      <span className="flex justify-between text-[13px]">
        <span className="font-bold text-white group-hover:underline">
          {over ? `${money(-left)} over budget` : `${money(left)} left`}
        </span>
        <span className="font-medium" style={{ color: HERO_SOFT }}>
          of {money(data.budget)}
        </span>
      </span>
    </button>
  );
}

function SpendRow({ item, onOpen }: { item: SpendItem; onOpen: () => void }) {
  const cat = spendCategory(item.category, item.category_name);
  const booked = item.source === "booking";
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-tint focus-visible:-outline-offset-2"
    >
      {booked && item.professional_name ? (
        <span className="relative shrink-0">
          <Avatar src={item.avatar_url} name={item.professional_name} size={42} />
          <CategoryIcon
            category={cat}
            size={22}
            solid
            className="absolute -right-1 -bottom-1 box-content border-2 border-surface"
          />
        </span>
      ) : (
        <CategoryIcon category={cat} size={42} />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body font-medium text-ink">{item.title}</span>
        <span className="block truncate text-caption text-muted">
          {booked
            ? `${item.professional_name ?? "Sheree booking"}${item.upcoming ? " · upcoming" : ""}`
            : cat.name}
        </span>
      </span>
      <span className="flex flex-col items-end">
        <span className="text-body font-bold text-ink">{money(item.amount)}</span>
        {booked ? <span className="text-[10px] font-bold tracking-[0.04em] text-primary">Sheree</span> : null}
      </span>
    </button>
  );
}
