import { redirect } from "next/navigation";

/**
 * The app opens on Discover.
 *
 * There is no marketing/welcome gate in front of the product any more: guests
 * land straight in the lookbook and can browse before they sign in, which is
 * also the page the installable app opens on (`manifest.start_url`).
 */
export default function RootPage() {
  redirect("/discover");
}
