"use client";

import { storageSet } from "@/lib/storage";
import { useToast } from "@/providers/toast-provider";
import { ArrowLeft, ChevronRight, LocateFixed, MapPin } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** The six areas the app offers, with their coordinates. */
const PLACES: Array<[string, number, number]> = [
  ["Accra", 5.6037, -0.187],
  ["East Legon", 5.6406, -0.1519],
  ["Osu", 5.556, -0.182],
  ["Tema", 5.6698, -0.0166],
  ["Adenta", 5.704, -0.1668],
  ["Kumasi", 6.6885, -1.6244],
];

/**
 * Choose an area — the original `/location` screen. It isn't a settings page:
 * it picks the point everything else is measured from, and stores it under the
 * same key the app used.
 */
export default function ChooseLocationPage() {
  const router = useRouter();
  const { error: showError } = useToast();
  const [busy, setBusy] = useState(false);

  const choose = async (name: string, latitude: number, longitude: number) => {
    await storageSet("explore-location", JSON.stringify({ name, latitude, longitude }));
    router.back();
  };

  const chooseCurrent = async () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      showError("Location unavailable", "Choose an area instead.");
      return;
    }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setBusy(false);
        void choose("Current location", position.coords.latitude, position.coords.longitude);
      },
      (error) => {
        setBusy(false);
        showError(
          "Location unavailable",
          error.message || "Choose an area instead.",
        );
      },
      { enableHighAccuracy: false, timeout: 10_000 },
    );
  };

  return (
    <div className="flex flex-col px-4 pb-[146px] pt-2">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label="Go back"
          onClick={() => router.back()}
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface text-ink"
        >
          <ArrowLeft aria-hidden className="size-5" />
        </button>
        <h1 className="text-[27px] leading-[35px] font-bold text-ink">Choose an area</h1>
      </div>

      <p className="my-8 text-body text-muted">
        Prices, travel distance and nearby availability will be calculated from this point.
      </p>

      <button
        type="button"
        onClick={() => void chooseCurrent()}
        className="flex min-h-[76px] items-center gap-3 rounded-panel bg-tint p-4 text-left"
      >
        {busy ? (
          <span className="size-5 animate-spin rounded-full border-2 border-secondary border-t-primary" />
        ) : (
          <LocateFixed aria-hidden className="size-5 shrink-0 text-primary" />
        )}
        <span>
          <span className="block text-body font-medium text-ink">Use my current location</span>
          <span className="block text-caption text-muted">Best for distance estimates</span>
        </span>
      </button>

      <p className="mt-8 mb-1 text-eyebrow text-muted uppercase">Popular areas</p>

      <ul className="flex flex-col gap-1">
        {PLACES.map(([name, latitude, longitude]) => (
          <li key={name}>
            <button
              type="button"
              onClick={() => void choose(name, latitude, longitude)}
              className="flex min-h-16 w-full items-center gap-3 rounded-panel bg-surface px-4 text-left"
            >
              <MapPin aria-hidden className="size-5 shrink-0 text-primary" />
              <span className="flex-1 text-body font-medium text-ink">{name}</span>
              <ChevronRight aria-hidden className="size-[18px] shrink-0 text-muted" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
