"use client";

import { useAction } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

/**
 * Links a booking made through the existing flow back to its price card.
 *
 * This is a cross-system confirmation, so it is best-effort from the client's
 * point of view: the booking already exists in Postgres and the mirrored card
 * already knows the booking id. If Convex is momentarily unreachable the card
 * still catches up through the scheduled re-verification, so the customer must
 * never be blocked from paying or shown a failure here.
 */
export function BookingConfirmation({
  priceCardId,
  bookingId,
}: {
  priceCardId: string;
  bookingId: string;
}) {
  const confirm = useAction(api.priceCards.confirmBooking);
  const attempted = useRef<string | null>(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!bookingId || attempted.current === bookingId) return;
    attempted.current = bookingId;
    void confirm({
      priceCardId: priceCardId as Id<"priceCards">,
      bookingId,
    }).catch(() => {
      setNotice("The booking is safe — the conversation card will refresh shortly.");
    });
  }, [bookingId, confirm, priceCardId]);

  return notice ? (
    <p role="status" className="mt-3 text-center text-[11px] text-muted">
      {notice}
    </p>
  ) : null;
}
