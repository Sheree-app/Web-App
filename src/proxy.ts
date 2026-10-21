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

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  if (!isSupabaseConfigured) return response;

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
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  if (!user && matches(pathname, PROTECTED_PREFIXES)) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.search = `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  if (user && AUTH_ROUTES.includes(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/home";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|images/|favicon.ico|manifest.webmanifest|.*\\.(?:png|jpg|jpeg|gif|svg|webp|avif|ico|woff|woff2)$).*)",
  ],
};
