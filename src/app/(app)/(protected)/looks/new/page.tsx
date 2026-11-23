import { Spinner } from "@/components/ui";
import { LookEditScreen } from "@/features/looks";
import { Suspense } from "react";

/** Add a look; `?booking=…&title=…` arrives from a "How did it turn out?" prompt. */
export default function NewLookPage() {
  return (
    // The form reads its prefill from the query string.
    <Suspense fallback={<Spinner label="Loading" />}>
      <LookEditScreen />
    </Suspense>
  );
}
