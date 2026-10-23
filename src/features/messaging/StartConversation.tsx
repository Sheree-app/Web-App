"use client";
import { useState, type ReactNode } from "react";
import { useMutation } from "convex/react";
import { useRouter, usePathname } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/auth-provider";
import { useMessaging } from "@/providers/messaging-provider";
import { supabase } from "@/lib/supabase";
import { api } from "../../../convex/_generated/api";

/**
 * The message action that sits beside "Book" on a professional's profile.
 *
 * It renders the same 54px panel as the booking button so the pair line up, and
 * takes the caller's flex sizing through `className` instead of imposing its own
 * margins.
 */
const ACTION =
  "flex min-h-[54px] w-full items-center justify-center gap-2 rounded-panel text-body font-medium transition active:scale-[.99] disabled:opacity-55";

export function StartConversation({
  professionalId,
  className,
}: {
  professionalId: string;
  className?: string;
}) {
  const { signedIn, user } = useAuth();
  const { status } = useMessaging();
  const router = useRouter();
  const pathname = usePathname();

  const frame = (children: ReactNode) => (
    <div className={cn("flex min-w-0 flex-col", className)}>{children}</div>
  );

  if (!signedIn) {
    return frame(
      <button
        type="button"
        onClick={() => router.push(`/sign-in?next=${encodeURIComponent(pathname)}`)}
        className={cn(ACTION, "border border-primary text-primary")}
      >
        <MessageCircle aria-hidden className="size-[18px]" />
        Sign in to message
      </button>,
    );
  }

  if (status !== "ready") {
    return frame(
      <button
        type="button"
        disabled
        className={cn(ACTION, "border border-line text-caption text-muted")}
      >
        {status === "loading" ? "Connecting to messages…" : "Messaging unavailable"}
      </button>,
    );
  }

  return frame(<StartConnected professionalId={professionalId} ownUserId={user?.id} />);
}

function StartConnected({
  professionalId,
  ownUserId,
}: {
  professionalId: string;
  ownUserId?: string;
}) {
  const create = useMutation(api.conversations.getOrCreateDirect);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const start = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const { data, error: lookupError } = await supabase
        .from("professional_profiles")
        .select("user_id")
        .eq("id", professionalId)
        .single();
      if (lookupError || !data) {
        throw new Error("This professional is unavailable. Please try again.");
      }
      if (data.user_id === ownUserId) throw new Error("You cannot message yourself.");
      const id = await create({ peerExternalId: data.user_id, originKind: "profile" });
      router.push(`/messages/${id}`);
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message === "You cannot message yourself."
          ? cause.message
          : "Could not open messages. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={() => void start()}
        aria-label="Message professional"
        className={cn(ACTION, "border border-primary text-primary")}
      >
        <MessageCircle aria-hidden className="size-[18px]" />
        {busy ? "Opening…" : "Message"}
      </button>
      {error ? (
        <p role="alert" className="mt-1.5 text-[11px] leading-[15px] text-error">
          {error}
        </p>
      ) : null}
    </>
  );
}
