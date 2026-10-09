"use client";

import { supabase } from "@/lib/supabase/client";
import { updateAccountProfile } from "@/features/account/api";
import { useAuth } from "@/providers/auth-provider";
import { useToast } from "@/providers/toast-provider";
import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Personal details, matching the original screen: username and phone are
 * editable, email is shown read-only, and the save alert says exactly what the
 * app said when the name is too short.
 */
export default function PersonalDetailsPage() {
  const router = useRouter();
  const { user, refreshProfile } = useAuth();
  const { error: showError } = useToast();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    void supabase
      .from("users")
      .select("username,phone")
      .eq("id", user.id)
      .single()
      .then(({ data }) => {
        setName(data?.username ?? "");
        setPhone(data?.phone ?? "");
      });
  }, [user]);

  const save = async () => {
    if (!user) return;
    if (name.trim().length < 2) {
      showError("Add a username", "Enter at least two characters.");
      return;
    }
    setSaving(true);
    try {
      await updateAccountProfile(user.id, "customer", {
        username: name,
        phone,
        businessName: "",
        location: "",
      });
      await refreshProfile();
      router.back();
    } catch (cause) {
      showError("Details not saved", cause instanceof Error ? cause.message : "Try again.");
    } finally {
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
          <h1 className="text-[27px] leading-[35px] font-bold text-ink">Personal details</h1>
        </div>
      </div>

      <p className="my-6 text-body text-muted">
        Keep the details we use for bookings and account updates accurate.
      </p>

      <Field label="Username" value={name} onChange={(value) => setName(value)} />
      <Field label="Email" value={user?.email ?? ""} readOnly />
      <Field
        label="Phone number"
        value={phone}
        onChange={(value) => setPhone(value)}
        placeholder="e.g. +233 24 000 0000"
        inputMode="tel"
      />

      <button
        type="button"
        disabled={saving}
        onClick={() => void save()}
        className="mt-2 h-14 rounded-panel bg-primary text-body font-medium text-surface disabled:opacity-60"
      >
        {saving ? "Saving…" : "Save details"}
      </button>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  readOnly,
  inputMode,
}: {
  label: string;
  value: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  readOnly?: boolean;
  inputMode?: "tel" | "text";
}) {
  return (
    <label className="mb-4 flex flex-col gap-1.5">
      <span className="text-caption font-bold text-ink">{label}</span>
      <input
        value={value}
        readOnly={readOnly}
        inputMode={inputMode}
        placeholder={placeholder}
        onChange={(event) => onChange?.(event.target.value)}
        className={
          readOnly
            ? "h-14 rounded-panel bg-raised px-4 text-body text-muted outline-none"
            : "h-14 rounded-panel bg-surface px-4 text-body text-ink outline-none placeholder:text-muted"
        }
      />
    </label>
  );
}
