"use client";

import { exchangeSupabaseSession, fetchAccount } from "@/features/auth/api";
import { api, isApiError, type ApiUser, type TokenResponse } from "@/lib/api";
import { SESSION_STORAGE_KEY } from "@/lib/api/browser-token-store";
// Wires the data cache to the session (restore for this person, wipe on sign-out).
import "@/lib/query-cache";
import { isNetworkError, isSessionExpired, reportError } from "@/lib/errors";
import { isSupabaseConfigured, supabase } from "@/lib/supabase/client";
import type { UserRole } from "@/types/database";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";

export type AppMode = "customer" | "professional";

/**
 * Who is signed in, as pages read it (`session.user.id`). It is no longer a
 * Supabase session: tokens live in the API client (`src/lib/api`), and code
 * that needs one calls the API rather than reading it from here.
 */
export type AuthUser = { id: string; email: string | null };
export type AuthSession = { user: AuthUser };

export type ProfileState = {
  role: UserRole | null;
  onboardingCompleted: boolean;
  onboardingStep: string | null;
  username: string;
  avatarUrl: string | null;
  appMode: AppMode;
  wantsProfessionalAccount: boolean;
};

type AuthValue = ProfileState & {
  session: AuthSession | null;
  user: AuthUser | null;
  loading: boolean;
  signedIn: boolean;
  needsOnboarding: boolean;
  /** Reloads the signed-in user's profile (after onboarding, edits, ...). */
  refreshProfile: () => Promise<ProfileState>;
  /**
   * Starts a session from any token response (sign-in, verify-email, password
   * reset) and resolves once the profile is loaded, so the caller can route.
   */
  startSession: (tokens: TokenResponse, email?: string) => Promise<ProfileState>;
  switchMode: (mode: AppMode) => Promise<void>;
  /** Signs out on this device at once; the server login is ended in the background. */
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

// Same keys as before the move, so the cached profile survives the update.
const modeKey = (id: string) => `sheree:app-mode:${id}`;
const profileKey = (id: string) => `sheree:profile:${id}`;

type CachedProfile = ProfileState & { email?: string | null };

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
    /* Private mode, quota, etc. Caching is best-effort. */
  }
}

