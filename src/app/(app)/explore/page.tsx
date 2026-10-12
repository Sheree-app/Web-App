"use client";

import { CardSkeleton, Sheet, Skeleton } from "@/components/ui";
import { categoryImage } from "@/features/explore/category-images";
import {
  fetchExploreCategories,
  fetchExploreProfessionals,
  fetchNearbyProfessionals,
} from "@/features/explore/api";
import { collections, type Category, type Professional } from "@/features/explore/data";
import { ProfessionalTile } from "@/features/explore/ProfessionalTile";
import { cn } from "@/lib/utils";
import {
  ArrowRight,
  ArrowUp,
  CloudOff,
  Droplets,
  Flower2,
  List,
  Map as MapIcon,
  Navigation,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Store,
  Zap,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ComponentType } from "react";

/** A 400-metre ring — about a five-minute walk. */
const NEARBY_RADIUS_METRES = 400;

const MOOD_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  "flash-outline": Zap,
  "shield-checkmark-outline": ShieldCheck,
  "sparkles-outline": Sparkles,
  "flower-outline": Flower2,
  "water-outline": Droplets,
};

type NearbyState = "loading" | "ready" | "denied" | "error";

/**
 * Explore, rebuilt from the original tab.
 *
 * The order is the app's order: nearby first (the whole point of a local
 * marketplace), then the trades, then the moods. The trending and "available
 * today" rows exist in the source but are commented out there, so they are not
 * rendered here either.
 */
