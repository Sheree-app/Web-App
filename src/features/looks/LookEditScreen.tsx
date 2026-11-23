"use client";

import { Spinner } from "@/components/ui";
import { userMessage } from "@/lib/errors";
import { mediaAssetFromFile, type MediaAsset } from "@/lib/media";
import { cn } from "@/lib/utils";
import { useToast } from "@/providers/toast-provider";
import { ArrowLeft, Camera, ChevronLeft, ChevronRight, CircleCheck, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { createLook, updateLook, uploadLookPhoto, type Look, type UploadedLookPhoto } from "./api";
import { LOOK_CATEGORIES } from "./categories";
import {
  currentMonth,
  lookDate,
  dayOfMonth,
  monthLabel,
  parseAmount,
  pickableDays,
  shiftMonth,
  todayDay,
  weekdayShort,
} from "./format";
import { useLook } from "./queries";
import { Stars } from "./Stars";

const MAX_PHOTOS = 4;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const labelStyle = "mt-6 mb-2 block text-body font-bold text-ink";
const inputStyle =
  "w-full min-h-[54px] rounded-panel border border-secondary bg-surface px-4 text-body text-ink placeholder:text-muted transition-colors focus:border-primary focus:outline-none disabled:opacity-45";

/**
 * Add a look (photos first, then a few details), or edit one (`id`). Opened
 * from a booking prompt (`/looks/new?booking=…`), it arrives filled in: title,
 * category, day, price and professional come from the booking.
 */
export function LookEditScreen({ id }: { id?: string }) {
  const router = useRouter();
  const toast = useToast();
  const params = useSearchParams();
  const editing = Boolean(id);
  const bookingId = editing ? null : params.get("booking");

  const [startDay] = useState(() => {
    const date = params.get("date");
    return date && DAY_RE.test(date) && date <= todayDay() ? date : todayDay();
  });
  const [photos, setPhotos] = useState<MediaAsset[]>([]);
  const [title, setTitle] = useState(() => (editing ? "" : (params.get("title") ?? "").slice(0, 60)));
  const [category, setCategory] = useState<string | null>(() => {
    const slug = editing ? null : params.get("category");
    return LOOK_CATEGORIES.some((c) => c.slug === slug) ? slug : null;
  });
  const [month, setMonth] = useState(startDay.slice(0, 7));
  const [day, setDay] = useState(startDay);
  const [pro, setPro] = useState(() => (editing ? "" : (params.get("pro") ?? "")));
  const [proLocked, setProLocked] = useState(Boolean(bookingId));
  const [price, setPrice] = useState(() => (editing ? "" : (params.get("price") ?? "")));
  const [rating, setRating] = useState<number | null>(null);
  const [note, setNote] = useState("");
  // Editing: the cached look (if any) fills the form at once, a single time.
  const existing = useLook(id ?? null);
  const [seeded, setSeeded] = useState<Look | null>(null);
  if (existing.data && !seeded) {
    const l = existing.data;
    setSeeded(l);
    setTitle(l.title);
    setCategory(l.category);
    setMonth(l.done_on.slice(0, 7));
    setDay(l.done_on);
    setPro(l.professional_name ?? "");
    setProLocked(Boolean(l.professional_id));
    setPrice(l.price != null ? String(l.price) : "");
    setRating(l.rating);
    setNote(l.note ?? "");
  }
  const loading = editing && !seeded;
  const [status, setStatus] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const days = useMemo(() => pickableDays(month), [month]);

  const loadError = existing.error && !existing.data ? existing.error : null;
  useEffect(() => {
    if (!loadError) return;
    toast.error("Look unavailable", userMessage(loadError, "We couldn't open this look.", "looks.edit.load"));
    router.replace("/looks");
  }, [loadError, router, toast]);

  // Previews are object URLs: release them when the screen goes away.
  const photosRef = useRef(photos);
  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);
  useEffect(() => () => photosRef.current.forEach((p) => URL.revokeObjectURL(p.uri)), []);

  const priceValue = price.trim() ? parseAmount(price) : null;
  const priceInvalid = price.trim() !== "" && priceValue === null;
  const saving = status !== null;
  const ready =
    !saving &&
    !loading &&
    title.trim().length > 0 &&
    category !== null &&
    !priceInvalid &&
    (editing || photos.length > 0);

  const addFiles = async (files: FileList | File[]) => {
    const room = MAX_PHOTOS - photos.length;
    const images = [...files].filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
    if (!images.length || room <= 0) return;
    if (images.length > room) toast.error(`You can add up to ${MAX_PHOTOS} photos`);
    const added: MediaAsset[] = [];
    for (const file of images.slice(0, room)) {
      try {
        added.push(await mediaAssetFromFile(file));
      } catch (error) {
        toast.error("Photo not added", userMessage(error, "That image couldn't be used. Try a different one."));
      }
    }
    setPhotos((current) => {
      const next = [...current, ...added];
      next.slice(MAX_PHOTOS).forEach((p) => URL.revokeObjectURL(p.uri));
      return next.slice(0, MAX_PHOTOS);
    });
  };

  const removePhoto = (index: number) =>
    setPhotos((all) => {
      const gone = all[index];
      if (gone) URL.revokeObjectURL(gone.uri);
      return all.filter((_, j) => j !== index);
    });

  const goMonth = (delta: number) => {
    const next = shiftMonth(month, delta);
    if (next > currentMonth()) return;
    setMonth(next);
    const options = pickableDays(next);
    if (!options.includes(day)) setDay(options[0]);
  };

  const save = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!ready || !category) return;
    const details = {
      title: title.trim(),
      category,
      done_on: day,
      professional_name: proLocked ? undefined : pro.trim() || null,
      price: priceValue,
      rating,
      note: note.trim() || null,
    };
    try {
      if (editing && id) {
        setStatus("Saving…");
        const { professional_name, ...rest } = details;
        await updateLook(id, professional_name === undefined ? rest : { ...rest, professional_name });
        router.replace(`/looks/${id}`);
        return;
      }
      const uploaded: UploadedLookPhoto[] = [];
      for (const [i, asset] of photos.entries()) {
        setStatus(photos.length > 1 ? `Uploading photo ${i + 1} of ${photos.length}…` : "Uploading photo…");
        uploaded.push(await uploadLookPhoto(asset));
      }
      setStatus("Saving…");
      const look = await createLook({
        ...details,
        professional_name: details.professional_name ?? (pro.trim() || null),
        booking_id: bookingId,
        photos: uploaded,
      });
      router.replace(`/looks/${look.id}`);
    } catch (error) {
      toast.error(
        editing ? "Look not saved" : "Look not added",
        userMessage(error, "We couldn't save your look. Please try again.", "looks.save"),
      );
      setStatus(null);
    }
  };

  const today = todayDay();

  return (
    <form onSubmit={(e) => void save(e)} className="flex flex-col pt-2" noValidate>
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label="Back"
          onClick={() => (window.history.length > 1 ? router.back() : router.push("/looks"))}
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface text-ink transition hover:bg-tint"
        >
          <ArrowLeft aria-hidden className="size-5" />
        </button>
        <h1 className="text-section text-ink">{editing ? "Edit look" : "Add a look"}</h1>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner label="Loading your look" />
        </div>
      ) : (
        <fieldset disabled={saving} className="contents">
          {!editing ? (
            <>
              <span className={labelStyle} id="look-photos-label">
                Photos
              </span>
              <div
                role="group"
                aria-labelledby="look-photos-label"
                onDragOver={(e) => {
                  if (!e.dataTransfer.types.includes("Files")) return;
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  if (!saving) void addFiles(e.dataTransfer.files);
                }}
                className={cn(
                  "-mx-4 flex gap-2.5 overflow-x-auto rounded-panel px-4 py-1 transition md:mx-0 md:flex-wrap md:overflow-visible md:px-0",
                  dragging && "bg-tint outline-2 outline-dashed outline-primary",
                )}
              >
                {photos.map((p, i) => (
                  <div key={p.uri} className="relative size-[120px] shrink-0 overflow-hidden rounded-panel bg-tint">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.uri} alt={`Photo ${i + 1}`} className="absolute inset-0 size-full object-cover" />
                    {i === 0 ? (
                      <span className="absolute bottom-1.5 left-1.5 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-bold text-white">
                        Cover
                      </span>
                    ) : null}
                    <button
                      type="button"
                      aria-label={`Remove photo ${i + 1}`}
                      onClick={() => removePhoto(i)}
                      className="absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded-full bg-black/55 text-white transition hover:bg-black/75"
                    >
                      <X aria-hidden className="size-3.5" />
                    </button>
                  </div>
                ))}
                {photos.length < MAX_PHOTOS ? (
                  <button
                    type="button"
                    onClick={() => fileInput.current?.click()}
                    className="flex size-[120px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-panel border-[1.5px] border-dashed border-primary bg-surface text-primary transition hover:bg-tint active:scale-[.98]"
                  >
                    <Camera aria-hidden className="size-[26px]" />
                    <span className="text-caption font-bold text-ink">{photos.length ? "Add more" : "Add photos"}</span>
                    <span className="text-[11px] text-muted">up to {MAX_PHOTOS}</span>
                  </button>
                ) : null}
              </div>
              <p className="mt-2 hidden text-caption text-muted md:block">Or drop photos here.</p>
              <input
                ref={fileInput}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                multiple
                hidden
                onChange={(e) => {
                  const files = e.target.files ? [...e.target.files] : [];
                  e.target.value = "";
                  void addFiles(files);
                }}
              />
            </>
          ) : null}

          <label htmlFor="look-title" className={labelStyle}>
            Name it
          </label>
          <input
            id="look-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Knotless braids, chrome nails"
            maxLength={60}
            className={inputStyle}
          />

          <span className={labelStyle} id="look-category-label">
            Category
          </span>
          <div role="radiogroup" aria-labelledby="look-category-label" className="flex flex-wrap gap-2">
            {LOOK_CATEGORIES.map((c) => {
              const on = category === c.slug;
              return (
                <button
                  key={c.slug}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setCategory(c.slug)}
                  style={on ? { backgroundColor: c.color, borderColor: c.color } : undefined}
                  className={cn(
                    "flex h-10 items-center gap-1.5 rounded-full border px-3.5 text-caption transition",
                    on ? "font-bold text-white" : "border-line bg-surface text-ink hover:bg-tint",
                  )}
                >
                  <c.icon aria-hidden className="size-4" style={{ color: on ? "#FFFFFF" : c.color }} />
                  {c.name}
                </button>
              );
            })}
          </div>

          <div className="mt-6 mb-2 flex items-center justify-between">
            <span className="text-body font-bold text-ink" id="look-day-label">
              When
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="Previous month"
                onClick={() => goMonth(-1)}
                className="flex size-8 items-center justify-center rounded-full text-ink transition hover:bg-tint"
              >
                <ChevronLeft aria-hidden className="size-[18px]" />
              </button>
              <span className="min-w-[120px] text-center text-caption font-bold text-ink">{monthLabel(month)}</span>
              <button
                type="button"
                aria-label="Next month"
                disabled={month >= currentMonth()}
                onClick={() => goMonth(1)}
                className="flex size-8 items-center justify-center rounded-full text-ink transition hover:bg-tint disabled:opacity-30"
              >
                <ChevronRight aria-hidden className="size-[18px]" />
              </button>
            </div>
          </div>
          <div
            role="radiogroup"
            aria-labelledby="look-day-label"
            className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:thin] md:mx-0 md:px-0"
          >
            {days.map((d) => {
              const on = d === day;
              return (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={lookDate(d, today)}
                  onClick={() => setDay(d)}
                  className={cn(
                    "flex h-16 w-14 shrink-0 flex-col items-center justify-center rounded-panel border transition",
                    on ? "border-ink bg-ink text-surface" : "border-line bg-surface text-ink hover:bg-tint",
                  )}
                >
                  <span className={cn("text-[11px]", on ? "text-surface" : "text-muted")}>
                    {d === today ? "Today" : weekdayShort(d)}
                  </span>
                  <span className="text-body font-bold">{dayOfMonth(d)}</span>
                </button>
              );
            })}
          </div>

          <label htmlFor="look-pro" className={labelStyle}>
            Who did it
          </label>
          {proLocked ? (
            <div id="look-pro" className={cn(inputStyle, "flex items-center gap-2 bg-tint/50")}>
              <CircleCheck aria-hidden className="size-[18px] shrink-0 text-primary" />
              <span className="min-w-0 flex-1 truncate">{pro || "Your Sheree professional"}</span>
              <span className="shrink-0 text-caption font-bold text-primary">Sheree booking</span>
            </div>
          ) : (
            <input
              id="look-pro"
              value={pro}
              onChange={(e) => setPro(e.target.value)}
              placeholder="Salon or stylist (optional)"
              maxLength={80}
              className={inputStyle}
            />
          )}

          <label htmlFor="look-price" className={labelStyle}>
            What it cost (optional)
          </label>
          <div
            className={cn(
              inputStyle,
              "flex items-center gap-2 focus-within:border-primary",
              priceInvalid && "border-danger focus-within:border-danger",
            )}
          >
            <span className="text-body font-bold text-muted">GH₵</span>
            <input
              id="look-price"
              value={price}
              onChange={(e) => setPrice(e.target.value.replace(/[^0-9.,]/g, ""))}
              placeholder="0"
              inputMode="decimal"
              maxLength={10}
              aria-invalid={priceInvalid || undefined}
              className="min-w-0 flex-1 bg-transparent text-body text-ink placeholder:text-muted focus:outline-none"
            />
          </div>

          <span className={labelStyle}>How did you like it?</span>
          <Stars value={rating} onChange={setRating} size={30} label="How did you like it?" />

          <label htmlFor="look-note" className={labelStyle}>
            Notes (optional)
          </label>
          <textarea
            id="look-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Colour, length, products used, what you’d change…"
            maxLength={280}
            rows={4}
            className={cn(inputStyle, "min-h-28 resize-y py-3 leading-6")}
          />
        </fieldset>
      )}

      <div className="sticky bottom-[calc(88px+env(safe-area-inset-bottom))] mt-8 md:bottom-6">
        <button
          type="submit"
          disabled={!ready}
          className="flex min-h-14 w-full items-center justify-center gap-2 rounded-full bg-ink px-6 text-body font-bold text-surface shadow-card transition hover:brightness-110 active:scale-[.99] disabled:opacity-40 disabled:shadow-none"
        >
          {saving ? (
            <>
              <span aria-hidden className="size-5 animate-spin rounded-full border-2 border-surface/40 border-t-surface" />
              <span role="status">{status}</span>
            </>
          ) : editing ? (
            "Save changes"
          ) : (
            "Save to my looks"
          )}
        </button>
      </div>
    </form>
  );
}
