"use client";

import { Wordmark } from "@/components/brand/wordmark";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/**
 * Frame for the onboarding wizard.
 *
 * Mobile showed one decision per screen with a progress bar pinned under the
 * masthead. Same here, but the form sits in a readable column and the primary
 * action stays reachable on tall phones.
 */
export function OnboardingShell({
  eyebrow,
  title,
  subtitle,
  step,
  totalSteps,
  children,
  footer,
  onBack,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  step: number;
  totalSteps: number;
  children: ReactNode;
  footer?: ReactNode;
  onBack?: () => void;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="mx-auto w-full max-w-2xl px-6 pt-safe">
        <div className="flex items-center justify-between pt-4">
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              className="text-caption font-medium text-muted transition hover:text-ink"
            >
              Back
            </button>
          ) : (
            <span className="text-caption text-muted">Setting up</span>
          )}
          <Wordmark size="sm" />
        </div>
        <div className="mt-4 flex gap-1.5" aria-hidden>
          {Array.from({ length: totalSteps }, (_, index) => (
            <span
              key={index}
              className={cn(
                "h-1.5 flex-1 rounded-full transition-colors",
                index < step ? "bg-primary" : "bg-secondary",
              )}
            />
          ))}
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-8">
        <div className="flex flex-col gap-2">
          <p className="text-eyebrow text-primary uppercase">{eyebrow}</p>
          <h1 className="text-page text-ink">{title}</h1>
          <p className="max-w-md text-body text-muted">{subtitle}</p>
        </div>
        <div className="flex flex-1 flex-col gap-4">{children}</div>
      </main>

      {footer ? (
        <div className="sticky bottom-0 border-t border-line/60 bg-background/95 backdrop-blur-md">
          <div className="mx-auto w-full max-w-2xl px-6 py-4 pb-[calc(16px+env(safe-area-inset-bottom))]">
            {footer}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Large, tappable choice card used for the "which side are you on" step. */
export function ChoiceCard({
  title,
  body,
  selected,
  onSelect,
  badge,
}: {
  title: string;
  body: string;
  selected?: boolean;
  onSelect: () => void;
  badge?: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "rounded-card border-2 p-5 text-left transition",
        selected
          ? "border-primary bg-tint"
          : "border-transparent bg-surface shadow-card hover:border-secondary",
      )}
    >
      <span className="flex items-center justify-between gap-3">
        <span className="text-title text-ink">{title}</span>
        {badge ? (
          <span className="rounded-full bg-secondary px-3 py-1 text-caption text-ink">{badge}</span>
        ) : null}
      </span>
      <span className="mt-1 block text-caption text-muted">{body}</span>
    </button>
  );
}
