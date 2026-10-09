import { Button, ButtonLink } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CloudOff, ImageOff, Loader2, Sparkles } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      aria-hidden
      className={cn("animate-shimmer rounded-tile bg-skeleton", className)}
      {...props}
    />
  );
}

/** Matches the feed/profile tile silhouette so layout doesn't jump. */
export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="overflow-hidden rounded-card bg-surface shadow-card">
      <Skeleton className="aspect-[5/4] w-full rounded-none" />
      <div className="flex flex-col gap-3 p-4">
        {Array.from({ length: lines }).map((_, index) => (
          <Skeleton
            key={index}
            className={cn("h-3", index === 0 ? "w-1/3" : index === 1 ? "w-3/4" : "w-1/2")}
          />
        ))}
      </div>
    </div>
  );
}

export function RowSkeleton() {
  return (
    <div className="flex items-center gap-4 rounded-panel bg-surface p-4">
      <Skeleton className="size-16 rounded-full" />
      <div className="flex flex-1 flex-col gap-2">
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-3 w-4/5" />
        <Skeleton className="h-3 w-2/5" />
      </div>
    </div>
  );
}

export function Spinner({ className, label = "Loading" }: { className?: string; label?: string }) {
  return (
    <span role="status" aria-label={label} className={cn("inline-flex", className)}>
      <Loader2 aria-hidden className="size-6 animate-spin text-primary" />
    </span>
  );
}

function StatePanel({
  icon,
  title,
  message,
  children,
}: {
  icon: ReactNode;
  title: string;
  message: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-card bg-surface px-6 py-10 text-center shadow-card">
      <span className="text-primary">{icon}</span>
      <h2 className="text-title text-ink">{title}</h2>
      <p className="max-w-xs text-caption text-muted">{message}</p>
      {children}
    </div>
  );
}

export function EmptyState({
  title,
  message,
  actionLabel,
  actionHref,
  onAction,
  icon,
}: {
  title: string;
  message: string;
  actionLabel?: string;
  actionHref?: string;
  onAction?: () => void;
  icon?: ReactNode;
}) {
  return (
    <StatePanel icon={icon ?? <Sparkles aria-hidden className="size-7" />} title={title} message={message}>
      {actionLabel && actionHref ? (
        <ButtonLink href={actionHref} size="sm" className="mt-1">
          {actionLabel}
        </ButtonLink>
      ) : actionLabel && onAction ? (
        <Button size="sm" className="mt-1" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </StatePanel>
  );
}

/** Offline / failed-fetch state. The message says what to do, not how it broke. */
export function ErrorState({
  title = "Something interrupted this",
  message,
  onRetry,
  retryLabel = "Try again",
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <StatePanel icon={<CloudOff aria-hidden className="size-7" />} title={title} message={message}>
      {onRetry ? (
        <Button size="sm" className="mt-1" onClick={onRetry}>
          {retryLabel}
        </Button>
      ) : null}
    </StatePanel>
  );
}

export function EmptyArtwork({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-6 text-center">
      <ImageOff aria-hidden className="size-6 text-muted" />
      <p className="text-caption text-muted">{message}</p>
    </div>
  );
}

export function SuccessScreen({
  title,
  message,
  actionLabel = "Continue",
  actionHref,
  onContinue,
}: {
  title: string;
  message: string;
  actionLabel?: string;
  actionHref?: string;
  onContinue?: () => void;
}) {
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="flex size-18 items-center justify-center rounded-full bg-success text-surface">
        <svg viewBox="0 0 24 24" aria-hidden className="size-9" fill="none" stroke="currentColor" strokeWidth={2.5}>
          <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <h1 className="text-page text-ink">{title}</h1>
      <p className="max-w-sm text-body text-muted">{message}</p>
      {actionHref ? (
        <ButtonLink href={actionHref} className="min-w-48">
          {actionLabel}
        </ButtonLink>
      ) : (
        <Button className="min-w-48" onClick={onContinue}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
