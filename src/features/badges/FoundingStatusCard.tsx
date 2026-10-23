"use client";

import type { MyFoundingStatus } from "./my-status";
import { FoundingBeauticianArtwork } from "./artwork";

/**
 * The professional's own founding standing: the badge they hold, the position
 * in each category, and the categories where spots are still open.
 *
 * Reads `get_my_founding_status` — deliberately not the public boolean, which
 * cannot describe positions or opportunities.
 */
export function FoundingStatusCard({ status }: { status: MyFoundingStatus | null }) {
  if (!status) return null;

  const { badges, opportunities } = status;
  if (!status.isFounding && opportunities.length === 0) return null;

  return (
    <section className="mt-6 rounded-card bg-surface p-4">
      <div className="flex items-center gap-2.5">
        <FoundingBeauticianArtwork size={26} />
        <div className="min-w-0">
          <h2 className="text-title text-ink">Founding Beautician</h2>
          <p className="text-[11px] text-muted">
            {status.isFounding
              ? "You were one of the first beauticians in your craft."
              : "Spots are still open in your categories."}
          </p>
        </div>
      </div>

      {badges.length ? (
        <ul className="mt-3 flex flex-col gap-1.5">
          {badges.map((badge) => (
            <li key={badge.slug || badge.category} className="flex items-baseline gap-2">
              <span className="text-caption font-bold text-ink">{badge.category}</span>
              {badge.position ? (
                <span className="text-[11px] text-muted">Founding #{badge.position}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {opportunities.length ? (
        <div className="mt-3 border-t border-line pt-3">
          <p className="text-eyebrow text-muted uppercase">Founding spots open</p>
          <ul className="mt-1.5 flex flex-col gap-1">
            {opportunities.map((item) => (
              <li key={item.slug || item.category} className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-caption text-ink">{item.category}</span>
                <span className="text-[11px] text-muted">
                  {item.remaining} of {item.spots} left
                  {item.ready ? "" : " · add a service to claim"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="mt-3 text-[10px] leading-[15px] text-muted">
        Founding status is separate from professional verification and Sheree official status.
      </p>
    </section>
  );
}
