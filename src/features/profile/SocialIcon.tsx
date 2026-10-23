import type { ReactNode } from "react";
import type { SocialPlatform } from "./socials";

/**
 * Brand marks for the social row on a professional's profile.
 *
 * The mobile app used Ionicons' logo set; on the web those glyphs were only
 * approximated with text characters (`◎`, `♪`, `f`, …). These are real vector
 * marks instead, drawn on the same 24px grid so the row stays even.
 */

export type SocialIconName = SocialPlatform | "whatsapp" | "telephone";

const ICONS: Record<SocialIconName, ReactNode> = {
  instagram: (
    <>
      <rect
        x="3.2"
        y="3.2"
        width="17.6"
        height="17.6"
        rx="5.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
      />
      <circle cx="12" cy="12" r="4.1" fill="none" stroke="currentColor" strokeWidth="1.9" />
      <circle cx="17.3" cy="6.8" r="1.2" fill="currentColor" />
    </>
  ),
  tiktok: (
    <path
      fill="currentColor"
      d="M14.3 3h2.5c.2 1.9 1.4 3.4 3.2 3.8v2.5c-1.2 0-2.3-.4-3.2-1v6.4a5.7 5.7 0 1 1-5.7-5.7c.3 0 .6 0 .9.1v2.6a3.1 3.1 0 1 0 2.3 3V3z"
    />
  ),
  facebook: (
    <path
      fill="currentColor"
      d="M13.6 21v-7.1h2.4l.4-2.8h-2.8V9.3c0-.8.2-1.4 1.4-1.4h1.5V5.4c-.3 0-1.2-.1-2.2-.1-2.2 0-3.7 1.3-3.7 3.8v2H8.2v2.8h2.4V21h3z"
    />
  ),
  x: (
    <path
      fill="currentColor"
      d="M4.1 4h3.7l4.2 5.7L16.8 4h2.9l-6.2 7.6L20.2 20h-3.7l-4.5-6.1L7 20H4.1l6.5-7.9L4.1 4z"
    />
  ),
  youtube: (
    <>
      <rect
        x="2.6"
        y="5.6"
        width="18.8"
        height="12.8"
        rx="4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
      />
      <path fill="currentColor" d="M10.3 9.2l5.1 2.8-5.1 2.8z" />
    </>
  ),
  snapchat: (
    <path
      fill="currentColor"
      d="M12 3.5c2.6 0 4.2 1.9 4.2 4.6v2.2c0 .5.5.6.9.5.4-.1.8.1.8.5 0 .5-.7.8-1.2.9-.3.1-.4.3-.3.6.3 1 .9 1.8 1.9 2.2.4.2.4.6 0 .8-.4.2-.9.2-1.4.2-.2 0-.3.2-.4.5-.1.4-.3.7-.7.7-.5 0-1-.2-1.6 0-.6.2-1 .7-1.9.7s-1.3-.5-1.9-.7c-.6-.2-1.1 0-1.6 0-.4 0-.6-.3-.7-.7-.1-.3-.2-.5-.4-.5-.5 0-1 0-1.4-.2-.4-.2-.4-.6 0-.8 1-.4 1.6-1.2 1.9-2.2.1-.3 0-.5-.3-.6-.5-.1-1.2-.4-1.2-.9 0-.4.4-.6.8-.5.4.1.9 0 .9-.5V8.1c0-2.7 1.6-4.6 4.2-4.6z"
    />
  ),
  whatsapp: (
    <>
      <path
        fill="currentColor"
        d="M12 3.4a8.6 8.6 0 0 0-7.3 13L3.4 20.6l4.4-1.2A8.6 8.6 0 1 0 12 3.4zm0 1.8a6.8 6.8 0 1 1-3.5 12.6l-.5-.3-2.4.7.7-2.3-.3-.5A6.8 6.8 0 0 1 12 5.2z"
      />
      <path
        fill="currentColor"
        d="M9.7 8.5c-.2-.5-.4-.5-.6-.5h-.5c-.2 0-.5.1-.7.3-.3.3-.9.9-.9 2.1s.9 2.4 1 2.6c.1.2 1.7 2.8 4.2 3.8 2.1.8 2.5.7 3 .6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.2-.2-.5-.3l-1.7-.8c-.2-.1-.4-.1-.5.1l-.7.9c-.1.2-.3.2-.5.1-.3-.1-1.1-.4-2-1.3-.7-.6-1.2-1.4-1.3-1.6-.1-.2 0-.3.1-.4l.4-.5c.1-.1.1-.2.2-.4 0-.1 0-.3 0-.4l-.6-1.4z"
      />
    </>
  ),
  telephone: (
    <path
      fill="currentColor"
      d="M7.2 4.4c.6-.2 1.2.1 1.4.7l.8 2c.2.5 0 1.1-.4 1.4l-1 .8a9.6 9.6 0 0 0 4.7 4.7l.8-1c.3-.4.9-.6 1.4-.4l2 .8c.6.2.9.8.7 1.4l-.5 1.6c-.2.6-.8 1-1.4 1A12.4 12.4 0 0 1 3.9 7.6c0-.6.4-1.2 1-1.4l2.3-.8z"
    />
  ),
};

export function SocialIcon({
  platform,
  className,
}: {
  platform: SocialIconName;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      focusable="false"
      className={className}
      fill="none"
    >
      {ICONS[platform]}
    </svg>
  );
}
