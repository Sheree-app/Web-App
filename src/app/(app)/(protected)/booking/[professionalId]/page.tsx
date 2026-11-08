import { LoadingRegion, Skeleton } from "@/components/ui";
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
    <Suspense
      fallback={
        // Same silhouette BookingFlow draws while it gets ready, so there's one
        // placeholder rather than a line of text followed by a different one.
        <LoadingRegion label="Loading booking" className="flex flex-col gap-3">
          <Skeleton className="h-12 w-full rounded-tile" />
          <Skeleton className="h-[280px] w-full rounded-card" />
        </LoadingRegion>
      }
    >
      <BookingFlow professionalId={professionalId} />
    </Suspense>
  );
}
