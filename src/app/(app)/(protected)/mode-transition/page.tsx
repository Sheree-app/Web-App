"use client";

import { Button, ButtonLink, Card, Spinner } from "@/components/ui";
import { recordAppOpen } from "@/features/notifications/api";
import { useAuth, type AppMode } from "@/providers/auth-provider";
import { cn } from "@/lib/utils";
import { Briefcase, ShoppingBag } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Switching between customer and business mode.
 *
 * Mobile played a full-screen transition here; on the web the switch is instant
 * and the screen becomes an honest chooser, since a person can land on it
 * directly from a link or a bookmark.
 */
export default function ModeTransitionPage() {
  const router = useRouter();
  const { appMode, role, switchMode } = useAuth();
  const [busy, setBusy] = useState<AppMode | null>(null);

  const choose = async (mode: AppMode) => {
    if (mode === "professional" && role !== "professional") {
      router.push("/become-professional");
      return;
    }
    setBusy(mode);
    await switchMode(mode);
    void recordAppOpen(mode).catch(() => undefined);
    setBusy(null);
    router.replace(mode === "professional" ? "/studio" : "/home");
  };

  return (
    <div className="flex flex-col gap-5">
      <header>
        <p className="text-eyebrow text-primary uppercase">Mode</p>
        <h1 className="text-page text-ink">What are you here to do?</h1>
        <p className="mt-1 max-w-md text-body text-muted">
          One account, two points of view. Your bookings and your business both stay in the same
          place.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card
          className={cn(
            "flex flex-col gap-3 border-2",
            appMode === "customer" ? "border-primary" : "border-transparent",
          )}
        >
          <span className="flex size-11 items-center justify-center rounded-full bg-tint text-primary">
            <ShoppingBag aria-hidden className="size-5" />
          </span>
          <h2 className="text-title text-ink">I’m booking</h2>
          <p className="text-caption text-muted">
            Discover work, save looks and manage your appointments.
          </p>
          <div className="mt-auto">
            {appMode === "customer" ? (
              <ButtonLink href="/home" variant="secondary" size="sm">
                Already in this mode
              </ButtonLink>
            ) : (
              <Button size="sm" loading={busy === "customer"} onClick={() => void choose("customer")}>
                Switch to customer
              </Button>
            )}
          </div>
        </Card>

        <Card
          className={cn(
            "flex flex-col gap-3 border-2",
            appMode === "professional" ? "border-primary" : "border-transparent",
          )}
        >
          <span className="flex size-11 items-center justify-center rounded-full bg-tint text-primary">
            <Briefcase aria-hidden className="size-5" />
          </span>
          <h2 className="text-title text-ink">I’m working</h2>
          <p className="text-caption text-muted">
            Your studio: services, calendar, posts and payouts.
          </p>
          <div className="mt-auto">
            {role === "professional" ? (
              appMode === "professional" ? (
                <ButtonLink href="/studio" variant="secondary" size="sm">
                  Already in this mode
                </ButtonLink>
              ) : (
                <Button
                  size="sm"
                  loading={busy === "professional"}
                  onClick={() => void choose("professional")}
                >
                  Switch to business
                </Button>
              )
            ) : (
              <ButtonLink href="/become-professional" size="sm">
                Set up a business
              </ButtonLink>
            )}
          </div>
        </Card>
      </div>

      {busy ? <Spinner label="Switching mode" /> : null}
    </div>
  );
}
