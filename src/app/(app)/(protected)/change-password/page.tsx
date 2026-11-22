"use client";

import { Button, FormError, PasswordInput } from "@/components/ui";
import { changePassword } from "@/features/auth/api";
import { mapAuthError } from "@/features/auth/auth-errors";
import { useToast } from "@/providers/toast-provider";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Change the password while signed in (`POST /v1/auth/password`): the current
 * password is checked, and every other device is signed out. Someone who
 * forgot it uses the emailed-code reset instead.
 */
export default function ChangePasswordPage() {
  const router = useRouter();
  const { success } = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    if (!current) {
      setError("Enter your current password.");
      return;
    }
    if (next.length < 8) {
      setError("Use at least 8 characters for your new password.");
      return;
    }
    if (next !== confirm) {
      setError("The passwords do not match.");
      return;
    }
    setSaving(true);
    try {
      await changePassword(current, next);
      success("Password updated", "Other devices have been signed out.");
      router.back();
    } catch (changeError) {
      setError(mapAuthError(changeError, "update-password").message);
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col px-4 pb-12 pt-2">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label="Go back"
          onClick={() => router.back()}
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface text-ink"
        >
          <ArrowLeft aria-hidden className="size-5" />
        </button>
        <div>
          <p className="text-eyebrow text-primary uppercase">Your account</p>
          <h1 className="text-[27px] leading-[35px] font-bold text-ink">Password</h1>
        </div>
      </div>

      <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
        <PasswordInput
          label="Current password"
          autoComplete="current-password"
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
        />
        <PasswordInput
          label="New password"
          placeholder="At least 8 characters"
          autoComplete="new-password"
          value={next}
          onChange={(event) => setNext(event.target.value)}
        />
        <PasswordInput
          label="Confirm new password"
          placeholder="Repeat your password"
          autoComplete="new-password"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
        />
        {error ? <FormError message={error} /> : null}
        <Button type="submit" loading={saving}>
          Save new password
        </Button>
        <Link
          href="/forgot-password"
          className="text-center text-caption font-medium text-primary underline-offset-4 hover:underline"
        >
          Forgot your current password?
        </Link>
      </form>
    </div>
  );
}
