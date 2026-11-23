"use client";

import { Avatar, Spinner } from "@/components/ui";
import { useBeauticians } from "@/features/account/queries";
import { userMessage } from "@/lib/errors";
import { ArrowLeft, ChevronRight, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** Every beautician the customer has had a completed appointment with. */
export default function BeauticiansPage() {
  const router = useRouter();
  const { data, error: loadError, isLoading, refetch } = useBeauticians();
  const pros = data ?? [];
  const loading = isLoading;
  // Only an error with nothing cached to show is worth a full error state.
  const error =
    loadError && !data
      ? userMessage(loadError, "We couldn’t load your beauticians. Try again.", "account.beauticians")
      : "";
  const load = () => void refetch();

  return (
    <div className="flex flex-col px-4 pb-12 pt-2">
      <button
        type="button"
        aria-label="Go back"
        onClick={() => router.back()}
        className="mb-5 flex size-11 items-center justify-center rounded-full bg-surface text-ink"
      >
        <ArrowLeft aria-hidden className="size-5" />
      </button>
      <h1 className="text-page text-ink">Your beauticians</h1>
      <p className="mt-1 text-body text-muted">Everyone you’ve had an appointment with on Sheree.</p>

      {loading ? (
        <div className="mt-10 flex justify-center">
          <Spinner label="Loading your beauticians" />
        </div>
      ) : error ? (
        <div className="mt-6 flex flex-col items-center gap-1 rounded-card bg-surface p-6 text-center">
          <p className="text-title text-ink">Beauticians are out of reach</p>
          <p className="text-caption text-muted">{error}</p>
          <button
            type="button"
            onClick={load}
            className="mt-2 rounded-full bg-primary px-6 py-2.5 text-caption font-bold text-surface"
          >
            Try again
          </button>
        </div>
      ) : pros.length === 0 ? (
        <div className="mt-6 flex flex-col items-center gap-1 rounded-card bg-surface p-6 text-center">
          <Users aria-hidden className="size-7 text-primary" />
          <p className="text-title text-ink">No beauticians yet</p>
          <p className="text-caption text-muted">
            After your first completed appointment, your beautician will show up here.
          </p>
        </div>
      ) : (
        <ul className="mt-5 flex flex-col gap-2">
          {pros.map((pro) => (
            <li key={pro.professionalId}>
              <Link
                href={`/professional/${pro.professionalId}`}
                className="flex items-center gap-3 rounded-panel bg-surface p-2 transition hover:bg-tint active:opacity-70"
              >
                <Avatar name={pro.name} src={pro.avatarUrl} size={52} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-medium text-ink">{pro.name}</span>
                  <span className="block truncate text-[11px] text-muted">
                    {pro.lastService} · {formatDate(pro.lastVisit)}
                  </span>
                  <span className="block text-[11px] text-muted">
                    {pro.visits} {pro.visits === 1 ? "visit" : "visits"}
                    {pro.location ? ` · ${pro.location}` : ""}
                  </span>
                </span>
                <ChevronRight aria-hidden className="size-[18px] shrink-0 text-muted" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