export default function ExplorePage() {
  const router = useRouter();

  const [categories, setCategories] = useState<Category[]>([]);
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [nearby, setNearby] = useState<Professional[]>([]);
  const [nearbyState, setNearbyState] = useState<NearbyState>("loading");
  const [showMap, setShowMap] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [moodTitle, setMoodTitle] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextCategories, nextProfessionals] = await Promise.all([
        fetchExploreCategories(),
        fetchExploreProfessionals(),
      ]);
      setCategories(nextCategories);
      setProfessionals(nextProfessionals);
    } catch {
      setError("Check your connection, then try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadNearby = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setNearbyState("denied");
      return;
    }
    setNearbyState("loading");
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const results = await fetchNearbyProfessionals(
            position.coords.latitude,
            position.coords.longitude,
            NEARBY_RADIUS_METRES,
            20,
          );
          setNearby(results);
          setNearbyState("ready");
        } catch {
          setNearbyState("error");
        }
      },
      () => setNearbyState("denied"),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  }, []);

  useEffect(() => {
    void load();
    void loadNearby();
  }, [load, loadNearby]);

  const ready = !loading && !error;

  return (
    <div className="flex flex-col pb-8">
      <header className="flex items-center justify-between px-4">
        <div>
          <p className="text-eyebrow text-primary uppercase">Beauty, near and far</p>
          <h1 className="text-page text-ink">Explore beauty</h1>
        </div>
      </header>

      <button
        type="button"
        onClick={() => router.push("/search")}
        aria-label="Search"
        className="mx-4 mt-4 flex min-h-14 items-center gap-3 rounded-panel bg-surface px-4 text-left"
      >
        <Search aria-hidden className="size-5 shrink-0 text-muted" />
        <span className="flex-1 text-body text-muted">What are you looking for?</span>
        <span className="flex size-11 shrink-0 items-center justify-center rounded-[18px] bg-tint">
          <SlidersHorizontal aria-hidden className="size-[19px] text-ink" />
        </span>
      </button>

      <button
        type="button"
        role="switch"
        aria-checked={showMap}
        aria-label="Show professionals on map"
        onClick={() => setShowMap((current) => !current)}
        className="relative mr-4 mt-4 flex h-11 w-[150px] shrink-0 items-center self-end rounded-full bg-surface p-[3px]"
      >
        <span
          aria-hidden
          className={cn(
            "absolute top-[3px] left-[3px] h-[38px] w-[72px] rounded-full bg-tint transition-transform",
            showMap && "translate-x-[72px]",
          )}
        />
        <span className="relative z-10 flex flex-1 items-center justify-center gap-1.5">
          <List aria-hidden className={cn("size-4", showMap ? "text-muted" : "text-ink")} />
          <span className={cn("text-caption font-bold", showMap ? "text-muted" : "text-ink")}>
            List
          </span>
        </span>
        <span className="relative z-10 flex flex-1 items-center justify-center gap-1.5">
          <MapIcon aria-hidden className={cn("size-4", showMap ? "text-ink" : "text-muted")} />
          <span className={cn("text-caption font-bold", showMap ? "text-ink" : "text-muted")}>
            Map
          </span>
        </span>
      </button>

      {loading ? (
        <div className="mt-6 flex flex-col gap-4 px-4">
          <Skeleton className="h-6 w-[42%] rounded-field" />
          <div className="flex gap-3">
            <CardSkeleton lines={2} />
            <CardSkeleton lines={2} />
          </div>
          <Skeleton className="h-6 w-[52%] rounded-field" />
          <div className="flex gap-3">
            <CardSkeleton lines={2} />
            <CardSkeleton lines={2} />
          </div>
        </div>
      ) : null}

      {error && !loading ? (
        <State
          icon={<CloudOff aria-hidden className="size-7 text-primary" />}
          title="Explore couldn’t refresh"
          body={error}
          onRetry={() => void load()}
        />
      ) : null}

      {ready && professionals.length === 0 ? (
        <State
          icon={<Store aria-hidden className="size-7 text-primary" />}
          title="No professionals to show yet"
          body="Professionals with an active service and portfolio image will appear here."
        />
      ) : null}

      {ready && professionals.length > 0 ? (
        showMap ? (
          // The original itself declines to draw a map on web — this is that
          // same fallback, with the same words.
          <div className="mx-4 mt-4 flex h-[520px] items-center justify-center rounded-card bg-raised px-6">
            <p className="text-center text-caption font-bold text-ink">
              Map view is available on iOS and Android.
            </p>
          </div>
        ) : (
          <>
            <NearbySection items={nearby} state={nearbyState} retry={() => void loadNearby()} />

            {categories.length > 0 ? (
              <Section title="Choose your thing" action={{ label: "See all", href: "/explore-all?section=categories" }}>
                <div className="rail px-4">
                  {categories.map((category) => (
                    <Link
                      key={category.id}
                      href={`/category/${category.slug}`}
                      className="w-[144px] overflow-hidden rounded-card"
                    >
                      <span className="relative block h-[128px] w-full bg-secondary">
                        <Image
                          src={categoryImage(category.slug, category.image)}
                          alt=""
                          fill
                          sizes="144px"
                          className="object-cover"
                        />
                      </span>
                      <span
                        className="flex h-12 items-center justify-between px-3"
                        style={{ backgroundColor: category.blush }}
                      >
                        <span className="truncate text-body font-medium text-[#2E2E2E]">
                          {category.name}
                        </span>
                        <ArrowRight aria-hidden className="size-[15px] shrink-0 text-[#2E2E2E]" />
                      </span>
                    </Link>
                  ))}
                </div>
              </Section>
            ) : null}

            <Section title="Find your mood">
              <div className="grid grid-cols-2 gap-3 px-4 lg:grid-cols-3">
                {collections.map((collection, index) => {
                  const Icon = MOOD_ICONS[collection.icon] ?? Sparkles;
                  return (
                    <button
                      key={collection.slug}
                      type="button"
                      onClick={() => setMoodTitle(collection.title)}
                      className={cn(
                        "relative overflow-hidden rounded-card p-4 text-left transition active:opacity-[.78]",
                        index === 0 ? "min-h-[178px] col-span-2 lg:col-span-1" : "min-h-[196px]",
                      )}
                      style={{ backgroundColor: collection.color }}
                    >
                      <span
                        aria-hidden
                        className="absolute -top-[38px] -right-[34px] size-[132px] rounded-full border opacity-20"
                        style={{ borderColor: collection.ink }}
                      />
                      <span
                        className="flex size-[38px] items-center justify-center rounded-full"
                        style={{ backgroundColor: collection.ink }}
                      >
                        <Icon className="size-[19px]" />
                      </span>
                      <span
                        className="mt-6 block max-w-[190px] text-[15px] leading-[21px] font-medium"
                        style={{ color: collection.ink }}
                      >
                        {collection.prompt}
                      </span>
                      <span className="mt-4 flex items-end justify-between gap-2">
                        <span>
                          <span
                            className="block text-[15px] leading-5 font-medium"
                            style={{ color: collection.ink }}
                          >
                            {collection.title}
                          </span>
                          <span
                            className="block max-w-[120px] text-[10px] leading-[14px] opacity-70"
                            style={{ color: collection.ink }}
                          >
                            {collection.subtitle}
                          </span>
                        </span>
                        <ArrowUp
                          aria-hidden
                          className="size-[18px] rotate-45"
                          style={{ color: collection.ink }}
                        />
                      </span>
                    </button>
                  );
                })}
              </div>
            </Section>

            {professionals.length > 4 ? (
              <Section title="Recommended for you">
                <CardRow items={professionals.slice(4, 8)} />
              </Section>
            ) : null}
          </>
        )
      ) : null}

      <div className="h-6" />

      <Sheet
        open={Boolean(moodTitle)}
        onClose={() => setMoodTitle(null)}
        title={`${moodTitle ?? ""} is still taking shape`}
        footer={
          <button
            type="button"
            onClick={() => setMoodTitle(null)}
            className="min-h-[54px] w-full rounded-panel bg-primary text-body font-medium text-surface"
          >
            Got it
          </button>
        }
      >
        <p className="text-body text-ink">
          We’re building this mood collection now. Check back soon for looks chosen to match it.
        </p>
      </Sheet>
    </div>
  );
}

