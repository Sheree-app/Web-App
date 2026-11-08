"use client";

import { cn } from "@/lib/utils";
import { Bell, MessageCircle, Sparkles, X } from "lucide-react";
import Image from "next/image";
import { useSyncExternalStore, type ReactNode } from "react";
import {
  STORE_URL,
  appPromoHidden,
  detectPlatform,
  dismissAppPromo,
  storesFor,
  subscribeAppPromo,
  type Store,
  type StorePlatform,
} from "./store";

/**
 * Banners render nothing on the server and on first paint: whether to show them
 * depends on this browser's "not now" and its platform. That keeps hydration
 * clean and means a dismissed banner never flashes.
 */
function usePromo(): { show: boolean; platform: StorePlatform } {
  const show = useSyncExternalStore(subscribeAppPromo, () => !appPromoHidden(), () => false);
  const platform = useSyncExternalStore(
    noopSubscribe,
    readPlatform,
    () => "desktop" as StorePlatform,
  );
  return { show, platform };
}

const noopSubscribe = () => () => {};

let cachedPlatform: StorePlatform | null = null;

function readPlatform(): StorePlatform {
  if (!cachedPlatform) {
    const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
    cachedPlatform = detectPlatform({
      userAgent: navigator.userAgent,
      maxTouchPoints: navigator.maxTouchPoints,
      uaPlatform: uaData?.platform ?? null,
    });
  }
  return cachedPlatform;
}

const STORE_COPY: Record<Store, { kicker: string; name: string; label: string }> = {
  ios: { kicker: "Download on the", name: "App Store", label: "Get Sheree on the App Store" },
  android: { kicker: "Get it on", name: "Google Play", label: "Get Sheree on Google Play" },
};

function StoreGlyph({ store, className }: { store: Store; className?: string }) {
  return store === "ios" ? <AppleGlyph className={className} /> : <PlayGlyph className={className} />;
}

/* --------------------------------- Store buttons --------------------------------- */

function AppleGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="currentColor">
      <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" />
    </svg>
  );
}

function PlayGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="currentColor">
      <path d="M22.018 13.298l-3.919 2.218-3.515-3.493 3.543-3.521 3.891 2.202a1.49 1.49 0 0 1 0 2.594zM1.337.924a1.486 1.486 0 0 0-.112.568v21.017c0 .217.045.419.124.6l11.155-11.087L1.337.924zm12.207 10.065l3.258-3.238L3.45.195a1.466 1.466 0 0 0-.946-.179l11.04 10.973zm0 2.067l-11 10.933c.298.036.612-.016.906-.183l13.324-7.54-3.23-3.21z" />
    </svg>
  );
}

function StoreButton({
  href,
  kicker,
  store,
  icon,
  compact,
}: {
  href: string;
  kicker: string;
  store: string;
  icon: ReactNode;
  compact?: boolean;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "inline-flex min-w-0 items-center justify-center gap-2 rounded-tile bg-[#16110F] text-white transition hover:bg-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary dark:bg-white dark:text-[#16110F] dark:hover:bg-white/90",
        compact ? "h-10 px-3" : "h-11 px-3.5",
      )}
    >
      <span className="flex shrink-0 items-center">{icon}</span>
      <span className="flex flex-col items-start leading-none whitespace-nowrap">
        <span className="text-[9px] font-medium tracking-wide opacity-80">{kicker}</span>
        <span className={cn("font-bold", compact ? "text-[13px]" : "text-[14px]")}>{store}</span>
      </span>
    </a>
  );
}

/**
 * The store buttons for this device: one on a phone, both on a computer, with
 * the likelier store first. With two buttons the row is a container query, so
 * in a narrow feed column they stack at equal width instead of wrapping into a
 * ragged pair, and sit side by side once there's room.
 */
export function StoreButtons({
  platform,
  compact,
  className,
}: {
  platform: StorePlatform;
  compact?: boolean;
  className?: string;
}) {
  const stores = storesFor(platform);
  const buttons = stores.map((store) => (
    <StoreButton
      key={store}
      href={STORE_URL[store]}
      kicker={STORE_COPY[store].kicker}
      store={STORE_COPY[store].name}
      icon={<StoreGlyph store={store} className={store === "ios" ? "size-[18px]" : "size-4"} />}
      compact={compact}
    />
  ));
  if (stores.length === 1) return <div className={cn("flex", className)}>{buttons}</div>;
  return (
    <div className={cn("@container", className)}>
      <div className="grid grid-cols-1 gap-2 @[16.5rem]:grid-cols-2">{buttons}</div>
    </div>
  );
}

function DismissButton({ onLight }: { onLight?: boolean }) {
  return (
    <button
      type="button"
      onClick={dismissAppPromo}
      aria-label="Not now"
      title="Not now"
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full transition",
        onLight
          ? "bg-surface/80 text-muted backdrop-blur hover:text-ink"
          : "text-muted hover:bg-surface/70 hover:text-ink",
      )}
    >
      <X aria-hidden className="size-4" />
    </button>
  );
}

/* ----------------------------------- Feed tile ----------------------------------- */

const PERKS = [
  { icon: Bell, label: "Booking reminders right on your lock screen" },
  { icon: MessageCircle, label: "Never miss a message from your professional" },
  { icon: Sparkles, label: "Your saved looks, always in your pocket" },
] as const;

/**
 * A lookbook pin that happens to be an invitation. It sits in the masonry like
 * any other piece of work, so it's met at scrolling pace rather than thrown in
 * front of the page, and one tap on "Not now" puts every banner away for a few days (DISMISS_DAYS).
 */
