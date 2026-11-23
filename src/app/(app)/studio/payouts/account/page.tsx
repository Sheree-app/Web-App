"use client";

import { userMessage } from "@/lib/errors";
import {
  Button,
  Card,
  Chip,
  FormError,
  FormSuccess,
  Input,
  Spinner,
  TopBar,
} from "@/components/ui";
import {
  savePayoutAccount,
  type PayoutInstitution,
  type PayoutMethod,
} from "@/features/account/payoutApi";
import { usePayoutAccount, usePayoutInstitutions } from "@/features/account/payoutQueries";
import { useState } from "react";

const METHODS: Array<{ value: PayoutMethod; label: string; hint: string }> = [
  { value: "ghipss", label: "Bank account", hint: "Any Ghanaian bank via GhIPSS" },
  { value: "mobile_money", label: "Mobile money", hint: "MTN, Telecel or AirtelTigo" },
];

const noInstitutions: PayoutInstitution[] = [];

/**
 * Where the money goes.
 *
 * Institution lists come from Paystack through the payout-account Edge Function,
 * so the names and codes always match what the payment provider expects.
 */
export default function PayoutAccountPage() {
  // In memory only (`payout*` keys are never stored); a save writes it back.
  const accountQuery = usePayoutAccount();
  const account = accountQuery.data ?? null;
  const [method, setMethod] = useState<PayoutMethod>("mobile_money");
  const institutions = usePayoutInstitutions(method).data ?? noInstitutions;
  const [institutionCode, setInstitutionCode] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  // Start the form from the account the first time it's known.
  const [seeded, setSeeded] = useState(false);
  if (!seeded && account) {
    setSeeded(true);
    if (account.method) setMethod(account.method);
    if (account.accountName) setAccountName(account.accountName);
  }

  const chooseMethod = (next: PayoutMethod) => {
    if (next === method) return;
    setMethod(next);
    setInstitutionCode("");
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();

    const institution = institutions.find((item) => item.code === institutionCode);
    if (!institution) {
      setError("Choose where the money should land.");
      return;
    }
    if (accountNumber.trim().length < 6) {
      setError("Check that account number.");
      return;
    }
    if (accountName.trim().length < 2) {
      setError("Enter the name on the account.");
      return;
    }

    setSaving(true);
    setError("");
    setSaved(false);

    try {
      // Writes the saved account into the cache too.
      await savePayoutAccount({
        method,
        bankCode: institution.code,
        institutionName: institution.name,
        accountNumber: accountNumber.trim(),
        accountName: accountName.trim(),
      });
      setAccountNumber("");
      setSaved(true);
    } catch (cause) {
      setError(userMessage(cause, "Those details couldn’t be saved."));
    } finally {
      setSaving(false);
    }
  };

  if (accountQuery.isLoading) {
    return (
      <div className="flex min-h-[50dvh] items-center justify-center">
        <Spinner label="Loading payout details" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <TopBar title="Payout account" backTo="/studio/payouts" />

      {account?.configured ? (
        <Card className="flex flex-col gap-1">
          <h2 className="text-title text-ink">Currently set up</h2>
          <p className="text-caption text-muted">
            {account.institutionName ?? "Account"} ····{account.last4 ?? ""} ·{" "}
            {account.accountName ?? ""}
          </p>
          <p className="text-caption text-muted">
            Changing this only affects future payouts.
          </p>
        </Card>
      ) : (
        <Card className="flex flex-col gap-1">
          <h2 className="text-title text-ink">No payout account yet</h2>
          <p className="text-caption text-muted">
            Add one and completed appointments can be paid out. You can change it later.
          </p>
        </Card>
      )}

      <form onSubmit={save} className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-3">
          <legend className="text-caption text-muted">Where should money land?</legend>
          <div className="flex flex-wrap gap-2">
            {METHODS.map((option) => (
              <Chip
                key={option.value}
                label={`${option.label} — ${option.hint}`}
                selected={method === option.value}
                onClick={() => chooseMethod(option.value)}
              />
            ))}
          </div>
        </fieldset>

        <label className="flex flex-col gap-2">
          <span className="text-caption text-muted">
            {method === "mobile_money" ? "Mobile money provider" : "Bank"}
          </span>
          <select
            value={institutionCode}
            onChange={(event) => setInstitutionCode(event.target.value)}
            className="min-h-[54px] rounded-panel border border-secondary bg-surface px-4 text-body text-ink"
          >
            <option value="">Choose one</option>
            {institutions.map((institution) => (
              <option key={institution.code} value={institution.code}>
                {institution.name}
              </option>
            ))}
          </select>
        </label>

        <Input
          label={method === "mobile_money" ? "Mobile money number" : "Account number"}
          inputMode="numeric"
          value={accountNumber}
          onChange={(event) => setAccountNumber(event.target.value.replace(/[^\d]/g, ""))}
        />

        <Input
          label="Name on the account"
          value={accountName}
          onChange={(event) => setAccountName(event.target.value)}
          hint="It has to match the account exactly, or the payout fails."
        />

        {error ? <FormError message={error} /> : null}
        {saved ? <FormSuccess message="Payout account saved." /> : null}

        <Button type="submit" size="lg" loading={saving}>
          Save payout account
        </Button>
      </form>
    </div>
  );
}
