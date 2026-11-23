import { UpkeepScreen } from "@/features/upkeep";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Beauty calendar",
  description: "Know when your next touch-up is due, and rebook in one tap.",
};

export default function UpkeepPage() {
  return <UpkeepScreen />;
}