export function AppPromoTile({ className }: { className?: string }) {
  const { show, platform } = usePromo();
  if (!show) return null;

  return (
    <aside
      aria-label="Get the Sheree app"
      className={cn(
        "relative mb-4 break-inside-avoid overflow-hidden rounded-panel bg-tint shadow-card animate-fade",
        className,
      )}
    >
      <div className="relative h-28 overflow-hidden md:h-40" aria-hidden>
        <Image
          src="/images/brand/splash-beauty-background.png"
          alt=""
          fill
          sizes="(min-width: 1024px) 25vw, 50vw"
          className="object-cover object-top"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-tint/30 to-tint" />
      </div>

      <div className="absolute top-2 right-2">
        <DismissButton onLight />
      </div>

      <div className="relative -mt-10 flex flex-col gap-3 px-3 pb-3 md:px-4 md:pb-4">
        <span className="relative size-12 overflow-hidden rounded-[14px] shadow-card ring-4 ring-tint md:size-14 md:rounded-[16px]">
          <Image src="/images/icon.png" alt="" fill sizes="56px" className="object-cover" />
        </span>
        <div>
          <p className="text-eyebrow text-primary uppercase">The Sheree app</p>
          <h2 className="mt-1 font-script text-[26px] leading-[30px] text-ink md:text-[30px] md:leading-[36px]">
            Lovelier in your hand
          </h2>
          <p className="mt-1 text-caption text-muted">
            Everything you love here, made for your phone.
          </p>
        </div>
        {/* The phone feed is two narrow columns; the perks only fit from tablet up. */}
        <ul className="hidden flex-col gap-2 md:flex">
          {PERKS.map(({ icon: Icon, label }) => (
            <li key={label} className="flex items-start gap-2 text-caption text-ink">
              <Icon aria-hidden className="mt-px size-4 shrink-0 text-primary" />
              {label}
            </li>
          ))}
        </ul>
        <StoreButtons platform={platform} compact />
        <p className="text-[11px] leading-4 text-muted">
          Free · <span className="hidden md:inline">same account, nothing to set up again</span>
          <span className="md:hidden">same account</span>
        </p>
      </div>
    </aside>
  );
}

/* ---------------------------------- Inline strip ---------------------------------- */

/**
 * A quiet one-line card for moments where the app genuinely helps, such as
 * right after booking. The copy is passed in so each placement can say why
 * the app is useful *there*.
 */
export function AppPromoStrip({
  title,
  body,
  className,
}: {
  title: string;
  body: string;
  className?: string;
}) {
  const { show, platform } = usePromo();
  if (!show) return null;

  return (
    <aside
      aria-label="Get the Sheree app"
      className={cn(
        "relative flex flex-col gap-3 overflow-hidden rounded-panel bg-tint p-4 animate-fade sm:flex-row sm:items-center",
        className,
      )}
    >
      {/* A soft blush bloom so the strip feels like Sheree, not an ad slot. */}
      <span
        aria-hidden
        className="pointer-events-none absolute -top-10 -right-10 size-36 rounded-full bg-secondary opacity-60 blur-2xl"
      />
      <div className="relative flex min-w-0 flex-1 items-center gap-3 pr-8 sm:pr-0">
        <span className="relative size-12 shrink-0 overflow-hidden rounded-[14px] shadow-card">
          <Image src="/images/icon.png" alt="" fill sizes="48px" className="object-cover" />
        </span>
        <div className="min-w-0">
          <p className="text-body font-medium text-ink">{title}</p>
          <p className="text-caption text-muted">{body}</p>
        </div>
      </div>
      <StoreButtons platform={platform} compact className="relative sm:shrink-0" />
      <div className="absolute top-2 right-2 sm:static sm:self-start">
        <DismissButton />
      </div>
    </aside>
  );
}

/* ----------------------------------- Simple bar ----------------------------------- */

/**
 * The lightest ask: one line and a "Get the app" link, for pages where the
 * content is the point (a post, a profile, a service list). It sits after the
 * content, never above it.
 */
export function AppPromoBar({
  title,
  body,
  className,
}: {
  title: string;
  body?: string;
  className?: string;
}) {
  const { show, platform } = usePromo();
  if (!show) return null;

  return (
    <aside
      aria-label="Get the Sheree app"
      className={cn(
        "flex items-center gap-3 rounded-panel border border-line bg-surface p-3 animate-fade",
        className,
      )}
    >
      <span className="relative size-10 shrink-0 overflow-hidden rounded-[12px]">
        <Image src="/images/icon.png" alt="" fill sizes="40px" className="object-cover" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-caption font-bold text-ink">{title}</p>
        {body ? <p className="line-clamp-2 text-caption text-muted">{body}</p> : null}
      </div>
      {storesFor(platform).length > 1 ? (
        // A computer: we can't know which phone they carry, so offer both,
        // icon-sized, likelier store first.
        <div className="flex shrink-0 gap-1.5">
          {storesFor(platform).map((store) => (
            <a
              key={store}
              href={STORE_URL[store]}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={STORE_COPY[store].label}
              title={STORE_COPY[store].name}
              className="flex size-9 items-center justify-center rounded-full bg-[#16110F] text-white transition hover:bg-black dark:bg-white dark:text-[#16110F]"
            >
              <StoreGlyph store={store} className={store === "ios" ? "size-4" : "size-3.5"} />
            </a>
          ))}
        </div>
      ) : (
        <a
          href={STORE_URL[storesFor(platform)[0]]}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={STORE_COPY[storesFor(platform)[0]].label}
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-caption font-bold text-surface transition hover:opacity-90"
        >
          <StoreGlyph store={storesFor(platform)[0]} className="size-3.5" />
          Get the app
        </a>
      )}
      <DismissButton />
    </aside>
  );
}
