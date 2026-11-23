"use client";

import { setSpendBudget } from "@/features/spend/api";
import { spendCategory } from "@/features/spend/categories";
import { setUpkeep } from "@/features/upkeep";
import { cn } from "@/lib/utils";
import { Camera, Lock, Repeat, UserRound } from "lucide-react";

/**
 * The customer half of onboarding (port of the app's `CustomerSetupSteps`):
 * three short, skippable steps that start the Me page's features before the
 * customer ever sees it — the beauty calendar (routine), the spend budget and
 * the look diary. Answers live in the onboarding page and are saved together
 * by `saveCustomerSetup` once the account itself is set up.
 */

/** Categories the beauty calendar can track (server: DEFAULT_CYCLE_DAYS). */
const ROUTINE_SLUGS = [
  "nails",
  "braids",
  "hair",
  "lashes",
  "brows",
  "wigs",
  "locs",
  "pedicure",
  "skincare",
  "barber",
] as const;
export type RoutineSlug = (typeof ROUTINE_SLUGS)[number];

export type LastDone = "week" | "weeks" | "month" | "unsure";
const LAST_DONE: Array<{ value: LastDone; label: string; daysAgo: number | null }> = [
  { value: "week", label: "This week", daysAgo: 3 },
  { value: "weeks", label: "2–3 weeks ago", daysAgo: 17 },
  { value: "month", label: "A month+", daysAgo: 35 },
  { value: "unsure", label: "Not sure", daysAgo: null },
];

export type Routine = Partial<Record<RoutineSlug, LastDone>>;

export const BUDGET_PRESETS = [200, 500, 1000] as const;

export type CustomerSetup = {
  routine: Routine;
  /** Monthly budget in GHS, or null when skipped. */
  budget: number | null;
};

const dayAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

/**
 * Saves the routine and budget. Best effort: each call is independent and a
 * failure never blocks the customer from getting in — the Me page cards let
 * them finish any part later. Returns what actually saved.
 */
export async function saveCustomerSetup(setup: CustomerSetup) {
  const entries = Object.entries(setup.routine) as Array<[RoutineSlug, LastDone]>;
  const routineResults = await Promise.allSettled(
    entries.map(([slug, when]) => {
      const daysAgo = LAST_DONE.find((o) => o.value === when)?.daysAgo ?? null;
      return setUpkeep(slug, { tracking: true, ...(daysAgo === null ? {} : { last_done: dayAgo(daysAgo) }) });
    }),
  );
  const budgetSaved =
    setup.budget !== null &&
    (await setSpendBudget(setup.budget).then(
      () => true,
      () => false,
    ));
  return {
    tracked: routineResults.filter((r) => r.status === "fulfilled").length,
    budget: budgetSaved ? setup.budget : null,
  };
}

/** One line per thing that was set up, for the "You're ready" screen. */
export function setupSummary(saved: { tracked: number; budget: number | null }, firstLook: boolean) {
  const lines: string[] = [];
  if (saved.tracked > 0)
    lines.push(`${saved.tracked} ${saved.tracked === 1 ? "service" : "services"} on your beauty calendar`);
  if (saved.budget !== null) lines.push(`GH₵${saved.budget.toLocaleString("en-GB")} monthly beauty budget`);
  if (firstLook) lines.push("Your look diary, ready for its first photo");
  return lines;
}

const chip =
  "inline-flex h-[42px] items-center gap-1.5 rounded-full border px-3.5 text-caption font-medium transition focus-visible:outline-2 focus-visible:outline-primary";

