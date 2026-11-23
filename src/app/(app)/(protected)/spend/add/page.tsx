import { AddSpendScreen } from "@/features/spend";
import { currentMonth, isMonth } from "@/features/spend/format";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Add a spend" };

/** `/spend/add?month=YYYY-MM` — which month's days the picker offers. */
export default async function AddSpendPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { month } = await searchParams;
  const now = currentMonth();
  return <AddSpendScreen month={isMonth(month) && month <= now ? month : now} />;
}
