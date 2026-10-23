"use client";

import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const SEEN_KEY = "sheree:welcome-modal-shown";

/**
 * A soft first welcome for people discovering Sheree for the first time.
 * It lives in the root layout so it can greet visitors before they choose
 * whether to browse, learn more, or create an account.
 */
export function WelcomeModal() {
  const pathname = usePathname();
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    // Auth and onboarding pages already have a focused task of their own.
    if (pathname.startsWith("/sign-") || pathname.startsWith("/forgot-password") || pathname.startsWith("/reset-password") || pathname.startsWith("/verify-email") || pathname.startsWith("/onboarding")) {
      return;
    }

    let seen = false;
    try {
      seen = window.sessionStorage.getItem(SEEN_KEY) === "1";
    } catch {
      // Showing the welcome is still useful when storage is unavailable.
    }
    if (!seen) setOpen(true);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    panelRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function close() {
    try {
      window.sessionStorage.setItem(SEEN_KEY, "1");
    } catch {
      // Best effort only; the dialog can still be dismissed for this render.
    }
    setOpen(false);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center p-3 sm:items-center sm:p-6">
      <button
        type="button"
        aria-label="Close welcome message"
        onClick={close}
        className="absolute inset-0 animate-fade bg-overlay"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-title"
        tabIndex={-1}
        className="animate-sheet relative w-full max-w-md overflow-hidden rounded-card bg-surface shadow-lift outline-none sm:animate-rise"
      >
        <div className="absolute inset-x-0 top-0 h-36 overflow-hidden bg-tint" aria-hidden>
          <img
            src="/images/brand/splash-beauty-background.png"
            alt=""
            className="h-full w-full object-cover object-top opacity-80"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-surface/35 to-surface" />
        </div>
        <div className="relative p-6 sm:p-8">
          <button
            type="button"
            onClick={close}
            aria-label="Close welcome message"
            className="absolute right-4 top-4 flex size-10 items-center justify-center rounded-full text-muted transition hover:bg-surface/70 hover:text-ink"
          >
            <X aria-hidden className="size-5" />
          </button>

          <div className="mb-7 h-5" aria-hidden />

          {!showDetails ? (
            <>
              <p className="text-eyebrow text-primary uppercase">A little hello</p>
              <h2 id="welcome-title" className="mt-2 text-section text-ink">
                Welcome to Sheree, lovely
              </h2>
              <p className="mt-3 text-body text-muted">
                Are you new here and curious to see how Sheree can make finding your next beauty or wellness moment feel easy?
              </p>
              <div className="mt-7 flex flex-col gap-3">
                <Button size="lg" onClick={() => setShowDetails(true)} className="w-full">
                  Yes, tell me more
                </Button>
                <button
                  type="button"
                  onClick={close}
                  className="min-h-11 rounded-panel px-4 text-caption font-medium text-muted transition hover:bg-tint hover:text-ink"
                >
                  I’m ready to look around
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-eyebrow text-primary uppercase">Made for your kind of care</p>
              <h2 id="welcome-title" className="mt-2 text-section text-ink">
                Your next favourite professional is closer than you think
              </h2>
              <p className="mt-3 text-body text-muted">
                Browse beautiful work, compare real prices, and book with confidence — all in one lovely place.
              </p>
              <div className="mt-5 space-y-3 rounded-panel bg-tint p-4 text-caption text-ink">
                <p><span className="mr-2 inline-block size-1.5 rounded-full bg-primary align-middle" />Discover trusted beauty and wellness professionals.</p>
                <p><span className="mr-2 inline-block size-1.5 rounded-full bg-primary align-middle" />See their work, availability, and prices before you choose.</p>
                <p><span className="mr-2 inline-block size-1.5 rounded-full bg-primary align-middle" />Keep everything you book in one calm, simple space.</p>
              </div>
              <div className="mt-7 flex flex-col gap-3">
                <Button size="lg" onClick={() => { close(); router.push("/sign-up"); }} className="w-full">
                  Create my Sheree account
                </Button>
                <button
                  type="button"
                  onClick={close}
                  className="min-h-11 rounded-panel px-4 text-caption font-medium text-muted transition hover:bg-tint hover:text-ink"
                >
                  I’ll browse for now
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