/** Step 1: which services they keep up with, and roughly when each was last done. */
export function RoutineStep({ value, onChange }: { value: Routine; onChange: (next: Routine) => void }) {
  const chosen = ROUTINE_SLUGS.filter((slug) => value[slug]);
  const toggle = (slug: RoutineSlug) => {
    const next = { ...value };
    if (next[slug]) delete next[slug];
    else next[slug] = "unsure";
    onChange(next);
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {ROUTINE_SLUGS.map((slug) => {
          const category = spendCategory(slug);
          const on = Boolean(value[slug]);
          const Icon = category.icon;
          return (
            <button
              key={slug}
              type="button"
              role="checkbox"
              aria-checked={on}
              onClick={() => toggle(slug)}
              className={cn(chip, on ? "border-primary bg-primary text-surface" : "border-line bg-surface text-ink hover:bg-tint")}
            >
              <Icon aria-hidden className="size-4" style={{ color: on ? undefined : category.color }} />
              {category.name}
            </button>
          );
        })}
      </div>
      {chosen.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="mt-1 text-[10px] font-bold tracking-[1.5px] text-muted uppercase">
            When did you last have it done?
          </p>
          {chosen.map((slug) => {
            const category = spendCategory(slug);
            return (
              <div key={slug} className="flex flex-col gap-2 rounded-panel bg-surface p-3">
                <p className="flex items-center gap-2 text-body font-medium text-ink">
                  <span aria-hidden className="size-2.5 rounded-full" style={{ backgroundColor: category.color }} />
                  {category.name}
                </p>
                <div role="radiogroup" aria-label={`${category.name}: last done`} className="flex flex-wrap gap-1.5">
                  {LAST_DONE.map((option) => {
                    const on = value[slug] === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => onChange({ ...value, [slug]: option.value })}
                        className={cn(
                          "h-[34px] rounded-full px-3 text-caption transition",
                          on ? "bg-primary font-bold text-surface" : "bg-tint text-ink hover:opacity-80",
                        )}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/** Step 2: a monthly beauty budget — a preset or their own amount. */
export function BudgetStep({
  value,
  custom,
  onChange,
  onCustomChange,
}: {
  value: number | null;
  custom: string;
  onChange: (next: number | null) => void;
  onCustomChange: (text: string) => void;
}) {
  const isPreset = BUDGET_PRESETS.some((p) => p === value) && !custom;
  return (
    <div className="flex flex-col gap-4">
      <div role="radiogroup" aria-label="Monthly budget" className="grid grid-cols-3 gap-2">
        {BUDGET_PRESETS.map((amount) => {
          const on = isPreset && value === amount;
          return (
            <button
              key={amount}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => {
                onCustomChange("");
                onChange(on ? null : amount);
              }}
              className={cn(
                "flex h-[84px] flex-col items-center justify-center rounded-panel border transition",
                on ? "border-primary bg-primary text-surface" : "border-line bg-surface text-ink hover:bg-tint",
              )}
            >
              <span className={cn("text-caption", on ? "text-surface" : "text-muted")}>GH₵</span>
              <span className="text-section">{amount.toLocaleString("en-GB")}</span>
            </button>
          );
        })}
      </div>
      <label
        className={cn(
          "flex h-14 items-center gap-2 rounded-panel border bg-surface px-4",
          custom ? "border-primary" : "border-line",
        )}
      >
        <span className="text-body font-bold text-muted">GH₵</span>
        <input
          value={custom}
          onChange={(event) => {
            const clean = event.target.value.replace(/[^0-9]/g, "").slice(0, 7);
            onCustomChange(clean);
            onChange(clean ? Number(clean) : null);
          }}
          inputMode="numeric"
          placeholder="Or type your own amount"
          aria-label="Monthly budget in cedis"
          className="min-w-0 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-muted"
        />
      </label>
      <p className="flex items-start gap-2 text-caption text-muted">
        <Lock aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        Only you can see this. Sheree adds your bookings automatically, and you can log anything else you spend.
      </p>
    </div>
  );
}

const TILES = [
  { slug: "braids", label: "Knotless braids", when: "Oct" },
  { slug: "nails", label: "Chrome nails", when: "Sep" },
  { slug: "lashes", label: "Wispy lashes", when: "Aug" },
];

const BENEFITS = [
  { icon: Camera, text: "Snap every hairstyle, set of nails and glam" },
  { icon: UserRound, text: "Remember who did it and what it cost" },
  { icon: Repeat, text: "Book the exact look again in one tap" },
];

/** Step 3: a preview of the look diary. The buttons live in the page footer. */
export function LooksStep() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-center gap-3 py-2">
        {TILES.map((tile, i) => {
          const category = spendCategory(tile.slug);
          const Icon = category.icon;
          return (
            <div
              key={tile.slug}
              aria-hidden
              className="relative flex aspect-[3/4] w-[30%] max-w-[120px] items-center justify-center overflow-hidden rounded-panel"
              style={{ backgroundColor: category.color, transform: `rotate(${(i - 1) * 4}deg)` }}
            >
              <Icon className="size-7 text-white/90" />
              <div className="absolute inset-x-0 bottom-0 bg-black/20 px-2 py-1.5">
                <p className="truncate text-[11px] font-bold text-white">{tile.label}</p>
                <p className="text-[10px] text-white/85">{tile.when}</p>
              </div>
            </div>
          );
        })}
      </div>
      {BENEFITS.map(({ icon: Icon, text }) => (
        <p key={text} className="flex items-center gap-3 text-body text-ink">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-tint">
            <Icon aria-hidden className="size-[17px] text-primary" />
          </span>
          {text}
        </p>
      ))}
    </div>
  );
}