function CardRow({ items }: { items: Professional[] }) {
  return (
    <div className="rail px-4">
      {items.map((item) => (
        <ProfessionalTile key={item.id} item={item} />
      ))}
    </div>
  );
}

function NearbySection({
  items,
  state,
  retry,
}: {
  items: Professional[];
  state: NearbyState;
  retry: () => void;
}) {
  return (
    <section className="mt-6 flex flex-col gap-3">
      <div className="flex items-center gap-3 px-4">
        <span className="flex size-[38px] shrink-0 items-center justify-center rounded-full border border-line bg-tint">
          <span className="size-2.5 rounded-full bg-primary" />
        </span>
        <div className="flex-1">
          <h2 className="text-section text-ink">Beauticians around you</h2>
          <p className="text-caption text-muted">Within 400 metres · about a 5-minute walk</p>
        </div>
      </div>

      {state === "loading" ? (
        <div className="flex justify-center py-6">
          <span className="size-6 animate-spin rounded-full border-2 border-secondary border-t-primary" />
        </div>
      ) : state === "denied" ? (
        <NearbyMessage
          text="Turn on location to see who’s just around the corner."
          action="Use my location"
          onPress={retry}
        />
      ) : state === "error" ? (
        <NearbyMessage
          text="Your location couldn’t be refreshed."
          action="Try again"
          onPress={retry}
        />
      ) : items.length > 0 ? (
        <CardRow items={items} />
      ) : (
        <NearbyMessage text="No beauticians are within 400 metres right now." />
      )}
    </section>
  );
}

function NearbyMessage({
  text,
  action,
  onPress,
}: {
  text: string;
  action?: string;
  onPress?: () => void;
}) {
  return (
    <div className="mx-4 flex min-h-[76px] items-center gap-3 rounded-panel bg-tint p-4">
      <Navigation aria-hidden className="size-5 shrink-0 text-primary" />
      <p className="flex-1 text-caption text-ink">{text}</p>
      {action ? (
        <button
          type="button"
          onClick={onPress}
          className="shrink-0 rounded-full bg-surface px-3 py-2.5 text-[11px] font-bold text-ink"
        >
          {action}
        </button>
      ) : null}
    </div>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: { label: string; href: string };
  children: React.ReactNode;
}) {
  return (
    <section className="mt-6 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 px-4">
        <h2 className="text-section text-ink">{title}</h2>
        {action ? (
          <Link href={action.href} className="text-caption font-bold text-primary">
            {action.label}
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function State({
  icon,
  title,
  body,
  onRetry,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  onRetry?: () => void;
}) {
  return (
    <div className="mx-4 mt-4 flex flex-col items-center gap-2 rounded-card bg-surface p-8">
      {icon}
      <h2 className="text-title text-ink">{title}</h2>
      <p className="text-center text-caption text-muted">{body}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-full bg-primary px-6 py-3 text-caption font-bold text-surface"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}
