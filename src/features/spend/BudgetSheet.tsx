"use client";

import { Button, Sheet } from "@/components/ui";
import { userMessage } from "@/lib/errors";
import { useToast } from "@/providers/toast-provider";
import { useState, type FormEvent } from "react";
import { AmountField } from "./AmountField";
import { setSpendBudget } from "./api";
import { parseAmount } from "./format";

/** Sets or clears the monthly beauty budget. */
export function BudgetSheet({
  open,
  budget,
  onClose,
  onSaved,
}: {
  open: boolean;
  budget: number | null;
  onClose: () => void;
  onSaved: (budget: number | null) => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Monthly budget">
      {/* Mounted only while open, so it starts from the saved budget each time. */}
      {open ? <BudgetForm budget={budget} onClose={onClose} onSaved={onSaved} /> : null}
    </Sheet>
  );
}

function BudgetForm({
  budget,
  onClose,
  onSaved,
}: {
  budget: number | null;
  onClose: () => void;
  onSaved: (budget: number | null) => void;
}) {
  const { error: showError } = useToast();
  const [text, setText] = useState(budget ? String(budget) : "");
  const [saving, setSaving] = useState<"save" | "remove" | null>(null);
  const value = parseAmount(text);

  const save = async (amount: number | null) => {
    if (saving) return;
    setSaving(amount === null ? "remove" : "save");
    try {
      const result = await setSpendBudget(amount);
      onSaved(result.budget);
      onClose();
    } catch (error) {
      showError(
        "Budget not saved",
        userMessage(error, "We couldn't save your budget. Please try again.", "spend.budget"),
      );
    } finally {
      setSaving(null);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (value !== null) void save(value);
  };

  return (
    <form onSubmit={submit} className="flex flex-col">
      <p className="text-title font-bold text-ink">How much do you want to spend on beauty each month?</p>
      <AmountField
        value={text}
        onChange={setText}
        label="Monthly budget in Ghana cedis"
        autoFocus
        className="mt-4"
      />
      <p className="mt-2 text-center text-caption text-muted">We’ll show how much you have left as you go.</p>
      <Button
        type="submit"
        size="lg"
        className="mt-6 rounded-full font-bold"
        disabled={value === null || saving !== null}
        loading={saving === "save"}
      >
        Save budget
      </Button>
      {budget ? (
        <button
          type="button"
          disabled={saving !== null}
          onClick={() => void save(null)}
          className="mt-2 self-center rounded-full px-4 py-3 text-caption font-bold text-danger transition hover:bg-danger-surface disabled:opacity-50"
        >
          {saving === "remove" ? "Removing…" : "Remove budget"}
        </button>
      ) : null}
    </form>
  );
}
