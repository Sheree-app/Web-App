"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";

/**
 * The beauty spend page marks itself as visited for this tab's session of the
 * app (module state survives client-side navigation, not a reload). "Add a
 * spend" then goes back to it the way the app's stack does; opened on its own
 * (a reload, a new tab) it goes to the spend page instead of leaving the app.
 */
let spendVisited = false;
export const markSpendVisited = () => {
  spendVisited = true;
};

export function useBackTo(fallback: string) {
  const router = useRouter();
  return useCallback(() => {
    if (spendVisited) router.back();
    else router.replace(fallback);
  }, [fallback, router]);
}

/** Back to wherever she came from in the app, or the Me page. */
export function useBackOrProfile() {
  const router = useRouter();
  return useCallback(() => {
    if (window.history.length > 1) router.back();
    else router.push("/profile");
  }, [router]);
}
