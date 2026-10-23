"use client";

import { Avatar } from "@/components/ui";
import { Wordmark } from "@/components/brand/wordmark";
import { MessageLink } from "@/features/messaging/MessageLink";
import { useAuth, type AppMode } from "@/providers/auth-provider";
import { cn } from "@/lib/utils";
import {
  Bell,
  CalendarDays,
  Compass,
  Grid2x2,
  Link2,
  PlusCircle,
  Search,
  Tags,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType } from "react";

type NavItem = {
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
};

const customerItems: NavItem[] = [
  { label: "Discover", href: "/home", icon: Compass },
  { label: "Explore", href: "/explore", icon: Search },
  { label: "Bookings", href: "/bookings", icon: CalendarDays },
];

/** The app's own five tabs: Home, Services, Post, Calendar, Business. */
const professionalItems: NavItem[] = [
  { label: "Home", href: "/studio", icon: Grid2x2 },
  { label: "Services", href: "/studio/services", icon: Tags },
  { label: "Post", href: "/studio/posts/new", icon: PlusCircle },
  { label: "Calendar", href: "/studio/calendar", icon: CalendarDays },
];

/**
 * Role-aware navigation, ported from `RoleBottomBar`.
 *
 * On phones it is the familiar thumb-reachable bar; from `md` up the same items
 * render as a horizontal rail in the header, so the layout stops pretending to
 * be a phone on a laptop.
 */
export function BottomNav({ mode }: { mode: AppMode }) {
  const pathname = usePathname();
  const { avatarUrl, username } = useAuth();

  const items = mode === "professional" ? professionalItems : customerItems;
  const profileHref = mode === "professional" ? "/studio/profile" : "/profile";
  const profileLabel = mode === "professional" ? "Business" : "Profile";

  const isActive = (href: string) =>
    (href === "/home" && (pathname === "/home" || pathname === "/discover")) ||
    (href !== "/home" && pathname.startsWith(`${href}/`));

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 rounded-t-[26px] border-t border-line bg-tabbar pt-2 pb-[calc(8px+env(safe-area-inset-bottom))] shadow-bar md:hidden"
    >
      <ul className="flex items-stretch">
        {items.map((item) => {
          const active = isActive(item.href);
          const Icon = item.icon;
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex flex-col items-center gap-1 py-2 text-[10px] font-medium transition",
                  active ? "text-primary" : "text-muted",
                )}
              >
                <Icon className="size-6" />
                {item.label}
              </Link>
            </li>
          );
        })}
        <li className="flex-1">
          <Link
            href={profileHref}
            aria-current={pathname.startsWith(profileHref) ? "page" : undefined}
            className={cn(
              "flex flex-col items-center gap-1 py-2 text-[10px] font-medium transition",
              pathname.startsWith(profileHref) ? "text-primary" : "text-muted",
            )}
          >
            <Avatar
              name={username}
              src={avatarUrl}
              size={25}
              className={cn(
                "border-2",
                pathname.startsWith(profileHref) ? "border-primary" : "border-secondary",
              )}
            />
            {profileLabel}
          </Link>
        </li>
      </ul>
    </nav>
  );
}

/** Desktop counterpart, rendered inside the app header. */
export function TopNav({ mode }: { mode: AppMode }) {
  const pathname = usePathname();
  const { avatarUrl, username } = useAuth();
  const items = mode === "professional" ? professionalItems : customerItems;
  const profileHref = mode === "professional" ? "/studio/profile" : "/profile";

  const isActive = (href: string) =>
    (href === "/home" && (pathname === "/home" || pathname === "/discover")) ||
    (href !== "/home" && pathname.startsWith(`${href}/`));

  return (
    <ul className="hidden items-center gap-1 md:flex">
      {items.map((item) => {
        const active = isActive(item.href);
        const Icon = item.icon;
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2 rounded-full px-4 py-2 text-caption transition",
                active ? "bg-secondary text-ink" : "text-muted hover:bg-tint hover:text-ink",
              )}
            >
              <Icon className="size-4" />
              {item.label}
            </Link>
          </li>
        );
      })}
      <li>
        <Link
          href={profileHref}
          className={cn(
            "flex items-center gap-2 rounded-full px-3 py-1.5 text-caption transition",
            pathname.startsWith(profileHref)
              ? "bg-secondary text-ink"
              : "text-muted hover:bg-tint hover:text-ink",
          )}
        >
          <Avatar name={username} src={avatarUrl} size={24} />
          {mode === "professional" ? "Business" : "Profile"}
        </Link>
      </li>
    </ul>
  );
}

