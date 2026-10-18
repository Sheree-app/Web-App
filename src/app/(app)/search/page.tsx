"use client";
import { CustomerPrice, usePricing } from "@/providers/pricing-provider";

import { Skeleton } from "@/components/ui";
import { searchMarketplace, type PriceSort, type SearchKind, type SearchResult } from "@/features/search/api";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BadgeCheck,
  CheckSquare,
  CircleX,
  CloudOff,
  Grid2x2,
  Search as SearchIcon,
  SlidersHorizontal,
  Sparkles,
  Square,
  Star,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

type Tab = SearchKind | "all";

const EXAMPLES = ["silk press in Accra", "soft glam", "mobile massage", "knotless braids"] as const;

const RANGES: Array<[number | null, number | null, string]> = [
  [null, null, "Any price"],
  [null, 100, "Under 100"],
  [100, 250, "100–250"],
  [250, 500, "250–500"],
  [500, null, "500+"],
];

const SORTS: Array<[PriceSort, string, "sparkles" | "up" | "down"]> = [
  ["relevance", "Recommended", "sparkles"],
  ["low_to_high", "Lowest first", "up"],
  ["high_to_low", "Highest first", "down"],
];

function priceActive(value: SearchPricing) {
  return (
    value.minimum !== null ||
    value.maximum !== null ||
    value.sort !== "relevance" ||
    !value.includeUnpriced
  );
}

function priceLabel(value: SearchPricing, currency: string) {
  if (value.sort === "low_to_high") return "Low first";
  if (value.sort === "high_to_low") return "High first";
  if (value.minimum !== null && value.maximum !== null) return `${currency} ${value.minimum}?${value.maximum}`;
  if (value.maximum !== null) return `Under ${value.maximum}`;
  if (value.minimum !== null) return `${value.minimum}+`;
  return "Price";
}

type SearchPricing = {
  minimum: number | null;
  maximum: number | null;
  sort: PriceSort;
  includeUnpriced: boolean;
};

const initialPricing: SearchPricing = {
  minimum: null,
  maximum: null,
  sort: "relevance",
  includeUnpriced: true,
};

/**
 * Search, rebuilt from the original screen: the same header, the same
 * discovery panel before you've typed two characters, the same kind tabs and
 * the same price panel — including its labels and its validation message.
 */
