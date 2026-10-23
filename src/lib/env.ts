/**
 * Single source of truth for public configuration.
 *
 * `next.config.ts` re-exports the mobile app's `EXPO_PUBLIC_*` variables under
 * these `NEXT_PUBLIC_*` names, so the ported code only ever reads one set of
 * keys and the app still boots (in a degraded, "not configured" state) when a
 * key is missing.
 */
function read(value: string | undefined, fallback = "") {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

export const env = {
  // Resolve both names here as well as in next.config.ts. Server components
  // and browser bundles can evaluate this module through different pipelines;
  // falling back directly to the existing Expo names prevents a placeholder
  // Supabase client when NEXT_PUBLIC_* has not been materialized yet.
  convexUrl: read(process.env.NEXT_PUBLIC_CONVEX_URL || process.env.EXPO_PUBLIC_CONVEX_URL),
  supabaseUrl: read(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL),
  supabaseAnonKey: read(
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.EXPO_PUBLIC_SUPABASE_KEY,
  ),
  paystackPublicKey: read(
    process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY || process.env.EXPO_PUBLIC_PAYSTACK_PUBLIC_KEY,
  ),
  /**
   * Public half of the VAPID key pair used for Web Push. The private half lives
   * only in the `notification-worker` function's secrets. Empty disables push.
   */
  vapidPublicKey: read(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY),
  mediaStorageProvider: read(
    process.env.NEXT_PUBLIC_MEDIA_STORAGE_PROVIDER || process.env.EXPO_PUBLIC_MEDIA_STORAGE_PROVIDER,
  ),
  r2PublicBaseUrl: read(
    process.env.NEXT_PUBLIC_R2_PUBLIC_BASE_URL || process.env.EXPO_PUBLIC_R2_PUBLIC_BASE_URL,
  ),
  siteUrl: read(process.env.NEXT_PUBLIC_SITE_URL || process.env.EXPO_PUBLIC_SITE_URL, "http://localhost:3000"),
} as const;

export const isSupabaseConfigured = Boolean(env.supabaseUrl && env.supabaseAnonKey);
