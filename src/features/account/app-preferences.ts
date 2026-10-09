import { storageGet, storageSet } from "@/lib/storage";
import type { AppearancePreference } from "@/providers/theme-provider";

export type { AppearancePreference } from "@/providers/theme-provider";

/**
 * Appearance preference, read and written through the same key the mobile app
 * used. `Appearance.setColorScheme` has no web equivalent — the theme provider
 * applies the `dark` class instead — so these helpers are now pure storage.
 */
const appearanceKey = "sheree:appearance";

export async function getAppearancePreference(): Promise<AppearancePreference> {
  const value = await storageGet(appearanceKey);
  return value === "light" || value === "dark" ? value : "system";
}

export async function setAppearancePreference(value: AppearancePreference) {
  await storageSet(appearanceKey, value);
}
