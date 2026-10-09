import { BookingFlow } from "@/features/booking/BookingFlow";
import { Suspense } from "react";

/**
 * Booking lives behind sign-in: the deposit flow needs an account, and every
 * step writes to the customer's own bookings.
 *
 * The screen brings its own step navigation — back control, the 1/3 progress
 * bar and the call button — exactly as the app renders it, so no app bar here.
 */
export default async function BookingPage({
  params,
}: {
  params: Promise<{ professionalId: string }>;
}) {
  const { professionalId } = await params;

  return (
    <Suspense fallback={<p className="text-caption text-muted">Loading booking…</p>}>
      <BookingFlow professionalId={professionalId} />
    </Suspense>
  );
}
