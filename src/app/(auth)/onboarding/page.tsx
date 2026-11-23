"use client";

import { schedulePayload } from "@/features/calendar/api";
import { CircleCheck } from "lucide-react";
import {
  BudgetStep,
  LooksStep,
  RoutineStep,
  saveCustomerSetup,
  setupSummary,
  type Routine,
} from "@/features/onboarding/CustomerSetupSteps";
import { Button, Checkbox, FormError, Input, Spinner, Textarea } from "@/components/ui";
import { categoryImage } from "@/features/explore/category-images";
import { fetchExploreCategories } from "@/features/explore/api";
import type { Category } from "@/features/explore/data";
import { api } from "@/lib/api";
import { userMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/auth-provider";
import { useToast } from "@/providers/toast-provider";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type Role = "customer" | "professional";
type Step =
  | "role"
  | "category"
  | "routine"
  | "budget"
  | "looks"
  | "identity"
  | "story"
  | "service"
  | "hours"
  | "socials"
  | "done";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const DAY_NUMBERS: Record<(typeof DAYS)[number], number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** The wizard's own words, taken from the app. */
const TITLES: Record<Step, string> = {
  role: "How would you like to use Sheree?",
  category: "What do you create?",
  routine: "What do you keep up with?",
  budget: "What’s your monthly beauty budget?",
  looks: "Start your look diary",
  identity: "Name your corner of Sheree",
  story: "Let clients get to know you",
  service: "How do you work?",
  hours: "Which days do you usually work?",
  socials: "Bring your audience with you",
  done: "You’re ready for Sheree",
};

const SUBTITLES: Record<Step, string> = {
  role: "Choose the experience that fits what you’re here to do.",
  category: "Choose every category that reflects your work.",
  routine: "Pick what you get done regularly and we’ll remind you before it’s due.",
  budget: "We’ll keep track as you go, so the end of the month is never a surprise.",
  looks: "A private diary of every look you love. Only you can see it.",
  identity: "This is the first impression clients will see.",
  story: "The details that turn a profile into a place clients trust.",
  service: "Set clear expectations before a client books.",
  hours: "A few quick answers and we’ll build your bookable week for you.",
  socials: "Make it easy for existing clients to find you here.",
  done: "",
};

const PROFESSIONAL_STEPS: Step[] = [
  "category",
  "identity",
  "story",
  "service",
  "hours",
  "socials",
  "done",
];

/** Customers pick what they love, then three skippable steps that set up the Me page. */
const CUSTOMER_STEPS: Step[] = ["category", "routine", "budget", "looks", "done"];

/**
 * Onboarding, rebuilt from the app's wizard: the same role cards, the same step
 * titles and subtitles, and the same two different journeys — customers pick
 * their lookbook, professionals build a bookable business.
 */
export default function OnboardingPage() {
  const router = useRouter();
  const { refreshProfile, switchMode } = useAuth();
  const { error: showError } = useToast();

  const [role, setRole] = useState<Role | null>(null);
  const [step, setStep] = useState<Step>("role");
  const [categories, setCategories] = useState<Category[]>([]);
  const [selected, setSelected] = useState<string[]>([]);

  const [business, setBusiness] = useState("");
  const [display, setDisplay] = useState("");
  const [phone, setPhone] = useState("");
  const [bio, setBio] = useState("");
  const [deposit, setDeposit] = useState("50");
  const [noDeposit, setNoDeposit] = useState(false);
  const [openDays, setOpenDays] = useState<string[]>(["Mon", "Tue", "Wed", "Thu", "Fri"]);
  const [opensAt, setOpensAt] = useState("09:00");
  const [closesAt, setClosesAt] = useState("18:00");
  const [instagram, setInstagram] = useState("");
  const [tiktok, setTikTok] = useState("");

  const [routine, setRoutine] = useState<Routine>({});
  const [budget, setBudget] = useState<number | null>(null);
  const [budgetText, setBudgetText] = useState("");
  const [firstLook, setFirstLook] = useState(false);
  const [customerSummary, setCustomerSummary] = useState<string[]>([]);

  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void fetchExploreCategories()
      .then(setCategories)
      .catch(() => setCategories([]));
  }, []);

  const steps = role === "professional" ? PROFESSIONAL_STEPS : CUSTOMER_STEPS;
  const index = Math.max(0, steps.indexOf(step));
  const progress = Math.max(12, ((index + 1) / steps.length) * 88);

  const toggleCategory = (slug: string) => {
    setError("");
    setSelected((current) =>
      current.includes(slug) ? current.filter((item) => item !== slug) : [...current, slug],
    );
  };

  const advance = (next: Step) => {
    setError("");
    setStep(next);
  };

  const next = () => {
    if (step === "role") {
      if (!role) {
        setError("Choose the experience that fits what you’re here to do.");
        return;
      }
      advance(role === "professional" ? "category" : "category");
      return;
    }

    if (step === "category") {
      if (selected.length === 0) {
        setError(
          role === "professional"
            ? "Choose every category that reflects your work."
            : "Pick at least one thing you love.",
        );
        return;
      }
      advance(role === "professional" ? "identity" : "routine");
      return;
    }

    if (step === "routine") {
      advance("budget");
      return;
    }

    if (step === "budget") {
      advance("looks");
      return;
    }

    if (step === "identity") {
      if (business.trim().length < 2) {
        setError("Give your business a name clients will recognise.");
        return;
      }
      advance("story");
      return;
    }

    if (step === "story") {
      advance("service");
      return;
    }

    if (step === "service") {
      advance("hours");
      return;
    }

    if (step === "hours") {
      if (openDays.length === 0) {
        setError("Pick at least one day you usually work.");
        return;
      }
      // "HH:MM" compares correctly as text.
      if (!(closesAt > opensAt)) {
        setError("Your closing time needs to be after your opening time.");
        return;
      }
      advance("socials");
      return;
    }

    void finish();
  };

  const back = () => {
    setError("");
    if (step === "role") {
      router.back();
      return;
    }
    const previous = steps[Math.max(0, index - 1)];
    setStep(previous === "category" && role === "customer" ? "role" : previous);
  };

  const finish = async (wantsFirstLook = false) => {
    if (!role) return;

    setSaving(true);
    setError("");

    const trimmedPhone = phone.trim();
    if (trimmedPhone && !/^[\d\s+()-]{6,20}$/.test(trimmedPhone)) {
      setSaving(false);
      setError("Enter a valid phone number, or leave it empty.");
      return;
    }

    try {
      if (role === "customer") {
        // The API takes interests by id; the wizard tracks slugs.
        const interestIds = categories
          .filter((category) => selected.includes(category.slug))
          .map((category) => category.id);
        await api.put("/v1/me/interests", { body: { interest_ids: interestIds } });
        await api.post<void>("/v1/onboarding/customer", {
          body: trimmedPhone ? { phone: trimmedPhone } : {},
        });
        // Best effort: the Me page cards let them finish any part later.
        const saved = await saveCustomerSetup({ routine, budget });
        setCustomerSummary(setupSummary(saved, wantsFirstLook));
      } else {
        // TODO(api): the deposit step has no effect any more; the server always
        // applies the platform deposit and `deposit` is not accepted.
        await api.post<void>("/v1/onboarding/professional", {
          body: {
            category_slug: selected[0],
            business_name: business.trim(),
            display_name: display.trim() || business.trim(),
            bio: bio.trim() || null,
            business_address: null,
            offers_mobile: false,
            open_days: openDays.map((day) => DAY_NUMBERS[day as (typeof DAYS)[number]]),
            // TODO(api): the web wizard doesn't ask for a country yet; Sheree
            // only operates in Ghana, which the old RPC also defaulted to.
            country_code: "GH",
            instagram_url: instagram.trim()
              ? `https://instagram.com/${instagram.trim().replace(/^@/, "")}`
              : null,
            tiktok_url: tiktok.trim()
              ? `https://www.tiktok.com/@${tiktok.trim().replace(/^@/, "")}`
              : null,
            phone: trimmedPhone || null,
            location: null,
            // The bookable week from the hours step. The web wizard doesn't ask
            // about breaks, buffers or approval, so the app's defaults apply.
            schedule: schedulePayload({
              preferences: {
                maxAppointmentsPerDay: 6,
                bufferMinutes: 15,
                defaultDurationMinutes: 60,
                approvalMode: "automatic",
              },
              hours: DAYS.map((day) => ({
                dayOfWeek: DAY_NUMBERS[day],
                opensAt,
                closesAt,
                isClosed: !openDays.includes(day),
              })),
              breaks: [],
              blocks: [],
            }),
          },
        });
      }
    } catch (cause) {
      const message = userMessage(cause, "Your setup couldn’t be saved. Please try again.");
      setSaving(false);
      setError(message);
      showError("Setup could not be saved", message);
      return;
    }

    await switchMode(role);
    await refreshProfile();
    setSaving(false);
    // The final screen offers the way in, in the app's own words.
    setStep("done");
  };

  const loadingCategories = categories.length === 0;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[520px] flex-col px-6 pt-safe pb-safe">
      <div className="flex items-center justify-between pt-4">
        <button
          type="button"
          onClick={back}
          className="text-caption font-medium text-muted transition hover:text-ink"
        >
          Back
        </button>
        <span className="wordmark text-[26px] leading-8 text-primary">Sheree</span>
      </div>

      <div className="mt-4 h-1.5 w-full rounded-full bg-secondary" aria-hidden>
        <div className="h-1.5 rounded-full bg-primary" style={{ width: `${progress}%` }} />
      </div>

      {step === "done" ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <span className="flex size-18 items-center justify-center rounded-full bg-success text-surface">
            <span aria-hidden className="text-3xl">
              ✓
            </span>
          </span>
          <p className="text-eyebrow text-primary uppercase">Welcome in</p>
          <h1 className="text-page text-ink">{TITLES.done}</h1>
          {role === "professional" ? (
            <p className="max-w-sm text-body text-muted">
              Your studio is open. Add services, set your hours and post your first look whenever
              you’re ready.
            </p>
          ) : (
            <>
              <p className="max-w-sm text-body text-muted">
                {customerSummary.length > 0
                  ? "Here’s what’s waiting for you on your Me page:"
                  : "Your lookbook is built. Fresh work from professionals you’ll love is waiting."}
              </p>
              {customerSummary.length > 0 ? (
                <ul className="flex flex-col gap-2 text-left">
                  {customerSummary.map((line) => (
                    <li key={line} className="flex items-center gap-2 text-body text-ink">
                      <CircleCheck aria-hidden className="size-[18px] shrink-0 text-primary" />
                      {line}
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          )}
          <Button
            size="lg"
            className="mt-2 min-w-48"
            onClick={() =>
              router.replace(role === "professional" ? "/studio" : firstLook ? "/looks/new" : "/home")
            }
          >
            {role === "professional" ? "Open my studio" : firstLook ? "Add my first look" : "Start browsing"}
          </Button>
        </div>
      ) : (
        <>
          <div className="mt-8 flex flex-col gap-2">
            <p className="text-eyebrow text-primary uppercase">
              {role === "professional" ? "Set up your business" : "Welcome to Sheree"}
            </p>
            <h1 className="text-page text-ink">{TITLES[step]}</h1>
            <p className="max-w-md text-body text-muted">{SUBTITLES[step]}</p>
          </div>

          <div className="mt-6 flex flex-1 flex-col gap-4">
            {step === "role" ? (
              <div className="flex flex-col gap-3">
                <RoleCard
                  kicker="I’m looking for"
                  title="Something beautiful"
                  detail="Discover, save and book trusted professionals."
                  tone="blush"
                  selected={role === "customer"}
                  onPress={() => {
                    setRole("customer");
                    setError("");
                  }}
                />
                <RoleCard
                  kicker="I create"
                  title="Beautiful work"
                  detail="Showcase your craft and grow your business."
                  tone="sage"
                  selected={role === "professional"}
                  onPress={() => {
                    setRole("professional");
                    setError("");
                  }}
                />
              </div>
            ) : null}

            {step === "category" ? (
              loadingCategories ? (
                <div className="flex items-center gap-3 text-caption text-muted">
                  <Spinner label="Loading categories" />
                  Loading categories…
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {categories.map((category) => {
                    const active = selected.includes(category.slug);
                    return (
                      <button
                        key={category.id}
                        type="button"
                        onClick={() => toggleCategory(category.slug)}
                        aria-pressed={active}
                        className={cn(
                          "overflow-hidden rounded-card border-2 bg-surface text-left transition",
                          active ? "border-primary" : "border-transparent shadow-card",
                        )}
                      >
                        <span className="relative block aspect-[1.15]">
                          <Image
                            src={categoryImage(category.slug, category.image)}
                            alt=""
                            fill
                            sizes="45vw"
                            className="object-cover"
                          />
                          {active ? (
                            <span className="absolute top-2 right-2 flex size-6 items-center justify-center rounded-full bg-primary text-surface">
                              ✓
                            </span>
                          ) : null}
                        </span>
                        <span className="block px-3 py-2 text-caption font-medium text-ink">
                          {category.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )
            ) : null}

            {step === "routine" ? <RoutineStep value={routine} onChange={setRoutine} /> : null}
            {step === "budget" ? (
              <BudgetStep
                value={budget}
                custom={budgetText}
                onChange={setBudget}
                onCustomChange={setBudgetText}
              />
            ) : null}
            {step === "looks" ? <LooksStep /> : null}

            {step === "identity" ? (
              <>
                <Input
                  label="Business name"
                  placeholder="e.g. The Curl Room"
                  value={business}
                  onChange={(event) => setBusiness(event.target.value)}
                />
                <Input
                  label="Display name"
                  placeholder="How clients will know you"
                  value={display}
                  onChange={(event) => setDisplay(event.target.value)}
                />
                <Input
                  label="Phone number"
                  inputMode="tel"
                  placeholder="e.g. +233 24 000 0000"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                />
              </>
            ) : null}

            {step === "story" ? (
              <Textarea
                label="Your story"
                placeholder="What you do best, who you usually work with, anything clients should know."
                value={bio}
                onChange={(event) => setBio(event.target.value)}
                className="min-h-40"
              />
            ) : null}

            {step === "service" ? (
              <>
                <Input
                  label="Booking deposit (%)"
                  inputMode="numeric"
                  value={noDeposit ? "0" : deposit}
                  disabled={noDeposit}
                  onChange={(event) =>
                    setDeposit(event.target.value.replace(/[^\d]/g, "").slice(0, 3))
                  }
                  hint="Customers in your region book without paying upfront."
                />
                <Checkbox
                  label="No booking deposit"
                  description="Clients book without paying a deposit first."
                  checked={noDeposit}
                  onChange={(event) => setNoDeposit(event.target.checked)}
                />
              </>
            ) : null}

            {step === "hours" ? (
              <>
                <fieldset className="flex flex-col gap-3">
                  <legend className="text-caption text-muted">Days you usually work</legend>
                  <div className="flex flex-wrap gap-2">
                    {DAYS.map((day) => {
                      const active = openDays.includes(day);
                      return (
                        <button
                          key={day}
                          type="button"
                          aria-pressed={active}
                          onClick={() =>
                            setOpenDays((current) =>
                              current.includes(day)
                                ? current.filter((item) => item !== day)
                                : [...current, day],
                            )
                          }
                          className={cn(
                            "min-w-16 rounded-full px-4 py-2 text-caption transition",
                            active ? "bg-secondary text-ink" : "bg-surface text-muted",
                          )}
                        >
                          {day}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>

                <div className="flex gap-3">
                  <Input
                    label="Start"
                    type="time"
                    value={opensAt}
                    onChange={(event) => setOpensAt(event.target.value)}
                  />
                  <Input
                    label="Finish"
                    type="time"
                    value={closesAt}
                    onChange={(event) => setClosesAt(event.target.value)}
                  />
                </div>
              </>
            ) : null}

            {step === "socials" ? (
              <>
                <Input
                  label="Instagram"
                  placeholder="@yourstudio"
                  autoCapitalize="none"
                  value={instagram}
                  onChange={(event) => setInstagram(event.target.value)}
                />
                <Input
                  label="TikTok"
                  placeholder="@yourstudio"
                  autoCapitalize="none"
                  value={tiktok}
                  onChange={(event) => setTikTok(event.target.value)}
                />
                <p className="text-caption text-muted">
                  You can add more links, and verify your documents, later from your profile.
                </p>
              </>
            ) : null}
          </div>

          <div className="sticky bottom-0 mt-6 flex flex-col gap-3 border-t border-line/60 bg-background/95 py-4 pb-[calc(16px+env(safe-area-inset-bottom))] backdrop-blur-md">
            {error ? <FormError message={error} /> : null}
            {step === "looks" ? (
              <>
                <Button
                  size="lg"
                  loading={saving && firstLook}
                  disabled={saving}
                  onClick={() => {
                    setFirstLook(true);
                    void finish(true);
                  }}
                >
                  Add my first look
                </Button>
                <Button
                  size="lg"
                  variant="ghost"
                  loading={saving && !firstLook}
                  disabled={saving}
                  onClick={() => {
                    setFirstLook(false);
                    void finish(false);
                  }}
                >
                  Maybe later
                </Button>
              </>
            ) : (
              <Button size="lg" loading={saving} onClick={next}>
                {step === "socials" ? "Finish setup" : "Continue"}
              </Button>
            )}
            {step === "routine" || step === "budget" ? (
              <Button
                size="lg"
                variant="ghost"
                disabled={saving}
                onClick={() => {
                  setError("");
                  if (step === "routine") {
                    setRoutine({});
                    setStep("budget");
                  } else {
                    setBudget(null);
                    setBudgetText("");
                    setStep("looks");
                  }
                }}
              >
                Skip
              </Button>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

function RoleCard({
  kicker,
  title,
  detail,
  tone,
  selected,
  onPress,
}: {
  kicker: string;
  title: string;
  detail: string;
  tone: "blush" | "sage";
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      aria-pressed={selected}
      className={cn(
        "flex flex-col items-start gap-1 rounded-card border-2 p-5 text-left transition",
        selected ? "border-primary" : "border-transparent",
      )}
      style={{ backgroundColor: tone === "blush" ? "#F5D6DC" : "#DDE7D9" }}
    >
      <span className="text-eyebrow uppercase">{kicker}</span>
      <span className="text-section text-ink">{title}</span>
      <span className="text-caption text-muted">{detail}</span>
    </button>
  );
}
