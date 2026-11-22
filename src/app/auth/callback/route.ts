import { NextResponse, type NextRequest } from "next/server";

/**
 * Landing point for the links the old Supabase emails carried (confirm email,
 * magic link, password recovery). The Sheree API sends six-digit codes
 * instead, so an old link can't be honoured: send people to the screen that
 * gets them the code they need.
 */
export function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const type = searchParams.get("type");
  if (type === "recovery") return NextResponse.redirect(`${origin}/forgot-password`);
  return NextResponse.redirect(`${origin}/sign-in?error=link-expired`);
}
