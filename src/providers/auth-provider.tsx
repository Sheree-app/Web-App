"use client";

import { isSupabaseConfigured, supabase } from "@/lib/supabase/client";
import type { UserRole } from "@/types/database";
import type { Session, User } from "@supabase/supabase-js";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";

export type AppMode = "customer" | "professional";

type ProfileState = {
  role: UserRole | null;
  onboardingCompleted: boolean;
  onboardingStep: string | null;
  username: string;
  avatarUrl: string | null;
  appMode: AppMode;
  wantsProfessionalAccount: boolean;
};

type AuthValue = ProfileState & {
  session: Session | null;
  user: User | null;
  loading: boolean;
  emailVerified: boolean;
  passwordReset: boolean;
  signedIn: boolean;
  needsOnboarding: boolean;
  setPasswordReset: (value: boolean) => void;
  refreshProfile: (nextSession?: Session | null) => Promise<ProfileState>;
  switchMode: (mode: AppMode) => Promise<void>;
  signOut: () => Promise<void>;
};

const emptyProfile: ProfileState = {
  role: null,
  onboardingCompleted: false,
  onboardingStep: null,
  username: "Sheree member",
  avatarUrl: null,
  appMode: "customer",
  wantsProfessionalAccount: false,
};

const AuthContext = createContext<AuthValue | undefined>(undefined);

/**
 * `AsyncStorage` on mobile is `localStorage` here. These two keys keep the same
 * names the app already used so nothing about the data contract changes.
 */
const modeKey = (id: string) => `sheree:app-mode:${id}`;
const profileKey = (id: string) => `sheree:profile:${id}`;

function readStored(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* Private mode, quota, etc. — caching is best-effort. */
  }
}

/** Profile snapshot kept for the instant paint while the row loads. */
function readCachedProfile(id: string): ProfileState | null {
  try {
    const raw = readStored(profileKey(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ProfileState>;
    if (
      (parsed.role !== "customer" && parsed.role !== "professional") ||
      typeof parsed.onboardingCompleted !== "boolean" ||
      typeof parsed.username !== "string"
    ) {
      return null;
    }
    return {
      ...emptyProfile,
      ...parsed,
      appMode: parsed.appMode === "professional" ? "professional" : "customer",
    };
  } catch {
    return null;
  }
}

/** Fallback profile built from the session's user metadata. */
function sessionProfile(session: Session): ProfileState {
  const metadata = session.user.user_metadata ?? {};
  const role: UserRole = metadata.role === "professional" ? "professional" : "customer";
  return {
    ...emptyProfile,
    role,
    // Sign-up sets `requires_onboarding`, so its absence means the account is
    // already through the flow.
    onboardingCompleted: metadata.requires_onboarding !== true,
    username: metadata.username ?? metadata.full_name ?? emptyProfile.username,
    appMode: role,
  };
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<ProfileState>(emptyProfile);
  const [loading, setLoading] = useState(true);
  const [passwordReset, setPasswordReset] = useState(false);

  const loadProfile = useCallback(async (nextSession: Session | null): Promise<ProfileState> => {
    if (!nextSession) {
      setProfile(emptyProfile);
      return emptyProfile;
    }

    // Accounts that never confirmed their email hold no usable session.
    if (!nextSession.user.email_confirmed_at) {
      await supabase.auth.signOut();
      setSession(null);
      setProfile(emptyProfile);
      return emptyProfile;
    }

    const [{ data, error }, storedMode, cached] = await Promise.all([
      supabase
        .from("users")
        .select(
          "role,onboarding_step,onboarding_completed_at,username,avatar_url,wants_professional_account",
        )
        .eq("id", nextSession.user.id)
        .maybeSingle(),
      Promise.resolve(readStored(modeKey(nextSession.user.id))),
      Promise.resolve(readCachedProfile(nextSession.user.id)),
    ]);

    const resolveMode = (role: UserRole | null, stored: string | null): AppMode =>
      role === "professional" && stored === "customer"
        ? "customer"
        : role === "professional"
          ? "professional"
          : "customer";

    if (error) {
      // Offline or RLS hiccup: fall back to whatever we already knew.
      const local = cached ?? sessionProfile(nextSession);
      const fallback = { ...local, appMode: resolveMode(local.role, storedMode) };
      setProfile(fallback);
      return fallback;
    }

    const role = data?.role ?? null;
    const next: ProfileState = !data
      ? sessionProfile(nextSession)
      : {
          role,
          onboardingCompleted: Boolean(data.onboarding_completed_at),
          onboardingStep: data.onboarding_step,
          username: data.username,
          avatarUrl: data.avatar_url,
          appMode: resolveMode(role, storedMode),
          wantsProfessionalAccount: Boolean(data.wants_professional_account),
        };

    setProfile(next);
    if (data) writeStored(profileKey(nextSession.user.id), JSON.stringify(next));
    return next;
  }, []);

  const refreshProfile = useCallback(
    (nextSession?: Session | null) => loadProfile(nextSession === undefined ? session : nextSession),
    [loadProfile, session],
  );

  const switchMode = useCallback(
    async (mode: AppMode) => {
      if (!session) return;
      if (profile.role !== "professional" && mode === "professional") return;
      writeStored(modeKey(session.user.id), mode);
      setProfile((current) => ({ ...current, appMode: mode }));
    },
    [profile.role, session],
  );

  const signOut = useCallback(async () => {
    if (session) {
      try {
        window.localStorage.removeItem(profileKey(session.user.id));
      } catch {
        /* ignore */
      }
    }
    await supabase.auth.signOut();
    setProfile(emptyProfile);
    setSession(null);
  }, [session]);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    let active = true;
    let pending: ReturnType<typeof setTimeout> | undefined;

    void supabase.auth
      .getSession()
      .then(async ({ data }) => {
        if (!active) return;
        setSession(data.session);

        // Paint the cached profile first so the shell doesn't flash a spinner.
        if (data.session) {
          const cached = readCachedProfile(data.session.user.id);
          if (!active) return;
          if (cached) {
            const storedMode = readStored(modeKey(data.session.user.id));
            setProfile({
              ...cached,
              appMode:
                cached.role === "professional" && storedMode === "customer"
                  ? "customer"
                  : cached.role === "professional"
                    ? "professional"
                    : "customer",
            });
            setLoading(false);
          }
        }

        await loadProfile(data.session);
        if (active) setLoading(false);
      })
      .catch(() => {
        if (active) setLoading(false);
      });

    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === "PASSWORD_RECOVERY") setPasswordReset(true);
      setSession(next);
      if (event === "USER_UPDATED") return;
      if (!next) {
        if (pending) clearTimeout(pending);
        pending = undefined;
        setProfile(emptyProfile);
        setLoading(false);
        return;
      }
      if (pending) clearTimeout(pending);
      // Deferred: Supabase calls this handler from inside its own lock.
      pending = setTimeout(() => {
        void loadProfile(next);
      }, 0);
    });

    return () => {
      active = false;
      if (pending) clearTimeout(pending);
      data.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const value = useMemo<AuthValue>(() => {
    const signedIn = Boolean(session);
    return {
      session,
      user: session?.user ?? null,
      loading,
      passwordReset,
      setPasswordReset,
      refreshProfile,
      switchMode,
      signOut,
      emailVerified: Boolean(session?.user.email_confirmed_at),
      signedIn,
      needsOnboarding: signedIn && !profile.onboardingCompleted,
      ...profile,
    };
  }, [loading, passwordReset, profile, refreshProfile, session, signOut, switchMode]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be inside AuthProvider");
  return value;
}
