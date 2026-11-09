"use client";

import { AuthFooterPrompt, AuthLayout } from "@/components/shell/auth-layout";
import { Button, FormError, Input, PasswordInput } from "@/components/ui";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/providers/auth-provider";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

/**
 * Where to go after signing in. Only same-site paths are honoured, so a crafted
 * `?next=https://…` or `?next=//evil.example` link can't bounce someone off-site,
 * and the auth screens themselves are skipped (the proxy would only send a
 * signed-in visitor on to /home anyway).
 */
function safeNext(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  const path = value.split(/[?#]/)[0];
  if (["/sign-in", "/sign-up", "/forgot-password"].includes(path)) return null;
  return value;
}

/** Resolves to `fallback` if `promise` hasn't settled within `ms`. */
function within<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      () => {
        window.clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

export default function SignInPage() {
  const { refreshProfile, setPasswordReset } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNext(searchParams.get("next"));

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

    let data: Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>["data"];
    let authError: Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>["error"];
    try {
      ({ data, error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      }));
    } catch {
      // A dropped connection can throw instead of returning an error.
      setLoading(false);
      setError("We couldn’t reach Sheree. Check your connection and try again.");
      return;
    }

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

    // The profile only picks the destination. A slow or failed lookup must not
    // keep anyone on this screen: after a few seconds go on to /home, where the
    // app's own guards finish the job (onboarding, studio) once it loads.
    const profile = await within(refreshProfile(data.session), 6000, null);

    const destination = !profile
      ? (next ?? "/home")
      : !profile.onboardingCompleted
        ? "/onboarding"
        : (next ?? (profile.role === "professional" ? "/studio" : "/home"));

    // A full page load, not a client-side route change. While signed out, the
    // router prefetched links like Bookings and Messages and cached the proxy's
    // answer to them: "go to /sign-in". A soft navigation could replay that
    // cached redirect and land back here even though the sign-in worked. A real
    // load drops that cache and sends the new session cookie to the server.
    // The button keeps spinning until the next page replaces this one.
    window.location.replace(destination);
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
