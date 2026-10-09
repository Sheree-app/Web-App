"use client";

import { Switch } from "@/components/ui";
import {
  defaultNotificationPreferences,
  fetchNotificationPreferences,
  fetchPushState,
  openNotificationSettings,
  registerForPushNotifications,
  saveNotificationPreferences,
  setPushEnabled,
  type NotificationPreferences,
  type PushState,
} from "@/features/notifications/api";
import { previewWebPush, webPushConfigured } from "@/features/notifications/web-push";
import { useAuth } from "@/providers/auth-provider";
import { useToast } from "@/providers/toast-provider";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  Bell,
  Calendar,
  ChevronRight,
  Heart,
  Images,
  Megaphone,
  Moon,
  Smartphone,
  Sparkles,
  Undo2,
  TriangleAlert,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type Toggle = {
  key: keyof NotificationPreferences;
  icon: React.ReactNode;
  title: string;
  detail: string;
};

const ICONS = {
  device: <Smartphone aria-hidden className="size-5 text-primary" />,
  calendar: <Calendar aria-hidden className="size-5 text-primary" />,
  images: <Images aria-hidden className="size-5 text-primary" />,
  heart: <Heart aria-hidden className="size-5 text-primary" />,
  sparkles: <Sparkles aria-hidden className="size-5 text-primary" />,
  megaphone: <Megaphone aria-hidden className="size-5 text-primary" />,
  undo: <Undo2 aria-hidden className="size-5 text-primary" />,
};

function displayTime(value: string) {
  const [hour] = value.split(":");
  const hour12 = Number(hour) % 12 || 12;
  return `${hour12}${Number(hour) < 12 ? "am" : "pm"}`;
}

/**
 * Notification settings, matching the original's three groups and its copy:
 * delivery, what you hear about (per role), and quiet hours.
 */
