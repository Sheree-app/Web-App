import type { NextConfig } from "next";

/**
 * The mobile app's environment was named for Expo (`EXPO_PUBLIC_*`). Rather than
 * ask for a second set of secrets, the web build re-exports the same values under
 * the `NEXT_PUBLIC_` names the browser needs. Anything already named
 * `NEXT_PUBLIC_*` wins, so the app can be migrated to the web-native names later
 * without touching this file.
 */
const env = {
  NEXT_PUBLIC_CONVEX_URL: (process.env.NEXT_PUBLIC_CONVEX_URL || process.env.EXPO_PUBLIC_CONVEX_URL || "").trim(),
  NEXT_PUBLIC_SUPABASE_URL:
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? "",
  NEXT_PUBLIC_SUPABASE_ANON_KEY:
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.EXPO_PUBLIC_SUPABASE_KEY ??
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
    "",
  NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY:
    process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY ?? process.env.EXPO_PUBLIC_PAYSTACK_PUBLIC_KEY ?? "",
  // Web Push: the public VAPID key is safe in the bundle; the private half is a
  // function secret. Accepts either the web-native or the Expo-prefixed name.
  NEXT_PUBLIC_VAPID_PUBLIC_KEY:
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ??
    process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY ??
    process.env.VAPID_PUBLIC_KEY ??
    "",
  NEXT_PUBLIC_MEDIA_STORAGE_PROVIDER:
    process.env.NEXT_PUBLIC_MEDIA_STORAGE_PROVIDER ??
    process.env.EXPO_PUBLIC_MEDIA_STORAGE_PROVIDER ??
    "",
  NEXT_PUBLIC_R2_PUBLIC_BASE_URL:
    process.env.NEXT_PUBLIC_R2_PUBLIC_BASE_URL ?? process.env.EXPO_PUBLIC_R2_PUBLIC_BASE_URL ?? "",
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL ?? process.env.EXPO_PUBLIC_SITE_URL ?? "",
};

const r2Host = (() => {
  try {
    return env.NEXT_PUBLIC_R2_PUBLIC_BASE_URL
      ? new URL(env.NEXT_PUBLIC_R2_PUBLIC_BASE_URL).hostname
      : null;
  } catch {
    return null;
  }
})();

const nextConfig: NextConfig = {
  env,
  async headers() {
    const associationHeaders = [
      { key: "Content-Type", value: "application/json; charset=utf-8" },
      {
        key: "Cache-Control",
        value: "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
      },
    ];

    return [
      { source: "/.well-known/apple-app-site-association", headers: associationHeaders },
      { source: "/apple-app-site-association", headers: associationHeaders },
      { source: "/.well-known/assetlinks.json", headers: associationHeaders },
    ];
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co" },
      { protocol: "https", hostname: "*.supabase.in" },
      { protocol: "https", hostname: "*.r2.dev" },
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "cdn.sheree.world" },
      ...(r2Host ? [{ protocol: "https" as const, hostname: r2Host }] : []),
    ],
  },
  // The ported mobile source is kept for reference and is not part of the build.
  outputFileTracingExcludes: {
    "*": ["./mobile/**"],
  },
};

export default nextConfig;
