"use client";
import { CustomerPrice } from "@/providers/pricing-provider";

import { cn } from "@/lib/utils";
import { FoundingBadge } from "@/features/badges/FoundingBadge";
import type { Professional } from "@/features/explore/data";
import { BadgeCheck, Sparkles } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

/**
 * The professional tile, measured from the original: a 224px card with a 150px
 * image, 12px of padding, and the rating/price row pinned to the bottom. The
 * `wide` variant fills its container, which is how the "Beauticians around you"
 * row and the profile list use it.
 */
export function ProfessionalTile({
  item,
  wide = false,
  className,
}: {
  item: Professional;
  wide?: boolean;
  className?: string;
}) {
  return (
    <Link
      href={`/professional/${item.id}`}
      className={cn(
        "block shrink-0 overflow-hidden rounded-card bg-surface transition active:opacity-80",
        wide ? "w-full" : "w-[224px]",
        className,
      )}
    >
      {item.image ? (
        <span className="relative block h-[150px] w-full bg-secondary">
          <Image
            src={item.image}
            alt=""
            fill
            sizes="224px"
            className="object-cover"
          />
        </span>
      ) : (
        <span className="flex h-[150px] w-full flex-col items-center justify-center gap-2 bg-secondary">
          <Sparkles aria-hidden className="size-[34px] text-primary" />
          <span className="text-caption font-bold text-primary">{item.category}</span>
        </span>
      )}

      <span className="flex flex-col gap-[3px] p-3">
        <span className="flex items-center gap-[2px]">
          <span className="truncate text-[15px] leading-[21px] font-medium text-ink">
            {item.name}
          </span>
          {item.verified ? (
            <BadgeCheck
              aria-label="Verified Professional"
              className="size-[15px] shrink-0 text-success"
            />
          ) : null}
          {/* The whole tile is a link, so the badge is presentational here. */}
          <FoundingBadge professionalId={item.id} size={15} interactive={false} />
        </span>

        <span className="truncate text-caption text-muted">
          {item.category} · {item.location}
        </span>

        <span className="mt-1 flex items-center justify-between gap-2">
          <span className="text-[12px] font-bold text-ink">
            ★ {item.rating} <span className="font-normal text-muted">({item.reviews})</span>
          </span>
          <span className="text-[11px] font-bold text-ink">from {<CustomerPrice value={item.price} />}</span>
        </span>

        {item.available ? (
          <span className="mt-0.5 text-[11px] font-medium text-success">Available today</span>
        ) : null}
      </span>
    </Link>
  );
}
