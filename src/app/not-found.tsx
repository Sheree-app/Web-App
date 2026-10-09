import { ButtonLink, Card } from "@/components/ui";
import { Wordmark } from "@/components/brand/wordmark";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Not found" };

/** Said plainly, with the two places worth going next. */
export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center gap-6 px-6 text-center">
      <Wordmark size="lg" />
      <Card className="flex flex-col items-center gap-3">
        <h1 className="text-page text-ink">That page isn’t here</h1>
        <p className="text-body text-muted">
          The link may be old, or the work behind it may have been removed. The lookbook is still
          where it was.
        </p>
        <div className="flex w-full flex-col gap-2 sm:flex-row">
          <ButtonLink href="/home" className="flex-1">
            Browse the lookbook
          </ButtonLink>
          <ButtonLink href="/explore" variant="secondary" className="flex-1">
            Explore professionals
          </ButtonLink>
        </div>
      </Card>
    </div>
  );
}

