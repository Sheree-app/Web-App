import { DiscoverFeed } from "@/features/feed/DiscoverFeed";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Explore Sheree",
  description: "Browse real work from Sheree professionals before you sign up.",
};

/** Guest entry point — the same feed, with booking actions gated behind sign-in. */
export default function GuestDiscoverPage() {
  return <DiscoverFeed guest />;
}
