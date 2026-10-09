/**
 * Web stand-in for the app's `AsyncStorage` calls.
 *
 * Every helper is async and swallows storage failures (Safari private mode, full
 * quota, disabled cookies) so feature code keeps the exact shape it had on
 * mobile: `await storageGet(key)` / `await storageSet(key, value)`.
 */

function available() {
  try {
    return typeof window !== "undefined" && Boolean(window.localStorage);
  } catch {
    return false;
  }
}

export async function storageGet(key: string): Promise<string | null> {
  if (!available()) return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export async function storageSet(key: string, value: string): Promise<void> {
  if (!available()) return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* best effort */
  }
}

export async function storageRemove(key: string): Promise<void> {
  if (!available()) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* best effort */
  }
}

export async function storageGetJSON<T>(key: string): Promise<T | null> {
  const raw = await storageGet(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function storageSetJSON(key: string, value: unknown): Promise<void> {
  await storageSet(key, JSON.stringify(value));
}
