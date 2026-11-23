import { FEED_SEED_COOKIE, newFeedSeed } from "@/features/feed/rows";
import { SIGNED_IN_COOKIE } from "@/lib/api/browser-token-store";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Next.js 16 renamed Middleware to Proxy; the behaviour is unchanged.
 *
 * Responsibilities:
 *  1. Optimistic route guards — signed-out people are sent to sign-in, signed-in
 *     people are kept out of the auth screens. The mobile app did this with
 *     `Stack.Protected` guards; here the same rules live in one place.
 *
 * The login itself lives in the browser (`src/lib/api`), so the proxy only sees
 * a hint cookie the API client keeps in step with it, plus the old Supabase
 * auth cookie: someone still holding that is let through so `AuthProvider` can
 * move their login to the API without asking them to sign in again.
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
  "/menu",
  "/beauticians",
  "/change-password",
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
  "/spend",
  "/looks",
  "/upkeep",
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

  const response = NextResponse.next({ request });
  const apiLogin = request.cookies.get(SIGNED_IN_COOKIE)?.value === "1";
  // A legacy cookie only opens protected pages (where the move happens). It
  // never bounces anyone off /sign-in: if the move fails, signing in must work.
  const legacyLogin = request.cookies
    .getAll()
    .some(({ name }) => /^sb-.+-auth-token(\.\d+)?$/.test(name));
  const user = apiLogin || legacyLogin;

  const pathname = request.nextUrl.pathname;

  if (!user && matches(pathname, PROTECTED_PREFIXES)) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.search = `?next=${encodeURIComponent(pathname)}`;
    return withSeed(NextResponse.redirect(url));
  }

  if (apiLogin && AUTH_ROUTES.includes(pathname)) {
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
