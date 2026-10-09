"use client";

import { Avatar } from "@/components/ui";
import { useAuth, type AppMode } from "@/providers/auth-provider";
import { cn } from "@/lib/utils";
import { CalendarDays, Compass, Grid2x2, PlusCircle, Search, Tags } from "lucide-react";
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
    pathname === href || (href !== "/home" && pathname.startsWith(`${href}/`));

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
    pathname === href || (href !== "/home" && pathname.startsWith(`${href}/`));

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
