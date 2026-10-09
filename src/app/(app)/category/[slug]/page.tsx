"use client";

import { CardSkeleton, Skeleton } from "@/components/ui";
import { fetchExploreCategories, fetchProfessionalsByCategory } from "@/features/explore/api";
import type { Professional } from "@/features/explore/data";
import { ProfessionalTile } from "@/features/explore/ProfessionalTile";
import { ArrowLeft } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

/**
 * One trade's professionals, ported from `CategoryResultsScreen`: back button,
 * the trade as the title, the count, then full-width tiles.
 */
export default function CategoryPage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const slug = params.slug;

  const [title, setTitle] = useState("Category");
  const [items, setItems] = useState<Professional[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const [categories, professionals] = await Promise.all([
        fetchExploreCategories(),
        fetchProfessionalsByCategory(slug),
      ]);
      setTitle(categories.find((category) => category.slug === slug)?.name ?? "Category");
      setItems(professionals);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex flex-col px-4 pb-[146px] pt-2">
      <button
        type="button"
        aria-label="Go back"
        onClick={() => router.back()}
        className="mb-6 flex size-11 items-center justify-center rounded-full bg-surface text-ink"
      >
        <ArrowLeft aria-hidden className="size-5" />
      </button>

      {loading ? (
        <Skeleton className="h-[34px] w-[48%] rounded-field" />
      ) : (
        <h1 className="text-page text-ink">{title}</h1>
      )}
      <p className="mt-2 text-body text-muted">
        Professionals with active services in this category.
      </p>

      {loading ? (
        <div className="mt-12 flex flex-col gap-4">
          <Skeleton className="h-3 w-[92px] rounded-tile" />
          <CardSkeleton lines={3} />
          <CardSkeleton lines={3} />
        </div>
      ) : error ? (
        <div className="mt-8 flex flex-col items-center gap-3 rounded-card bg-surface p-8">
          <h2 className="text-title text-ink">This category could not load</h2>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-1 rounded-full bg-primary px-6 py-2.5 text-caption font-bold text-surface"
          >
            Try again
          </button>
        </div>
      ) : (
        <>
          <p className="my-6 text-caption text-muted">
            {items.length} {items.length === 1 ? "professional" : "professionals"}
          </p>

          <div className="flex flex-col gap-4">
            {items.map((item) => (
              <ProfessionalTile key={item.id} item={item} wide />
            ))}
          </div>

          {items.length === 0 ? (
            <div className="mt-8 flex flex-col items-center gap-3 rounded-card bg-surface p-8">
              <h2 className="text-title text-ink">No active services yet</h2>
              <p className="text-center text-caption text-muted">
                Professionals who add services here will appear automatically.
              </p>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
