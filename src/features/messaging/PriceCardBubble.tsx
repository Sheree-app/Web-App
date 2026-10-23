"use client";

import { useMutation } from "convex/react";
import { CalendarCheck, Loader2, ReceiptText, Undo2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "../../../convex/_generated/api";
import { cn } from "@/lib/utils";
import {
  canBookPriceCard,
  canWithdrawPriceCard,
  formatPrice,
  priceCardStateLabel,
  PRICE_CARD_TONE,
} from "./format";
import type { PriceCardView } from "./types";

/**
 * A custom price card inside the thread.
 *
 * The price shown here is only ever the one the server stored. BOOK NOW sends
 * the customer into the existing booking flow, which re-reads the mirrored card
 * in Postgres and refuses to reserve at any other amount.
 */
export function PriceCardBubble({
  card,
  mine,
  peerExternalId,
  onWithdrawn,
}: {
  card: PriceCardView;
  mine: boolean;
  peerExternalId: string;
  onWithdrawn?: () => void;
}) {
  const cancel = useMutation(api.priceCards.cancel);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const bookable = !mine && canBookPriceCard(card);
  const withdrawable = mine && canWithdrawPriceCard(card);
  const waitingForMirror = !mine && card.status === "sent" && card.publishedAt === null;

  const withdraw = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await cancel({ priceCardId: card.id });
      onWithdrawn?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That price card could not be withdrawn.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={cn(
        "w-full min-w-[240px] max-w-[330px] overflow-hidden rounded-panel border",
        mine ? "border-primary/25 bg-surface" : "border-line bg-surface",
      )}
    >
      <div className="flex items-start gap-3 border-b border-line/70 bg-tint/60 px-4 py-3">
        <span className="mt-0.5 flex size-9 items-center justify-center rounded-full bg-secondary text-ink">
          <ReceiptText aria-hidden className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-[1.2px] text-muted">
            Custom service
          </p>
          <h3 className="truncate text-body font-bold text-ink">{card.serviceName}</h3>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold",
            PRICE_CARD_TONE[card.status],
          )}
        >
          {priceCardStateLabel(card)}
        </span>
      </div>

      <div className="px-4 py-3">
        {card.description ? (
          <p className="mb-3 whitespace-pre-wrap break-words text-caption text-muted">
            {card.description}
          </p>
        ) : null}
        <div className="flex items-end justify-between gap-3">
          <p className="text-section text-ink">{formatPrice(card.priceMinor, card.currency)}</p>
          <p className="pb-1 text-caption text-muted">{card.durationLabel}</p>
        </div>
        {card.expiresAt && card.status === "sent" ? (
          <p className="mt-1 text-[11px] text-muted">
            Holds until{" "}
            {new Intl.DateTimeFormat("en-GB", {
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            }).format(card.expiresAt)}
          </p>
        ) : null}
        {card.bookingReference ? (
          <p className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-success">
            <CalendarCheck aria-hidden className="size-3.5" />
            {card.bookingReference}
            {card.bookingStartsAt
              ? ` · ${new Intl.DateTimeFormat("en-GB", {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                }).format(card.bookingStartsAt)}`
              : ""}
          </p>
        ) : null}
        {card.publishError ? (
          <p className="mt-2 text-[11px] text-danger">
            Booking is not ready yet — the professional has been asked to retry.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="mt-2 text-[11px] text-danger">
            {error}
          </p>
        ) : null}

        {bookable ? (
          <Link
            href={`/booking/${encodeURIComponent(peerExternalId)}?priceCard=${encodeURIComponent(card.id)}`}
            className="mt-3 flex min-h-11 w-full items-center justify-center rounded-field bg-primary px-4 text-caption font-bold text-surface transition hover:brightness-[1.04]"
          >
            Book now · {formatPrice(card.priceMinor, card.currency)}
          </Link>
        ) : waitingForMirror ? (
          <p className="mt-3 flex items-center gap-2 text-[11px] text-muted">
            <Loader2 aria-hidden className="size-3.5 animate-spin" />
            Preparing the booking link…
          </p>
        ) : null}

        {withdrawable ? (
          <button
            type="button"
            onClick={() => void withdraw()}
            disabled={busy}
            className="mt-2 flex min-h-10 w-full items-center justify-center gap-2 rounded-field border border-line px-4 text-caption font-medium text-muted transition hover:bg-tint disabled:opacity-50"
          >
            <Undo2 aria-hidden className="size-3.5" />
            {busy ? "Withdrawing…" : "Withdraw price card"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
