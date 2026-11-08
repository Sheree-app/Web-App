import { DiscoverFeed } from "@/features/feed/DiscoverFeed";
import { fetchInitialFeed } from "@/features/feed/server";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Explore Sheree",
  description: "Browse real work from Sheree professionals before you sign up.",
};

/** Guest entry point — the same feed, with booking actions gated behind sign-in. */
export default async function GuestDiscoverPage() {
  return <DiscoverFeed guest initialPage={await fetchInitialFeed()} />;
}
