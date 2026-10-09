import { redirect } from "next/navigation";

/**
 * The professional setup used to be its own route. It is now the second half of
 * the one wizard, exactly as it is in the app — so this path forwards there
 * rather than duplicating the flow.
 */
export default function ProfessionalOnboardingRedirect() {
  redirect("/onboarding");
}
