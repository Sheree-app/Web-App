"use client";

import { cn } from "@/lib/utils";
import { useEffect, useRef } from "react";

/**
 * Six-digit code entry.
 *
 * Mobile drew six cells over a hidden native input. The web does the same with
 * one real input — which keeps paste, autofill and the numeric keypad working —
 * rendered transparently on top of the cells it drives.
 */
export function OtpField({
  value,
  onChange,
  length = 6,
  invalid,
  autoFocus = true,
  onComplete,
  label = "Verification code",
}: {
  value: string;
  onChange: (next: string) => void;
  length?: number;
  invalid?: boolean;
  autoFocus?: boolean;
  onComplete?: (code: string) => void;
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const update = (raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(0, length);
    onChange(digits);
    if (digits.length === length) onComplete?.(digits);
  };

  return (
    <div className="relative">
      <label htmlFor="otp-input" className="sr-only">
        {label}
      </label>
      <input
        id="otp-input"
        ref={inputRef}
        value={value}
        onChange={(event) => update(event.target.value)}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={length}
        aria-invalid={invalid ? true : undefined}
        className="absolute inset-0 z-10 h-full w-full cursor-text bg-transparent text-transparent caret-transparent outline-none"
      />
      <div className="pointer-events-none flex gap-2">
        {Array.from({ length }, (_, index) => {
          const digit = value[index];
          const active = index === value.length && value.length < length;
          return (
            <span
              key={index}
              className={cn(
                "flex h-16 flex-1 items-center justify-center rounded-field border bg-surface text-section text-ink transition",
                invalid ? "border-danger" : active ? "border-primary" : "border-line",
              )}
            >
              {digit}
              {active ? <span className="ml-0.5 h-6 w-0.5 animate-pulse-soft bg-primary" /> : null}
            </span>
          );
        })}
      </div>
    </div>
  );
}
