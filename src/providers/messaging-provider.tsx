"use client";

import { ConvexProviderWithAuth, ConvexReactClient, useConvexAuth, useMutation, useQuery } from "convex/react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../../convex/_generated/api";
import { createMessagingTokenFetcher } from "@/features/messaging/token-fetcher";
import { usePresenceHeartbeat } from "@/features/messaging/use-presence";
import { env } from "@/lib/env";
import { supabase } from "@/lib/supabase";
import { useAuth } from "./auth-provider";

const client = env.convexUrl ? new ConvexReactClient(env.convexUrl) : null;
type MessagingState = { status: "disabled" | "loading" | "signedOut" | "ready" | "error"; retry: () => void };
const Context = createContext<MessagingState>({ status: "disabled", retry: () => {} });
export const useMessaging = () => useContext(Context);

function useSupabaseAuth() {
  const { loading, session } = useAuth();
  const userId = session?.user.id;
  // Convex reauthenticates whenever this function changes. Token rotation must
  // not change its identity, or refresh -> render -> reauthenticate loops forever.
  const fetchAccessToken = useMemo(() => createMessagingTokenFetcher(supabase.auth, userId), [userId]);
  return useMemo(() => ({ isLoading: loading, isAuthenticated: Boolean(userId), fetchAccessToken }), [loading, userId, fetchAccessToken]);
}

export function MessagingProvider({ children }: { children: ReactNode }) {
  if (!client) return <Context.Provider value={{ status: "disabled", retry: () => {} }}>{children}</Context.Provider>;
  return <ConvexProviderWithAuth client={client} useAuth={useSupabaseAuth}><MessagingIdentity>{children}</MessagingIdentity></ConvexProviderWithAuth>;
}

function MessagingIdentity({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { user, signedIn } = useAuth();
  const userId = user?.id;
  const ensureSelf = useMutation(api.users.ensureSelf);
  const [attempt, setAttempt] = useState(0);
  const [identity, setIdentity] = useState<{ userId: string; status: "ready" | "error" } | null>(null);
  useEffect(() => {
    if (!isAuthenticated || !userId) return;
    let active = true;
    void ensureSelf({}).then(() => { if (active) setIdentity({ userId, status: "ready" }); }).catch((error) => {
      console.error("Messaging profile setup failed", error);
      if (active) setIdentity({ userId, status: "error" });
    });
    return () => { active = false; };
  }, [ensureSelf, isAuthenticated, userId, attempt]);
  const retry = useCallback(() => {
    if (!isAuthenticated) {
      // Reconnect on this explicit action, rather than independently rotating
      // Supabase tokens behind Convex's stable authentication callback.
      window.location.reload();
      return;
    }
    setIdentity(null);
    setAttempt(value => value + 1);
  }, [isAuthenticated]);
  const status = !signedIn ? "signedOut" : isLoading ? "loading" : !isAuthenticated ? "error" : identity?.userId === user?.id ? identity?.status ?? "loading" : "loading";
  // Presence only beats once this account's messaging identity is ready; a
  // signed-out or half-provisioned session never touches the presence table.
  usePresenceHeartbeat(status === "ready");
  return <Context.Provider value={{ status, retry }}>{children}</Context.Provider>;
}

// Mount only inside a configured provider; signed-out users never subscribe.
export function MessagingUnread({ inbox, children }: { inbox?: "customer" | "professional"; children: (count: number) => ReactNode }) {
  const { status } = useMessaging();
  if (status !== "ready") return children(0);
  return <UnreadSubscription inbox={inbox}>{children}</UnreadSubscription>;
}
function UnreadSubscription({ inbox, children }: { inbox?: "customer" | "professional"; children: (count: number) => ReactNode }) {
  const count = useQuery(api.conversations.unreadTotal, { inbox });
  return children(count ?? 0);
}
