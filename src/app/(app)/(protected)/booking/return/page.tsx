"use client";

import { ButtonLink, Spinner, SuccessScreen } from "@/components/ui";
import { verifyDeposit, releaseUnpaidBooking } from "@/features/booking/api";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Where Paystack sends the customer back.
 *
 * Paystack appends `reference`, and we pass `bookingId` through the callback URL.
 * Verification happens server-side (the Edge Function talks to Paystack), so this
 * page never trusts the query string for anything but identifiers.
 */
export default function BookingReturnPage() {
  const searchParams = useSearchParams();
  const bookingId = searchParams.get("bookingId") ?? "";
  const reference = searchParams.get("reference") ?? searchParams.get("trxref") ?? "";

  const [state, setState] = useState<"checking" | "paid" | "failed">("checking");
  const [message, setMessage] = useState("");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    if (!bookingId || !reference) {
      setState("failed");
      setMessage("We didn’t get a payment reference back. Open your bookings to check the status.");
      return;
    }

    verifyDeposit(bookingId, reference)
      .then(async (paid) => {
        if (paid) {
          setState("paid");
          return;
        }
        // Unpaid: release the slot so someone else can take it.
        await releaseUnpaidBooking(bookingId).catch(() => undefined);
        setState("failed");
        setMessage("That payment didn’t complete, so the slot was released. Nothing was charged.");
      })
      .catch(() => {
        setState("failed");
        setMessage(
          "We couldn’t confirm the payment just now. Check your bookings in a moment — the slot is held briefly.",
        );
      });
  }, [bookingId, reference]);

  if (state === "checking") {
    return (
      <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-3">
        <Spinner label="Confirming your deposit" />
        <p className="text-caption text-muted">Confirming your deposit…</p>
      </div>
    );
  }

  if (state === "paid") {
    return (
      <SuccessScreen
        title="You’re booked."
        message="Your deposit is paid and the appointment is on their calendar. You’ll find everything under Bookings."
        actionLabel="See my bookings"
        actionHref="/bookings"
      />
    );
  }

  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-page text-ink">Payment not completed</h1>
      <p className="max-w-sm text-body text-muted">{message}</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <ButtonLink href="/bookings">Check bookings</ButtonLink>
        <ButtonLink href="/explore" variant="secondary">
          Find someone else
        </ButtonLink>
      </div>
    </div>
  );
}
