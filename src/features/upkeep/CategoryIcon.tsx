import { spendCategory, type SpendCategory } from "@/features/spend/categories";

/**
 * The calendar uses the spend tracker's categories (same slugs and palette),
 * so both features read the same.
 */
export type UpkeepCategory = SpendCategory;

/** Any slug the server returns, including ones not listed. */
export const upkeepCategory = spendCategory;

/** A category's line icon in its own colour on a soft tint of that colour. */
export function CategoryIcon({ category, size = 38 }: { category: UpkeepCategory; size?: number }) {
  const Icon = category.icon;
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, backgroundColor: `${category.color}2E`, color: category.color }}
      className="inline-flex shrink-0 items-center justify-center rounded-full"
    >
      <Icon style={{ width: Math.round(size * 0.48), height: Math.round(size * 0.48) }} />
    </span>
  );
}
