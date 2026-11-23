import { cn } from "@/lib/utils";
import type { SpendCategoryTotal } from "./api";
import { spendCategory } from "./categories";
import { money, monthInitial, monthLabel } from "./format";

/**
 * One rounded bar split by category, widest first. The track (`className`
 * background) shows when nothing has been spent yet.
 */
export function CategoryBar({
  categories,
  height = 12,
  gap = 3,
  className,
}: {
  categories: SpendCategoryTotal[];
  height?: number;
  gap?: number;
  className?: string;
}) {
  const total = categories.reduce((sum, c) => sum + c.amount, 0);
  return (
    <div
      aria-hidden
      style={{ height, borderRadius: height / 2, gap }}
      className={cn("flex w-full overflow-hidden bg-tint", className)}
    >
      {total > 0
        ? categories.map((c) => (
            <span
              key={c.slug}
              style={{
                flexGrow: c.amount / total,
                flexBasis: 0,
                minWidth: height / 2,
                backgroundColor: spendCategory(c.slug, c.name).color,
              }}
            />
          ))
        : null}
    </div>
  );
}

/**
 * Six months of totals as soft columns; the selected month is filled in the
 * primary colour, the rest in the secondary. Each column names its total for
 * screen readers and on hover.
 */
export function TrendBars({
  trend,
  selected,
  height = 88,
}: {
  trend: Array<{ month: string; total: number }>;
  selected: string;
  height?: number;
}) {
  const max = Math.max(...trend.map((t) => t.total), 1);
  return (
    <ul className="flex items-end gap-2.5" aria-label="Spend over the last six months">
      {trend.map((t) => {
        const on = t.month === selected;
        const h = t.total > 0 ? Math.max(8, (t.total / max) * height) : 4;
        const label = `${monthLabel(t.month)}: ${money(t.total)}`;
        return (
          <li key={t.month} className="group flex flex-1 flex-col gap-1.5" title={label} aria-label={label}>
            <div className="flex flex-col justify-end" style={{ height }}>
              <div
                style={{ height: h }}
                className={cn(
                  "rounded-[10px] transition-[filter] group-hover:brightness-95",
                  on ? "bg-primary" : "bg-secondary",
                )}
              />
            </div>
            <span
              aria-hidden
              className={cn("text-center text-[11px] leading-4 font-bold", on ? "text-primary" : "text-muted")}
            >
              {monthInitial(t.month)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
