"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type AppearancePreference = "system" | "light" | "dark";

const STORAGE_KEY = "sheree:appearance";

type ThemeValue = {
  isDark: boolean;
  preference: AppearancePreference;
  setPreference: (value: AppearancePreference) => void;
  ready: boolean;
};

const ThemeContext = createContext<ThemeValue | undefined>(undefined);

function resolveIsDark(preference: AppearancePreference, prefersDark: boolean) {
  return preference === "system" ? prefersDark : preference === "dark";
}

function applyScheme(isDark: boolean) {
  const root = document.documentElement;
  root.classList.toggle("dark", isDark);
  // Matches the native app's status bar treatment so mobile browser chrome
  // blends with the page instead of flashing white.
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", isDark ? "#211B20" : "#FCFAF8");
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<AppearancePreference>("light");
  const [isDark, setIsDark] = useState(false);
  const [ready, setReady] = useState(false);

  // The inline boot script in the root layout has already applied the class; this
  // effect only syncs React state with what the DOM is showing.
  //
  // A first-time visitor gets light regardless of their device setting — dark is
  // an explicit choice (or "follow your device", which is also explicit). The
  // boot script applies the identical rule.
  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const next: AppearancePreference =
      stored === "system" || stored === "light" || stored === "dark" ? stored : "light";
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    setPreferenceState(next);
    setIsDark(resolveIsDark(next, prefersDark));
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    applyScheme(isDark);
  }, [isDark, ready]);

  useEffect(() => {
    if (!ready || preference !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) => setIsDark(event.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [preference, ready]);

  const setPreference = useCallback((value: AppearancePreference) => {
    setPreferenceState(value);
    window.localStorage.setItem(STORAGE_KEY, value);
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    setIsDark(resolveIsDark(value, prefersDark));
  }, []);

  const value = useMemo(
    () => ({ isDark, preference, setPreference, ready }),
    [isDark, preference, setPreference, ready],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used within ThemeProvider");
  return value;
}
