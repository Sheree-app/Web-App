"use client";
import { StartConversation } from "@/features/messaging/StartConversation";

import { Avatar, CardSkeleton, Skeleton, Spinner } from "@/components/ui";
import { fetchCreatorProfile, type CreatorProfile } from "@/features/profile/api";
import { SocialIcon, type SocialIconName } from "@/features/profile/SocialIcon";
import { SOCIAL_PLATFORMS, normalizeSocialLink, type SocialPlatform } from "@/features/profile/socials";
import { useToast } from "@/providers/toast-provider";
import { ProfessionalName } from "@/features/badges/ProfessionalName";
import { ArrowLeft, CalendarDays, ChevronLeft, ChevronRight, MapPin, Share2, X } from "lucide-react";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

const stars = (rating: number) => "★".repeat(Math.round(rating)) + "☆".repeat(Math.max(0, 5 - Math.round(rating)));

type Tab = "work" | "studio" | "reviews";

/**
 * The public profile, rebuilt from `ProfileScreen`: identity block, the Book
 * action, the social row, About, then Work / Studio / Reviews with their own
 * empty states — and the studio photo viewer.
 */
export default function ProfessionalPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const profileId = params.id;

  const [profile, setProfile] = useState<CreatorProfile | null>(null);
  const [tab, setTab] = useState<Tab>("work");
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setProfile(await fetchCreatorProfile(profileId));
    } catch {
      // A missing row and a network failure look the same to the reader, and
      // the "Profile unavailable" state covers both.
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, [profileId]);

  useEffect(() => {
    void load();
  }, [load]);

  const share = async () => {
    if (!profile) return;
    const url = typeof window === "undefined" ? "" : window.location.href;
    if (typeof navigator !== "undefined" && navigator.share) {
      await navigator
        .share({
          title: `Meet ${profile.businessName}`,
          text: `${profile.category} · ${profile.location}`,
          url,
        })
        .catch(() => undefined);
      return;
    }
    await navigator.clipboard?.writeText(url).catch(() => undefined);
    toast("Link copied", { detail: "Paste it wherever you’re sharing." });
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-4 px-4 pt-4">
        <Skeleton className="size-[104px] rounded-full" />
        <Skeleton className="h-7 w-[52%] rounded-field" />
        <Skeleton className="h-3 w-[38%] rounded-tile" />
        <CardSkeleton lines={2} />
        <CardSkeleton lines={2} />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-2 px-6 text-center">
        <span aria-hidden className="text-[30px] text-primary">
          ⚠
        </span>
        <p className="text-title text-ink">Profile unavailable</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-2 rounded-full bg-primary px-6 py-2.5 text-caption font-bold text-surface"
        >
          Try again
        </button>
      </div>
    );
  }

  const socials = SOCIAL_PLATFORMS.filter((platform) => profile.socials[platform.key]);

  return (
    <div className="flex flex-col px-4 pb-12 pt-2">
      {/* Identity, actions and tabs stay in a readable column; the work grid
          below is allowed to use the full content width. */}
      <div className="mx-auto w-full max-w-[720px]">
      <div className="flex items-center justify-between">
        <button
          type="button"
          aria-label="Go back"
          onClick={() => router.back()}
          className="flex size-11 items-center justify-center rounded-full bg-surface text-ink"
        >
          <ArrowLeft aria-hidden className="size-5" />
        </button>
        <button
          type="button"
          aria-label="Share profile"
          onClick={() => void share()}
          className="flex size-11 items-center justify-center rounded-full bg-surface text-ink"
        >
          <Share2 aria-hidden className="size-5" />
        </button>
      </div>

      <section className="mt-4 flex flex-col items-center gap-1">
        <Avatar name={profile.name} src={profile.avatar} size={104} />
        <span className="mt-2 flex items-center gap-1.5">
          <ProfessionalName
            name={profile.name}
            professionalId={profile.id}
            verified={profile.verified}
            founding={profile.founding}
            official={profile.official}
            foundingLabel
            size={19}
            nameAs="h1"
            nameClassName="text-section text-ink"
          />
        </span>
        <p className="text-body font-bold text-ink">{profile.category}</p>
        <a
          href={`https://maps.google.com/?q=${encodeURIComponent(profile.location)}`}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-1 flex max-w-[92%] items-center gap-1 text-body text-ink underline"
        >
          <MapPin aria-hidden className="size-3.5 shrink-0 text-primary" />
          <span className="truncate">{profile.location}</span>
        </a>
        {profile.reviewCount > 0 ? (
          <p className="mt-1 text-caption text-ink">
            ★ {profile.rating.toFixed(1)}{" "}
            <span className="text-muted">({profile.reviewCount} reviews)</span>
          </p>
        ) : null}
      </section>

      <div className="mt-4 flex items-stretch gap-2">
        <button
          type="button"
          onClick={() => router.push(`/services/${profile.id}`)}
          className="flex min-h-[54px] flex-1 items-center justify-center gap-2 rounded-panel bg-primary text-body font-medium text-surface transition active:scale-[.99]"
        >
          <CalendarDays aria-hidden className="size-[18px]" />
          Book
        </button>

        <StartConversation professionalId={profile.id} className="flex-1" />
      </div>

      {socials.length > 0 || profile.socials.whatsapp || profile.socials.telephone ? (
        <div className="mt-4 flex flex-wrap justify-center gap-4">
          {socials.map((platform) => (
            <SocialLink
              key={platform.key}
              platform={platform.key}
              label={platform.label}
              url={safeHref(platform.key, profile.socials[platform.key] as string)}
            />
          ))}
          {profile.socials.whatsapp ? (
            <SocialLink
              platform="whatsapp"
              label="WhatsApp"
              url={`https://wa.me/${profile.socials.whatsapp.replace(/\D/g, "")}`}
            />
          ) : null}
          {profile.socials.telephone ? (
            <SocialLink platform="telephone" label="Call" url={`tel:${profile.socials.telephone}`} />
          ) : null}
        </div>
      ) : null}

      {profile.bio ? (
        <section className="mt-6 flex flex-col gap-2">
          <h2 className="text-section text-ink">About</h2>
          <p className="text-body text-ink">{profile.bio}</p>
        </section>
      ) : null}

      <div role="tablist" className="mt-6 flex gap-2">
        {(
          [
            ["work", "Work", profile.portfolio.length],
            ["studio", "Studio", profile.studio.length],
            ["reviews", "Reviews", profile.reviewCount],
          ] as const
        ).map(([value, label, count]) => {
          const active = tab === value;
          return (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(value)}
              className={
                active
                  ? "flex h-10 items-center gap-2 rounded-full bg-ink px-4 text-caption font-bold text-surface"
                  : "flex h-10 items-center gap-2 rounded-full bg-surface px-4 text-caption font-bold text-muted"
              }
            >
              {label}
              <span className={active ? "text-[11px] text-surface/70" : "text-[11px] text-muted"}>
                {count}
              </span>
            </button>
          );
        })}
      </div>
      </div>

      <div className="mt-4">
        {tab === "work" ? (
          profile.portfolio.length > 0 ? (
            /* The Discover rhythm: rounded pins in staggered columns, with the
               caption kept under each image instead of hidden in a tooltip. */
            <div className="-mx-1 columns-2 gap-3 md:mx-0 md:columns-3 md:gap-5 lg:columns-4">
              {profile.portfolio.map((item, index) => {
                // Honest to the source image, within the feed's bounds.
                const ratio = Math.min(1.05, Math.max(0.62, item.aspectRatio || 0.82));
                return (
                  <figure key={item.id} className="mb-4 break-inside-avoid">
                    <div
                      className="relative overflow-hidden rounded-panel bg-secondary"
                      style={{ aspectRatio: `${ratio}` }}
                    >
                      <Image
                        src={item.image}
                        alt={item.caption || `Work ${index + 1} by ${profile.name}`}
                        fill
                        sizes="(min-width: 1024px) 24vw, (min-width: 768px) 32vw, 48vw"
                        className="object-cover"
                      />
                    </div>
                    {item.caption ? (
                      <figcaption className="mt-2.5 line-clamp-2 px-1 text-[11px] leading-[15px] text-ink">
                        {item.caption}
                      </figcaption>
                    ) : null}
                  </figure>
                );
              })}
            </div>
          ) : (
            <Empty glyph="🖼" title="No work posted yet" />
          )
        ) : tab === "studio" ? (
          profile.studio.length > 0 ? (
            <div className="mx-auto grid w-full max-w-[720px] grid-cols-2 gap-3 lg:grid-cols-3">
              {profile.studio.map((photo, index) => (
                <button
                  key={photo.id}
                  type="button"
                  aria-label={`Open studio photo ${index + 1} of ${profile.studio.length}`}
                  onClick={() => setViewerIndex(index)}
                  className="relative aspect-square overflow-hidden rounded-panel bg-secondary transition active:opacity-80"
                >
                  <Image src={photo.image} alt="" fill sizes="50vw" className="object-cover" />
                </button>
              ))}
            </div>
          ) : (
            <Empty glyph="🏬" title="No studio photos yet" />
          )
        ) : profile.reviews.length > 0 ? (
          <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4">
            <div className="flex items-center gap-4 rounded-card bg-surface p-4">
              <div>
                <p className="text-page text-ink">{profile.rating.toFixed(1)}</p>
                <p className="text-caption text-[#A76A20]">{stars(profile.rating)}</p>
              </div>
              <div>
                <p className="text-body font-medium text-ink">Client rated</p>
                <p className="text-caption text-muted">
                  From completed appointments on Sheree
                </p>
              </div>
            </div>

            <ul className="flex flex-col gap-3">
              {profile.reviews.map((review) => (
                <li key={review.id} className="flex flex-col gap-2 rounded-card bg-surface p-4">
                  <div className="flex items-center gap-3">
                    <Avatar name={review.author} src={review.avatar} size={40} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body font-medium text-ink">{review.author}</p>
                      <p className="truncate text-[11px] text-muted">{review.service}</p>
                    </div>
                    <p className="text-caption text-[#A76A20]">{stars(review.rating)}</p>
                  </div>
                  <p className="text-body text-ink">{review.body}</p>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-[720px] items-center gap-3 rounded-card bg-surface p-4">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-tint text-[23px] text-primary">
              ★
            </span>
            <div>
              <p className="text-body font-medium text-ink">Reviews will appear here</p>
              <p className="text-caption text-muted">
                Only clients with a completed appointment can leave one.
              </p>
            </div>
          </div>
        )}
      </div>

      {viewerIndex !== null ? (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/95">
          <div className="flex items-center justify-between px-4 pt-safe">
            <p className="text-caption text-white">
              {viewerIndex + 1} of {profile.studio.length}
            </p>
            <button
              type="button"
              aria-label="Close image viewer"
              onClick={() => setViewerIndex(null)}
              className="flex size-11 items-center justify-center text-white"
            >
              <X aria-hidden className="size-6" />
            </button>
          </div>

          <div className="relative flex-1">
            {profile.studio[viewerIndex] ? (
              <Image
                src={profile.studio[viewerIndex].image}
                alt=""
                fill
                sizes="100vw"
                className="object-contain"
              />
            ) : null}
          </div>

          <div className="flex items-center justify-between px-4 pb-8">
            <button
              type="button"
              aria-label="Previous photo"
              disabled={viewerIndex === 0}
              onClick={() => setViewerIndex((index) => Math.max(0, (index ?? 0) - 1))}
              className="flex size-12 items-center justify-center rounded-full bg-white/10 text-white disabled:opacity-30"
            >
              <ChevronLeft aria-hidden className="size-6" />
            </button>
            <button
              type="button"
              aria-label="Next photo"
              disabled={viewerIndex >= profile.studio.length - 1}
              onClick={() =>
                setViewerIndex((index) => Math.min(profile.studio.length - 1, (index ?? 0) + 1))
              }
              className="flex size-12 items-center justify-center rounded-full bg-white/10 text-white disabled:opacity-30"
            >
              <ChevronRight aria-hidden className="size-6" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function safeHref(platform: SocialPlatform, value: string) {
  try {
    return normalizeSocialLink(platform, value) ?? "#";
  } catch {
    return "#";
  }
}

function SocialLink({
  platform,
  label,
  url,
}: {
  platform: SocialIconName;
  label: string;
  url: string;
}) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      className="flex flex-col items-center gap-1"
      aria-label={label}
    >
      <span className="flex size-11 items-center justify-center rounded-full bg-surface text-ink">
        <SocialIcon platform={platform} className="size-[21px]" />
      </span>
      <span className="text-[11px] text-muted">{label}</span>
    </a>
  );
}

function Empty({ glyph, title }: { glyph: string; title: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-card bg-surface p-8">
      <span aria-hidden className="text-[26px] text-primary">
        {glyph}
      </span>
      <p className="text-body font-medium text-ink">{title}</p>
    </div>
  );
}

void Spinner;
