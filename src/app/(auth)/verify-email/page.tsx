"use client";

import { AuthLayout } from "@/components/shell/auth-layout";
import { Button, FormError, FormSuccess, OtpField } from "@/components/ui";
import { supabase } from "@/lib/supabase/client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

const RESEND_SECONDS = 60;

export default function VerifyEmailPage() {
  const router = useRouter();
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

      setLoading(true);
      setError("");

      const { data, error: authError } = await supabase.auth.verifyOtp({
        email,
        token: candidate,
        type: "email",
      });

      setLoading(false);

      if (authError) {
        setCode("");
        setError(
          authError.message.toLowerCase().includes("expired")
            ? "That code has expired. Request a fresh one below."
            : "That code isn’t right. Check the email and try again.",
        );
        return;
      }
      if (!data.session) {
        setError("Email verified, but sign-in could not start.");
        return;
      }
      router.replace("/onboarding");
    },
    [code, email, router],
  );

  const resend = async () => {
    if (!email || seconds > 0 || resending) return;
    setResending(true);
    setError("");
    setSent(false);

    const { error: resendError } = await supabase.auth.resend({ type: "signup", email });

    setResending(false);
    if (resendError) {
      setError(resendError.message);
      return;
    }
    setCode("");
    setSeconds(RESEND_SECONDS);
    setSent(true);
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
