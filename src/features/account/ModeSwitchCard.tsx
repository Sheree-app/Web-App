"use client";

import { Sheet } from "@/components/ui";
import { useAuth, type AppMode } from "@/providers/auth-provider";
import { cn } from "@/lib/utils";
import { Briefcase, Lock, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * The Customer / Professional switch, ported from `ModeSwitchCard`: a two-up
 * segmented control that hands off to the mode transition screen, and locks the
 * professional side for people who signed up as customers.
 */
export function ModeSwitchCard() {
  const router = useRouter();
  const { role, appMode, wantsProfessionalAccount } = useAuth();
  const [lockedNotice, setLockedNotice] = useState(false);

  const lockedProfessional = role !== "professional" && !wantsProfessionalAccount;

  const select = (mode: AppMode) => {
    if (mode === appMode) return;
    if (mode === "professional" && lockedProfessional) {
      setLockedNotice(true);
      return;
    }
    router.push("/mode-transition");
  };

  return (
    <>
      <div role="tablist" className="flex h-[54px] gap-[5px] rounded-panel bg-tint p-[5px]">
        <ModeButton
          label="Customer"
          icon={<Sparkles aria-hidden className="size-[17px]" />}
          active={appMode === "customer"}
          onPress={() => select("customer")}
        />
        <ModeButton
          label="Professional"
          icon={<Briefcase aria-hidden className="size-[17px]" />}
          active={appMode === "professional"}
          locked={lockedProfessional}
          onPress={() => select("professional")}
        />
      </div>

      <Sheet
        open={lockedNotice}
        onClose={() => setLockedNotice(false)}
        title="Professional experience is locked"
        footer={
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setLockedNotice(false)}
              className="min-h-[54px] flex-1 rounded-panel bg-surface text-body font-medium text-ink"
            >
              Not now
            </button>
            <button
              type="button"
              onClick={() => {
                setLockedNotice(false);
                router.push("/settings");
              }}
              className="min-h-[54px] flex-1 rounded-panel bg-primary text-body font-medium text-surface"
            >
              Go to Settings
            </button>
          </div>
        }
      >
        <p className="text-body text-ink">
          You chose to use Sheree as a customer. Start a professional account from Settings to
          unlock the professional experience.
        </p>
      </Sheet>
    </>
  );
}

function ModeButton({
  label,
  icon,
  active,
  locked,
  onPress,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  locked?: boolean;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      disabled={Boolean(locked) && active}
      onClick={onPress}
      className={cn(
        "flex flex-1 items-center justify-center gap-2 rounded-field transition active:opacity-70",
        active ? "bg-ink" : "bg-transparent",
        locked && "opacity-60",
      )}
    >
      <span className={active ? "text-surface" : "text-muted"}>{icon}</span>
      <span
        className={cn(
          "text-[13px] font-bold",
          active ? "text-surface" : "text-muted",
          locked && "opacity-70",
        )}
      >
        {label}
      </span>
      {locked ? <Lock aria-hidden className="size-3 text-muted" /> : null}
    </button>
  );
}