/**
 * Persistent desktop rail. At rest it is icon-only, Instagram-style; hovering
 * over the rail widens it and reveals the labels. The expansion overlays the
 * content column instead of reflowing it.
 */
export function SidebarNav({ mode }: { mode: AppMode }) {
  const pathname = usePathname();
  const { avatarUrl, username, signedIn } = useAuth();
  const items = mode === "professional" ? professionalItems : customerItems;
  const profileHref = mode === "professional" ? "/studio/profile" : "/profile";
  const profileLabel = mode === "professional" ? "Business" : "Profile";
  const isActive = (href: string) =>
    (href === "/home" && (pathname === "/home" || pathname === "/discover")) ||
    (href !== "/home" && pathname.startsWith(`${href}/`));

  const labelClass = "hidden whitespace-nowrap text-caption group-hover/sidebar:block";

  const itemClass = (active: boolean) =>
    cn(
      "flex h-12 w-12 shrink-0 items-center justify-center gap-3 rounded-field px-3 transition-[width,background-color,color] duration-200 group-hover/sidebar:w-full group-hover/sidebar:justify-start",
      active ? "bg-secondary text-ink" : "text-muted hover:bg-tint hover:text-ink",
    );

  return (
    <aside className="group/sidebar fixed inset-y-0 left-0 z-40 hidden w-[76px] flex-col overflow-hidden border-r border-line/70 bg-background px-3 py-7 transition-[width] duration-200 hover:w-[240px] md:flex">
      <Link
        href={mode === "professional" ? "/studio" : "/home"}
        aria-label="Sheree home"
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-field transition-[width] duration-200 group-hover/sidebar:w-full group-hover/sidebar:justify-start group-hover/sidebar:px-3"
      >
        <span className="wordmark text-[30px] leading-none text-primary select-none group-hover/sidebar:hidden">
          S
        </span>
        <Wordmark size="sm" className="hidden group-hover/sidebar:block" />
      </Link>

      <nav aria-label="Primary" className="mt-10 w-full">
        <ul className="flex flex-col items-center gap-1">
          {items.map((item) => {
            const active = isActive(item.href);
            const Icon = item.icon;
            return (
              <li key={item.href} className="flex w-full justify-center">
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  aria-label={item.label}
                  className={itemClass(active)}
                >
                  <Icon className="size-6 shrink-0" />
                  <span className={labelClass}>{item.label}</span>
                </Link>
              </li>
            );
          })}
          <li className="flex w-full justify-center">
            <Link
              href={profileHref}
              aria-current={pathname.startsWith(profileHref) ? "page" : undefined}
              aria-label={profileLabel}
              className={itemClass(pathname.startsWith(profileHref))}
            >
              <Avatar
                name={username}
                src={avatarUrl}
                size={24}
                className={cn(
                  "shrink-0 border-2",
                  pathname.startsWith(profileHref) ? "border-primary" : "border-line",
                )}
              />
              <span className={labelClass}>{profileLabel}</span>
            </Link>
          </li>
        </ul>
      </nav>

      <div className="mt-4 flex w-full flex-col items-center gap-1 border-t border-line/70 pt-4">
        {signedIn ? (
          <MessageLink
            className={cn(itemClass(false), "bg-transparent")}
            iconClassName="size-6"
            label="Messages"
            labelClassName={labelClass}
          />
        ) : null}
        <Link
          href={signedIn ? "/notifications" : "/sign-in"}
          aria-label={signedIn ? "Notifications" : "Sign in"}
          className={itemClass(false)}
        >
          <Bell className="size-6 shrink-0" />
          <span className={labelClass}>{signedIn ? "Notifications" : "Sign in"}</span>
        </Link>
      </div>

      <div className="mt-auto flex w-full justify-center pt-4">
        <Link href="/help-support" aria-label="Help and links" className={itemClass(false)}>
          <Link2 className="size-5 shrink-0" />
          <span className={labelClass}>Help & links</span>
        </Link>
      </div>
    </aside>
  );
}
