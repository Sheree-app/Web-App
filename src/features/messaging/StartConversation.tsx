"use client";
import { useState } from "react";
import { useMutation } from "convex/react";
import { useRouter, usePathname } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { useAuth } from "@/providers/auth-provider";
import { useMessaging } from "@/providers/messaging-provider";
import { supabase } from "@/lib/supabase";
import { api } from "../../../convex/_generated/api";

export function StartConversation({ professionalId }: { professionalId: string }) {
  const { signedIn, user } = useAuth();
  const { status } = useMessaging();
  const router = useRouter();
  const pathname = usePathname();
  if (!signedIn) return <button type="button" onClick={() => router.push(`/sign-in?next=${encodeURIComponent(pathname)}`)} className="mt-3 min-h-12 rounded-panel border border-primary text-body font-medium text-primary">Sign in to message</button>;
  if (status !== "ready") return <button type="button" disabled className="mt-3 min-h-12 rounded-panel border border-line text-caption text-muted">{status === "loading" ? "Connecting to messages..." : "Messaging unavailable"}</button>;
  return <StartConnected professionalId={professionalId} ownUserId={user?.id} />;
}
function StartConnected({ professionalId, ownUserId }: { professionalId: string; ownUserId?: string }) {
  const create = useMutation(api.conversations.getOrCreateDirect);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const start = async () => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const { data, error: lookupError } = await supabase.from("professional_profiles").select("user_id").eq("id", professionalId).single();
      if (lookupError || !data) throw new Error("This professional is unavailable. Please try again.");
      if (data.user_id === ownUserId) throw new Error("You cannot message yourself.");
      const id = await create({ peerExternalId: data.user_id, originKind: "profile" });
      router.push(`/messages/${id}`);
    } catch (error) { setError(error instanceof Error && error.message === "You cannot message yourself." ? error.message : "Could not open messages. Please try again."); }
    finally { setBusy(false); }
  };
  return <><button type="button" disabled={busy} onClick={() => void start()} className="mt-3 flex min-h-12 items-center justify-center gap-2 rounded-panel border border-primary text-body font-medium text-primary disabled:opacity-50"><MessageCircle aria-hidden className="size-5" />{busy ? "Opening conversation..." : "Message professional"}</button>{error && <p role="alert" className="mt-2 text-caption text-error">{error}</p>}</>;
}
