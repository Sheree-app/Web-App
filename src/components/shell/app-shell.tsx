"use client";

import { MessageLink } from "@/features/messaging/MessageLink";
import { Wordmark } from "@/components/brand/wordmark";
import { BottomNav, SidebarNav } from "@/components/shell/bottom-nav";
import { Avatar } from "@/components/ui";
import {
  markNotificationOpened,
  markNotificationRead,
  syncWebPushSubscription,
} from "@/features/notifications/api";
import { listenToServiceWorker } from "@/features/notifications/web-push";
import { useAuth } from "@/providers/auth-provider";
import { cn } from "@/lib/utils";
import { Bell, Repeat } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

/**
 * The signed-in frame: header, content column and role-aware navigation.
 *
 * Mobile keeps the thumb bar fixed to the bottom; from `md` up the items move
 * into a fixed, icon-only left rail (Instagram-style) and the content column
 * shifts beside it, so the app reads as a considered web layout rather than a
 * stretched phone.
 */
export function AppShell({ children, className }: { children: ReactNode; className?: string }) {
  const { appMode, unreadCount, avatarUrl, username, signedIn } = useAppShellAuth();
  const router = useRouter();
  const pathname = usePathname();

  // Discover keeps its full-bleed masonry. A professional's profile also uses
  // the full content width so its four-column work grid gets real estate; its
  // header and review copy stay in a readable column inside the page. Every
  // other screen reads as a centred column at feed width.
  const fullBleed =
    pathname === "/discover" ||
    pathname === "/home" ||
    pathname.startsWith("/professional/");

  // Web Push keeps working while the app is open: clicking a notification should
  // move the current tab, and a subscription the browser rotated has to be saved
  // again or the sender keeps pushing to an endpoint that no longer exists.
  useEffect(
    () =>
      listenToServiceWorker({
        onNotificationClick: ({ notificationId, url }) => {
          if (notificationId) {
            void markNotificationRead(notificationId).catch(() => undefined);
            void markNotificationOpened(notificationId).catch(() => undefined);
          }
          router.push(url);
        },
        onSubscriptionChange: (subscription) => {
          void syncWebPushSubscription(subscription).catch(() => undefined);
        },
      }),
    [router],
  );

  return (
    <div className="flex min-h-dvh flex-col">
      <SidebarNav mode={appMode} />
      <header className="sticky top-0 z-30 border-b border-line/60 bg-background/92 pt-safe backdrop-blur-md md:hidden">
        <div className="mx-auto flex h-14 w-full max-w-[520px] items-center gap-3 px-4">
          <Link href={appMode === "professional" ? "/studio" : "/home"} aria-label="Sheree home">
            <Wordmark size="sm" />
          </Link>
          <div className="flex-1" />
          {appMode === "professional" ? (
            <Link href="/mode-transition" className="hidden items-center gap-2 rounded-full bg-tint px-3 py-1.5 text-caption text-ink transition hover:brightness-95 sm:flex">
              <Repeat aria-hidden className="size-4" />
              Business mode
            </Link>
          ) : null}
          {signedIn && <MessageLink />}
          {signedIn ? (
            <Link
              href="/notifications"
              aria-label="Notifications"
              className="relative flex size-10 items-center justify-center rounded-full bg-surface text-ink transition active:scale-95"
            >
              <Bell aria-hidden className="size-5" />
              {unreadCount > 0 ? (
                <span className="absolute top-2 right-2 size-2 rounded-full bg-primary ring-2 ring-surface" />
              ) : null}
            </Link>
          ) : (
            <Link
              href="/sign-in"
              className="rounded-full bg-secondary px-4 py-2 text-caption font-medium text-ink"
            >
              Sign in
            </Link>
          )}
          <Link href={appMode === "professional" ? "/studio/profile" : "/profile"} className="md:hidden">
            <Avatar name={username} src={avatarUrl} size={34} />
          </Link>
        </div>
      </header>

      <main
        className={cn(
          "flex-1 px-4 pt-4 pb-[calc(100px+env(safe-area-inset-bottom))] md:pt-10 md:pb-12 md:pr-10 md:pl-[calc(76px+2.5rem)] lg:pr-14 lg:pl-[calc(76px+3.5rem)]",
          className,
        )}
      >
        <div
          className={cn(
            "mx-auto w-full max-w-[520px]",
            fullBleed ? "md:max-w-none" : "md:max-w-[720px]",
          )}
        >
          {children}
        </div>
      </main>

      <BottomNav mode={appMode} />
    </div>
  );
}

/**
 * Narrow accessor so the shell doesn't re-render on every profile field. The
 * unread badge is a placeholder until the notifications module lands.
 */
function useAppShellAuth() {
  const { appMode, avatarUrl, username, signedIn } = useAuth();
  return { appMode, avatarUrl, username, signedIn, unreadCount: 0 };
}
