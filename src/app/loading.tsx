import { CardSkeleton } from "@/components/ui";

/**
 * Shown while a route streams in. Card silhouettes rather than a spinner, so the
 * page has a shape before it has content.
 */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <CardSkeleton lines={2} />
        <CardSkeleton lines={2} />
        <CardSkeleton lines={2} />
      </div>
    </div>
  );
}
