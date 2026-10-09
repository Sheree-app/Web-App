"use client";

import { cn } from "@/lib/utils";
import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import type { ComponentProps, ReactNode } from "react";

/**
 * Page header. Sticky on scroll, with a back affordance that falls back to the
 * section root when there is no history (deep links, PWA launches) instead of
 * dumping people out of the app.
 */
export function TopBar({
  title,
  subtitle,
  backTo,
  showBack = true,
  action,
  className,
  children,
}: {
  title?: string;
  subtitle?: string;
  backTo?: string;
  showBack?: boolean;
  action?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  const router = useRouter();

  const goBack = () => {
    if (backTo) {
      router.push(backTo);
      return;
    }
    if (window.history.length > 1) {
      router.back();
      return;
    }
    router.push("/home");
  };

  return (
    <header
      className={cn(
        "sticky top-0 z-30 border-b border-line/60 bg-background/92 backdrop-blur-md",
        className,
      )}
    >
      <div className="flex min-h-16 items-center gap-3 px-4 md:mx-auto md:max-w-5xl">
        {showBack ? (
          <button
            type="button"
            onClick={goBack}
            aria-label="Go back"
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface text-ink transition active:scale-95"
          >
            <ArrowLeft aria-hidden className="size-5" />
          </button>
        ) : null}
        <div className="min-w-0 flex-1">
          {subtitle ? <p className="text-eyebrow text-primary uppercase">{subtitle}</p> : null}
          {title ? <h1 className="truncate text-title text-ink">{title}</h1> : null}
          {children}
        </div>
        {action}
      </div>
    </header>
  );
}

/** Pill switcher for filters that change what a list shows. */
export function SegmentedTabs<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: Array<{ value: T; label: string; count?: number }>;
  value: T;
  onChange: (next: T) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn("no-scrollbar flex gap-1 overflow-x-auto rounded-full bg-surface p-1", className)}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex-1 rounded-full px-4 py-2 text-caption whitespace-nowrap transition",
              active ? "bg-secondary text-ink" : "text-muted hover:text-ink",
            )}
          >
            {option.label}
            {typeof option.count === "number" ? (
              <span className={cn("ml-2", active ? "text-ink/70" : "text-muted/70")}>
                {option.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** Horizontal section switcher used inside profile and studio screens. */
export function TabLinks({ className, children, ...props }: ComponentProps<"nav">) {
  return (
    <nav
      className={cn("no-scrollbar flex gap-2 overflow-x-auto pb-1", className)}
      {...props}
    >
      {children}
    </nav>
  );
}
