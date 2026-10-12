"use client";

import { Wordmark } from "@/components/brand/wordmark";
import { LookbookRail } from "@/components/brand/lookbook-rail";
import { cn } from "@/lib/utils";
import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Shared frame for every account screen, ported from the mobile `AuthScreen`:
 * masthead, eyebrow, headline, form, and a footer that sits on the baseline.
 *
 * On phones it is a single column that scrolls; from `md` up the form is a
 * centred card, with a companion lookbook panel on desktop.
 */
export function AuthLayout({
  eyebrow,
  title,
  subtitle,
  children,
  footer,
  back = true,
  backTo = "/",
  aside,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
  back?: boolean;
  backTo?: string;
  aside?: ReactNode;
}) {
  const router = useRouter();

  return (
    <div className="relative flex min-h-dvh flex-col bg-background">
      {/* Booking-pattern artwork, cropped and held well below the type. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[url('/images/brand/auth-booking-pattern.png')] bg-cover bg-center opacity-[0.07] dark:opacity-[0.05]"
      />
      <div className="relative mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 pt-safe lg:flex-row lg:items-center lg:gap-16 lg:py-16">
        <div className="mx-auto flex w-full max-w-lg flex-1 flex-col md:my-10 md:rounded-card md:border md:border-line md:bg-surface md:p-8 md:shadow-card lg:my-0 lg:max-w-md lg:p-10">
          <div className="flex min-h-14 items-center justify-between pt-3">
            {back ? (
              <button
                type="button"
                onClick={() => router.push(backTo)}
                aria-label="Go back"
                className="flex size-10 items-center justify-center rounded-full bg-surface text-ink shadow-card transition active:scale-95"
              >
                <ArrowLeft aria-hidden className="size-5" />
              </button>
            ) : (
              <span />
            )}
            <Wordmark size="md" />
          </div>

          <div className="relative mt-8 mb-8 flex flex-col gap-3 lg:mt-14">
            {/* The blush "mirror" and its spark, as on the native auth screens. */}
            <span
              aria-hidden
              className="absolute -top-7 right-1 h-[118px] w-[92px] rotate-[9deg] rounded-[46px] bg-secondary"
            >
              <span className="absolute top-3.5 right-3.5 block size-3 rounded-full bg-surface" />
            </span>
            <p className="text-eyebrow text-primary uppercase">{eyebrow}</p>
            <h1 className={cn("relative max-w-xs text-page text-ink")}>{title}</h1>
            <p className="relative max-w-sm text-body text-muted">{subtitle}</p>
          </div>

          <div className="flex flex-1 flex-col gap-4 pb-10 lg:flex-none lg:pb-0">
            {children}
            {footer ? <div className="mt-auto pt-8">{footer}</div> : null}
          </div>
        </div>
        <div className="hidden min-w-0 flex-1 lg:block">
          {aside ?? (
            <section className="overflow-hidden rounded-[32px] bg-tint px-8 py-12">
              <p className="text-eyebrow text-primary uppercase">Your next look starts here</p>
              <h2 className="mt-4 text-hero text-ink">Find your inspiration.<br />Make it your own.</h2>
              <p className="mt-5 mb-10 max-w-sm text-body text-muted">
                Discover real work, find beauty professionals and make room for your next appointment.
              </p>
              <LookbookRail />
              <p className="mt-8 text-caption text-muted">For the looks you love and the people who create them.</p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

export function AuthFooterPrompt({
  prompt,
  actionLabel,
  href,
}: {
  prompt: string;
  actionLabel: string;
  href: string;
}) {
  return (
    <p className="text-center text-caption text-muted">
      {prompt}{" "}
      <a href={href} className="font-medium text-primary underline-offset-4 hover:underline">
        {actionLabel}
      </a>
    </p>
  );
}
