"use client";

import { Button } from "@/components/ui";
import { userMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { useToast } from "@/providers/toast-provider";
import { ArrowLeft, CirclePlus } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { AmountField } from "./AmountField";
import { addSpendEntry } from "./api";
import { SPEND_CATEGORIES } from "./categories";
import { dayOfMonth, parseAmount, pickableDays, todayDay, weekdayShort } from "./format";
import { useBackTo } from "./navigation";

/**
 * "Add a spend", a page of its own (`/spend/add?month=YYYY-MM`) as in the app:
 * amount, what it was for, which day, and an optional note. Beauty spend
 * reloads when she comes back.
 */
export function AddSpendScreen({ month }: { month: string }) {
  const back = useBackTo(`/spend?month=${month}`);
  const { error: showError, success } = useToast();
  const days = useMemo(() => pickableDays(month), [month]);
  const today = todayDay();
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [day, setDay] = useState(days[0] ?? today);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const value = parseAmount(amount);
  const ready = value !== null && category !== null && !saving;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready || value === null || !category) return;
    setSaving(true);
    try {
      await addSpendEntry({ category, amount: value, spent_on: day, note: note.trim() || null });
      success("Added to your month");
      back();
    } catch (error) {
      showError("Spend not added", userMessage(error, "We couldn't add that. Please try again.", "spend.add"));
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="flex flex-col px-4 pt-2 pb-12 md:px-0">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label="Go back"
          onClick={back}
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface text-ink transition hover:bg-tint"
        >
          <ArrowLeft aria-hidden className="size-5" />
        </button>
        <h1 className="text-[27px] leading-[35px] font-bold text-ink">Add a spend</h1>
      </div>

      <p className="mt-4 text-title font-bold text-ink">What did you treat yourself to?</p>

      <AmountField
        value={amount}
        onChange={setAmount}
        label="Amount in Ghana cedis"
        autoFocus
        className="my-4"
      />

      <fieldset className="mt-2">
        <legend className="mb-2 text-eyebrow text-muted uppercase">Category</legend>
        <div className="flex flex-wrap gap-2">
          {SPEND_CATEGORIES.map((c) => {
            const on = category === c.slug;
            const Icon = c.icon;
            return (
              <button
                key={c.slug}
                type="button"
                aria-pressed={on}
                onClick={() => setCategory(c.slug)}
                style={on ? { backgroundColor: c.color, borderColor: c.color } : undefined}
                className={cn(
                  "flex h-[38px] items-center gap-1.5 rounded-full border px-3 text-[13px] transition",
                  on ? "font-bold text-white" : "border-line bg-surface font-medium text-ink hover:bg-tint",
                )}
              >
                <Icon aria-hidden className="size-4" style={on ? undefined : { color: c.color }} />
                {c.name}
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="mt-6">
        <legend className="mb-2 text-eyebrow text-muted uppercase">When</legend>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2 max-md:no-scrollbar md:mx-0 md:px-0 md:[scrollbar-width:thin]">
          {days.map((d) => {
            const on = d === day;
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                aria-label={d}
                onClick={() => setDay(d)}
                className={cn(
                  "flex h-16 w-14 shrink-0 flex-col items-center justify-center gap-0.5 rounded-[18px] border transition",
                  on ? "border-ink bg-ink text-surface" : "border-line bg-surface hover:bg-tint",
                )}
              >
                <span className={cn("text-[11px] leading-4 font-medium", on ? "text-surface" : "text-muted")}>
                  {d === today ? "Today" : weekdayShort(d)}
                </span>
                <span className={cn("text-[18px] leading-6 font-bold", on ? "text-surface" : "text-ink")}>
                  {dayOfMonth(d)}
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <label className="mt-6 flex flex-col">
        <span className="mb-2 text-eyebrow text-muted uppercase">Note (optional)</span>
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="e.g. Lash refill at Glam Studio"
          maxLength={80}
          className="h-[50px] rounded-field border border-line bg-surface px-4 text-body text-ink outline-none transition focus:border-primary"
        />
      </label>

      <Button
        type="submit"
        size="lg"
        disabled={!ready}
        loading={saving}
        className="mt-8 rounded-full font-bold"
      >
        {saving ? null : <CirclePlus aria-hidden className="size-5" />}
        Add to my month
      </Button>
    </form>
  );
}
