import { Wordmark } from "@/components/brand/wordmark";
import Link from "next/link";
import type { ReactNode } from "react";

const LINKS = [
  { href: "/terms", label: "Terms of Service" },
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/account-deletion", label: "Delete your account" },
] as const;

/**
 * The frame around the public legal pages (`/terms`, `/privacy`). They sit
 * outside the app shell so they render the same signed in or out, and the
 * page bodies keep the marketing site's `legal-*` markup, styled in
 * `globals.css`, so the copy can be pasted across unchanged.
 */
export function LegalShell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-dvh bg-background">
      <div className="mx-auto flex w-full max-w-3xl flex-col px-4 pt-safe pb-16 sm:px-6">
        <header className="flex min-h-16 items-center justify-between gap-4 pt-3">
          <Link href="/" aria-label="Sheree home">
            <Wordmark size="md" />
          </Link>
          <Link
            href="/home"
            className="rounded-full border border-line bg-surface px-4 py-2 text-caption font-bold text-ink transition hover:bg-tint"
          >
            Open Sheree
          </Link>
        </header>

        {children}

        <footer className="mt-12 flex flex-col gap-3 border-t border-line pt-6 text-caption text-muted">
          <nav aria-label="Legal" className="flex flex-wrap gap-x-5 gap-y-2">
            {LINKS.map((link) => (
              <Link key={link.href} href={link.href} className="font-bold text-ink transition hover:text-primary">
                {link.label}
              </Link>
            ))}
          </nav>
          <p>© {new Date().getFullYear()} Sheree · Accra, Ghana</p>
        </footer>
      </div>
    </main>
  );
}
