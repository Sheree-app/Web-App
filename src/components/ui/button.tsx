"use client";

import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "outline" | "danger";
export type ButtonSize = "sm" | "md" | "lg" | "icon";

const variantStyles: Record<ButtonVariant, string> = {
  // `text-surface` inverts with the theme (white on blush in light mode, ink on
  // blush in dark) which is exactly how the native button label behaved.
  primary: "bg-primary text-surface hover:brightness-[1.04]",
  secondary: "bg-secondary text-ink hover:brightness-[1.02]",
  ghost: "bg-transparent text-ink hover:bg-tint",
  outline: "border border-line bg-surface text-ink hover:bg-tint",
  danger: "bg-danger text-surface hover:brightness-[1.04]",
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: "min-h-10 rounded-field px-4 text-caption",
  md: "min-h-[54px] rounded-panel px-6 text-body",
  lg: "min-h-14 rounded-panel px-7 text-body",
  icon: "size-11 rounded-full",
};

const baseStyles =
  "inline-flex items-center justify-center gap-2 font-medium transition-[filter,background-color,transform] duration-150 active:scale-[.985] disabled:pointer-events-none disabled:opacity-45";

export function buttonStyles(variant: ButtonVariant = "primary", size: ButtonSize = "md") {
  return cn(baseStyles, variantStyles[variant], sizeStyles[size]);
}

type ButtonProps = ComponentProps<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  children?: ReactNode;
};

export function Button({
  className,
  variant = "primary",
  size = "md",
  loading = false,
  children,
  disabled,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(buttonStyles(variant, size), className)}
      {...props}
    >
      {loading ? <Loader2 aria-hidden className="size-5 animate-spin" /> : null}
      {children}
    </button>
  );
}

/** Same visual language, but a real link — correct for navigation. */
export function ButtonLink({
  className,
  variant = "primary",
  size = "md",
  children,
  ...props
}: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize; children?: ReactNode }) {
  return (
    <Link className={cn(buttonStyles(variant, size), className)} {...props}>
      {children}
    </Link>
  );
}

/** Icon-only control used in headers and cards. */
export function IconButton({
  className,
  variant = "ghost",
  label,
  children,
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant; label: string; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(buttonStyles(variant, "icon"), "shrink-0", className)}
      {...props}
    >
      {children}
    </button>
  );
}
