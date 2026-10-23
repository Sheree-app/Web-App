"use client";

import { cn } from "@/lib/utils";
import { BadgeCheck } from "lucide-react";
import { OfficialBeauticianArtwork } from "./artwork";
import { FoundingBadge } from "./FoundingBadge";

export type ProfessionalNameProps = {
  name: string;
  professionalId?: string | null;
  userId?: string | null;
  verified?: boolean | null;
  founding?: boolean | null;
  official?: boolean | null;
  /** Show the Founding Beautician pill instead of the icon-only seal. */
  foundingLabel?: boolean;
  /** Icon edge length for verified/founding/official marks. */
  size?: number;
  /** False inside a link that already owns the click. */
  interactive?: boolean;
  nameAs?: "span" | "h1" | "h2" | "h3";
  nameClassName?: string;
  className?: string;
};

/**
 * A professional's displayed name with the three separate status marks, in the
 * product order: name → Verified Professional → Founding Beautician → Sheree
 * official. Keeping them in one component prevents a surface from accidentally
 * implying that verification or official status is founding status.
 */
export function ProfessionalName({
  name,
  professionalId,
  userId,
  verified,
  founding,
  official,
  foundingLabel = false,
  size = 16,
  interactive = true,
  nameAs = "span",
  nameClassName,
  className,
}: ProfessionalNameProps) {
  const Name = nameAs;

  return (
    <span className={cn("flex min-w-0 items-center gap-[3px]", className)}>
      <Name className={cn("truncate", nameClassName)}>{name}</Name>

      {verified ? (
        <BadgeCheck
          aria-label="Verified Professional"
          className="shrink-0 text-success"
          style={{ width: size, height: size }}
        />
      ) : null}

      <FoundingBadge
        founding={founding}
        professionalId={professionalId}
        userId={userId}
        label={foundingLabel}
        size={size}
        interactive={interactive}
      />

      {official ? (
        <span role="img" aria-label="Sheree official" title="Sheree official" className="inline-flex">
          <OfficialBeauticianArtwork size={size} />
        </span>
      ) : null}
    </span>
  );
}
