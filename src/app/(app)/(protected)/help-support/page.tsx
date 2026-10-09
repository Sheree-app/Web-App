import { ButtonLink } from "@/components/ui";
import { ArrowLeft, Minus, Plus } from "lucide-react";
import Image from "next/image";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Help & support",
  description: "How bookings, changes and saved looks work — and how to reach us.",
};

const FAQS = [
  [
    "How do bookings work?",
    "Choose a service, date and time. Ghana bookings require the listed deposit; bookings in other regions do not.",
  ],
  [
    "Can I change a booking?",
    "Open Bookings and select the appointment. Changes depend on the professional’s policy.",
  ],
  [
    "How do saved looks work?",
    "Tap the bookmark on a Discover post. Your collection stays synced to your account.",
  ],
  [
    "How do I report a problem?",
    "Open Report a problem, choose a category, describe what happened and send it. Our team reviews every report and follows up from there.",
  ],
] as const;

/**
 * Help & support, matching the original: the support card, then the same four
 * questions with their answers behind a disclosure.
 */
export default function HelpSupportPage() {
  return (
    <div className="flex flex-col px-4 pb-12 pt-2">
      <div className="flex items-center gap-3">
        <ButtonLink
          href="/profile"
          variant="ghost"
          size="icon"
          aria-label="Go back"
          className="shrink-0"
        >
          <ArrowLeft aria-hidden className="size-5" />
        </ButtonLink>
        <h1 className="text-[27px] leading-[35px] font-bold text-ink">Help & support</h1>
      </div>

      <section className="mt-8 flex flex-col items-start rounded-card bg-tint p-6">
        <Image
          src="/images/brand/welcome-pattern.webp"
          alt=""
          width={0}
          height={0}
          className="hidden"
        />
        <span aria-hidden className="text-2xl text-primary">
          💬
        </span>
        <h2 className="mt-2 text-section text-ink">How can we help?</h2>
        <p className="mt-1 text-body text-muted">
          Our support team replies Monday–Saturday, 8am–6pm GMT.
        </p>
        <a
          href="mailto:support@sheree.app?subject=Sheree%20support"
          className="mt-4 inline-flex min-h-12 items-center justify-center rounded-full bg-primary px-6 text-body font-medium text-surface"
        >
          Email support
        </a>
      </section>

      <p className="mt-8 mb-1 text-eyebrow text-muted uppercase">Frequently asked</p>

      <ul className="flex flex-col gap-2">
        {FAQS.map(([question, answer]) => (
          <li key={question}>
            <details className="group rounded-panel bg-surface p-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                <span className="text-body font-medium text-ink">{question}</span>
                <Plus aria-hidden className="size-5 shrink-0 text-primary group-open:hidden" />
                <Minus aria-hidden className="hidden size-5 shrink-0 text-primary group-open:block" />
              </summary>
              <p className="mt-2 text-caption text-muted">{answer}</p>
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}
