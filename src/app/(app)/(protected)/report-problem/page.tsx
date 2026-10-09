"use client";

import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/providers/auth-provider";
import { useToast } from "@/providers/toast-provider";
import { ArrowLeft, Check, Wrench } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** The four categories the report function accepts — they drive triage. */
const CATEGORIES = [
  "Something is broken",
  "Booking or payment",
  "Account or login",
  "Safety concern",
] as const;

/**
 * Report a problem, matching the original: the reassurance note, the category
 * chips, what happened, the steps, and a done screen with the app's own words.
 */
export default function ReportProblemPage() {
  const router = useRouter();
  const { appMode } = useAuth();
  const { error: showError } = useToast();

  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("Something is broken");
  const [details, setDetails] = useState("");
  const [steps, setSteps] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const send = async () => {
    if (details.trim().length < 10) {
      showError("Add a little more detail", "Describe what happened in at least 10 characters.");
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.functions.invoke("report-problem", {
        body: { category, details, steps, appMode, platform: "web" },
      });
      if (error) throw new Error(error.message || "Your report could not be submitted.");
      setSubmitted(true);
    } catch (cause) {
      showError("Report not sent", cause instanceof Error ? cause.message : "Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="flex min-h-[70dvh] flex-col items-center justify-center gap-3 px-6 text-center">
        <span className="flex size-16 items-center justify-center rounded-full bg-success text-surface">
          <Check aria-hidden className="size-8" />
        </span>
        <h1 className="text-page text-ink">Report sent</h1>
        <p className="max-w-sm text-body text-muted">
          Thanks — we’ve received your report. Our team will review it and follow up if we need
          more details.
        </p>
        <button
          type="button"
          onClick={() => router.back()}
          className="mt-2 min-h-[54px] min-w-48 rounded-panel bg-primary text-body font-medium text-surface"
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col px-4 pb-12 pt-2">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label="Go back"
          onClick={() => router.back()}
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface text-ink"
        >
          <ArrowLeft aria-hidden className="size-5" />
        </button>
        <div>
          <p className="text-eyebrow text-primary uppercase">Help us fix it</p>
          <h1 className="text-[27px] leading-[35px] font-bold text-ink">Report a problem</h1>
        </div>
      </div>

      <div className="mt-6 flex items-start gap-3 rounded-card bg-surface p-4">
        <Wrench aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
        <p className="text-caption text-muted">
          Specific details help us understand the problem faster. Don’t include passwords or card
          information.
        </p>
      </div>

      <fieldset className="mt-6 flex flex-col gap-3">
        <legend className="text-caption text-muted">What does this affect?</legend>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((item) => {
            const active = category === item;
            return (
              <button
                key={item}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setCategory(item)}
                className={
                  active
                    ? "rounded-full bg-primary px-4 py-2.5 text-caption font-medium text-surface"
                    : "rounded-full bg-surface px-4 py-2.5 text-caption font-medium text-ink"
                }
              >
                {item}
              </button>
            );
          })}
        </div>
      </fieldset>

      <label className="mt-6 flex flex-col gap-2">
        <span className="text-caption text-muted">What happened?</span>
        <textarea
          value={details}
          onChange={(event) => setDetails(event.target.value.slice(0, 1000))}
          placeholder="Tell us what you expected and what happened instead…"
          className="min-h-32 rounded-panel bg-surface p-4 text-body text-ink outline-none placeholder:text-muted"
        />
        <span className="self-end text-caption text-muted">{details.length}/1000</span>
      </label>

      <label className="mt-4 flex flex-col gap-2">
        <span className="text-caption text-muted">Steps to reproduce (optional)</span>
        <textarea
          value={steps}
          onChange={(event) => setSteps(event.target.value.slice(0, 1000))}
          placeholder="1. Open… 2. Tap… 3. See…"
          className="min-h-28 rounded-panel bg-surface p-4 text-body text-ink outline-none placeholder:text-muted"
        />
      </label>

      <button
        type="button"
        disabled={submitting}
        onClick={() => void send()}
        className="mt-6 min-h-[54px] rounded-panel bg-primary text-body font-medium text-surface disabled:opacity-60"
      >
        {submitting ? "Sending…" : "Send report"}
      </button>
    </div>
  );
}
