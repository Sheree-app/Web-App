import { cn } from "@/lib/utils";
import Link from "next/link";

/**
 * The public legal pages. One list so every footer, the legal shell and the
 * help page link to the same URLs (the mobile app links to `/privacy` and
 * `/terms` on the site, so those paths are the canonical ones).
 */
export const LEGAL_LINKS = [
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/terms", label: "Terms of Service" },
  { href: "/account-deletion", label: "Delete your account" },
] as const;

/**
 * A small, always-rendered legal footer for the app and auth frames, so the
 * privacy policy is reachable from every screen without signing in.
 */
export function LegalFooter({ className }: { className?: string }) {
  return (
    <footer className={cn("flex flex-col gap-2 text-caption text-muted", className)}>
      <nav aria-label="Legal" className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {LEGAL_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="font-medium text-ink underline decoration-line underline-offset-4 transition hover:text-primary hover:decoration-primary"
          >
            {link.label}
          </Link>
        ))}
        <a
          href="mailto:support@sheree.app?subject=Sheree%20support"
          className="font-medium text-ink underline decoration-line underline-offset-4 transition hover:text-primary hover:decoration-primary"
        >
          Contact support
        </a>
      </nav>
      <p>© {new Date().getFullYear()} Sheree · Accra, Ghana</p>
    </footer>
  );
}
