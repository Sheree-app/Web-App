import { Spinner } from "@/components/ui";
import { LookEditScreen } from "@/features/looks";
import { Suspense } from "react";

export default async function EditLookPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<Spinner label="Loading your look" />}>
      <LookEditScreen id={id} />
    </Suspense>
  );
}
