"use client";

import { cn } from "@/lib/utils";
import { CalendarDays, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useUpkeep } from "./queries";
import { CategoryIcon, upkeepCategory } from "./CategoryIcon";
import { progress, statusLine } from "./format";

/**
 * The Me page's beauty calendar teaser: what's due next, linking to /upkeep.
 * Fetches its own data (cached for a few minutes, refreshed by any calendar
 * change); it still works as an entry point without data.
 */
export function UpkeepSummaryCard({ className }: { className?: string }) {
  const plan = useUpkeep().data ?? null;
  const next = (plan?.items ?? []).slice(0, 2);
  const urgent = next.filter((i) => i.status === "overdue" || i.status === "due_soon").length;

  return (
    <Link
      href="/upkeep"
      aria-label="Open beauty calendar"
      className={cn(
        "block rounded-card bg-surface p-4 shadow-card transition hover:brightness-[1.01] active:scale-[.99]",
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-tint text-primary">
          <CalendarDays aria-hidden className="size-[21px]" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-eyebrow text-primary uppercase">
            Beauty calendar{urgent ? ` · ${urgent} due soon` : ""}
          </p>
          <p className="text-title font-bold text-ink">{next.length ? "What’s next" : "Never miss a touch-up"}</p>
        </div>
        <ChevronRight aria-hidden className="size-[18px] shrink-0 text-muted" />
      </div>
      {next.length && plan ? (
        <ul className="mt-3 flex flex-col gap-3">
          {next.map((item) => {
            const cat = upkeepCategory(item.category, item.name);
            const warn = item.status === "overdue";
            return (
              <li key={item.category} className="flex items-center gap-3">
                <CategoryIcon category={cat} size={34} />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-bold text-ink">{cat.name}</span>
                    <span
                      className={cn(
                        "text-xs font-medium text-muted",
                        warn && "text-danger",
                        item.status === "due_soon" && "text-primary",
                      )}
                    >
                      {statusLine(item, plan.today)}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-tint">
                    <div
                      className="h-1.5 rounded-full"
                      style={{
                        width: `${Math.max(progress(item) * 100, 3)}%`,
                        backgroundColor: warn ? "var(--color-danger)" : cat.color,
                      }}
                    />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-2 text-caption text-muted">
          Know when your nails, braids or lashes are due, and rebook in one tap.
        </p>
      )}
    </Link>
  );
}
