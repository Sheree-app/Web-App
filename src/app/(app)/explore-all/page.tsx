"use client";

import { CardSkeleton, RowSkeleton } from "@/components/ui";
import { categoryImage } from "@/features/explore/category-images";
import { prefetchCategoryProfessionals, useExploreCategories, useExploreProfessionals } from "@/features/explore/queries";
import type { Category, Professional } from "@/features/explore/data";
import { ProfessionalTile } from "@/features/explore/ProfessionalTile";
import { ArrowLeft, ArrowRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo } from "react";

const EMPTY_PROS: Professional[] = [];
const EMPTY_CATEGORIES: Category[] = [];

/**
 * The "See all" destination from Explore, matching `explore-all` on mobile:
 * one screen that serves the categories, the available-today list and the
 * trending list, decided by the `section` parameter.
 */
function ExploreAll() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const section = searchParams.get("section") ?? "trending";

  // Shared with Explore, so this usually paints from the cache at once.
  const people = useExploreProfessionals();
  const categoryQuery = useExploreCategories();
  const items: Professional[] = people.data ?? EMPTY_PROS;
  const categories: Category[] = categoryQuery.data ?? EMPTY_CATEGORIES;
  // As before, a failed load just ends the skeleton.
  const loading = section === "categories" ? categoryQuery.isLoading : people.isLoading;

  const list = useMemo(
    () => (section === "available" ? items.filter((item) => item.available) : items),
    [items, section],
  );

  const title =
    section === "categories"
      ? "All beauty services"
      : section === "available"
        ? "Available today"
        : "Trending near you";

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
        <div className="min-w-0">
          <p className="text-[9px] leading-[14px] font-bold tracking-[1.5px] text-primary uppercase">
            Explore beauty
          </p>
          <h1 className="truncate text-[27px] leading-[35px] font-bold text-ink">{title}</h1>
        </div>
      </div>

      {loading ? (
        <div className="mt-8 flex flex-col gap-4">
          {section === "categories" ? (
            <>
              <RowSkeleton />
              <RowSkeleton />
              <RowSkeleton />
            </>
          ) : (
            <>
              <CardSkeleton lines={3} />
              <CardSkeleton lines={3} />
            </>
          )}
        </div>
      ) : section === "categories" ? (
        <div className="mt-8 flex flex-col gap-3">
          {categories.map((category) => (
            <Link
              key={category.id}
              href={`/category/${category.slug}`}
              onPointerEnter={() => prefetchCategoryProfessionals(category.slug)}
              onFocus={() => prefetchCategoryProfessionals(category.slug)}
              onTouchStart={() => prefetchCategoryProfessionals(category.slug)}
              className="flex h-[84px] items-center gap-4 overflow-hidden rounded-panel bg-surface pr-4"
            >
              <span className="relative h-full w-[92px] shrink-0 bg-secondary">
                <Image
                  src={categoryImage(category.slug, category.image)}
                  alt=""
                  fill
                  sizes="92px"
                  className="object-cover"
                />
              </span>
              <span className="flex-1 truncate text-title text-ink">{category.name}</span>
              <ArrowRight aria-hidden className="size-[18px] shrink-0 text-primary" />
            </Link>
          ))}
        </div>
      ) : (
        <div className="mt-8 flex flex-col gap-4">
          {list.map((item) => (
            <ProfessionalTile key={item.id} item={item} wide />
          ))}
        </div>
      )}
    </div>
  );
}

export default function ExploreAllPage() {
  return (
    <Suspense fallback={<div className="px-4 py-8 text-caption text-muted">Loading…</div>}>
      <ExploreAll />
    </Suspense>
  );
}
