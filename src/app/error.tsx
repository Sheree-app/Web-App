"use client";

import { Button, ButtonLink, Card } from "@/components/ui";
import { useEffect } from "react";

/**
 * Route-level error boundary. Says what happened, offers the one useful action
 * (try again), and never shows a stack trace to a customer.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Swap this for the project's error reporter when one is wired up.
    console.error("Sheree route error:", error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[70dvh] max-w-lg flex-col items-center justify-center px-6">
      <Card className="flex flex-col items-center gap-3 text-center">
        <h1 className="text-page text-ink">Something interrupted that</h1>
        <p className="text-body text-muted">
          This screen didn’t finish loading. Trying again usually fixes it — your bookings and saved
          work are untouched.
        </p>
        <div className="flex w-full flex-col gap-2 sm:flex-row">
          <Button onClick={reset} className="flex-1">
            Try again
          </Button>
          <ButtonLink href="/home" variant="secondary" className="flex-1">
            Back to the lookbook
          </ButtonLink>
        </div>
      </Card>
    </div>
  );
}
