"use client";

import { ConfirmDialog } from "@/components/ui";
import { ModeSwitchCard } from "@/features/account/ModeSwitchCard";
import { useAuth } from "@/providers/auth-provider";
import {
  ArrowLeft,
  Bookmark,
  Bug,
  ChevronRight,
  LogOut,
  PersonStanding,
  Settings as SettingsIcon,
  Star,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Row = { icon: React.ReactNode; title: string; detail: string; href: string };

const SECTIONS: { label: string; rows: Row[] }[] = [
  {
    label: "Profile & preferences",
    rows: [
      {
        icon: <Bookmark aria-hidden className="size-5 text-primary" />,
        title: "Saved looks",
        detail: "Professionals and work you love",
        href: "/bookmarks",
      },
      {
        icon: <Users aria-hidden className="size-5 text-primary" />,
        title: "Your beauticians",
        detail: "Everyone you’ve booked on Sheree",
        href: "/beauticians",
      },
      {
        icon: <Star aria-hidden className="size-5 text-primary" />,
        title: "My reviews",
        detail: "The experiences you’ve shared",
        href: "/reviews",
      },
    ],
  },
  {
    label: "Settings & support",
    rows: [
      {
        icon: <PersonStanding aria-hidden className="size-5 text-primary" />,
        title: "Personal details",
        detail: "Name, email and phone",
        href: "/personal-details",
      },
      {
        icon: <SettingsIcon aria-hidden className="size-5 text-primary" />,
        title: "Settings",
        detail: "Appearance, notifications, privacy and support",
        href: "/settings",
      },
      {
        icon: <Bug aria-hidden className="size-5 text-primary" />,
        title: "Report a problem",
        detail: "Tell us what went wrong",
        href: "/report-problem",
      },
    ],
  },
];

/**
 * The customer's account menu, opened from the menu button on the Me page.
 * Account housekeeping lives here so the Me page stays free for the
 * customer's own beauty content.
 */
export default function MenuPage() {
  const router = useRouter();
  const { signOut } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  return (
    <div className="flex flex-col px-4 pb-12 pt-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label="Go back"
          onClick={() => router.back()}
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface text-ink"
        >
          <ArrowLeft aria-hidden className="size-5" />
        </button>
        <h1 className="text-page text-ink">Menu</h1>
      </div>

      <section className="mt-6 flex flex-col gap-2">
        <p className="text-eyebrow text-muted uppercase">Switch experience</p>
        <ModeSwitchCard />
      </section>

      {SECTIONS.map((section) => (
        <section key={section.label} className="mt-8 flex flex-col gap-1">
          <p className="text-eyebrow text-muted uppercase">{section.label}</p>
          {section.rows.map((row) => (
            <Link
              key={row.title}
              href={row.href}
              className="flex items-center gap-3 rounded-panel p-2 transition hover:bg-surface active:scale-[.99] active:opacity-65"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-tint">
                {row.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-body font-medium text-ink">{row.title}</span>
                <span className="block truncate text-caption text-muted">{row.detail}</span>
              </span>
              <ChevronRight aria-hidden className="size-5 shrink-0 text-muted" />
            </Link>
          ))}
        </section>
      ))}

      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="mt-8 flex items-center justify-center gap-2 rounded-panel py-4 text-body font-medium text-danger"
      >
        <LogOut aria-hidden className="size-5" />
        Sign out
      </button>
      <p className="mt-4 text-center text-[11px] text-muted">Sheree · built with care in Accra</p>

      <ConfirmDialog
        open={confirming}
        title="Sign out of Sheree?"
        message="You can sign back in anytime."
        confirmLabel="Sign out"
        cancelLabel="Stay signed in"
        destructive
        loading={signingOut}
        onClose={() => setConfirming(false)}
        onConfirm={async () => {
          // Always succeeds in this browser; ending the server login is best effort.
          setSigningOut(true);
          await signOut();
          window.location.replace("/");
        }}
      />
    </div>
  );
}
