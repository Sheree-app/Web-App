"use client";

import { Spinner } from "@/components/ui";
import { useAuth } from "@/providers/auth-provider";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Studio gate.
 *
 * Opening the studio from a customer account should never be a dead end: people
 * with a business profile are switched into business mode automatically, and
 * everyone else is offered the setup flow instead of an error.
 */
export default function StudioLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { loading, signedIn, role, appMode, switchMode, wantsProfessionalAccount } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (!signedIn) {
      router.replace("/sign-in?next=%2Fstudio");
      return;
    }
    if (role !== "professional") {
      router.replace(wantsProfessionalAccount ? "/onboarding/professional" : "/become-professional");
      return;
    }
    if (appMode !== "professional") void switchMode("professional");
  }, [appMode, loading, role, router, signedIn, switchMode, wantsProfessionalAccount]);

  if (loading || !signedIn || role !== "professional") {
    return (
      <div className="flex min-h-[60dvh] items-center justify-center">
        <Spinner label="Opening your studio" />
      </div>
    );
  }

  return <>{children}</>;
}
