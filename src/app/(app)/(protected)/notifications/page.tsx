"use client";

import { Spinner } from "@/components/ui";
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationOpened,
  markNotificationRead,
  notificationDestination,
  recordAppOpen,
  type AppNotification,
} from "@/features/notifications/api";
import { useAuth } from "@/providers/auth-provider";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

type Tab = "all" | "attention" | "activity" | "updates";

const TAB_LABELS: Record<Tab, string> = {
  all: "All",
  attention: "Needs attention",
  activity: "Activity",
  updates: "Updates & offers",
};

const TAB_ORDER: Tab[] = ["all", "attention", "activity", "updates"];

/** Which tab each notification kind belongs to, as the app defines it. */
const CATEGORY_BY_KIND: Record<AppNotification["kind"], Exclude<Tab, "all">> = {
  appointment_reminder: "attention",
  booking: "attention",
  payment: "attention",
  message: "activity",
  review: "activity",
  social: "activity",
  promotion: "updates",
};

/** The icon the app uses for each kind. */
const GLYPH: Record<AppNotification["kind"], string> = {
  appointment_reminder: "🗓",
  message: "💬",
  booking: "✓",
  payment: "💳",
  review: "★",
  promotion: "✨",
  social: "♥",
};

function formatTime(value: string) {
  const date = new Date(value);
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days === 0) {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  if (days === 1) return "Yesterday";
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

/**
 * The inbox, rebuilt from the original: the same four tabs, the same heading
 * per role, the unread dot, and "Mark all read".
 */
export default function NotificationsPage() {
  const router = useRouter();
  const { appMode, signedIn } = useAuth();
  const professional = appMode === "professional";

  const [items, setItems] = useState<AppNotification[]>([]);
  const [cursor, setCursor] = useState<{ createdAt: string; id: string } | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(
    async (reset = false) => {
      try {
        const page = await fetchNotifications(appMode, reset ? null : cursor, 30);
        setItems((current) => (reset ? page.items : [...current, ...page.items]));
        setCursor(page.nextCursor);
        setError(false);
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    },
    [appMode, cursor],
  );

  useEffect(() => {
    if (!signedIn) return;
    void load(true);
    void recordAppOpen(appMode).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appMode, signedIn]);

  const open = async (item: AppNotification) => {
    if (!item.readAt) {
      setItems((current) =>
        current.map((entry) =>
          entry.id === item.id ? { ...entry, readAt: new Date().toISOString() } : entry,
        ),
      );
      void markNotificationRead(item.id).catch(() => undefined);
    }
    void markNotificationOpened(item.id).catch(() => undefined);
    router.push(notificationDestination(item.data) ?? item.url ?? "/notifications");
  };

  const markAll = async () => {
    setItems((current) =>
      current.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() })),
    );
    await markAllNotificationsRead(appMode).catch(() => undefined);
  };

  const tabCount = (tab: Tab) =>
    tab === "all"
      ? items.length
      : items.filter((item) => CATEGORY_BY_KIND[item.kind] === tab).length;

  const visibleItems =
    activeTab === "all"
      ? items
      : items.filter((item) => CATEGORY_BY_KIND[item.kind] === activeTab);

  const unread = items.some((item) => !item.readAt);

  return (
    <div className="flex flex-col px-4 pb-12 pt-2">
      <div className="flex h-12 items-center justify-between gap-3">
        <button
          type="button"
          aria-label="Go back"
          onClick={() => router.back()}
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface text-ink"
        >
          <span aria-hidden>←</span>
        </button>
        <div className="flex items-center gap-3">
          {unread ? (
            <button
              type="button"
              onClick={() => void markAll()}
              className="text-caption font-bold text-primary"
            >
              Mark all read
            </button>
          ) : null}
          <button
            type="button"
            aria-label="Notification settings"
            onClick={() => router.push("/notification-settings")}
            className="flex size-10 shrink-0 items-center justify-center rounded-[16px] bg-surface text-ink"
          >
            <span aria-hidden className="text-[18px]">
              ⚙
            </span>
          </button>
        </div>
      </div>

      <div className="py-6">
        <span className="flex size-[42px] items-center justify-center rounded-full bg-secondary text-primary">
          <span aria-hidden className="text-[18px]">
            ✦
          </span>
        </span>
        <p className="mt-3 text-eyebrow text-primary uppercase">
          {professional ? "Studio inbox" : "Your beauty inbox"}
        </p>
        <h1 className="mt-1 max-w-[330px] text-page text-ink">
          {professional ? "What needs your attention" : "Little updates,"}
          <span className="text-primary">{professional ? " today" : " just for you"}</span>
        </h1>
        <p className="mt-1 max-w-[310px] text-caption text-muted">
          {professional
            ? "Bookings, payments and reactions to your work—all in one place."
            : "Appointments, messages and lovely news—all in one place."}
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <Spinner label="Loading your notifications" />
        </div>
      ) : error ? (
        <Empty
          glyph="☁"
          title="Your updates are having a moment"
          body="Pull down to try again."
        />
      ) : items.length === 0 ? (
        <Empty
          glyph="✦"
          title="All quiet, lovely"
          body={
            professional
              ? "New bookings and reactions to your work will appear here."
              : "Booking updates and messages will appear here."
          }
        />
      ) : (
        <>
          <div className="rail gap-2 pb-4" role="tablist">
            {TAB_ORDER.map((tab) => {
              const active = activeTab === tab;
              return (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveTab(tab)}
                  className={
                    active
                      ? "flex h-10 shrink-0 items-center gap-2 rounded-full bg-ink px-3.5 text-caption font-bold text-surface"
                      : "flex h-10 shrink-0 items-center gap-2 rounded-full border border-line bg-surface px-3.5 text-caption font-bold text-ink"
                  }
                >
                  {TAB_LABELS[tab]}
                  <span
                    className={
                      active
                        ? "text-[10px] font-bold text-secondary"
                        : "text-[10px] font-bold text-muted"
                    }
                  >
                    {tabCount(tab)}
                  </span>
                </button>
              );
            })}
          </div>

          {visibleItems.length > 0 ? (
            <ul className="flex flex-col gap-3">
              {visibleItems.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    aria-label={`${item.readAt ? "" : "Unread: "}${item.title}. ${item.body}`}
                    onClick={() => void open(item)}
                    className={
                      item.readAt
                        ? "flex w-full items-start gap-3 rounded-card border border-line bg-surface p-4 text-left transition active:scale-[.99] active:opacity-70"
                        : "flex w-full items-start gap-3 rounded-card border border-line bg-tint p-4 text-left transition active:scale-[.99] active:opacity-70"
                    }
                  >
                    <span className="flex size-[42px] shrink-0 items-center justify-center rounded-[15px] bg-tint text-primary">
                      <span aria-hidden>{GLYPH[item.kind]}</span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-body font-medium text-ink">{item.title}</span>
                        {!item.readAt ? (
                          <span className="size-[7px] shrink-0 rounded-full bg-primary" />
                        ) : null}
                      </span>
                      <span className="mt-0.5 block text-caption text-muted">{item.body}</span>
                      <span className="mt-2 block text-[11px] font-medium text-muted">
                        {formatTime(item.createdAt)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <Empty
              glyph="🗂"
              title={`No ${TAB_LABELS[activeTab].toLowerCase()} notifications`}
              body="New notifications in this category will appear here."
            />
          )}

          {cursor ? (
            <button
              type="button"
              onClick={() => void load(false)}
              className="mt-4 self-center rounded-full bg-surface px-5 py-3 text-caption font-bold text-ink"
            >
              Load older
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}

function Empty({ glyph, title, body }: { glyph: string; title: string; body: string }) {
  return (
    <div className="mt-6 flex flex-col items-center rounded-card bg-surface p-8 text-center">
      <span aria-hidden className="text-[32px] text-primary">
        {glyph}
      </span>
      <p className="mt-2 text-title text-ink">{title}</p>
      <p className="mt-1 text-caption text-muted">{body}</p>
    </div>
  );
}
