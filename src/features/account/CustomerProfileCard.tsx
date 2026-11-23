"use client";

import { Avatar, Skeleton, Spinner } from "@/components/ui";
import { useLooksFirstPage } from "@/features/looks/queries";
import { mediaAssetFromFile } from "@/lib/media";
import { userMessage } from "@/lib/errors";
import { useAuth } from "@/providers/auth-provider";
import { useToast } from "@/providers/toast-provider";
import { Camera } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { uploadAccountAvatar } from "./api";
import { BeauticiansRow } from "./BeauticiansRow";
import { useAccountProfile, useMyReviews, useSavedCount } from "./queries";

/** A count, or the first page's size plus "+" when there are more pages. */
type Count = { value: number; more: boolean } | null;


/**
 * The customer's profile header on the Me page, laid out like a social
 * profile: picture beside Looks / Saved / Reviews counts, then the name, a
 * full-width "Edit profile" button and the beauticians row.
 */
export function CustomerProfileCard() {
  const { user, refreshProfile } = useAuth();
  const { error: showError } = useToast();
  // All cached: the page paints from the last visit and refreshes behind it.
  const account = useAccountProfile("customer").data ?? null;
  const looksPage = useLooksFirstPage().data;
  const savedPage = useSavedCount().data;
  const reviewList = useMyReviews().data;
  const looks: Count = looksPage ? { value: looksPage.items.length, more: Boolean(looksPage.next_cursor) } : null;
  const saved: Count = savedPage ? { value: savedPage.items.length, more: Boolean(savedPage.nextCursor) } : null;
  const reviews: Count = reviewList ? { value: reviewList.length, more: false } : null;
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const userId = user?.id;

  const pickAvatar = async (file: File) => {
    if (!userId) return;
    setUploading(true);
    try {
      const asset = await mediaAssetFromFile(file);
      // Updates the cached profile, which re-renders this card.
      await uploadAccountAvatar(userId, "customer", asset);
      await refreshProfile();
    } catch (cause) {
      showError("Picture not saved", userMessage(cause, "We couldn't save your picture. Please try again.", "account.photo"));
    } finally {
      setUploading(false);
    }
  };

  return (
    <section className="mt-4">
      <div className="flex items-center gap-6">
        {!account ? (
          <Skeleton className="size-[86px] shrink-0 rounded-full" />
        ) : (
          <div className="relative shrink-0">
            <Avatar name={account.name} src={account.avatar} size={86} />
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void pickAvatar(file);
              }}
            />
            <button
              type="button"
              aria-label="Change profile picture"
              disabled={uploading}
              onClick={() => fileInput.current?.click()}
              className="absolute -right-0.5 -bottom-0.5 flex size-7 items-center justify-center rounded-full border-2 border-background bg-primary text-surface"
            >
              {uploading ? <Spinner className="[&_svg]:size-3.5" label="Uploading" /> : <Camera aria-hidden className="size-3.5" />}
            </button>
          </div>
        )}
        <div className="flex flex-1 justify-around">
          <Stat label="Looks" count={looks} href="/looks" />
          <Stat label="Saved" count={saved} href="/bookmarks" />
          <Stat label="Reviews" count={reviews} href="/reviews" />
        </div>
      </div>
      {!account ? (
        <Skeleton className="mt-3 h-[18px] w-[44%] rounded-tile" />
      ) : (
        <p className="mt-3 truncate text-body font-bold text-ink">{account.name}</p>
      )}
      <Link
        href="/personal-details"
        className="mt-3 flex min-h-10 items-center justify-center rounded-field bg-surface text-caption font-bold text-ink transition hover:bg-tint active:opacity-70"
      >
        Edit profile
      </Link>
      <BeauticiansRow />
    </section>
  );
}

function Stat({ label, count, href }: { label: string; count: Count; href: string }) {
  const value = count ? `${count.value}${count.more ? "+" : ""}` : "–";
  return (
    <Link
      href={href}
      aria-label={`${value} ${label}`}
      className="flex flex-col items-center rounded-tile px-2 py-1 transition hover:bg-surface active:opacity-70"
    >
      <span className="text-section text-ink">{value}</span>
      <span className="text-caption text-muted">{label}</span>
    </Link>
  );
}