export default function NotificationSettingsPage() {
  const router = useRouter();
  const { role } = useAuth();
  const { toast, error: showError } = useToast();

  const [prefs, setPrefs] = useState<NotificationPreferences>(defaultNotificationPreferences);
  const [push, setPush] = useState<PushState>({
    supported: true,
    configured: webPushConfigured(),
    permission: "default",
    subscribed: false,
    deviceId: null,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    void Promise.all([fetchNotificationPreferences(), fetchPushState()])
      .then(([next, nextPush]) => {
        setPrefs(next);
        setPush(nextPush);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);


  const persist = async (next: NotificationPreferences) => {
    setSaving(true);
    try {
      await saveNotificationPreferences(next);
    } catch {
      showError("Settings not saved", "Try again.");
    } finally {
      setSaving(false);
    }
  };

  const update = (key: keyof NotificationPreferences, value: boolean) => {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    void persist(next);
  };

  /**
   * Turning push on is three steps, not one: permission, a browser
   * subscription, and the `push_tokens` row the sender reads.
   */
  const enablingPush = async () => {
    if (!push.supported || !push.configured) return;

    if (push.permission === "denied") {
      const instruction = await openNotificationSettings();
      toast("Notifications are blocked", { tone: "info", detail: instruction });
      return;
    }

    setWorking(true);
    try {
      const deviceId = await registerForPushNotifications();
      if (!deviceId) {
        const next = await fetchPushState();
        setPush(next);
        if (next.permission !== "granted") {
          toast("Notifications stay off", {
            tone: "info",
            detail: "Your browser kept the permission request until you allow it.",
          });
        }
        return;
      }
      update("pushEnabled", true);
      setPush((current) => ({ ...current, subscribed: true, permission: "granted", deviceId }));
      toast("Push is on for this device", {
        tone: "success",
        detail: "Booking changes and reminders will land here.",
      });
    } catch (cause) {
      showError("Push could not be turned on", cause instanceof Error ? cause.message : "Try again.");
    } finally {
      setWorking(false);
    }
  };

  const togglePush = async (value: boolean) => {
    if (value) {
      await enablingPush();
      return;
    }
    update("pushEnabled", false);
    try {
      await setPushEnabled(false);
      setPush((current) => ({ ...current, subscribed: false }));
    } catch (cause) {
      showError(
        "Push could not be turned off",
        cause instanceof Error ? cause.message : "Try again.",
      );
    }
  };

  const previewPush = async () => {
    const shown = await previewWebPush(
      "Sheree",
      "This is how a booking update will look on this device.",
    );
    if (!shown) await enablingPush();
  };

  // Push is only "ready" when the browser, the deployment, the permission and
  // the stored subscription all agree — otherwise the banner says which is missing.
  const pushReady = push.supported && push.configured && push.permission === "granted" && push.subscribed;
  const pushHeadline = !push.supported
    ? "This browser can’t show notifications"
    : !push.configured
      ? "Push isn’t set up for this deployment"
      : push.permission === "denied"
        ? "Notifications are blocked"
        : push.permission === "granted"
          ? "Finish turning on push"
          : "Push notifications are off";
  const pushDetail = !push.supported
    ? "Try a current Chrome, Edge, Firefox or Safari on a device."
    : !push.configured
      ? "Add a VAPID key pair and redeploy to switch push on."
      : push.permission === "denied"
        ? "Open your browser’s site settings for Sheree and allow notifications."
        : push.permission === "granted"
          ? "Tap to save this device for push."
          : "Tap to allow notifications on this device.";

  const professionalToggles: Toggle[] = [
    {
      key: "bookingUpdates",
      icon: ICONS.calendar,
      title: "Booking updates",
      detail: "New bookings, changes and appointment reminders",
    },
    {
      key: "portfolioReminders",
      icon: ICONS.images,
      title: "Portfolio reminders",
      detail: "A soft nudge when your work could use an update",
    },
    {
      key: "feedEngagement",
      icon: ICONS.heart,
      title: "Feed engagement",
      detail: "Useful activity around your work",
    },
    {
      key: "businessReminders",
      icon: ICONS.sparkles,
      title: "Business reminders",
      detail: "Availability and profile completion",
    },
  ];

  const customerToggles: Toggle[] = [
    {
      key: "bookingReminders",
      icon: ICONS.calendar,
      title: "Booking reminders",
      detail: "Confirmations and upcoming appointment alerts",
    },
    {
      key: "beautyReminders",
      icon: ICONS.sparkles,
      title: "Beauty reminders",
      detail: "A gentle nudge when it may be time to rebook",
    },
    {
      key: "feedUpdates",
      icon: ICONS.images,
      title: "Feed updates",
      detail: "A daily digest when followed creators post",
    },
    {
      key: "professionalUpdates",
      icon: ICONS.heart,
      title: "Professional updates",
      detail: "Fresh work from professionals you follow",
    },
    {
      key: "reengagement",
      icon: ICONS.undo,
      title: "Come-back reminders",
      detail: "One soft reminder after five quiet days",
    },
    {
      key: "marketing",
      icon: ICONS.megaphone,
      title: "Marketing notifications",
      detail: "Master switch for all non-booking updates",
    },
  ];

  const toggles = role === "professional" ? professionalToggles : customerToggles;

  if (loading) {
    return (
      <div className="flex min-h-[60dvh] items-center justify-center">
        <span className="size-6 animate-spin rounded-full border-2 border-secondary border-t-primary" />
      </div>
    );
  }

  return (
    <div className="flex flex-col px-4 pb-12 pt-2">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          aria-label="Go back"
          onClick={() => router.back()}
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface text-ink"
        >
          <ArrowLeft aria-hidden className="size-5" />
        </button>
        <button
          type="button"
          onClick={() => router.push("/notifications")}
          className="text-caption font-medium text-primary"
        >
          Open inbox
        </button>
      </div>

      <section className="mt-4 flex flex-col gap-2">
        <span className="flex size-12 items-center justify-center rounded-full bg-tint">
          <Bell aria-hidden className="size-6 text-primary" />
        </span>
        <p className="text-eyebrow text-primary uppercase">Notification control</p>
        <h1 className="text-page text-ink">Only the updates you want</h1>
        <p className="max-w-sm text-caption text-muted">
          Important booking changes stay easy to spot. Everything else is yours to tune.
        </p>
      </section>

      {!pushReady ? (
        <button
          type="button"
          disabled={working || !push.supported || !push.configured}
          onClick={() => void enablingPush()}
          className="mt-6 flex items-center gap-3 rounded-panel bg-tint p-4 text-left disabled:opacity-70"
        >
          <TriangleAlert aria-hidden className="size-5 shrink-0 text-warning" />
          <span className="flex-1">
            <span className="block text-body font-medium text-ink">{pushHeadline}</span>
            <span className="block text-caption text-muted">{pushDetail}</span>
          </span>
          {push.supported && push.configured ? (
            <ChevronRight aria-hidden className="size-[18px] text-muted" />
          ) : null}
        </button>
      ) : null}

      <Group title="Delivery">
        <Toggle
          icon={ICONS.device}
          title="Push notifications"
          detail="Show alerts on this device"
          value={prefs.pushEnabled}
          onChange={(value) => void togglePush(value)}
        />
        {push.subscribed ? (
          <div className="flex items-center justify-between gap-3 pb-4">
            <span className="text-caption text-muted">Test the setup without waiting for a push</span>
            <button
              type="button"
              onClick={() => void previewPush()}
              className="shrink-0 rounded-full bg-tint px-4 py-2 text-caption font-bold text-primary"
            >
              Preview
            </button>
          </div>
        ) : null}
      </Group>

      <Group title="What you hear about">
        {toggles.map((item) => (
          <Toggle
            key={item.key as string}
            icon={item.icon}
            title={item.title}
            detail={item.detail}
            value={Boolean(prefs[item.key])}
            onChange={(value) => update(item.key, value)}
          />
        ))}
      </Group>

      <Group title="Quiet hours">
        <Toggle
          icon={<Moon aria-hidden className="size-5 text-primary" />}
          title="Pause non-urgent alerts"
          detail={`Daily, ${displayTime(prefs.quietFrom)}–${displayTime(prefs.quietUntil)}`}
          value={prefs.quietHoursEnabled}
          onChange={(value) => update("quietHoursEnabled", value)}
        />
        {prefs.quietHoursEnabled ? (
          <div className="flex gap-3 px-4 pb-4">
            <label className="flex flex-1 flex-col gap-1">
              <span className="text-caption text-muted">From</span>
              <input
                type="time"
                value={prefs.quietFrom}
                onChange={(event) => setPrefs({ ...prefs, quietFrom: event.target.value })}
                onBlur={() => void persist(prefs)}
                className="h-12 rounded-field bg-surface px-3 text-body text-ink outline-none"
              />
            </label>
            <label className="flex flex-1 flex-col gap-1">
              <span className="text-caption text-muted">Until</span>
              <input
                type="time"
                value={prefs.quietUntil}
                onChange={(event) => setPrefs({ ...prefs, quietUntil: event.target.value })}
                onBlur={() => void persist(prefs)}
                className="h-12 rounded-field bg-surface px-3 text-body text-ink outline-none"
              />
            </label>
          </div>
        ) : null}
      </Group>

      <p className={cn("mt-4 text-caption text-muted", saving && "opacity-60")}>
        {saving ? "Saving…" : "Changes save as you go."}
      </p>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8 flex flex-col gap-1">
      <p className="mb-1 text-eyebrow text-muted uppercase">{title}</p>
      <div className="flex flex-col divide-y divide-line rounded-panel bg-surface px-4">{children}</div>
    </section>
  );
}

function Toggle({
  icon,
  title,
  detail,
  value,
  onChange,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-3 py-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-[14px] bg-tint">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <Switch label={title} description={detail} checked={value} onChange={onChange} />
      </div>
    </div>
  );
}
