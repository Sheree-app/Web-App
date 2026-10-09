import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Landing point for links Supabase emails out: email confirmation, magic links
 * and password recovery.
 *
 * Two shapes arrive here. PKCE links carry `?code=` and must be exchanged for a
 * session. Older links carry `?token_hash=&type=` and are verified directly. Both
 * end up in the same place: a session cookie, then a redirect into the app.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const rawNext = searchParams.get("next");
  // Only ever redirect to a path on this site.
  const next = rawNext && rawNext.startsWith("/") ? rawNext : null;

  try {
    const supabase = await createSupabaseServerClient();

    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        return NextResponse.redirect(`${origin}/sign-in?error=link-expired`);
      }
    } else if (tokenHash && type) {
      const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
      if (error) {
        return NextResponse.redirect(`${origin}/sign-in?error=link-expired`);
      }
    } else {
      return NextResponse.redirect(`${origin}/sign-in`);
    }
  } catch {
    return NextResponse.redirect(`${origin}/sign-in?error=link-expired`);
  }

  if (type === "recovery") {
    // The reset screen needs the session to change the password.
    return NextResponse.redirect(`${origin}/reset-password`);
  }

  return NextResponse.redirect(`${origin}${next ?? "/onboarding"}`);
}
