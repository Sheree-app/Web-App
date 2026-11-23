"use client";

import { Avatar } from "@/components/ui";
import Link from "next/link";
import { useBeauticians } from "./queries";

const SHOWN = 10;

/**
 * Instagram-highlight-style row of the beauticians the customer has worked
 * with. Hidden until there is at least one.
 */
export function BeauticiansRow() {
  // Best effort: a failure just leaves the row hidden.
  const pros = useBeauticians().data ?? [];

  if (pros.length === 0) return null;

  return (
    <section className="mt-6">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[10px] font-bold tracking-[1.5px] text-muted uppercase">Your beauticians</p>
        <Link href="/beauticians" className="text-caption font-bold text-primary hover:underline">
          See all
        </Link>
      </div>
      <div className="-mx-4 flex gap-4 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        {pros.slice(0, SHOWN).map((pro) => (
          <Link
            key={pro.professionalId}
            href={`/professional/${pro.professionalId}`}
            aria-label={`Open ${pro.name}'s profile`}
            className="flex w-[68px] shrink-0 flex-col items-center transition hover:opacity-80 active:opacity-70"
          >
            {/* An exact flex square (60 + 2×2 gap + 2×2 border): as inline
                content the photo sat on a text line, and line-height made the
                ring taller than wide. */}
            <span className="flex size-[68px] shrink-0 items-center justify-center rounded-full border-2 border-primary">

              <Avatar name={pro.name} src={pro.avatarUrl} size={60} />
            </span>
            <span className="mt-1 max-w-[68px] truncate text-[11px] text-ink">{pro.name.split(" ")[0]}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
