import { Avatar } from "@/components/ui";
import { cn } from "@/lib/utils";
import { Camera } from "lucide-react";
import Link from "next/link";
import type { LookPrompt } from "./api";
import { lookDate } from "./format";

/** "Add a look" filled in from a finished Sheree booking. */
export function lookFromPromptHref(p: LookPrompt): string {
  const params = new URLSearchParams({
    booking: p.booking_id,
    title: p.service_name,
    category: p.category,
    date: p.date,
  });
  if (p.price != null) params.set("price", String(p.price));
  if (p.professional_name) params.set("pro", p.professional_name);
  return `/looks/new?${params}`;
}

/** "How did it turn out?": a finished booking waiting for its photo. */
export function PromptCard({ prompt, className }: { prompt: LookPrompt; className?: string }) {
  return (
    <Link
      href={lookFromPromptHref(prompt)}
      className={cn(
        "flex items-center gap-3 rounded-panel border border-secondary bg-surface p-3 transition active:scale-[.99] md:hover:bg-tint/50",
        className,
      )}
    >
      <Avatar src={prompt.avatar_url} name={prompt.professional_name ?? "Sheree"} size={44} />
      <span className="min-w-0 flex-1">
        <span className="block text-[9px] font-bold tracking-[0.14em] text-primary">HOW DID IT TURN OUT?</span>
        <span className="block truncate text-body font-bold text-ink">{prompt.service_name}</span>
        <span className="block truncate text-caption text-muted">
          {[prompt.professional_name, lookDate(prompt.date)].filter(Boolean).join(" · ")}
        </span>
      </span>
      <span className="flex size-[38px] shrink-0 items-center justify-center rounded-full bg-primary text-surface">
        <Camera aria-hidden className="size-[18px]" />
      </span>
    </Link>
  );
}
