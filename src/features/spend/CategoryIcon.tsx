import { cn } from "@/lib/utils";
import type { SpendCategory } from "./categories";

/**
 * A category's line icon in its own colour on a soft tint of that colour.
 * `solid` fills the circle with the colour and draws the icon in white
 * (selected chips, the badge on a professional's photo).
 */
export function CategoryIcon({
  category,
  size = 38,
  solid = false,
  className,
}: {
  category: SpendCategory;
  size?: number;
  solid?: boolean;
  className?: string;
}) {
  const Icon = category.icon;
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        backgroundColor: solid ? category.color : `${category.color}2E`,
        color: solid ? "#FFFFFF" : category.color,
      }}
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full", className)}
    >
      <Icon style={{ width: Math.round(size * 0.48), height: Math.round(size * 0.48) }} strokeWidth={2} />
    </span>
  );
}