export default function SearchPage() {
  const { config } = usePricing();
  const router = useRouter();

  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  const [minRating, setMinRating] = useState(0);
  const [pricing, setPricing] = useState<SearchPricing>(initialPricing);
  const [priceOpen, setPriceOpen] = useState(false);

  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  const run = useCallback(
    async (text: string, value: SearchPricing, rating: number) => {
      if (text.trim().length < 2) {
        setResults([]);
        setError(false);
        return;
      }
      setLoading(true);
      setError(false);
      try {
        setResults(await searchMarketplace(text.trim(), value, rating));
      } catch {
        setError(true);
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // Debounced, the way the original did it.
  useEffect(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void run(query, pricing, minRating), 320);
    return () => window.clearTimeout(timer.current);
  }, [minRating, pricing, query, run]);

  const tabs: Array<{ key: Tab; label: string }> = [
    { key: "all", label: "All" },
    { key: "professional", label: "Pros" },
    { key: "service", label: "Services" },
    { key: "post", label: "Posts" },
    { key: "category", label: "Categories" },
  ];

  const visible = tab === "all" ? results : results.filter((item) => item.kind === tab);

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="flex items-center gap-3 px-4 pt-safe">
        <button
          type="button"
          aria-label="Go back"
          onClick={() => router.back()}
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface text-ink"
        >
          <ArrowLeft aria-hidden className="size-5" />
        </button>

        <div className="flex min-h-14 flex-1 items-center gap-3 rounded-panel bg-surface px-4">
          <SearchIcon aria-hidden className="size-5 shrink-0 text-primary" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Try ‘knotless braids’ or a professional"
            className="min-w-0 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-muted"
          />
          {query ? (
            <button type="button" aria-label="Clear search" onClick={() => setQuery("")}>
              <CircleX aria-hidden className="size-5 text-muted" />
            </button>
          ) : null}
        </div>
      </header>

      <div className="flex-1 px-4 pb-8 pt-2">
        {query.trim().length < 2 ? (
          <Discovery />
        ) : (
          <>
            <div className="rail gap-2 py-4">
              {tabs.map((item) => {
                const active = tab === item.key;
                const count = results.filter((result) => result.kind === item.key).length;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setTab(item.key)}
                    className={`shrink-0 rounded-full px-4 py-2 text-caption ${
                      active ? "bg-ink text-surface" : "bg-surface text-ink"
                    }`}
                  >
                    {item.label}
                    {results.length && item.key !== "all" ? ` ${count}` : ""}
                  </button>
                );
              })}
            </div>

            <div className="flex items-end gap-2">
              <div className="flex-1">
                <p className="text-eyebrow text-primary uppercase">Best matches</p>
                <h1 className="text-[19px] leading-[27px] font-bold text-ink">
                  {loading
                    ? "Searching everywhere…"
                    : `${visible.length} ${visible.length === 1 ? "result" : "results"}`}
                </h1>
              </div>

              <button
                type="button"
                onClick={() => setMinRating((value) => (value ? 0 : 4))}
                className={`flex items-center gap-1.5 rounded-full px-3 py-2 text-caption font-bold ${
                  minRating > 0 ? "bg-primary text-surface" : "bg-surface text-ink"
                }`}
              >
                <Star aria-hidden className="size-[13px]" />
                4+
              </button>

              <button
                type="button"
                onClick={() => setPriceOpen((value) => !value)}
                className={`flex items-center gap-1.5 rounded-full px-3 py-2 text-caption font-bold ${
                  priceActive(pricing) ? "bg-primary text-surface" : "bg-surface text-ink"
                }`}
              >
                <SlidersHorizontal aria-hidden className="size-[14px]" />
                {priceLabel(pricing, config.currency)}
              </button>
            </div>

            {priceOpen ? (
              <PriceControls
                value={pricing}
                onChange={setPricing}
                onClose={() => setPriceOpen(false)}
              />
            ) : null}

            {loading ? (
              <div className="flex flex-col gap-3 py-8">
                <Skeleton className="h-24 rounded-card" />
                <Skeleton className="h-24 rounded-card" />
              </div>
            ) : error ? (
              <State
                icon={<CloudOff aria-hidden className="size-7 text-primary" />}
                title="Search is out of reach"
                body="Check your connection and try again."
              />
            ) : visible.length === 0 ? (
              <State
                icon={<SearchIcon aria-hidden className="size-7 text-primary" />}
                title="No close matches"
                body="Try a service, style, creator name or location."
              />
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {visible.map((item) => (
                  <ResultCard key={`${item.kind}-${item.id}`} item={item} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Discovery() {
  return (
    <div className="pt-8">
      <p className="text-eyebrow text-primary uppercase">Search all of Sheree</p>
      <p className="mt-2 text-hero text-ink">Find the exact hands for the idea in your head.</p>
      <p className="mt-3 text-body text-muted">
        Search creators, treatments, posts, styles and locations — spelling doesn’t have to be
        perfect.
      </p>
      <ul className="mt-8 flex flex-col gap-2">
        {EXAMPLES.map((example) => (
          <li key={example} className="flex items-center gap-2">
            <Sparkles aria-hidden className="size-4 shrink-0 text-primary" />
            <span className="text-body font-medium text-ink">{example}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ResultCard({ item }: { item: SearchResult }) {
  const href =
    item.kind === "professional"
      ? `/professional/${item.id}`
      : item.kind === "service"
        ? `/services/${item.professionalId}`
        : item.kind === "post"
          ? `/post/${item.id}`
          : `/category/${item.title.toLowerCase().replace(/\s+/g, "-")}`;

  return (
    <Link
      href={href}
      className="flex gap-3 rounded-card bg-surface p-3 transition active:scale-[.99] active:opacity-70"
    >
      <span className="relative size-[76px] shrink-0 overflow-hidden rounded-panel bg-secondary">
        {item.image ? (
          <Image src={item.image} alt="" fill sizes="76px" className="object-cover" />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center">
            {item.kind === "category" ? (
              <Grid2x2 aria-hidden className="size-[23px] text-primary" />
            ) : (
              <Sparkles aria-hidden className="size-[23px] text-primary" />
            )}
          </span>
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block text-eyebrow text-muted uppercase">{item.kind}</span>
        <span className="flex items-center gap-1">
          <span className="truncate text-title text-ink">{item.title}</span>
          {item.verified ? (
            <BadgeCheck aria-hidden className="size-4 shrink-0 text-success" />
          ) : null}
        </span>
        <span className="block truncate text-caption text-muted">{item.subtitle}</span>
        <span className="mt-1.5 flex items-center justify-between gap-2">
          <span className="truncate text-caption text-muted">
            {item.rating > 0 ? `★ ${item.rating} (${item.reviewCount})` : item.location}
          </span>
          {item.price !== null ? (
            <span className="text-caption font-bold text-ink">from {<CustomerPrice value={item.price} />}</span>
          ) : null}
        </span>
      </span>
    </Link>
  );
}

function State({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="mt-8 flex flex-col items-center gap-2 rounded-card bg-surface p-8 text-center">
      {icon}
      <h2 className="text-title text-ink">{title}</h2>
      <p className="text-caption text-muted">{body}</p>
    </div>
  );
}

function PriceControls({
  value,
  onChange,
  onClose,
}: {
  value: SearchPricing;
  onChange: (next: SearchPricing) => void;
  onClose: () => void;
}) {
  const [min, setMin] = useState(value.minimum?.toString() ?? "");
  const [max, setMax] = useState(value.maximum?.toString() ?? "");

  const updateRange = (low: number | null, high: number | null) => {
    setMin(low?.toString() ?? "");
    setMax(high?.toString() ?? "");
    onChange({ ...value, minimum: low, maximum: high });
  };

  const custom = (nextMin: string, nextMax: string) => {
    setMin(nextMin);
    setMax(nextMax);
    const low = nextMin ? Number(nextMin) : null;
    const high = nextMax ? Number(nextMax) : null;
    if (low === null || high === null || low <= high) {
      onChange({ ...value, minimum: low, maximum: high });
    }
  };

  return (
    <div className="mt-4 flex flex-col gap-3 rounded-card bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-eyebrow text-primary uppercase">Price & order</p>
          <h2 className="text-title text-ink">Shape the shortlist</h2>
        </div>
        <button type="button" aria-label="Close price controls" onClick={onClose}>
          <CircleX aria-hidden className="size-5 text-ink" />
        </button>
      </div>

      <p className="text-eyebrow text-muted uppercase">Sort by</p>
      <div className="flex gap-2">
        {SORTS.map(([key, label, icon]) => {
          const active = value.sort === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onChange({ ...value, sort: key })}
              className={`flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-field px-2 text-caption font-medium ${
                active ? "bg-ink text-surface" : "bg-tint text-ink"
              }`}
            >
              {icon === "sparkles" ? (
                <Sparkles aria-hidden className="size-[15px]" />
              ) : icon === "up" ? (
                <ArrowUp aria-hidden className="size-[15px]" />
              ) : (
                <ArrowDown aria-hidden className="size-[15px]" />
              )}
              {label}
            </button>
          );
        })}
      </div>

      <p className="text-eyebrow text-muted uppercase">Quick ranges</p>
      <div className="rail gap-2">
        {RANGES.map(([low, high, label]) => (
          <button
            key={label}
            type="button"
            onClick={() => updateRange(low, high)}
            className={`shrink-0 rounded-full px-3.5 py-2.5 text-caption ${
              value.minimum === low && value.maximum === high
                ? "bg-ink text-surface"
                : "bg-tint text-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex items-end gap-3">
        <PriceBox label="Minimum" value={min} onChange={(text) => custom(text, max)} />
        <span className="pb-4 text-muted">—</span>
        <PriceBox label="Maximum" value={max} onChange={(text) => custom(min, text)} />
      </div>

      {min && max && Number(min) > Number(max) ? (
        <p className="text-caption text-danger">Minimum must be lower than maximum.</p>
      ) : null}

      <button
        type="button"
        onClick={() => onChange({ ...value, includeUnpriced: !value.includeUnpriced })}
        className="flex items-center gap-3 rounded-panel bg-tint p-4 text-left"
      >
        <span className="flex-1">
          <span className="block text-body font-medium text-ink">Include unpriced inspiration</span>
          <span className="block text-caption text-muted">
            Posts and categories without listed prices
          </span>
        </span>
        {value.includeUnpriced ? (
          <CheckSquare aria-hidden className="size-[22px] text-primary" />
        ) : (
          <Square aria-hidden className="size-[22px] text-muted" />
        )}
      </button>

      <button
        type="button"
        onClick={() => {
          setMin("");
          setMax("");
          onChange(initialPricing);
        }}
        className="text-caption font-medium text-primary underline-offset-4 hover:underline"
      >
        Reset all pricing
      </button>
    </div>
  );
}

function PriceBox({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (text: string) => void;
}) {
  return (
    <label className="flex flex-1 flex-col gap-1">
      <span className="text-caption text-muted">{label}</span>
      <input
        inputMode="numeric"
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/[^\d]/g, ""))}
        placeholder="Any"
        className="min-h-12 rounded-field bg-tint px-3 text-body text-ink outline-none placeholder:text-muted"
      />
    </label>
  );
}
