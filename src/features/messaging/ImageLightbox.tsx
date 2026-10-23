"use client";

import { X } from "lucide-react";
import { useEffect, useRef } from "react";

/**
 * Accessible image viewer.
 *
 * Focus moves into the dialog, Tab is trapped inside it, Escape closes it, and
 * focus returns to whatever opened it. Body scrolling is locked while open so a
 * mobile browser cannot scroll the thread underneath the photo.
 */
export function ImageLightbox({
  open,
  src,
  alt,
  onClose,
}: {
  open: boolean;
  src: string | null;
  alt: string;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusables = () =>
      Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((node) => !node.hasAttribute("disabled"));

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        panelRef.current?.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, [onClose, open]);

  if (!open || !src) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 md:p-8">
      <div
        aria-hidden
        onClick={onClose}
        className="absolute inset-0 animate-fade bg-overlay backdrop-blur-sm"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={alt || "Shared photo"}
        tabIndex={-1}
        className="relative flex max-h-full w-full max-w-4xl flex-col items-center outline-none"
      >
        <div className="mb-3 flex w-full justify-end">
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close photo"
            className="flex size-11 items-center justify-center rounded-full bg-surface/95 text-ink shadow-card transition hover:bg-surface"
          >
            <X aria-hidden className="size-5" />
          </button>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt || "Photo shared in this conversation"}
          className="max-h-[78dvh] w-auto max-w-full rounded-card object-contain shadow-lift"
        />
      </div>
    </div>
  );
}
