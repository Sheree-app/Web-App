"use client";

import { ConfirmDialog, Sheet, Skeleton } from "@/components/ui";
import { userMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { useToast } from "@/providers/toast-provider";
import {
  ArrowLeft,
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  Ellipsis,
  Repeat,
  SquarePen,
  Trash2,
  User,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { deleteLook, type Look } from "./api";
import { useLook } from "./queries";
import { lookCategory } from "./categories";
import { lookDate, money } from "./format";
import { Stars } from "./Stars";

/** One look: its photos, then the details and "book again". */
export function LookScreen({ id }: { id: string }) {
  const router = useRouter();
  const toast = useToast();
  const lookQuery = useLook(id);
  const [menu, setMenu] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Deleting drops the look from the cache; keep showing it while we leave.
  const [lastLook, setLastLook] = useState<Look | null>(null);
  if (lookQuery.data && lookQuery.data !== lastLook) setLastLook(lookQuery.data);
  const look = lookQuery.data ?? (deleting ? lastLook : null);
  const failed = Boolean(lookQuery.error) && !look;

  const back = () => (window.history.length > 1 ? router.back() : router.push("/looks"));

  const remove = async () => {
    setDeleting(true);
    try {
      await deleteLook(id);
      toast.success("Look deleted");
      router.replace("/looks");
    } catch (error) {
      setDeleting(false);
      setConfirmDelete(false);
      toast.error("Not deleted", userMessage(error, "We couldn't delete this look. Please try again.", "looks.delete"));
    }
  };

  const cat = look ? lookCategory(look.category, look.category_name) : null;

  return (
    <div className="flex flex-col md:grid md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] md:items-start md:gap-8">
      <div className="relative -mx-4 -mt-4 md:mx-0 md:mt-0">
        {look ? (
          <Photos look={look} />
        ) : failed ? (
          <div className="aspect-[4/5] w-full bg-tint md:rounded-card" />
        ) : (
          <Skeleton className="aspect-[4/5] w-full rounded-none md:rounded-card" />
        )}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-between p-3">
          <button type="button" aria-label="Back" onClick={back} className={glass}>
            <ArrowLeft aria-hidden className="size-5" />
          </button>
          {look ? (
            <button
              type="button"
              aria-label="More options"
              aria-haspopup="dialog"
              onClick={() => setMenu(true)}
              className={glass}
            >
              <Ellipsis aria-hidden className="size-5" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="pt-5 md:pt-2">
        {failed && !look ? (
          <p className="text-body text-muted">We couldn’t load this look. Go back and try again.</p>
        ) : !look || !cat ? (
          <div className="flex flex-col gap-2.5">
            <Skeleton className="h-[26px] w-3/5" />
            <Skeleton className="h-3.5 w-2/5" />
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3">
              <span
                className="inline-flex items-center gap-1.5 rounded-full bg-tint px-2.5 py-1 text-caption font-bold"
                style={{ color: cat.color }}
              >
                <cat.icon aria-hidden className="size-3.5" />
                {cat.name}
              </span>
              <span className="text-caption text-muted">{lookDate(look.done_on)}</span>
            </div>
            <h1 className="mt-2 text-page text-ink">{look.title}</h1>
            {look.rating ? (
              <div className="mt-2">
                <Stars value={look.rating} />
              </div>
            ) : null}

            <div className="mt-5 flex flex-col gap-2">
              {look.professional_name ? (
                <Detail
                  icon={User}
                  label="Done by"
                  value={look.professional_name}
                  href={look.professional_id ? `/professional/${look.professional_id}` : undefined}
                />
              ) : null}
              {look.price != null ? <Detail icon={Wallet} label="Cost" value={money(look.price)} /> : null}
              {look.booking_id ? <Detail icon={CalendarCheck} label="Booked on" value="Sheree" /> : null}
            </div>

            {look.note ? <p className="mt-4 text-body whitespace-pre-line text-ink">{look.note}</p> : null}

            <div className="mt-6 flex flex-col gap-2.5">
              {look.professional_id ? (
                // Same destination as "Book again" on a booking: her service menu.
                <Link
                  href={`/services/${look.professional_id}`}
                  className="flex min-h-[54px] items-center justify-center gap-2 rounded-panel bg-primary text-body font-bold text-surface transition hover:brightness-[1.04] active:scale-[.99]"
                >
                  <Repeat aria-hidden className="size-[19px]" />
                  Book this again
                </Link>
              ) : null}
              <Link
                href={`/looks/${look.id}/edit`}
                className="flex min-h-[54px] items-center justify-center gap-2 rounded-panel border border-line bg-surface text-body font-medium text-ink transition hover:bg-tint active:scale-[.99]"
              >
                <SquarePen aria-hidden className="size-[19px]" />
                Edit details
              </Link>
            </div>
          </>
        )}
      </div>

      <Sheet open={menu} onClose={() => setMenu(false)} title={look?.title ?? "Look"}>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => {
              setMenu(false);
              router.push(`/looks/${id}/edit`);
            }}
            className="flex min-h-[52px] items-center gap-3 rounded-panel px-3 text-body text-ink transition hover:bg-tint"
          >
            <SquarePen aria-hidden className="size-5" />
            Edit details
          </button>
          <button
            type="button"
            onClick={() => {
              setMenu(false);
              setConfirmDelete(true);
            }}
            className="flex min-h-[52px] items-center gap-3 rounded-panel px-3 text-body text-danger transition hover:bg-danger-surface"
          >
            <Trash2 aria-hidden className="size-5" />
            Delete look
          </button>
        </div>
      </Sheet>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this look?"
        message="Its photos are deleted too. This can’t be undone."
        confirmLabel="Delete"
        cancelLabel="Keep"
        destructive
        loading={deleting}
        onConfirm={() => void remove()}
        onClose={() => !deleting && setConfirmDelete(false)}
      />
    </div>
  );
}

const glass =
  "pointer-events-auto flex size-11 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur-md transition hover:bg-black/50";

/** Swipeable photos (scroll-snap), with arrows and arrow keys on desktop. */
function Photos({ look }: { look: Look }) {
  const strip = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  const count = look.photos.length;

  const go = (index: number) => {
    const node = strip.current;
    if (!node) return;
    const next = Math.max(0, Math.min(count - 1, index));
    node.scrollTo({ left: next * node.clientWidth, behavior: "smooth" });
  };

  return (
    <div
      className="relative aspect-[4/5] w-full overflow-hidden bg-tint md:rounded-card"
      role="region"
      aria-roledescription="carousel"
      aria-label={`${look.title} photos`}
      tabIndex={count > 1 ? 0 : undefined}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight") go(page + 1);
        if (event.key === "ArrowLeft") go(page - 1);
      }}
    >
      <div
        ref={strip}
        onScroll={(event) => {
          const node = event.currentTarget;
          setPage(Math.round(node.scrollLeft / Math.max(1, node.clientWidth)));
        }}
        className="flex size-full snap-x snap-mandatory overflow-x-auto [scrollbar-width:none]"
      >
        {look.photos.map((photo, i) => (
          <div key={photo.id} className="relative size-full shrink-0 snap-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photo.original}
              alt={count > 1 ? `Photo ${i + 1} of ${count}` : look.title}
              loading={i === 0 ? "eager" : "lazy"}
              className="absolute inset-0 size-full object-cover"
              // The thumbnail shows while the full photo loads.
              style={{ backgroundImage: `url(${photo.thumbnail})`, backgroundSize: "cover" }}
            />
          </div>
        ))}
      </div>
      {count > 1 ? (
        <>
          <div className="absolute inset-x-0 bottom-3 flex justify-center gap-1.5" aria-hidden>
            {look.photos.map((p, i) => (
              <span
                key={p.id}
                className={cn("h-1.5 rounded-full bg-white/60 transition-all", i === page ? "w-4 bg-white" : "w-1.5")}
              />
            ))}
          </div>
          {page > 0 ? (
            <button
              type="button"
              aria-label="Previous photo"
              onClick={() => go(page - 1)}
              className={cn(glass, "absolute top-1/2 left-3 hidden -translate-y-1/2 md:flex")}
            >
              <ChevronLeft aria-hidden className="size-5" />
            </button>
          ) : null}
          {page < count - 1 ? (
            <button
              type="button"
              aria-label="Next photo"
              onClick={() => go(page + 1)}
              className={cn(glass, "absolute top-1/2 right-3 hidden -translate-y-1/2 md:flex")}
            >
              <ChevronRight aria-hidden className="size-5" />
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function Detail({ icon: Icon, label, value, href }: { icon: LucideIcon; label: string; value: string; href?: string }) {
  const body = (
    <>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-tint text-primary">
        <Icon aria-hidden className="size-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-caption text-muted">{label}</span>
        <span className="block truncate text-body font-medium text-ink">{value}</span>
      </span>
      {href ? <ChevronRight aria-hidden className="size-[18px] text-muted" /> : null}
    </>
  );
  const style = "flex items-center gap-3 rounded-panel bg-surface p-3";
  return href ? (
    <Link href={href} className={cn(style, "transition hover:bg-tint")}>
      {body}
    </Link>
  ) : (
    <div className={style}>{body}</div>
  );
}
