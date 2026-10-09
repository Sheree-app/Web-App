"use client";

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
  fetchPayoutAccount,
  fetchPayoutInstitutions,
  savePayoutAccount,
  type PayoutAccount,
  type PayoutInstitution,
  type PayoutMethod,
} from "@/features/account/payoutApi";
import { useEffect, useState } from "react";

const METHODS: Array<{ value: PayoutMethod; label: string; hint: string }> = [
  { value: "ghipss", label: "Bank account", hint: "Any Ghanaian bank via GhIPSS" },
  { value: "mobile_money", label: "Mobile money", hint: "MTN, Telecel or AirtelTigo" },
];

/**
 * Where the money goes.
 *
 * Institution lists come from Paystack through the payout-account Edge Function,
 * so the names and codes always match what the payment provider expects.
 */
export default function PayoutAccountPage() {
  const [account, setAccount] = useState<PayoutAccount | null>(null);
  const [method, setMethod] = useState<PayoutMethod>("mobile_money");
  const [institutions, setInstitutions] = useState<PayoutInstitution[]>([]);
  const [institutionCode, setInstitutionCode] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    fetchPayoutAccount()
      .then((next) => {
        if (!active) return;
        setAccount(next);
        if (next.method) setMethod(next.method);
        if (next.accountName) setAccountName(next.accountName);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setInstitutionCode("");
    fetchPayoutInstitutions(method)
      .then((next) => {
        if (active) setInstitutions(next);
      })
      .catch(() => {
        if (active) setInstitutions([]);
      });

    return () => {
      active = false;
    };
  }, [method]);

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
      const next = await savePayoutAccount({
        method,
        bankCode: institution.code,
        institutionName: institution.name,
        accountNumber: accountNumber.trim(),
        accountName: accountName.trim(),
      });
      setAccount(next);
      setAccountNumber("");
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Those details couldn’t be saved.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
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
                onClick={() => setMethod(option.value)}
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
