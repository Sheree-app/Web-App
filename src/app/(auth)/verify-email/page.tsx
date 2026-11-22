"use client";

import { AuthLayout } from "@/components/shell/auth-layout";
import { Button, FormError, FormSuccess, OtpField } from "@/components/ui";
import { verifyEmail } from "@/features/auth/api";
import { mapAuthError } from "@/features/auth/auth-errors";
import { clearVerification, heldVerification, resendVerification } from "@/features/auth/pending-verification";
import type { TokenResponse } from "@/lib/api";
import { homeRoute, useAuth } from "@/providers/auth-provider";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

const RESEND_SECONDS = 60;
/**
 * The code check needs the token from the sign-up or sign-in a moment ago,
 * held in memory only; after a page reload signing in again sends a new code.
 */
const SIGN_IN_AGAIN = "This page was reloaded, so we need you to sign in again. We’ll send a fresh code.";

export default function VerifyEmailPage() {
  const { startSession } = useAuth();
  const searchParams = useSearchParams();
  const email = searchParams.get("email") ?? "";

  const [code, setCode] = useState("");
  const [seconds, setSeconds] = useState(RESEND_SECONDS);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (seconds <= 0) return;
    const timer = window.setInterval(
      () => setSeconds((current) => Math.max(0, current - 1)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [seconds]);

  const finish = useCallback(
    async (tokens: TokenResponse) => {
      clearVerification();
      const profile = await startSession(tokens, email);
      // A full load, so cached "go to /sign-in" redirects are dropped.
      window.location.replace(homeRoute(profile));
    },
    [email, startSession],
  );

  const verify = useCallback(
    async (token?: string) => {
      const candidate = token ?? code;
      if (!email) {
        setError("Return to sign up and enter your email again.");
        return;
      }
      if (candidate.length !== 6) {
        setError("Enter the complete six-digit code.");
        return;
      }
      const held = heldVerification(email);
      if (!held) {
        setError(SIGN_IN_AGAIN);
        return;
      }

      setLoading(true);
      setError("");
      try {
        const tokens = await verifyEmail(held.token, candidate);
        await finish(tokens);
      } catch (verifyError) {
        setLoading(false);
        const failure = mapAuthError(verifyError, "verify-code");
        if (failure.clearCode) setCode("");
        setError(failure.message);
      }
    },
    [code, email, finish],
  );

  const resend = async () => {
    if (!email || seconds > 0 || resending) return;
    setResending(true);
    setError("");
    setSent(false);
    try {
      const result = await resendVerification(email);
      if (result.kind === "verified") {
        await finish(result.tokens);
        return;
      }
      setResending(false);
      if (result.kind === "sign_in_again") {
        setError(SIGN_IN_AGAIN);
        return;
      }
      setCode("");
      setSeconds(RESEND_SECONDS);
      setSent(true);
    } catch (resendError) {
      setResending(false);
      setError(mapAuthError(resendError, "resend").message);
    }
  };

  return (
    <AuthLayout
      eyebrow="Email check"
      title="A small code, then you’re in."
      subtitle={`We sent six digits to ${email || "your email"}. Enter them below to verify this is really you.`}
      backTo="/sign-up"
      footer={
        <p className="text-center text-caption text-muted">
          Wrong email?{" "}
          <Link href="/sign-up" className="font-medium text-primary underline-offset-4 hover:underline">
            Start again
          </Link>
          {" · "}
          <Link href="/sign-in" className="font-medium text-primary underline-offset-4 hover:underline">
            Sign in
          </Link>
        </p>
      }
    >
      <div className="flex flex-col gap-4">
        <OtpField
          value={code}
          onChange={(next) => {
            setError("");
            setSent(false);
            setCode(next);
          }}
          invalid={Boolean(error)}
          onComplete={(complete) => void verify(complete)}
        />
        {error ? <FormError message={error} /> : null}
        {sent ? <FormSuccess message="New code sent. It can take a minute to arrive." /> : null}
        <Button loading={loading} onClick={() => void verify()}>
          Verify email
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
