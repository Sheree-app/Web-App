import { SpendScreen } from "@/features/spend";
import { currentMonth, isMonth } from "@/features/spend/format";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Beauty spend" };

/** `/spend?month=YYYY-MM` — the month defaults to this one, and never runs ahead of it. */
export default async function SpendPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { month } = await searchParams;
  const now = currentMonth();
  const initial = isMonth(month) && month <= now ? month : now;
  return <SpendScreen key={initial} initialMonth={initial} />;
}
