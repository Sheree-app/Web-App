import { LoadingRegion, Skeleton } from "@/components/ui";

/**
 * Shown while an in-app route streams in. It lives under `(app)` rather than at
 * the root so the shell (sidebar and bottom bar) stays on screen during
 * navigation, and it draws inside the shell's content column instead of
 * bringing its own width and padding.
 *
 * It is deliberately plain — a title and a few blocks — because most screens
 * draw their own detailed skeleton once their code arrives. A detailed generic
 * shape here would only jump into a different detailed shape a moment later.
 */
export default function AppLoading() {
  return (
    <LoadingRegion className="flex flex-col gap-3">
      <Skeleton className="mb-3 h-8 w-[52%] rounded-field" />
      <Skeleton className="h-[108px] w-full rounded-card" />
      <Skeleton className="h-20 w-full rounded-card" />
      <Skeleton className="h-20 w-full rounded-card" />
    </LoadingRegion>
  );
}
