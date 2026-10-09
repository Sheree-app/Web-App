"use client";

import { cn } from "@/lib/utils";
import { CircleAlert, CircleCheck, Eye, EyeOff } from "lucide-react";
import { useId, useState, type ComponentProps, type ReactNode } from "react";

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
  className,
}: {
  label?: string;
  hint?: string;
  error?: string;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {label ? (
        <label htmlFor={htmlFor} className="text-caption text-muted">
          {label}
        </label>
      ) : null}
      {children}
      {/* The hint and the error occupy the same slot so nothing jumps. */}
      {error ? (
        <p className="text-caption text-danger">{error}</p>
      ) : hint ? (
        <p className="text-caption text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

const controlStyles =
  "w-full rounded-panel border bg-surface text-body text-ink placeholder:text-muted transition-colors focus:border-primary focus:outline-none disabled:opacity-45";

export function Input({
  label,
  hint,
  error,
  className,
  id,
  ...props
}: ComponentProps<"input"> & { label?: string; hint?: string; error?: string }) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={inputId}>
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        className={cn(
          controlStyles,
          "min-h-[54px] px-4",
          error ? "border-danger" : "border-secondary",
          className,
        )}
        {...props}
      />
    </Field>
  );
}

export function Textarea({
  label,
  hint,
  error,
  className,
  id,
  ...props
}: ComponentProps<"textarea"> & { label?: string; hint?: string; error?: string }) {
  const generatedId = useId();
  const textareaId = id ?? generatedId;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={textareaId}>
      <textarea
        id={textareaId}
        aria-invalid={error ? true : undefined}
        className={cn(
          controlStyles,
          "min-h-32 resize-y px-4 py-3 leading-6",
          error ? "border-danger" : "border-secondary",
          className,
        )}
        {...props}
      />
    </Field>
  );
}

export function Select({
  label,
  hint,
  error,
  className,
  id,
  children,
  ...props
}: ComponentProps<"select"> & { label?: string; hint?: string; error?: string; children: ReactNode }) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={selectId}>
      <select
        id={selectId}
        aria-invalid={error ? true : undefined}
        className={cn(
          controlStyles,
          "min-h-[54px] appearance-none px-4",
          error ? "border-danger" : "border-secondary",
          className,
        )}
        {...props}
      >
        {children}
      </select>
    </Field>
  );
}

export function PasswordInput({
  label,
  hint,
  error,
  className,
  id,
  ...props
}: ComponentProps<"input"> & { label?: string; hint?: string; error?: string }) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const [visible, setVisible] = useState(false);
  return (
    <Field label={label} hint={hint} error={error} htmlFor={inputId}>
      <div className="relative">
        <input
          id={inputId}
          type={visible ? "text" : "password"}
          aria-invalid={error ? true : undefined}
          className={cn(
            controlStyles,
            "min-h-[54px] px-4 pr-14",
            error ? "border-danger" : "border-secondary",
            className,
          )}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? "Hide password" : "Show password"}
          className="absolute inset-y-0 right-0 flex w-14 items-center justify-center text-muted transition hover:text-ink"
        >
          {visible ? (
            <EyeOff aria-hidden className="size-5" />
          ) : (
            <Eye aria-hidden className="size-5" />
          )}
        </button>
      </div>
    </Field>
  );
}

/** Native checkbox restyled to the brand blush, sized for thumbs. */
export function Checkbox({
  label,
  description,
  className,
  id,
  ...props
}: ComponentProps<"input"> & { label: string; description?: string }) {
  const generatedId = useId();
  const checkboxId = id ?? generatedId;
  return (
    <div className={cn("flex items-start gap-3", className)}>
      <input
        id={checkboxId}
        type="checkbox"
        className="mt-0.5 size-6 shrink-0 appearance-none rounded-tile border border-secondary bg-surface transition checked:border-primary checked:bg-primary"
        {...props}
      />
      <label htmlFor={checkboxId} className="flex-1">
        <span className="block text-body text-ink">{label}</span>
        {description ? <span className="block text-caption text-muted">{description}</span> : null}
      </label>
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center justify-between gap-4 py-1",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <span className="flex-1">
        <span className="block text-body text-ink">{label}</span>
        {description ? <span className="block text-caption text-muted">{description}</span> : null}
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className={cn(
          "relative h-8 w-14 shrink-0 rounded-full transition-colors",
          checked ? "bg-primary" : "bg-secondary",
          "after:absolute after:top-1 after:left-1 after:size-6 after:rounded-full after:bg-surface after:transition-transform",
          checked && "after:translate-x-6",
        )}
      />
    </label>
  );
}

export function FormError({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-field bg-danger-surface px-3 py-3 text-caption text-ink"
    >
      <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
      <span>{message}</span>
    </p>
  );
}

export function FormSuccess({ message }: { message: string }) {
  return (
    <p
      role="status"
      className="flex items-start gap-2 rounded-field bg-success-surface px-3 py-3 text-caption text-ink"
    >
      <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
      <span>{message}</span>
    </p>
  );
}
