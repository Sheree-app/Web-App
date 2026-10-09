"use client";

import { Sheet, Switch } from "@/components/ui";
import { deleteAccount, fetchWantsProfessionalAccount, setWantsProfessionalAccount } from "@/features/account/api";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/providers/auth-provider";
import { useTheme, type AppearancePreference } from "@/providers/theme-provider";
import { useToast } from "@/providers/toast-provider";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  Briefcase,
  ChevronRight,
  Contrast,
  FileText,
  HelpCircle,
  Info,
  Key,
  Lock,
  Moon,
  Bell,
  ShieldCheck,
  Smartphone,
  Sun,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const APPEARANCES: Array<{
  value: AppearancePreference;
  label: string;
  icon: React.ReactNode;
}> = [
  { value: "system", label: "Device", icon: <Smartphone aria-hidden className="size-[18px]" /> },
  { value: "light", label: "Light", icon: <Sun aria-hidden className="size-[18px]" /> },
  { value: "dark", label: "Dark", icon: <Moon aria-hidden className="size-[18px]" /> },
];

/**
 * Settings, rebuilt from the original screen: the same sections in the same
 * order — appearance, alerts, professional account, privacy, help, legal, and
 * the delete flow with its typed confirmation.
 */
export default function SettingsPage() {
  const router = useRouter();
  const { preference, setPreference } = useTheme();
  const { user, role, refreshProfile, signOut } = useAuth();
  const { error: showError } = useToast();

  const [wantsProfessional, setWantsProfessional] = useState(false);
  const [professionalSaving, setProfessionalSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!user) return;
    let active = true;
    void fetchWantsProfessionalAccount(user.id)
      .then((value) => {
        if (active) setWantsProfessional(value);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [user]);

  const toggleProfessional = async (value: boolean) => {
    if (!user) return;
    setProfessionalSaving(true);
    try {
      await setWantsProfessionalAccount(value);
      setWantsProfessional(value);
      await refreshProfile();
    } catch (cause) {
      showError("Preference not saved", cause instanceof Error ? cause.message : "Try again.");
    } finally {
      setProfessionalSaving(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await deleteAccount();
      await signOut();
      router.replace("/");
    } catch (cause) {
      setDeleting(false);
      showError("Account not deleted", cause instanceof Error ? cause.message : "Try again.");
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
          <p className="text-eyebrow text-primary uppercase">Your app</p>
          <h1 className="text-[27px] leading-[35px] font-bold text-ink">Settings</h1>
        </div>
      </div>

      <p className="my-6 text-body text-muted">
        Make Sheree feel right for you, and keep your account protected.
      </p>

      <Section title="Appearance">
        <div className="rounded-card bg-surface p-4">
          <div className="flex items-start gap-3">
            <Contrast aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
            <div>
              <p className="text-body font-medium text-ink">App appearance</p>
              <p className="text-caption text-muted">Choose a look or follow your device</p>
            </div>
          </div>
          <div role="radiogroup" className="mt-3 flex gap-2">
            {APPEARANCES.map((item) => {
              const active = preference === item.value;
              return (
                <button
                  key={item.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setPreference(item.value)}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-2 rounded-field py-3 text-caption font-bold",
                    active ? "bg-primary text-surface" : "bg-tint text-muted",
                  )}
                >
                  <span className={active ? "text-surface" : "text-muted"}>{item.icon}</span>
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>
      </Section>

      <Section title="Alerts">
        <Row
          icon={<Bell aria-hidden className="size-5 text-primary" />}
          title="Notifications"
          detail="Inbox, alert types and quiet hours"
          onPress={() => router.push("/notification-settings")}
        />
      </Section>

      {role === "customer" ? (
        <Section title="Professional account">
          <div className="flex min-h-[72px] items-center gap-3 rounded-panel bg-surface px-4">
            <span className="flex size-[38px] shrink-0 items-center justify-center rounded-[14px] bg-tint">
              <Briefcase aria-hidden className="size-5 text-primary" />
            </span>
            <p className="flex-1 text-caption text-muted">
              Unlocks the professional experience from your profile
            </p>
            <Switch
              label="Professional account"
              checked={wantsProfessional}
              disabled={professionalSaving}
              onChange={(value) => void toggleProfessional(value)}
            />
          </div>
        </Section>
      ) : null}

      <Section title="Privacy & security">
        <Row
          icon={<Key aria-hidden className="size-5 text-primary" />}
          title="Password"
          detail="Change or reset your password"
          onPress={() => router.push("/reset-password")}
        />
        <Row
          icon={<ShieldCheck aria-hidden className="size-5 text-primary" />}
          title="Privacy"
          detail="Manage your account protection"
          onPress={() =>
            window.alert(
              "Your privacy\n\nYour profile and booking data are protected by account-level access controls. More privacy controls will appear here as they become available.",
            )
          }
        />
      </Section>

      <Section title="Help & information">
        <Row
          icon={<HelpCircle aria-hidden className="size-5 text-primary" />}
          title="Help and support"
          detail="FAQs and contact"
          onPress={() => router.push("/help-support")}
        />
        <Row
          icon={<Info aria-hidden className="size-5 text-primary" />}
          title="About Sheree"
          detail="Version 1.0.0 · built with care in Accra"
          onPress={() =>
            window.alert("Sheree\n\nA simpler way to discover and book trusted beauty professionals.")
          }
        />
      </Section>

      <Section title="Legal">
        <Row
          icon={<FileText aria-hidden className="size-5 text-primary" />}
          title="Terms of Service"
          detail="The rules for using Sheree"
          onPress={() => void openExternal("https://sheree.world/terms", "Terms of Service")}
        />
        <Row
          icon={<Lock aria-hidden className="size-5 text-primary" />}
          title="Privacy Policy"
          detail="How we collect and protect your data"
          onPress={() => void openExternal("https://sheree.world/privacy", "Privacy Policy")}
        />
      </Section>

      <Section title="Danger zone">
        <button
          type="button"
          onClick={() => setDeleteOpen(true)}
          className="flex min-h-[72px] w-full items-center gap-3 rounded-panel bg-surface px-4 text-left"
        >
          <span className="flex size-[38px] shrink-0 items-center justify-center rounded-[14px] bg-danger-surface">
            <Trash2 aria-hidden className="size-5 text-danger" />
          </span>
          <span className="flex-1">
            <span className="block text-body font-medium text-danger">Delete account</span>
            <span className="block text-caption text-muted">
              Permanently remove your Sheree account
            </span>
          </span>
          <ChevronRight aria-hidden className="size-[18px] text-danger" />
        </button>
      </Section>

      <Sheet
        open={deleteOpen}
        onClose={() => {
          if (!deleting) {
            setDeleteOpen(false);
            setConfirmation("");
          }
        }}
        title="Delete your account?"
        footer={
          <div className="flex gap-3">
            <button
              type="button"
              disabled={deleting}
              onClick={() => {
                setDeleteOpen(false);
                setConfirmation("");
              }}
              className="min-h-[54px] flex-1 rounded-panel bg-surface text-body font-medium text-ink"
            >
              Keep account
            </button>
            <button
              type="button"
              disabled={deleting || confirmation.trim() !== "DELETE"}
              onClick={() => void remove()}
              className={cn(
                "min-h-[54px] flex-1 rounded-panel bg-danger text-body font-medium text-surface",
                (deleting || confirmation.trim() !== "DELETE") && "opacity-50",
              )}
            >
              Delete forever
            </button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <span className="flex size-12 items-center justify-center rounded-full bg-danger-surface">
            <Trash2 aria-hidden className="size-6 text-danger" />
          </span>
          <p className="text-body text-muted">
            Your profile, posts and personal details will be removed. Booking and payment records
            may be retained without your personal information. This cannot be undone.
          </p>
          <label className="flex flex-col gap-2">
            <span className="text-caption font-bold text-ink">Type DELETE to confirm</span>
            <input
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value.toUpperCase())}
              placeholder="DELETE"
              className="h-14 rounded-panel bg-surface px-4 text-body text-ink outline-none"
            />
          </label>
        </div>
      </Sheet>
    </div>
  );
}

async function openExternal(url: string, label: string) {
  try {
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (!opened) throw new Error("popup blocked");
  } catch {
    window.alert(`Couldn’t open ${label}\n\nTry again from your browser.`);
  }
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-4 flex flex-col gap-1">
      <p className="ml-1 mb-1 text-eyebrow text-muted uppercase">{title}</p>
      {children}
    </section>
  );
}

function Row({
  icon,
  title,
  detail,
  onPress,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      className="flex min-h-[72px] w-full items-center gap-3 rounded-panel bg-surface px-4 text-left transition active:scale-[.99] active:opacity-65"
    >
      <span className="flex size-[38px] shrink-0 items-center justify-center rounded-[14px] bg-tint">
        {icon}
      </span>
      <span className="flex-1">
        <span className="block text-body font-medium text-ink">{title}</span>
        <span className="block text-caption text-muted">{detail}</span>
      </span>
      <ChevronRight aria-hidden className="size-[18px] shrink-0 text-muted" />
    </button>
  );
}

void supabase;
