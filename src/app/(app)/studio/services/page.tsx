"use client";

import { FormError, Sheet, Skeleton } from "@/components/ui";
import { fetchPayoutAccount } from "@/features/account/payoutApi";
import {
  fetchOwnServices,
  fetchServiceCategories,
  saveProfessionalService,
  uploadServicePhoto,
  type ServiceCategory,
} from "@/features/services/api";
import { DEPOSIT_PERCENT, duration, money, type Service } from "@/features/services/data";
import { useToast } from "@/providers/toast-provider";
import {
  ArrowRight,
  Camera,
  Check,
  Pencil,
  Plus,
  Wallet,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type Draft = {
  id: string;
  categoryId: string;
  name: string;
  description: string;
  price: string;
  duration: string;
  active: boolean;
  photoFile: File | null;
  photoPreview: string | null;
  image: string;
};

const blank: Draft = {
  id: "local-new",
  categoryId: "",
  name: "",
  description: "",
  price: "",
  duration: "60",
  active: true,
  photoFile: null,
  photoPreview: null,
  image: "",
};

/**
 * The price list, rebuilt from `ProfessionalServicesScreen`: the menu header
 * with its Add service pill, the payout gate, the live-services summary, the
 * grouped rows, and one editor sheet for adding and editing.
 */
export default function StudioServicesPage() {
  const { toast, error: showError } = useToast();

  const [items, setItems] = useState<Service[]>([]);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [payoutReady, setPayoutReady] = useState<boolean | null>(null);
  const [payoutRequired, setPayoutRequired] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [formError, setFormError] = useState("");

  const load = useCallback(async () => {
    try {
      const [{ profileId: id, countryCode, services }, availableCategories] = await Promise.all([
        fetchOwnServices(),
        fetchServiceCategories(),
      ]);
      setProfileId(id);
      setPayoutRequired(countryCode === "GH");
      setItems(services);
      setCategories(availableCategories);
      const account = await fetchPayoutAccount().catch(() => null);
      setPayoutReady(Boolean(account?.configured));
    } catch (cause) {
      showError(
        "Services could not load",
        cause instanceof Error ? cause.message : "Check your connection and try again.",
      );
    } finally {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    void load();
  }, [load]);

  const active = useMemo(() => items.filter((item) => item.active), [items]);

  const grouped = useMemo(
    () =>
      categories
        .map((category) => ({
          category,
          services: items.filter((item) => item.categoryId === category.id),
        }))
        .filter((group) => group.services.length > 0)
        .concat(
          items.some((item) => !item.categoryId)
            ? [
                {
                  category: { id: "", name: "Uncategorised" },
                  services: items.filter((item) => !item.categoryId),
                },
              ]
            : [],
        ),
    [categories, items],
  );

  const gated = payoutRequired && payoutReady !== true;

  const openEditor = (item?: Service) => {
    setFormError("");
    setDraft(
      item
        ? {
            id: item.id,
            categoryId: item.categoryId ?? "",
            name: item.name,
            description: item.description,
            price: String(item.price),
            duration: String(item.durationMinutes),
            active: item.active,
            photoFile: null,
            photoPreview: null,
            image: item.image,
          }
        : blank,
    );
  };

  const save = async () => {
    if (!draft) return;
    if (
      !draft.name.trim() ||
      !draft.categoryId ||
      !draft.description.trim() ||
      Number(draft.price) <= 0 ||
      Number(draft.duration) < 5
    ) {
      setFormError(
        "Choose a category and add a name, description, valid price and duration.",
      );
      return;
    }
    if (!profileId) {
      setFormError("Reload the page and try again.");
      return;
    }

    setSaving(true);
    setFormError("");
    const value: Service = {
      id: draft.id,
      name: draft.name.trim(),
      categoryId: draft.categoryId,
      category: categories.find((category) => category.id === draft.categoryId)?.name ?? "Uncategorised",
      description: draft.description.trim(),
      price: Number(draft.price),
      durationMinutes: Number(draft.duration),
      active: draft.active,
      image: draft.image,
    };

    try {
      const id = await saveProfessionalService(profileId, value);
      let image = value.image;
      if (draft.photoFile) {
        image = await uploadServicePhoto(id, URL.createObjectURL(draft.photoFile), draft.photoFile.name);
      }
      const saved = { ...value, id, image };
      setItems((current) =>
        draft.id === "local-new"
          ? [saved, ...current]
          : current.map((item) => (item.id === draft.id ? saved : item)),
      );
      setDraft(null);
      toast("Service saved", { tone: "success", detail: saved.name });
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Service could not be saved");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col">
      <header className="flex items-center justify-between gap-3">
        <div>
          <p className="text-eyebrow text-primary uppercase">Your menu</p>
          <h1 className="text-page text-ink">Services</h1>
        </div>
        <button
          type="button"
          disabled={gated}
          onClick={() => openEditor()}
          className={
            gated
              ? "flex h-[46px] shrink-0 items-center gap-1.5 rounded-panel bg-primary px-4 text-caption font-bold text-surface opacity-45"
              : "flex h-[46px] shrink-0 items-center gap-1.5 rounded-panel bg-primary px-4 text-caption font-bold text-surface transition active:scale-95"
          }
        >
          <Plus aria-hidden className="size-5" />
          Add service
        </button>
      </header>

      <p className="mt-1 text-body text-muted">Keep the menu clear, priced and easy to book.</p>

      {payoutRequired && payoutReady === false ? (
        <Link
          href="/studio/payouts/account"
          className="mt-4 flex min-h-[84px] items-center gap-3 rounded-card border border-secondary bg-tint p-4 transition active:scale-[.995]"
        >
          <span className="flex size-[42px] shrink-0 items-center justify-center rounded-field bg-surface">
            <Wallet aria-hidden className="size-[21px] text-primary" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-body font-medium text-ink">
              Connect payouts to add services
            </span>
            <span className="mt-0.5 block text-caption text-muted">
              Your account must be ready before customers can book anything new.
            </span>
          </span>
          <ArrowRight aria-hidden className="size-[19px] shrink-0 text-primary" />
        </Link>
      ) : null}

      {loading ? (
        <div className="mt-6 flex flex-col gap-4">
          <Skeleton className="h-[92px] w-full rounded-card" />
          <Skeleton className="h-[100px] w-full rounded-card" />
          <Skeleton className="h-[100px] w-full rounded-card" />
        </div>
      ) : (
        <>
          <div className="mt-6 flex items-center gap-6 rounded-card bg-tint p-4">
            <div>
              <p className="text-section text-ink">{active.length}</p>
              <p className="text-caption text-muted">Live services</p>
            </div>
            <span aria-hidden className="h-[35px] w-px shrink-0 bg-line" />
            <div>
              <p className="text-section text-ink">
                {active.length ? money(Math.min(...active.map((item) => item.price))) : "—"}
              </p>
              <p className="text-caption text-muted">Lowest price</p>
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-3">
            {grouped.map((group) => (
              <div key={group.category.id || "uncategorised"} className="mb-3 flex flex-col gap-3">
                <div className="flex items-baseline justify-between gap-3 px-1.5">
                  <h2 className="text-section text-ink">{group.category.name}</h2>
                  <p className="text-caption text-muted">
                    {group.services.length} {group.services.length === 1 ? "service" : "services"}
                  </p>
                </div>
                {group.services.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => openEditor(item)}
                    className="flex min-h-[100px] items-center gap-3 rounded-card bg-surface p-4 text-left shadow-card transition active:scale-[.995] active:opacity-80"
                  >
                    <span
                      aria-hidden
                      className={
                        item.active ? "size-2 shrink-0 rounded-full bg-success" : "size-2 shrink-0 rounded-full bg-muted"
                      }
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[16px] leading-6 font-bold text-ink">
                        {item.name}
                      </span>
                      <span className="block text-caption text-muted">
                        {duration(item.durationMinutes)} · {DEPOSIT_PERCENT}% deposit
                      </span>
                      <span
                        className={
                          item.active
                            ? "mt-0.5 block text-[10px] font-bold text-success"
                            : "mt-0.5 block text-[10px] font-bold text-muted"
                        }
                      >
                        {item.active ? "Live" : "Paused"}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-3">
                      <span className="text-body font-medium text-ink">{money(item.price)}</span>
                      <Pencil aria-hidden className="size-[18px] text-muted" />
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </>
      )}

      <Sheet
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        title={draft?.id === "local-new" ? "New service" : "Edit service"}
        size="lg"
        footer={
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setDraft(null)}
              className="min-h-[54px] flex-1 rounded-panel bg-surface text-body text-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void save()}
              className="min-h-[54px] flex-1 rounded-panel bg-primary text-body font-medium text-surface disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        }
      >
        {draft ? (
          <div className="flex flex-col gap-4">
            <label className="flex h-[150px] cursor-pointer flex-col items-center justify-center gap-1 overflow-hidden rounded-card border-[1.5px] border-dashed border-line bg-tint">
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    setDraft({
                      ...draft,
                      photoFile: file,
                      photoPreview: URL.createObjectURL(file),
                    });
                  }
                }}
              />
              {draft.photoPreview ?? draft.image ? (
                <span className="relative size-full">
                  <Image
                    src={(draft.photoPreview ?? draft.image) as string}
                    alt=""
                    fill
                    sizes="480px"
                    className="object-cover"
                  />
                </span>
              ) : (
                <>
                  <Camera aria-hidden className="size-7 text-primary" />
                  <span className="text-body font-medium text-ink">Add a service photo</span>
                  <span className="text-caption text-muted">Show the finished result</span>
                </>
              )}
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-caption font-bold text-ink">Service name</span>
              <input
                value={draft.name}
                placeholder="e.g. Signature silk press"
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                className="min-h-[54px] rounded-panel border border-line bg-surface px-4 text-body text-ink"
              />
            </label>

            <div className="flex flex-col gap-1.5">
              <span className="text-caption font-bold text-ink">Category</span>
              <span className="text-caption text-muted">
                Services appear together under this heading.
              </span>
              <div className="rail gap-3 py-1.5">
                {categories.map((category) => {
                  const selected = draft.categoryId === category.id;
                  return (
                    <button
                      key={category.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setDraft({ ...draft, categoryId: category.id })}
                      className={
                        selected
                          ? "flex min-h-[42px] shrink-0 items-center gap-1.5 rounded-full border border-primary bg-primary px-4 text-caption font-bold text-surface"
                          : "flex min-h-[42px] shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface px-4 text-caption font-bold text-ink"
                      }
                    >
                      {category.name}
                      {selected ? <Check aria-hidden className="size-[15px]" /> : null}
                    </button>
                  );
                })}
              </div>
            </div>

            <label className="flex flex-col gap-1.5">
              <span className="text-caption font-bold text-ink">Description</span>
              <textarea
                value={draft.description}
                placeholder="What is included?"
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                className="min-h-[120px] rounded-panel border border-line bg-surface px-4 py-3 text-body text-ink"
              />
            </label>

            <div className="flex gap-3">
              <label className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="text-caption font-bold text-ink">Price (GH₵)</span>
                <input
                  inputMode="decimal"
                  value={draft.price}
                  onChange={(event) =>
                    setDraft({ ...draft, price: event.target.value.replace(/[^\d.]/g, "") })
                  }
                  className="min-h-[54px] rounded-panel border border-line bg-surface px-4 text-body text-ink"
                />
              </label>
              <label className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="text-caption font-bold text-ink">Duration (min)</span>
                <input
                  inputMode="numeric"
                  value={draft.duration}
                  onChange={(event) =>
                    setDraft({ ...draft, duration: event.target.value.replace(/[^\d]/g, "").slice(0, 3) })
                  }
                  className="min-h-[54px] rounded-panel border border-line bg-surface px-4 text-body text-ink"
                />
              </label>
            </div>

            <div className="flex min-h-[72px] items-center justify-between gap-3 rounded-panel bg-surface px-4">
              <span>
                <span className="block text-caption font-bold text-ink">Visible to customers</span>
                <span className="block text-caption text-muted">Turn off to pause bookings</span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={draft.active}
                aria-label="Visible to customers"
                onClick={() => setDraft({ ...draft, active: !draft.active })}
                className={
                  draft.active
                    ? "relative h-8 w-14 shrink-0 rounded-full bg-primary transition-colors"
                    : "relative h-8 w-14 shrink-0 rounded-full bg-secondary transition-colors"
                }
              >
                <span
                  aria-hidden
                  className={
                    draft.active
                      ? "absolute top-1 left-1 size-6 translate-x-6 rounded-full bg-surface transition-transform"
                      : "absolute top-1 left-1 size-6 rounded-full bg-surface transition-transform"
                  }
                />
              </button>
            </div>

            {draft.id === "local-new" ? (
              <p className="text-caption text-muted">
                Your photo uploads with the service when you save.
              </p>
            ) : null}

            {formError ? <FormError message={formError} /> : null}
          </div>
        ) : null}
      </Sheet>
    </div>
  );
}
