"use client";

import { AuthLayout } from "@/components/shell/auth-layout";
import { Button, FormError, FormSuccess, OtpField, PasswordInput } from "@/components/ui";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/providers/auth-provider";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

const RESEND_SECONDS = 60;

/**
 * Password recovery, in the two beats the mobile app used: prove the code, then
 * set the new password. Landing here from a recovery link (no `email` param)
 * means the session already exists, so the code step is skipped.
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setPasswordReset } = useAuth();

  const email = searchParams.get("email") ?? "";
  const step = searchParams.get("step");
  const recovery = Boolean(email);
  const verified = !recovery || step === "password";

  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [seconds, setSeconds] = useState(recovery ? RESEND_SECONDS : 0);
  const [done, setDone] = useState(false);

  // Recovery sessions may only touch the password, nothing else in the app.
  useEffect(() => {
    if (recovery) setPasswordReset(true);
    return () => setPasswordReset(false);
  }, [recovery, setPasswordReset]);

  useEffect(() => {
    if (seconds <= 0) return;
    const timer = window.setInterval(() => setSeconds((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [seconds]);

  const verifyCode = async (token?: string) => {
    const candidate = token ?? code;
    if (candidate.length !== 6) {
      setError("Enter the complete six-digit code.");
      return;
    }
    setPasswordReset(true);
    setLoading(true);
    setError("");
    setNotice("");

    const { data, error: verifyError } = await supabase.auth.verifyOtp({
      email,
      token: candidate,
      type: "recovery",
    });

    setLoading(false);

    if (verifyError || !data.session) {
      setCode("");
      setError(
        verifyError?.message.toLowerCase().includes("expired")
          ? "That code has expired. Request a fresh one below."
          : "That code isn’t right. Check the email and try again.",
      );
      return;
    }

    router.replace(`/reset-password?email=${encodeURIComponent(email)}&step=password`);
  };

  const resend = async () => {
    if (!email || seconds > 0 || resending) return;
    setResending(true);
    setError("");
    setNotice("");

    const { error: resendError } = await supabase.auth.resetPasswordForEmail(email);

    setResending(false);
    if (resendError) {
      setError(resendError.message);
      return;
    }
    setCode("");
    setSeconds(RESEND_SECONDS);
    setNotice("A fresh code is on its way.");
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
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }
    setPasswordReset(false);
    setDone(true);
  };

  if (done) {
    return (
      <AuthLayout
        eyebrow="Password updated"
        title="You’re back in."
        subtitle="Your new password is active."
        back={false}
      >
        <div className="flex flex-col gap-4">
          <FormSuccess message="Your password was changed securely." />
          <Button onClick={() => router.replace("/")}>Continue to Sheree</Button>
        </div>
      </AuthLayout>
    );
  }

  if (!verified) {
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
            onComplete={(complete) => void verifyCode(complete)}
          />
          {error ? <FormError message={error} /> : null}
          {notice ? <FormSuccess message={notice} /> : null}
          <Button loading={loading} onClick={() => void verifyCode()}>
            Continue
          </Button>
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
      </form>
    </AuthLayout>
  );
}
