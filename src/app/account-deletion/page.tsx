import { Wordmark } from "@/components/brand/wordmark";
import type { Metadata } from "next";
import Link from "next/link";
import { DeletionRequestForm } from "./request-form";

/**
 * Public account-deletion page. Google Play requires a URL, reachable without
 * signing in, that explains how to delete a Sheree account and what happens to
 * the data. Keep this route out of `PROTECTED_PREFIXES` in `src/proxy.ts`.
 *
 * The "deleted" and "kept" lists mirror `supabase/functions/account-delete`;
 * update both together.
 */
export const metadata: Metadata = {
  title: "Delete your account",
  description: "How to delete your Sheree account and the personal data connected to it.",
  alternates: { canonical: "/account-deletion" },
};

const steps = [
  {
    title: "Send your request",
    body: "Delete the account from the app, or complete the form below using the email address on your Sheree account.",
  },
  {
    title: "Confirm it’s you",
    body: "For requests sent by email, we may contact you to verify your identity before making any changes.",
  },
  {
    title: "We close the account",
    body: "We confirm when the request is complete, or explain if we must retain limited records.",
  },
];

const deleted = [
  "Your sign-in account, email address and password",
  "Your name, username, profile photo and phone number",
  "Saved collections, bookmarks and interests",
  "Notifications and push-notification tokens",
  "Uploaded photos, portfolio media and verification documents",
  "For professionals: your business details, bio, address, social links, and your posts and services are removed from Sheree",
];

const kept = [
  "Booking and payment records, where we must keep them for tax, accounting or dispute purposes",
  "Records needed for safety, fraud prevention or to meet a legal obligation",
  "Messages and reviews you left for other people may remain, shown as from “Deleted user”",
];

export default function AccountDeletionPage() {
  return (
    <main className="min-h-dvh bg-background">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 pt-safe pb-16 sm:px-6">
        <header className="flex min-h-16 items-center pt-3">
          <Link href="/" aria-label="Sheree home">
            <Wordmark size="md" />
          </Link>
        </header>

        <div className="grid gap-10 lg:grid-cols-[1fr_minmax(0,440px)] lg:gap-16">
          <section className="flex flex-col gap-8">
            <div className="flex flex-col gap-3">
              <p className="text-eyebrow text-primary uppercase">Privacy request</p>
              <h1 className="text-page text-ink sm:text-hero">Delete your Sheree account</h1>
              <p className="max-w-prose text-body text-muted">
                You can permanently delete your Sheree account and the personal data connected to it at any time,
                whether you use Sheree as a customer or a beauty professional.
              </p>
            </div>

            <ol className="flex flex-col gap-4" aria-label="What happens next">
              {steps.map((step, index) => (
                <li key={step.title} className="flex gap-4 rounded-panel bg-surface p-4">
                  <span className="text-title text-primary tabular-nums">{String(index + 1).padStart(2, "0")}</span>
                  <div className="flex flex-col gap-1">
                    <h2 className="text-title text-ink">{step.title}</h2>
                    <p className="text-caption text-muted">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>

            <div className="flex flex-col gap-3">
              <h2 className="text-section text-ink">Delete it yourself in the app</h2>
              <p className="text-body text-muted">
                Signed in? Go to <strong className="font-medium text-ink">Profile → Settings → Delete account</strong>,
                type <strong className="font-medium text-ink">DELETE</strong> and confirm. Your account is deleted
                straight away.
              </p>
              <Link href="/settings" className="self-start text-body font-medium text-primary underline-offset-4 hover:underline">
                Open settings
              </Link>
            </div>

            <div className="grid gap-6 sm:grid-cols-2">
              <div className="flex flex-col gap-3">
                <h2 className="text-title text-ink">What we delete</h2>
                <ul className="flex list-disc flex-col gap-2 pl-5 text-caption text-muted">
                  {deleted.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div className="flex flex-col gap-3">
                <h2 className="text-title text-ink">What we may keep</h2>
                <ul className="flex list-disc flex-col gap-2 pl-5 text-caption text-muted">
                  {kept.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <p className="text-caption text-muted">
                  We keep these records only for as long as the law requires, then delete them.
                </p>
              </div>
            </div>
          </section>

          <section className="flex flex-col gap-4 self-start rounded-card border border-line bg-surface p-5 shadow-card sm:p-8">
            <div className="flex flex-col gap-2">
              <p className="text-eyebrow text-primary uppercase">Can’t sign in?</p>
              <h2 className="text-section text-ink">Request deletion by email</h2>
              <p className="text-caption text-muted">
                Enter enough information for us to find and verify your account. Do not include passwords or payment
                details.
              </p>
            </div>
            <DeletionRequestForm />
            <p className="text-caption text-muted">
              This form prepares an email on your device. Nothing you enter here is stored on this website.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
