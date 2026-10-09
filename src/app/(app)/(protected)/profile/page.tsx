"use client";

import { Avatar, Sheet, Skeleton, Spinner } from "@/components/ui";
import { ModeSwitchCard } from "@/features/account/ModeSwitchCard";
import {
  fetchAccountProfile,
  fetchOwnProfessionalId,
  saveProfessionalSocialLinks,
  uploadAccountAvatar,
  type AccountProfile,
} from "@/features/account/api";
import { EMPTY_SOCIAL_LINKS, SOCIAL_PLATFORMS, socialUsername, type SocialPlatform } from "@/features/profile/socials";
import { mediaAssetFromFile } from "@/lib/media";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/auth-provider";
import { useToast } from "@/providers/toast-provider";
import {
  Bookmark,
  Bug,
  Calendar,
  Camera,
  ChevronRight,
  Eye,
  Images,
  LogOut,
  MapPin,
  Pencil,
  PersonStanding,
  Settings as SettingsIcon,
  Share2,
  Star,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Row = {
  icon: React.ReactNode;
  title: string;
  detail: string;
  onPress: () => void;
};

/**
 * The profile tab, rebuilt from `AccountProfileScreen`: the same header, the
 * mode switch, the hero, then the same labelled sections — with the rows the
 * app shows for each role, and nothing else.
 */
export default function ProfilePage() {
  const router = useRouter();
  const { success, error: showError } = useToast();
  const { user, role, refreshProfile } = useAuth();

  const [account, setAccount] = useState<AccountProfile | null>(null);
  const [professionalId, setProfessionalId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [socialsOpen, setSocialsOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [savingSocials, setSavingSocials] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const accountRole = role === "professional" ? "professional" : "customer";

  useEffect(() => {
    if (!user) return;
    let active = true;

    Promise.all([
      fetchAccountProfile(user.id, accountRole, user.email ?? ""),
      accountRole === "professional"
        ? fetchOwnProfessionalId(user.id).catch(() => null)
        : Promise.resolve(null),
    ])
      .then(([nextAccount, nextProfessionalId]) => {
        if (!active) return;
        setAccount(nextAccount);
        setProfessionalId(nextProfessionalId);
        setDraft(
          Object.fromEntries(
            Object.entries(nextAccount.socials).map(([key, value]) => [
              key,
              socialUsername(value as string | null),
            ]),
          ),
        );
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [accountRole, user]);

  const pickAvatar = async (file: File) => {
    if (!user) return;
    setUploading(true);
    try {
      const asset = await mediaAssetFromFile(file);
      const url = await uploadAccountAvatar(user.id, accountRole, asset);
      setAccount((current) => (current ? { ...current, avatar: url ?? current.avatar } : current));
      await refreshProfile();
    } catch (cause) {
      showError(
        "That photo couldn’t be uploaded",
        cause instanceof Error ? cause.message : "Try a different image.",
      );
    } finally {
      setUploading(false);
    }
  };

  const saveSocials = async () => {
    if (!user) return;
    setSavingSocials(true);
    try {
      const socials = await saveProfessionalSocialLinks(
        user.id,
        draft as Record<SocialPlatform, string>,
      );
      setAccount((current) => (current ? { ...current, socials } : current));
      setSocialsOpen(false);
      success("Social links saved");
    } catch (cause) {
      showError(
        "Social links not saved",
        cause instanceof Error ? cause.message : "Check your links and try again.",
      );
    } finally {
      setSavingSocials(false);
    }
  };

  const { signOut: endSession } = useAuth();

  const rows: { label: string; items: Row[] }[] =
    accountRole === "professional"
      ? [
          {
            label: "Business profile",
            items: [
              {
                icon: <Share2 aria-hidden className="size-5 text-primary" />,
                title: "Social links",
                detail: "Send clients straight to your profiles",
                onPress: () => setSocialsOpen(true),
              },
              {
                icon: <Eye aria-hidden className="size-5 text-primary" />,
                title: "View public profile",
                detail: "See what customers see",
                onPress: () => professionalId && router.push(`/professional/${professionalId}`),
              },
              {
                icon: <Images aria-hidden className="size-5 text-primary" />,
                title: "Work and studio photos",
                detail: "Manage what clients see on your profile",
                onPress: () => router.push("/studio/portfolio"),
              },
              {
                icon: <MapPin aria-hidden className="size-5 text-primary" />,
                title: "Location and travel",
                detail: "Map pin, address and travel charge",
                onPress: () => router.push("/location"),
              },
            ],
          },
          {
            label: "Bookings & money",
            items: [
              {
                icon: <Wallet aria-hidden className="size-5 text-primary" />,
                title: "Payout account",
                detail: "Deposits and payout details",
                onPress: () => router.push("/studio/payouts/account"),
              },
              {
                icon: <Calendar aria-hidden className="size-5 text-primary" />,
                title: "Calendar & availability",
                detail: "Working hours, breaks and booking rules",
                onPress: () => router.push("/studio/calendar"),
              },
            ],
          },
          {
            label: "Payouts",
            items: [
              {
                icon: <TrendingUp aria-hidden className="size-5 text-primary" />,
                title: "Payouts & earnings",
                detail: "Money expected, received and needing attention",
                onPress: () => router.push("/studio/payouts"),
              },
            ],
          },
        ]
      : [
          {
            label: "Profile & preferences",
            items: [
              {
                icon: <Bookmark aria-hidden className="size-5 text-primary" />,
                title: "Saved looks",
                detail: "Professionals and work you love",
                onPress: () => router.push("/bookmarks"),
              },
              {
                icon: <Star aria-hidden className="size-5 text-primary" />,
                title: "My reviews",
                detail: "The experiences you’ve shared",
                onPress: () => router.push("/reviews"),
              },
            ],
          },
        ];

  return (
    <div className="flex flex-col px-4 pb-12 pt-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-eyebrow text-primary uppercase">
            {accountRole === "professional" ? "Your business" : "Your Sheree"}
          </p>
          <h1 className="text-page text-ink">Profile</h1>
        </div>
        <button
          type="button"
          aria-label="Edit profile"
          onClick={() => router.push("/personal-details")}
          className="flex size-11 items-center justify-center rounded-full bg-surface text-ink"
        >
          <Pencil aria-hidden className="size-5" />
        </button>
      </div>

      <section className="mt-6 flex flex-col gap-2">
        <p className="text-eyebrow text-muted uppercase">Switch experience</p>
        <ModeSwitchCard />
      </section>

      <section className="mt-6 flex flex-col items-center gap-2">
        {loading || !account ? (
          <>
            <Skeleton className="size-[106px] rounded-full" />
            <Skeleton className="h-6 w-[44%] rounded-field" />
            <Skeleton className="h-3.5 w-[58%] rounded-tile" />
          </>
        ) : (
          <>
            <div className="relative">
              <Avatar name={account.name} src={account.avatar} size={106} />
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void pickAvatar(file);
                }}
              />
              <button
                type="button"
                aria-label="Change profile picture"
                disabled={uploading}
                onClick={() => fileInput.current?.click()}
                className="absolute right-0 bottom-0 flex size-9 items-center justify-center rounded-full bg-primary text-surface"
              >
                {uploading ? (
                  <Spinner className="[&_svg]:size-4" label="Uploading" />
                ) : (
                  <Camera aria-hidden className="size-[18px]" />
                )}
              </button>
            </div>
            <p className="text-section text-ink">
              {accountRole === "professional" && account.business ? account.business : account.name}
            </p>
            <p className="text-caption text-muted">{account.email}</p>
            {accountRole === "professional" ? (
              <p className="text-caption text-muted">{account.name}</p>
            ) : null}
            <button
              type="button"
              onClick={() => router.push("/personal-details")}
              className="text-caption font-medium text-primary underline-offset-4 hover:underline"
            >
              Edit profile
            </button>
          </>
        )}
      </section>

      {rows.map((section) => (
        <section key={section.label} className="mt-8 flex flex-col gap-1">
          <p className="text-eyebrow text-muted uppercase">{section.label}</p>
          {section.items.map((item) => (
            <button
              key={item.title}
              type="button"
              onClick={item.onPress}
              className="flex items-center gap-3 rounded-panel p-2 text-left transition active:scale-[.99] active:opacity-65"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-tint">
                {item.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-body font-medium text-ink">{item.title}</span>
                <span className="block truncate text-caption text-muted">{item.detail}</span>
              </span>
              <ChevronRight aria-hidden className="size-5 shrink-0 text-muted" />
            </button>
          ))}
        </section>
      ))}

      <section className="mt-8 flex flex-col gap-1">
        <p className="text-eyebrow text-muted uppercase">Settings & support</p>
        {[
          {
            icon: <PersonStanding aria-hidden className="size-5 text-primary" />,
            title: "Personal details",
            detail: account?.phone || "Name, email and phone",
            onPress: () => router.push("/personal-details"),
          },
          {
            icon: <SettingsIcon aria-hidden className="size-5 text-primary" />,
            title: "Settings",
            detail: "Appearance, notifications, privacy and support",
            onPress: () => router.push("/settings"),
          },
          {
            icon: <Bug aria-hidden className="size-5 text-primary" />,
            title: "Report a problem",
            detail: "Tell us what went wrong",
            onPress: () => router.push("/report-problem"),
          },
        ].map((item) => (
          <button
            key={item.title}
            type="button"
            onClick={item.onPress}
            className="flex items-center gap-3 rounded-panel p-2 text-left transition active:scale-[.99] active:opacity-65"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-tint">
              {item.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-body font-medium text-ink">{item.title}</span>
              <span className="block truncate text-caption text-muted">{item.detail}</span>
            </span>
            <ChevronRight aria-hidden className="size-5 shrink-0 text-muted" />
          </button>
        ))}
      </section>

      <button
        type="button"
        disabled={signingOut}
        onClick={async () => {
          setSigningOut(true);
          await endSession();
          router.replace("/");
        }}
        className="mt-8 flex items-center justify-center gap-2 rounded-panel py-4 text-body font-medium text-danger"
      >
        <LogOut aria-hidden className="size-5" />
        Sign out
      </button>

      <p className="mt-4 text-center text-[11px] text-muted">
        Sheree · built with care in Accra
      </p>

      <Sheet
        open={socialsOpen}
        onClose={() => setSocialsOpen(false)}
        title="Social links"
        description="Send clients straight to your profiles"
        footer={
          <button
            type="button"
            onClick={() => void saveSocials()}
            disabled={savingSocials}
            className={cn(
              "min-h-[54px] w-full rounded-panel bg-primary text-body font-medium text-surface",
              savingSocials && "opacity-60",
            )}
          >
            Save socials
          </button>
        }
      >
        <div className="flex flex-col gap-4">
          {SOCIAL_PLATFORMS.map((platform) => (
            <label key={platform.key} className="flex flex-col gap-2">
              <span className="text-caption text-muted">{platform.label}</span>
              <input
                value={draft[platform.key] ?? (EMPTY_SOCIAL_LINKS[platform.key] ?? "")}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, [platform.key]: event.target.value }))
                }
                placeholder={`@your${platform.key}`}
                className="min-h-[54px] rounded-panel bg-surface px-4 text-body text-ink outline-none"
              />
            </label>
          ))}
        </div>
      </Sheet>
    </div>
  );
}
