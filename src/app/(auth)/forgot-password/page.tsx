"use client";

import { AuthLayout } from "@/components/shell/auth-layout";
import { Button, FormError, Input } from "@/components/ui";
import { supabase } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    setError("");

    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      setError("Enter the email address linked to your account.");
      return;
    }

    setLoading(true);
    const { error: authError } = await supabase.auth.resetPasswordForEmail(normalizedEmail);
    setLoading(false);

    if (authError) {
      setError(authError.message);
      return;
    }

    router.push(`/reset-password?email=${encodeURIComponent(normalizedEmail)}`);
  };

  return (
    <AuthLayout
      eyebrow="Password reset"
      title="Let’s get you back in."
      subtitle="Enter your account email and we’ll send you a six-digit reset code."
      backTo="/sign-in"
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
        {error ? <FormError message={error} /> : null}
        <Button type="submit" loading={loading}>
          Send reset code
        </Button>
      </form>
    </AuthLayout>
  );
}
