"use client";
import { usePricing } from "@/providers/pricing-provider";
import { feeLabel, toCedis } from "@/lib/pricing";

import { CardSkeleton, Sheet, Skeleton } from "@/components/ui";
import { fetchProfessionalHandle, fetchProfessionalName, fetchProfessionalServices } from "@/features/services/api";
import { duration, type Service } from "@/features/services/data";
import { useToast } from "@/providers/toast-provider";
import { ArrowLeft, ArrowRight, Clock, Info, Share2, ShieldCheck, Wallet } from "lucide-react";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

/**
 * The professional's menu, rebuilt from `CustomerServicesScreen`: the same
 * header, the "THE MENU" head, category tabs with counts, and a detail sheet
 * that ends in "Choose this service".
 */
export default function ServicesPage() {
  const { money, customerPrice, financials, config } = usePricing();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const id = params.id;

  const [items, setItems] = useState<Service[]>([]);
  const [professionalName, setProfessionalName] = useState("Professional services");
  const [activeCategory, setActiveCategory] = useState("all");
  const [selected, setSelected] = useState<Service | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!id) return;
    setError(false);
    void Promise.all([fetchProfessionalServices(id), fetchProfessionalName(id)])
      .then(([services, name]) => {
        setItems(services);
        setProfessionalName(name);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [id]);

  const tabs = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      const category = item.category?.trim() || "Other services";
      counts.set(category, (counts.get(category) ?? 0) + 1);
    }
    return [
      { key: "all", name: "All", count: items.length },
      ...[...counts.entries()].map(([name, count]) => ({ key: name, name, count })),
    ];
  }, [items]);

  const effectiveCategory =
    activeCategory === "all" || tabs.some((tab) => tab.key === activeCategory)
      ? activeCategory
      : "all";

  const groups = useMemo(() => {
    const result = new Map<string, Service[]>();
    for (const item of items) {
      const category = item.category?.trim() || "Other services";
      if (effectiveCategory !== "all" && category !== effectiveCategory) continue;
      result.set(category, [...(result.get(category) ?? []), item]);
    }
    return [...result.entries()].map(([category, services]) => ({ category, services }));
  }, [items, effectiveCategory]);

  const share = async () => {
    const handle = await fetchProfessionalHandle(id).catch(() => id);
    const url =
      typeof window === "undefined" ? "" : `${window.location.origin}/services/${handle}`;
    if (typeof navigator !== "undefined" && navigator.share) {
      await navigator
        .share({
          title: `${professionalName}’s services`,
          text: `${items.length} services`,
          url,
        })
        .catch(() => undefined);
      return;
    }
    await navigator.clipboard?.writeText(url).catch(() => undefined);
    toast("Link copied", { detail: "Paste it wherever you’re sharing." });
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
        <div className="min-w-0 flex-1">
          <p className="truncate text-eyebrow text-primary uppercase">{professionalName}</p>
          <h1 className="truncate text-page text-ink">Choose your service</h1>
        </div>
        <button
          type="button"
          aria-label="Share services"
          onClick={() => void share()}
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface text-ink"
        >
          <Share2 aria-hidden className="size-5" />
        </button>
      </div>

      <p className="mt-3 text-body text-muted">
        Compare the professional’s services, timing and pricing before booking.
      </p>

      <div className="mt-6 flex items-center justify-between gap-3">
        <p className="text-eyebrow text-muted uppercase">The menu</p>
        {loading ? (
          <Skeleton className="h-3 w-[72px] rounded-tile" />
        ) : (
          <p className="text-caption text-muted">{items.length} services</p>
        )}
      </div>

      {!loading && !error && tabs.length > 1 ? (
        <div className="rail mt-3 gap-2">
          {tabs.map((tab) => {
            const active = effectiveCategory === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveCategory(tab.key)}
                className={`flex shrink-0 items-center gap-2 rounded-full px-4 py-2.5 text-caption ${
                  active ? "bg-ink text-surface" : "bg-surface text-ink"
                }`}
              >
                {tab.name}
                <span className={active ? "text-surface/70" : "text-muted"}>{tab.count}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {loading ? (
        <div className="mt-6 flex flex-col gap-4">
          <CardSkeleton lines={3} />
          <CardSkeleton lines={3} />
        </div>
      ) : error ? (
        <div className="mt-8 rounded-card bg-surface p-8 text-center">
          <h2 className="text-title text-ink">Services could not load</h2>
          <p className="mt-1 text-caption text-muted">Check your connection and try again.</p>
        </div>
      ) : (
        groups.map((group) => (
          <section key={group.category} className="mt-6 flex flex-col gap-3">
            <div className="flex items-end justify-between gap-3">
              <h2 className="text-section text-ink">{group.category}</h2>
              <p className="text-caption text-muted">
                {group.services.length} {group.services.length === 1 ? "service" : "services"}
              </p>
            </div>

            {group.services.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelected(item)}
                className="flex items-stretch overflow-hidden rounded-card bg-surface text-left shadow-card transition active:scale-[.99]"
              >
                {item.image ? (
                  <span className="relative w-[104px] shrink-0 self-stretch overflow-hidden bg-secondary md:w-[128px]">
                    <Image
                      src={item.image}
                      alt=""
                      fill
                      sizes="(min-width: 768px) 128px, 104px"
                      className="object-cover"
                    />
                  </span>
                ) : null}
                <span className="flex min-w-0 flex-1 flex-col gap-1 p-3.5 md:p-4">
                  <span className="flex items-start justify-between gap-3">
                    <span className="min-w-0 flex-1">
                      {item.popular ? (
                        <span className="block text-[9px] leading-[14px] font-bold tracking-[1.5px] text-primary uppercase">
                          Most loved
                        </span>
                      ) : null}
                      <span className="block text-title text-ink">{item.name}</span>
                    </span>
                    <span className="shrink-0 text-title text-ink">{customerPrice(item.price)}</span>
                  </span>
                  <span className="line-clamp-2 text-caption text-muted">{item.description}</span>
                  <span className="flex items-center gap-1.5 text-caption text-muted">
                    <Clock aria-hidden className="size-[15px] shrink-0" />
                    {duration(item.durationMinutes)}
                  </span>
                </span>
              </button>
            ))}
          </section>
        ))
      )}

      <Sheet
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected?.name ?? ""}
        footer={
          <button
            type="button"
            onClick={() => selected && router.push(`/booking/${id}?service=${selected.id}`)}
            className="flex min-h-[54px] w-full items-center justify-center gap-2 rounded-panel bg-primary text-body font-medium text-surface"
          >
            Choose this service
            <ArrowRight aria-hidden className="size-[18px]" />
          </button>
        }
      >
        {selected ? (
          <div className="flex flex-col gap-4">
            {selected.image ? (
              <span className="relative block aspect-[4/3] overflow-hidden rounded-panel bg-secondary">
                <Image src={selected.image} alt="" fill sizes="480px" className="object-cover" />
              </span>
            ) : null}

            {selected.popular ? (
              <p className="text-eyebrow text-primary uppercase">Most loved</p>
            ) : null}
            <h2 className="text-page text-ink">{selected.name}</h2>
            <p className="text-body text-ink">{selected.description}</p>

            <dl className="flex flex-col gap-3">
              <Fact
                icon={<Clock aria-hidden className="size-5 text-primary" />}
                label="Time"
                value={duration(selected.durationMinutes)}
              />
              <Fact
                icon={<Wallet aria-hidden className="size-5 text-primary" />}
                label="Service price"
                value={money(selected.price)}
              />
              <Fact icon={<ShieldCheck className="size-5 text-primary" />} label={feeLabel(config, financials(selected.price).capped)} value={money(toCedis(financials(selected.price).fee))} />
              <Fact icon={<Wallet className="size-5 text-primary" />} label="Total" value={customerPrice(selected.price)} />
              <Fact icon={<Wallet className="size-5 text-primary" />} label="Deposit due now" value={money(toCedis(financials(selected.price).dueNow))} />
              <Fact icon={<Wallet className="size-5 text-primary" />} label="Balance after your appointment" value={money(toCedis(financials(selected.price).balance))} />
            </dl>

            <p className="flex items-start gap-2 rounded-panel bg-tint p-4 text-caption text-ink">
              <Info aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
              The remaining balance is paid after your appointment.
            </p>

            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-eyebrow text-muted uppercase">Total</p>
                <p className="text-section text-ink">{customerPrice(selected.price)}</p>
              </div>
            </div>
          </div>
        ) : null}
      </Sheet>
    </div>
  );
}

function Fact({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3">
      {icon}
      <dt className="flex-1 text-caption text-muted">{label}</dt>
      <dd className="text-body font-medium text-ink">{value}</dd>
    </div>
  );
}
