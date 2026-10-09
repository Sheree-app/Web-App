"use client";

import { Button, ButtonLink, Card, FormError } from "@/components/ui";
import { db } from "@/lib/supabase/untyped";
import { useAuth } from "@/providers/auth-provider";
import { Sparkles } from "lucide-react";
import { useState } from "react";

/**
 * The customer-side door into the professional flow.
 *
 * It records the intent (so the studio can be offered later) and then hands
 * over to the same setup the sign-up path uses — one implementation, two ways
 * of reaching it.
 */
export default function BecomeProfessionalPage() {
  const { wantsProfessionalAccount, role, refreshProfile } = useAuth();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const startSetup = async () => {
    setSaving(true);
    setError("");
    // Best-effort: the RPC only exists once the migration has been applied.
    const { error: rpcError } = await db.rpc("set_my_professional_intent", { value: true });
    setSaving(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    await refreshProfile();
  };

  return (
    <div className="flex flex-col gap-4">
      <header>
        <p className="text-eyebrow text-primary uppercase">Sell on Sheree</p>
        <h1 className="text-page text-ink">Get booked for your craft.</h1>
        <p className="mt-1 max-w-lg text-body text-muted">
          Keep your customer account and add a professional one. Your lookbook stays; you gain a
          studio, a calendar and a way to take deposits.
        </p>
      </header>

      <Card className="flex flex-col gap-3">
        <span className="flex size-11 items-center justify-center rounded-full bg-tint text-primary">
          <Sparkles aria-hidden className="size-5" />
        </span>
        <h2 className="text-title text-ink">What setup asks for</h2>
        <ul className="flex flex-col gap-2 text-caption text-muted">
          <li>· The trade you want bookings for</li>
          <li>· Your business name and where you work from</li>
          <li>· Deposits and the days you take appointments</li>
        </ul>
        <p className="text-caption text-muted">
          Identity documents and payout details come later, from your studio — nothing blocks you
          from finishing setup first.
        </p>
      </Card>

      {error ? <FormError message={error} /> : null}

      {role === "professional" || wantsProfessionalAccount ? (
        <ButtonLink href="/onboarding/professional" size="lg">
          Continue professional setup
        </ButtonLink>
      ) : (
        <Button size="lg" loading={saving} onClick={() => void startSetup()}>
          Start professional setup
        </Button>
      )}

      <ButtonLink href="/profile" variant="ghost">
        Not now
      </ButtonLink>
    </div>
  );
}
