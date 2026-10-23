"use client";
import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { MessagingUnread } from "@/providers/messaging-provider";
import { MessagingBoundary } from "./MessagingGate";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export function MessageLink({
  className,
  iconClassName,
  label,
  labelClassName,
}: {
  className?: string;
  iconClassName?: string;
  label?: ReactNode;
  labelClassName?: string;
}) {
  return (
    <Link
      href="/messages"
      aria-label="Messages"
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-full bg-surface text-ink",
        className,
      )}
    >
      <span className="relative flex shrink-0 items-center justify-center">
        <MessageCircle aria-hidden className={cn("size-5", iconClassName)} />
        <MessagingBoundary fallback={null}>
          <MessagingUnread>
            {(count) =>
              count > 0 ? (
                <span
                  aria-label={`${count} unread messages`}
                  className="absolute -right-1 -top-1 min-w-5 rounded-full bg-primary px-1 text-center text-[10px] leading-5 font-bold text-surface"
                >
                  {count > 99 ? "99+" : count}
                </span>
              ) : null
            }
          </MessagingUnread>
        </MessagingBoundary>
      </span>
      {label ? <span className={labelClassName}>{label}</span> : null}
    </Link>
  );
}
