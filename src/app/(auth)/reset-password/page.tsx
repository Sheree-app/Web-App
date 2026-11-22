"use client";

import { AuthLayout } from "@/components/shell/auth-layout";
import { Button, FormError, FormSuccess, OtpField, PasswordInput } from "@/components/ui";
import { requestPasswordReset, resetPassword } from "@/features/auth/api";
import { mapAuthError } from "@/features/auth/auth-errors";
import { homeRoute, useAuth } from "@/providers/auth-provider";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

const RESEND_SECONDS = 60;

/**
 * Password recovery in the two beats the mobile app uses: type the emailed
 * code, then the new password. The API checks the code and sets the password
 * in one call (`POST /v1/auth/password/reset`), which also signs every other
 * device out and this one in, so the code is only held here until then.
 */
export default function ResetPasswordPage() {
  const searchParams = useSearchParams();
  const { startSession } = useAuth();
  const email = (searchParams.get("email") ?? "").trim().toLowerCase();

  const [step, setStep] = useState<"code" | "password">("code");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [seconds, setSeconds] = useState(RESEND_SECONDS);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (seconds <= 0) return;
    const timer = window.setInterval(() => setSeconds((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [seconds]);

  const continueWithCode = (token?: string) => {
    const candidate = token ?? code;
    if (candidate.length !== 6) {
      setError("Enter the complete six-digit code.");
      return;
    }
    setCode(candidate);
    setError("");
    setNotice("");
    setStep("password");
  };

  const resend = async () => {
    if (!email || seconds > 0 || resending) return;
    setResending(true);
    setError("");
    setNotice("");
    try {
      await requestPasswordReset(email);
      setCode("");
      setSeconds(RESEND_SECONDS);
      setNotice("A fresh code is on its way.");
    } catch (resendError) {
      setError(mapAuthError(resendError, "forgot-password").message);
    } finally {
      setResending(false);
    }
  };

  const updatePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");

    if (password.length < 8) {
      setError("Use at least 8 characters for your new password.");
      return;
    }
    if (password !== confirm) {
      setError("The passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const tokens = await resetPassword(email, code, password);
      const profile = await startSession(tokens, email);
      setDone(homeRoute(profile));
    } catch (resetError) {
      const failure = mapAuthError(resetError, "reset-code");
      if (failure.clearCode) {
        // The code itself was the problem: back to the code step.
        setCode("");
        setStep("code");
      }
      setError(failure.message);
    } finally {
      setLoading(false);
    }
  };

  if (!email) {
    return (
      <AuthLayout
        eyebrow="Password reset"
        title="Start with your email."
        subtitle="We need the email on your account to send a reset code."
        backTo="/sign-in"
      >
        <Link href="/forgot-password" className="text-center font-medium text-primary underline-offset-4 hover:underline">
          Get a reset code
        </Link>
      </AuthLayout>
    );
  }

  if (done) {
    return (
      <AuthLayout
        eyebrow="Password updated"
        title="You’re back in."
        subtitle="Your new password is active, and other devices have been signed out."
        back={false}
      >
        <div className="flex flex-col gap-4">
          <FormSuccess message="Your password was changed securely." />
          <Button onClick={() => window.location.replace(done)}>Continue to Sheree</Button>
        </div>
      </AuthLayout>
    );
  }

  if (step === "code") {
    return (
      <AuthLayout
        eyebrow="Check your email"
        title="Enter your reset code."
        subtitle={`We sent six digits to ${email}. Enter them below to continue.`}
        backTo="/sign-in"
      >
        <div className="flex flex-col gap-4">
          <OtpField
            value={code}
            onChange={(next) => {
              setError("");
              setCode(next);
            }}
            invalid={Boolean(error)}
            onComplete={(complete) => continueWithCode(complete)}
          />
          {error ? <FormError message={error} /> : null}
          {notice ? <FormSuccess message={notice} /> : null}
          <Button onClick={() => continueWithCode()}>Continue</Button>
          <button
            type="button"
            onClick={() => void resend()}
            disabled={seconds > 0 || resending}
            className="text-center text-caption font-medium text-primary underline-offset-4 transition hover:underline disabled:text-muted"
          >
            {seconds > 0 ? `Send a new code in ${seconds}s` : "Send a new code"}
          </button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      eyebrow="New password"
      title="Choose something you’ll remember."
      subtitle="At least eight characters. You’ll stay signed in on this device."
      backTo="/sign-in"
    >
      <form onSubmit={updatePassword} className="flex flex-col gap-4">
        <PasswordInput
          label="New password"
          placeholder="At least 8 characters"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <PasswordInput
          label="Confirm new password"
          placeholder="Repeat your password"
          autoComplete="new-password"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
        />
        {error ? <FormError message={error} /> : null}
        <Button type="submit" loading={loading}>
          Save new password
        </Button>
        <button
          type="button"
          onClick={() => setStep("code")}
          className="text-center text-caption font-medium text-primary underline-offset-4 transition hover:underline"
        >
          Change the code
        </button>
      </form>
    </AuthLayout>
  );
}
