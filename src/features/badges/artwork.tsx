"use client";

/**
 * Badge artwork.
 *
 * `public/images/founding-beautician.png` is the mobile app's pink Founding
 * Beautician seal; `public/images/goldbadge.png` is the gold Sheree official
 * mark. Both are served as-is so the web badge is the same artwork members see
 * on mobile.
 */

export const FOUNDING_BADGE_SRC = "/images/founding-beautician.png";
export const OFFICIAL_BADGE_SRC = "/images/goldbadge.png";

type BadgeArtworkProps = {
  size?: number;
  className?: string;
  /** When supplied, the image itself is exposed to assistive tech. */
  title?: string;
};

function BadgeArtwork({
  src,
  size = 16,
  className,
  title,
}: BadgeArtworkProps & { src: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      width={size}
      height={size}
      alt={title ?? ""}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      draggable={false}
      className={
        className
          ? `inline-block shrink-0 select-none object-contain align-middle ${className}`
          : "inline-block shrink-0 select-none object-contain align-middle"
      }
    />
  );
}

/** The pink Founding Beautician seal. */
export function FoundingBeauticianArtwork(props: BadgeArtworkProps) {
  return <BadgeArtwork src={FOUNDING_BADGE_SRC} {...props} />;
}

/** The gold Sheree official mark. */
export function OfficialBeauticianArtwork(props: BadgeArtworkProps) {
  return <BadgeArtwork src={OFFICIAL_BADGE_SRC} {...props} />;
}
