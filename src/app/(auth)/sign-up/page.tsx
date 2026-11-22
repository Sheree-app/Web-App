"use client";

import { AuthFooterPrompt, AuthLayout } from "@/components/shell/auth-layout";
import { Button, FormError, Input, PasswordInput } from "@/components/ui";
import { isVerificationPending, signUp } from "@/features/auth/api";
import { mapAuthError } from "@/features/auth/auth-errors";
import { holdVerification } from "@/features/auth/pending-verification";
import { useAuth } from "@/providers/auth-provider";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function SignUpPage() {
  const router = useRouter();
  const { startSession } = useAuth();
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
    let result: Awaited<ReturnType<typeof signUp>>;
    try {
      result = await signUp(normalizedEmail, password, name.trim());
    } catch (signUpError) {
      setLoading(false);
      setError(mapAuthError(signUpError, "sign-up").message);
      return;
    }

    if (!isVerificationPending(result)) {
      // Verification skipped by the identity provider: already signed in.
      await startSession(result, normalizedEmail);
      window.location.replace("/onboarding");
      return;
    }

    holdVerification(normalizedEmail, result.pending_authentication_token, password);
    setLoading(false);
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
          By creating an account, you agree to Sheree’s{" "}
          <Link href="/terms" className="font-bold text-primary underline-offset-2 hover:underline">
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="font-bold text-primary underline-offset-2 hover:underline">
            Privacy Policy
          </Link>
          .
        </p>
        {error ? <FormError message={error} /> : null}
        <Button type="submit" loading={loading}>
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
