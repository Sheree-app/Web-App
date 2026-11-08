import { FEED_SEED_COOKIE, newFeedSeed } from "@/features/feed/rows";
import { env, isSupabaseConfigured } from "@/lib/env";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Next.js 16 renamed Middleware to Proxy; the behaviour is unchanged.
 *
 * Responsibilities:
 *  1. Refresh the Supabase session cookie on every navigation so a long-lived
 *     tab doesn't get signed out mid-session.
 *  2. Optimistic route guards — signed-out people are sent to sign-in, signed-in
 *     people are kept out of the auth screens. The mobile app did this with
 *     `Stack.Protected` guards; here the same rules live in one place.
 *
 * It deliberately does not fetch profile rows — role and onboarding state are
 * resolved by `AuthProvider` on the client, which is where the redirects that
 * depend on them also happen.
 */
const PROTECTED_PREFIXES = [
  "/messages",
  "/bookings",
  "/profile",
  "/bookmarks",
  "/notifications",
  "/settings",
  "/personal-details",
  "/location",
  "/reviews",
  "/become-professional",
  "/booking",
  "/review",
  "/reschedule",
  "/dispute",
  "/studio",
  "/onboarding",
  "/mode-transition",
];

const AUTH_ROUTES = ["/sign-in", "/sign-up", "/forgot-password"];

function matches(pathname: string, prefixes: string[]) {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** A year: the shuffle should stay put for as long as someone keeps visiting. */
const FEED_SEED_MAX_AGE = 60 * 60 * 24 * 365;

export async function proxy(request: NextRequest) {
  // The feed's shuffle seed. Set on the request too, so a first visit's server
  // render already uses the seed the browser will keep using.
  const newSeed = request.cookies.get(FEED_SEED_COOKIE) ? null : newFeedSeed();
  if (newSeed) request.cookies.set(FEED_SEED_COOKIE, newSeed);
  const withSeed = <T extends NextResponse>(res: T): T => {
    if (newSeed) {
      res.cookies.set(FEED_SEED_COOKIE, newSeed, {
        path: "/",
        maxAge: FEED_SEED_MAX_AGE,
        sameSite: "lax",
        secure: request.nextUrl.protocol === "https:",
        // Read by the browser's feed client as well, so not httpOnly. It's a
        // shuffle seed, not a credential.
        httpOnly: false,
      });
    }
    return res;
  };

  let response = NextResponse.next({ request });

  if (!isSupabaseConfigured) return withSeed(response);

  const supabase = createServerClient(
    env.supabaseUrl,
    env.supabaseAnonKey,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet, headers) => {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
          // Auth responses must never be cached by a CDN or proxy.
          for (const [key, value] of Object.entries(headers ?? {})) {
            response.headers.set(key, value);
          }
        },
      },
    },
  );

  // Must run before the response is committed so refreshed cookies can be written.
  //
  // `getClaims()` rather than `getUser()`: the project signs access tokens with
  // an asymmetric key (ES256), so the token is verified locally against the
  // cached JWKS instead of a round trip to Supabase Auth on every request. It
  // still refreshes an expired session (and writes the cookies) first, and on a
  // project with a symmetric key it falls back to `getUser()` by itself. These
  // guards are optimistic either way; data access is enforced by RLS.
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims?.sub ? data.claims : null;

  const pathname = request.nextUrl.pathname;

  if (!user && matches(pathname, PROTECTED_PREFIXES)) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.search = `?next=${encodeURIComponent(pathname)}`;
    return withSeed(NextResponse.redirect(url));
  }

  if (user && AUTH_ROUTES.includes(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/home";
    url.search = "";
    return withSeed(NextResponse.redirect(url));
  }

  return withSeed(response);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|images/|favicon.ico|manifest.webmanifest|\\.well-known/|apple-app-site-association|.*\\.(?:png|jpg|jpeg|gif|svg|webp|avif|ico|woff|woff2)$).*)",
  ],
};
