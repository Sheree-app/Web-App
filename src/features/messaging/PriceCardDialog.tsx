"use client";

import { useMutation } from "convex/react";
import { useId, useState } from "react";
import { Button } from "@/components/ui";
import { Sheet } from "@/components/ui/overlay";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { cn } from "@/lib/utils";

const FIELD =
  "min-h-11 w-full rounded-field border border-secondary bg-surface px-3.5 text-body text-ink outline-none transition focus:border-primary disabled:opacity-50";

const TTL_OPTIONS = [
  { value: 24, label: "24 hours" },
  { value: 72, label: "3 days" },
  { value: 168, label: "7 days" },
  { value: 336, label: "14 days" },
];

/**
 * Professional-only composer for a conversation custom service.
 *
 * Everything here is a proposal, never a catalogue entry: the backend derives
 * the professional role from the conversation and writes the price to Convex
 * and then to the Postgres mirror that the booking RPC reads.
 */
export function PriceCardDialog({
  open,
  conversationId,
  onClose,
}: {
  open: boolean;
  conversationId: Id<"conversations">;
  onClose: () => void;
}) {
  const create = useMutation(api.priceCards.create);
  const formId = useId();
  const [serviceName, setServiceName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("60");
  const [ttlHours, setTtlHours] = useState(168);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const amount = Number(price);
  const minutes = Number(durationMinutes);
  const valid =
    serviceName.trim().length > 0 &&
    serviceName.trim().length <= 120 &&
    Number.isFinite(amount) &&
    amount > 0 &&
    Number.isFinite(minutes) &&
    minutes >= 1 &&
    minutes <= 1440;

  const reset = () => {
    setServiceName("");
    setDescription("");
    setPrice("");
    setDurationMinutes("60");
    setTtlHours(168);
    setError("");
    setBusy(false);
  };

  const close = () => {
    reset();
    onClose();
  };

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError("");
    try {
      await create({
        conversationId,
        serviceName: serviceName.trim(),
        description: description.trim() || undefined,
        // Money crosses the boundary in minor units; the UI never sends a
        // pre-formatted string the server would have to trust.
        priceMinor: Math.round(amount * 100),
        currency: "GHS",
        durationMinutes: Math.round(minutes),
        durationLabel: `${Math.round(minutes)} min`,
        ttlHours,
      });
      close();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "That price card could not be sent. Try again.",
      );
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={close}
      title="Send a price card"
      description="A one-off offer for this conversation. It never appears on your public profile."
      footer={
        <div className="flex flex-col gap-2">
          {error ? (
            <p role="alert" className="text-caption text-danger">
              {error}
            </p>
          ) : null}
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={() => void submit()} loading={busy} disabled={!valid}>
              Send offer
            </Button>
          </div>
        </div>
      }
    >
      <form
        id={formId}
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-caption text-muted">Service</span>
          <input
            value={serviceName}
            onChange={(event) => setServiceName(event.target.value)}
            maxLength={120}
            required
            autoFocus
            placeholder="Silk press with trim"
            className={FIELD}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-caption text-muted">What’s included (optional)</span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={3}
            maxLength={600}
            placeholder="Shampoo, steam treatment, blow-dry and a light trim."
            className={cn(FIELD, "resize-none py-2.5 leading-6")}
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-caption text-muted">Price (GH₵)</span>
            <input
              value={price}
              onChange={(event) => setPrice(event.target.value.replace(/[^\d.]/g, ""))}
              inputMode="decimal"
              placeholder="220"
              required
              className={FIELD}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-caption text-muted">Duration (minutes)</span>
            <input
              value={durationMinutes}
              onChange={(event) => setDurationMinutes(event.target.value.replace(/[^\d]/g, ""))}
              inputMode="numeric"
              placeholder="90"
              required
              className={FIELD}
            />
          </label>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-caption text-muted">Offer holds for</span>
          <select
            value={ttlHours}
            onChange={(event) => setTtlHours(Number(event.target.value))}
            className={cn(FIELD, "appearance-none")}
          >
            {TTL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <p className="rounded-field bg-tint px-3.5 py-3 text-[11px] leading-4 text-muted">
          The amount is locked into this card. Your customer can only book at exactly this price,
          and you can withdraw it until they do.
        </p>
      </form>
    </Sheet>
  );
}
