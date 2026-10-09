import { AppShell } from "@/components/shell/app-shell";

/**
 * Signed-in (and guest-browsable) frame. The proxy has already bounced anyone
 * without a session away from protected routes; the pages that need an account
 * live under `(app)/(protected)`.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
