import { LookScreen } from "@/features/looks";

export default async function LookPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LookScreen id={id} />;
}
