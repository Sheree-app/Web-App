"use client";

import { CardLink } from "@/components/ui";
import { cn } from "@/lib/utils";
import { ChevronRight, Wallet } from "lucide-react";
import { useSpendMonth } from "./queries";
import { spendCategory } from "./categories";
import { currentMonth, money, monthLabel, plural } from "./format";
import { CategoryBar } from "./SpendCharts";

/**
 * The Me page's beauty spend teaser: this month's total and a peek at where it
 * went. Fetches its own month (cached, and dropped whenever spend changes) and
 * links to `/spend`. Until it loads, or if it can't, it shows the invite copy.
 */
export function SpendSummaryCard({ className }: { className?: string }) {
  // The month is part of the key so last month's cache is never shown as this month.
  const data = useSpendMonth(currentMonth()).data ?? null;
  const leader = data?.categories[0] ? spendCategory(data.categories[0].slug, data.categories[0].name) : null;
  const hasSpend = Boolean(data && data.total > 0);

  return (
    <CardLink href="/spend" aria-label="Open beauty spend" className={cn("group", className)}>
      <div className="flex items-center gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-tint text-primary">
          <Wallet aria-hidden className="size-[21px]" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-eyebrow text-primary uppercase">
            Beauty spend · {data ? monthLabel(data.month, { year: false }) : "This month"}
          </p>
          <p className="truncate text-title font-bold text-ink">
            {hasSpend && data ? money(data.total) : "Track your glow-ups"}
          </p>
        </div>
        <ChevronRight
          aria-hidden
          className="size-[18px] shrink-0 text-muted transition-transform group-hover:translate-x-0.5"
        />
      </div>
      {hasSpend && data ? (
        <>
          <CategoryBar categories={data.categories} height={8} gap={2} className="mt-3" />
          <p className="mt-2 text-caption text-muted">
            {plural(data.entries.length, "treat")}
            {leader ? ` · mostly ${leader.name.toLowerCase()}` : ""}
            {data.budget ? ` · ${money(Math.max(data.budget - data.total, 0))} left` : ""}
          </p>
        </>
      ) : (
        <p className="mt-2 text-caption text-muted">
          See where your beauty money goes, set a budget and share your month.
        </p>
      )}
    </CardLink>
  );
}
