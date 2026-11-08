import { FeedSkeleton, LoadingRegion, Skeleton } from "@/components/ui";

/** Feed-shaped, matching what DiscoverFeed shows while its first page loads. */
export default function FeedLoading() {
  return (
    <LoadingRegion label="Loading work">
      <Skeleton className="h-[34px] w-[48%] rounded-field" />
      <Skeleton className="mt-3 mb-6 h-3 w-[240px] max-w-full rounded-tile" />
      <FeedSkeleton />
    </LoadingRegion>
  );
}
