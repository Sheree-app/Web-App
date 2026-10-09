"use client";

import { AuthFooterPrompt, AuthLayout } from "@/components/shell/auth-layout";
import { Button, FormError, Input, PasswordInput } from "@/components/ui";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/providers/auth-provider";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

export default function SignInPage() {
  const { refreshProfile, setPasswordReset } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");

    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError("Enter a valid email address.");
      return;
    }
    if (!password) {
      setError("Enter your password.");
      return;
    }

    setPasswordReset(false);
    setLoading(true);

    const { data, error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });

    if (authError) {
      setLoading(false);
      setError(
        authError.message === "Invalid login credentials"
          ? "The email or password is incorrect."
          : authError.message,
      );
      return;
    }

    // An unconfirmed account gets a fresh link instead of a dead end.
    if (!data.user?.email_confirmed_at) {
      await supabase.auth.signOut();
      const normalizedEmail = email.trim().toLowerCase();
      const { error: resendError } = await supabase.auth.resend({
        type: "signup",
        email: normalizedEmail,
      });
      setLoading(false);
      if (resendError) {
        setError(
          "Verify your email before signing in. Use the verification email we sent you, or try again shortly.",
        );
        return;
      }
      router.replace(`/verify-email?email=${encodeURIComponent(normalizedEmail)}`);
      return;
    }

    const profile = await refreshProfile(data.session);
    setLoading(false);

    if (!profile.onboardingCompleted) {
      router.replace("/onboarding");
      return;
    }
    if (next) {
      router.replace(next);
      return;
    }
    router.replace(profile.role === "professional" ? "/studio" : "/home");
  };

  return (
    <AuthLayout
      eyebrow="Welcome back"
      title="Pick up where you left off."
      subtitle="Sign in to reach your saved looks, bookings and conversations."
      footer={<AuthFooterPrompt prompt="New to Sheree?" actionLabel="Create an account" href="/sign-up" />}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Input
          label="Email address"
          placeholder="you@example.com"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <div className="flex flex-col gap-2">
          <PasswordInput
            label="Password"
            placeholder="Your password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <Link
            href="/forgot-password"
            className="self-end text-caption font-medium text-primary underline-offset-4 hover:underline"
          >
            Forgot password?
          </Link>
        </div>
        {error ? <FormError message={error} /> : null}
        <Button type="submit" loading={loading} className="mt-1">
          Sign in
        </Button>
      </form>
    </AuthLayout>
  );
}
