"use client";

import { BottomNav, SidebarNav } from "@/components/shell/bottom-nav";
import {
  markNotificationOpened,
  markNotificationRead,
  syncWebPushSubscription,
} from "@/features/notifications/api";
import { listenToServiceWorker } from "@/features/notifications/web-push";
import { useAuth } from "@/providers/auth-provider";
import { cn } from "@/lib/utils";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

/**
 * The signed-in frame: content column and role-aware navigation.
 *
 * Mobile keeps the thumb bar fixed to the bottom; from `md` up the items move
 * into a fixed, icon-only left rail (Instagram-style) and the content column
 * shifts beside it, so the app reads as a considered web layout rather than a
 * stretched phone.
 */
export function AppShell({ children, className }: { children: ReactNode; className?: string }) {
  const { appMode } = useAppShellAuth();
  const router = useRouter();
  const pathname = usePathname();

  // Discover keeps its full-bleed masonry. A professional's profile also uses
  // the full content width so its four-column work grid gets real estate; its
  // header and review copy stay in a readable column inside the page. An open
  // post and the messages inbox need the same room to put two panes side by side
  // on large screens. Every other screen reads as a centred column at feed width.
  const fullBleed =
    pathname === "/discover" ||
    pathname === "/home" ||
    pathname.startsWith("/professional/") ||
    pathname.startsWith("/post/") ||
    pathname.startsWith("/messages");

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
  const { appMode } = useAuth();
  return { appMode };
}
