"use client";

import { AuthFooterPrompt, AuthLayout } from "@/components/shell/auth-layout";
import { Button, FormError, Input, PasswordInput } from "@/components/ui";
import { supabase } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function SignUpPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");

    const normalizedEmail = email.trim().toLowerCase();
    if (name.trim().length < 2) {
      setError("Enter a username.");
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      setError("Enter a valid email address.");
      return;
    }
    if (password.length < 8) {
      setError("Use at least 8 characters for your password.");
      return;
    }

    setLoading(true);
    const { data, error: authError } = await supabase.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        // `requires_onboarding` is what routes the new account into the flow
        // after it confirms its email.
        data: { username: name.trim(), requires_onboarding: true },
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    setLoading(false);

    if (authError) {
      setError(authError.message);
      return;
    }

    if (data.session) {
      // Confirm-email is switched off in this project; signing in silently here
      // would skip verification, so surface the misconfiguration instead.
      await supabase.auth.signOut();
      setError(
        "Email verification is not enabled yet. Turn on Confirm email in Supabase, then try again.",
      );
      return;
    }

    router.push(`/verify-email?email=${encodeURIComponent(normalizedEmail)}`);
  };

  return (
    <AuthLayout
      eyebrow="Join Sheree"
      title="Make this space yours."
      subtitle="Create your account first. We’ll shape Sheree around what you want to do next."
      backTo="/"
      footer={<AuthFooterPrompt prompt="Already have an account?" actionLabel="Sign in" href="/sign-in" />}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Input
          label="Username"
          placeholder="Your username"
          autoCapitalize="none"
          autoCorrect="off"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
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
        <PasswordInput
          label="Password"
          placeholder="At least 8 characters"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <p className="text-caption text-muted">
          By creating an account, you agree to Sheree’s terms and privacy policy.
        </p>
        {error ? <FormError message={error} /> : null}
        <Button type="submit" loading={loading}>
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
