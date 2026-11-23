"use client";

import { Button, Sheet } from "@/components/ui";
import { userMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { useToast } from "@/providers/toast-provider";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { setUpkeep, type UpkeepChange, type UpkeepPlan } from "./api";
import { CategoryIcon, upkeepCategory } from "./CategoryIcon";
import { dayOfMonth, longDayLabel, monthLabel, pickableDays, shiftMonth, weekdayShort } from "./dates";
import { CYCLE_PRESETS, cycleLabel } from "./format";

export type UpkeepSheetTarget = {
  category: string;
  name: string;
  cycle_days: number;
  last_done: string | null;
  /** True for a category she's adding now (not on the calendar yet). */
  adding: boolean;
};

/**
 * How often she redoes something and when she last did. Adding a category
 * asks for the last time it was done; that day can also be left to her
 * bookings, looks and spend to fill in.
 *
 * Mounted fresh for each target (the screen keys it), so its state starts
 * from the target without an effect.
 */
export function UpkeepSheet({
  target,
  today,
  onClose,
  onSaved,
}: {
  target: UpkeepSheetTarget;
  /** The calendar's today (Accra day, from the server). */
  today: string;
  onClose: () => void;
  onSaved: (plan: UpkeepPlan) => void;
}) {
  const { error: showError } = useToast();
  const start = target.last_done ?? (target.adding ? today : null);
  const [cycle, setCycle] = useState(target.cycle_days);
  const [day, setDay] = useState<string | null>(start);
  const [month, setMonth] = useState((start ?? today).slice(0, 7));
  const [busy, setBusy] = useState<"save" | "stop" | null>(null);

  const thisMonth = today.slice(0, 7);
  const days = useMemo(() => pickableDays(month, today), [month, today]);
  const presets = useMemo(
    () => (CYCLE_PRESETS.includes(cycle) ? CYCLE_PRESETS : [...CYCLE_PRESETS, cycle].sort((a, b) => a - b)),
    [cycle],
  );
  const cat = upkeepCategory(target.category, target.name);
  const lower = cat.name.toLowerCase();

  const run = async (kind: "save" | "stop", change: UpkeepChange) => {
    setBusy(kind);
    try {
      onSaved(await setUpkeep(target.category, change));
      onClose();
    } catch (error) {
      showError("Not saved", userMessage(error, "We couldn't update your calendar. Please try again.", "upkeep.save"));
    } finally {
      setBusy(null);
    }
  };

  const save = () => {
    const change: UpkeepChange = { cycle_days: cycle, tracking: true };
    if (day !== target.last_done) change.last_done = day;
    void run("save", change);
  };

  return (
    <Sheet
      open
      onClose={busy ? () => undefined : onClose}
      title={cat.name}
      description={target.adding ? "Add to your calendar" : "Your calendar"}
      footer={
        <div className="flex flex-col gap-1">
          <Button onClick={save} loading={busy === "save"} disabled={busy !== null} className="w-full font-bold">
            {target.adding ? `Add ${lower}` : "Save"}
          </Button>
          {!target.adding ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void run("stop", { tracking: false })}
              loading={busy === "stop"}
              disabled={busy !== null}
              className="w-full font-bold text-danger"
            >
              Stop tracking {lower}
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="flex items-center gap-3">
        <CategoryIcon category={cat} size={44} />
        <p className="text-caption text-muted">
          {target.adding
            ? `Tell us how often you redo your ${lower} and when you last had it done.`
            : "Change how often, or when you last had it done."}
        </p>
      </div>

      <fieldset className="mt-6">
        <legend className="mb-2 text-eyebrow text-muted uppercase">How often · {cycleLabel(cycle)}</legend>
        <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 md:mx-0 md:flex-wrap md:px-0">
          {presets.map((d) => {
            const on = d === cycle;
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                aria-label={cycleLabel(d)}
                onClick={() => setCycle(d)}
                className={cn(
                  "h-[38px] shrink-0 rounded-full border px-3.5 text-caption transition",
                  on ? "border-ink bg-ink font-bold text-surface" : "border-line bg-background text-ink hover:bg-tint",
                )}
              >
                {d % 7 === 0 ? `${d / 7} wk` : `${d} d`}
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="mt-6">
        <div className="mb-2 flex items-center justify-between">
          <legend className="text-eyebrow text-muted uppercase">Last done</legend>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => setMonth(shiftMonth(month, -1))}
              className="flex size-8 items-center justify-center rounded-full text-ink hover:bg-tint"
            >
              <ChevronLeft aria-hidden className="size-[18px]" />
            </button>
            <span aria-live="polite" className="min-w-[104px] text-center text-caption font-bold text-ink">
              {monthLabel(month)}
            </span>
            <button
              type="button"
              aria-label="Next month"
              disabled={month >= thisMonth}
              onClick={() => setMonth(shiftMonth(month, 1))}
              className="flex size-8 items-center justify-center rounded-full text-ink hover:bg-tint disabled:opacity-30"
            >
              <ChevronRight aria-hidden className="size-[18px]" />
            </button>
          </div>
        </div>
        <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 md:mx-0 md:grid md:grid-cols-7 md:px-0">
          {days.map((d) => {
            const on = d === day;
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                aria-label={d === today ? `Today, ${longDayLabel(d)}` : longDayLabel(d)}
                onClick={() => setDay(on && !target.adding ? target.last_done : d)}
                className={cn(
                  "flex h-16 w-14 shrink-0 flex-col items-center justify-center gap-0.5 rounded-[18px] border transition md:w-auto",
                  on ? "border-ink bg-ink text-surface" : "border-line bg-background text-ink hover:bg-tint",
                )}
              >
                <span className={cn("text-[11px] font-medium", on ? "text-surface" : "text-muted")}>
                  {d === today ? "Today" : weekdayShort(d)}
                </span>
                <span className="text-lg leading-none font-bold">{dayOfMonth(d)}</span>
              </button>
            );
          })}
        </div>
      </fieldset>
      <p className="mt-3 text-caption text-muted">Your Sheree bookings, looks and spends update this on their own.</p>
    </Sheet>
  );
}