function readCachedProfile(id: string): CachedProfile | null {
  try {
    const raw = readStored(profileKey(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedProfile>;
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

/** The user id in the API client's stored session, read synchronously. */
function storedSessionUserId(): string | null {
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    const id = raw ? (JSON.parse(raw) as { user?: { id?: unknown } }).user?.id : null;
    return typeof id === "string" ? id : null;
  } catch {
    return null;
  }
}

/** A professional may browse as a customer; a customer is always in customer mode. */
const modeFor = (role: UserRole | null, stored: string | null): AppMode =>
  role === "professional" && stored !== "customer" ? "professional" : "customer";

/**
 * When the account can't be read (offline, server error) and nothing is
 * cached, the token still says who this is. Onboarding is assumed done: the
 * next successful load corrects it either way.
 */
const tokenProfile = (user: ApiUser): ProfileState => ({
  ...emptyProfile,
  role: user.role,
  onboardingCompleted: true,
  appMode: user.role,
});

/**
 * The one-time move from a Supabase session (cookies written by the old web
 * app) to an API login, so nobody has to sign in again (design.md §5.3).
 * Returns tokens, or null when there is nothing to move or it can't be moved
 * right now; the Supabase session is kept for a retry unless Supabase says it
 * is gone.
 */
async function exchangeLegacySession(): Promise<TokenResponse | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const { data } = await supabase.auth.getSession();
    const legacy = data.session;
    if (!legacy) return null;
    // An unconfirmed account never held a usable session in the old app.
    if (!legacy.user.email_confirmed_at) {
      await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
      return null;
    }
    const tokens = await exchangeSupabaseSession({
      accessToken: legacy.access_token,
      refreshToken: legacy.refresh_token,
    });
    // The server has logged the Supabase session out; drop the cookies too.
    await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
    return tokens;
  } catch (error) {
    if (isApiError(error) && error.code === "invalid_supabase_session") {
      await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
      return null;
    }
    if (!isNetworkError(error)) reportError(error, "auth-exchange");
    return null;
  }
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [profile, setProfile] = useState<ProfileState>(emptyProfile);
  const [loading, setLoading] = useState(true);
  // Only the latest load may write state: a slow earlier call must not put a
  // signed-out (or previous) user's profile back.
  const loadSeq = useRef(0);
  const sessionRef = useRef<AuthSession | null>(null);
  const profileRef = useRef<ProfileState>(emptyProfile);

  const applySession = useCallback((next: AuthSession | null) => {
    const current = sessionRef.current;
    // Keep the same object while nothing changed, so `[session]` effects don't re-run.
    if (next && current && current.user.id === next.user.id && current.user.email === next.user.email) return;
    sessionRef.current = next;
    setSession(next);
  }, []);
  const applyProfile = useCallback((next: ProfileState) => {
    profileRef.current = next;
    setProfile(next);
  }, []);
  const clear = useCallback(() => {
    loadSeq.current += 1;
    applySession(null);
    applyProfile(emptyProfile);
  }, [applyProfile, applySession]);

  const loadProfile = useCallback(
    async (user: ApiUser): Promise<ProfileState> => {
      const seq = ++loadSeq.current;
      const latest = () => seq === loadSeq.current && api.session.user()?.id === user.id;
      const storedMode = readStored(modeKey(user.id));
      const cached = readCachedProfile(user.id);
      let account: Awaited<ReturnType<typeof fetchAccount>>;
      try {
        account = await fetchAccount();
      } catch (error) {
        // The login ended (the client already told the subscriber below).
        if (isSessionExpired(error)) return emptyProfile;
        if (!isNetworkError(error)) reportError(error, "auth-profile");
        const local = cached ?? tokenProfile(user);
        const fallback = { ...local, appMode: modeFor(local.role, storedMode) };
        if (latest()) {
          applySession({
            user: { id: user.id, email: cached?.email ?? sessionRef.current?.user.email ?? null },
          });
          applyProfile(fallback);
        }
        return fallback;
      }
      const next: ProfileState = {
        role: account.role,
        onboardingCompleted: account.onboarding_completed,
        onboardingStep: account.onboarding_step,
        username: account.username ?? emptyProfile.username,
        avatarUrl: account.avatar_url,
        appMode: modeFor(account.role, storedMode),
        wantsProfessionalAccount: account.wants_professional_account,
      };
      if (latest()) {
        applySession({ user: { id: user.id, email: account.email } });
        applyProfile(next);
        writeStored(profileKey(user.id), JSON.stringify({ ...next, email: account.email }));
      }
      return next;
    },
    [applyProfile, applySession],
  );

  const refreshProfile = useCallback(async () => {
    const user = api.session.user();
    return user ? loadProfile(user) : emptyProfile;
  }, [loadProfile]);

  const startSession = useCallback(
    async (tokens: TokenResponse, email?: string) => {
      await api.session.start(tokens);
      applySession({ user: { id: tokens.user.id, email: email ?? null } });
      return loadProfile(tokens.user);
    },
    [applySession, loadProfile],
  );

  const signOut = useCallback(async () => {
    const id = sessionRef.current?.user.id;
    if (id) {
      try {
        window.localStorage.removeItem(profileKey(id));
      } catch {
        /* ignore */
      }
    }
    clear();
    await api.session.signOut();
  }, [clear]);

  const switchMode = useCallback(
    async (mode: AppMode) => {
      const current = sessionRef.current;
      if (!current) return;
      if (profileRef.current.role !== "professional" && mode === "professional") return;
      writeStored(modeKey(current.user.id), mode);
      applyProfile({ ...profileRef.current, appMode: mode });
    },
    [applyProfile],
  );

  // Before the first paint after hydration: who was signed in last time, read
  // straight from storage (the API client reads it asynchronously). With the
  // user known at once, every cached query paints immediately on a reload
  // instead of waiting a tick for the session. The async check below confirms
  // it, or clears it if the login has ended.
  useLayoutEffect(() => {
    const id = storedSessionUserId();
    if (!id || sessionRef.current) return;
    const cached = readCachedProfile(id);
    applySession({ user: { id, email: cached?.email ?? null } });
    if (cached) {
      applyProfile({ ...cached, appMode: modeFor(cached.role, readStored(modeKey(id))) });
      setLoading(false);
    }
  }, [applyProfile, applySession]);

  useEffect(() => {
    let active = true;
    // The API client says when a login ends on its own (refresh refused,
    // account blocked) or changes in another tab.
    const unsubscribe = api.session.subscribe((user, reason) => {
      if (!active) return;
      if (!user) {
        clear();
        setLoading(false);
        return;
      }
      if (reason === "signed_in" && sessionRef.current?.user.id !== user.id) {
        applySession({ user: { id: user.id, email: null } });
        void loadProfile(user).finally(() => {
          if (active) setLoading(false);
        });
      }
    });

    void (async () => {
      let user = await api.session.ready();
      if (!active) return;
      if (!user) {
        const tokens = await exchangeLegacySession();
        if (!active) return;
        if (tokens) {
          await startSession(tokens);
          if (active) setLoading(false);
          return;
        }
        user = null;
      }
      if (!user) {
        // The optimistic session from storage didn't hold up (expired).
        if (sessionRef.current) clear();
        setLoading(false);
        return;
      }
      // Paint the cached profile first (it also works offline), then refresh it.
      const cached = readCachedProfile(user.id);
      applySession({ user: { id: user.id, email: cached?.email ?? null } });
      if (cached) {
        applyProfile({ ...cached, appMode: modeFor(cached.role, readStored(modeKey(user.id))) });
        setLoading(false);
      }
      await loadProfile(user);
      if (active) setLoading(false);
    })().catch((error) => {
      // The site must still open; the log explains why it opened signed out.
      reportError(error, "auth-session");
      if (active) setLoading(false);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [applyProfile, applySession, clear, loadProfile, startSession]);

  const value = useMemo<AuthValue>(() => {
    const signedIn = Boolean(session);
    return {
      session,
      user: session?.user ?? null,
      loading,
      signedIn,
      needsOnboarding: signedIn && !profile.onboardingCompleted,
      refreshProfile,
      startSession,
      switchMode,
      signOut,
      ...profile,
    };
  }, [loading, profile, refreshProfile, session, signOut, startSession, switchMode]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be inside AuthProvider");
  return value;
}

/** Where a freshly signed-in person goes. */
export function homeRoute(profile: ProfileState, next?: string | null) {
  if (!profile.onboardingCompleted) return "/onboarding";
  return next ?? (profile.role === "professional" ? "/studio" : "/home");
}
