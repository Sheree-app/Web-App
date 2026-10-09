import { DiscoverFeed } from "@/features/feed/DiscoverFeed";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Made for you",
  description: "Fresh work from beauty and wellness professionals who match your interests.",
};

export default function HomePage() {
  return <DiscoverFeed />;
}
