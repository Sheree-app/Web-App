"use client";

import { cn } from "@/lib/utils";
import { useEffect, useRef } from "react";

/** The big "GH₵ 0" field shared by Add a spend and the budget sheet. */
export function AmountField({
  value,
  onChange,
  label,
  autoFocus,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Accessible name, e.g. "Amount in Ghana cedis". */
  label: string;
  autoFocus?: boolean;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  // Focused a frame after mount rather than with `autoFocus`: a Sheet moves
  // focus to its panel when it opens, which would otherwise win.
  useEffect(() => {
    if (!autoFocus) return;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [autoFocus]);

  return (
    <label
      className={cn(
        "flex cursor-text items-center justify-center gap-1.5 rounded-panel bg-tint px-4 py-3 transition focus-within:ring-2 focus-within:ring-primary/60",
        className,
      )}
    >
      <span aria-hidden className="text-[22px] leading-7 font-bold text-primary">
        GH₵
      </span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/[^0-9.,]/g, ""))}
        placeholder="0"
        inputMode="decimal"
        autoComplete="off"
        ref={inputRef}
        maxLength={10}
        aria-label={label}
        size={Math.max(value.length, 1) + 1}
        className="min-w-20 max-w-full bg-transparent py-0 text-[44px]! leading-[54px] font-bold text-ink outline-none placeholder:text-line"
      />
    </label>
  );
}
