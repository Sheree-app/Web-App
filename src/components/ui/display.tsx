import { cn, initials } from "@/lib/utils";
import { Search, Star } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export function Card({ className, children, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("rounded-card bg-surface p-4 shadow-card", className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardLink({ className, children, ...props }: ComponentProps<typeof Link>) {
  return (
    <Link
      className={cn(
        "block rounded-card bg-surface p-4 shadow-card transition active:scale-[.99] md:hover:-translate-y-0.5",
        className,
      )}
      {...props}
    >
      {children}
    </Link>
  );
}

export function SectionHeading({
  title,
  action,
  eyebrow,
  className,
}: {
  title: string;
  action?: ReactNode;
  eyebrow?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex items-end justify-between gap-4", className)}>
      <div>
        {eyebrow ? <p className="text-eyebrow text-primary uppercase">{eyebrow}</p> : null}
        <h2 className="text-section text-ink">{title}</h2>
      </div>
      {action}
    </div>
  );
}

type BadgeTone = "neutral" | "success" | "warning" | "error" | "primary";

const badgeTones: Record<BadgeTone, string> = {
  neutral: "bg-secondary text-ink",
  success: "bg-success text-surface",
  warning: "bg-warning text-ink",
  error: "bg-danger text-surface",
  primary: "bg-primary text-surface",
};

export function Badge({
  label,
  tone = "neutral",
  className,
}: {
  label: string;
  tone?: BadgeTone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-3 py-1 text-caption whitespace-nowrap",
        badgeTones[tone],
        className,
      )}
    >
      {label}
    </span>
  );
}

export function Chip({
  label,
  selected,
  className,
  ...props
}: ComponentProps<"button"> & { label: string; selected?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-4 py-2 text-caption transition",
        selected ? "bg-secondary text-ink" : "bg-surface text-muted hover:text-ink",
        className,
      )}
      {...props}
    >
      {label}
    </button>
  );
}

export function Avatar({
  name,
  src,
  size = 44,
  className,
}: {
  name?: string | null;
  src?: string | null;
  size?: number;
  className?: string;
}) {
  return (
    <span
      style={{ width: size, height: size }}
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-secondary text-ink",
        className,
      )}
    >
      {src ? (
        <Image src={src} alt="" fill sizes={`${size}px`} className="object-cover" />
      ) : (
        <span className="text-caption font-medium">{initials(name)}</span>
      )}
    </span>
  );
}

export function SearchBar({
  className,
  ...props
}: ComponentProps<"input"> & { className?: string }) {
  return (
    <div className="relative">
      <Search
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted"
      />
      <input
        type="search"
        className={cn(
          "min-h-[54px] w-full rounded-card bg-surface pr-4 pl-12 text-body text-ink placeholder:text-muted focus:outline-none focus-visible:outline-2 focus-visible:outline-primary",
          className,
        )}
        {...props}
      />
    </div>
  );
}

export function RatingStars({
  rating,
  count,
  className,
}: {
  rating: number;
  count?: number;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1 text-caption text-muted", className)}>
      <Star aria-hidden className="size-3.5 fill-primary text-primary" />
      {rating > 0 ? rating.toFixed(1) : "New"}
      {count ? <span className="text-muted">({count})</span> : null}
    </span>
  );
}

/** Compact metric used on profile and studio dashboards. */
export function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex-1 rounded-panel bg-surface px-4 py-3 text-center">
      <p className="text-title text-ink">{value}</p>
      <p className="text-caption text-muted">{label}</p>
    </div>
  );
}
