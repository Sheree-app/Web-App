import { redirect } from "next/navigation";

/**
 * In the app the studio's fifth tab *is* the profile screen, with the business
 * sections rather than the customer ones. `/profile` already renders those for
 * a professional, so this path forwards there instead of keeping a second copy.
 */
export default function StudioProfileRedirect() {
  redirect("/profile");
}
