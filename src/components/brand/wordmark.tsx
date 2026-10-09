import { cn } from "@/lib/utils";
import type { ComponentProps } from "react";

/**
 * The Sheree wordmark. Sacramento at display sizes is the one place the brand
 * shows its hand, so it is a component rather than a loose class name.
 */
export function Wordmark({
  className,
  size = "md",
  ...props
}: ComponentProps<"span"> & { size?: "sm" | "md" | "lg" | "xl" }) {
  const sizes = {
    sm: "text-[26px] leading-8",
    md: "text-[38px] leading-[50px]",
    lg: "text-[52px] leading-[68px]",
    xl: "text-[clamp(64px,18vw,96px)] leading-[1.1]",
  } as const;

  return (
    <span
      className={cn("wordmark block text-primary select-none", sizes[size], className)}
      {...props}
    >
      Sheree
    </span>
  );
}

/** Small blush "spark" used as the brand's accent mark next to eyebrows. */
export function Spark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2.5 rounded-full bg-primary", className)}
    />
  );
}
