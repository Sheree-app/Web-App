"use client";

import { Spinner } from "@/components/ui";
import { useAuth } from "@/providers/auth-provider";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Client-side counterpart to the proxy's optimistic check.
 *
 * The proxy can only see whether a session exists; onboarding state and the
 * active app mode live in the profile, which the proxy deliberately doesn't
 * fetch. This guard is where those rules are enforced, mirroring the
 * `Stack.Protected` guards in the mobile root layout.
 */
export function AuthGuard({
  children,
  requireOnboarded = true,
}: {
  children: React.ReactNode;
  requireOnboarded?: boolean;
}) {
  const { loading, signedIn, needsOnboarding } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) return;
    if (!signedIn) {
      router.replace(`/sign-in?next=${encodeURIComponent(pathname)}`);
      return;
    }
    if (requireOnboarded && needsOnboarding) {
      router.replace("/onboarding");
    }
  }, [loading, needsOnboarding, pathname, requireOnboarded, router, signedIn]);

  if (loading || !signedIn || (requireOnboarded && needsOnboarding)) {
    return (
      <div className="flex min-h-[60dvh] items-center justify-center">
        <Spinner label="Checking your account" />
      </div>
    );
  }

  return <>{children}</>;
}
