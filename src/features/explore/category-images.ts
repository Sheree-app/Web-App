/**
 * Category artwork, mapped by interest slug.
 *
 * The mobile app bundled these as `require()` modules; on the web they are
 * static files under `/public/images/categories`. The slug → file mapping is
 * identical, so a category looks the same in both clients.
 */
export const categoryImages: Record<string, string> = {
  "wig-installs": "/images/categories/hair.png",
  barbering: "/images/categories/barbering.png",
  manicures: "/images/categories/nails.png",
  pedicures: "/images/categories/pedicures.png",
  makeup: "/images/categories/makeup.png",
  facials: "/images/categories/skincare.png",
  braids: "/images/categories/braids.png",
  lashes: "/images/categories/lashes.png",
  eyebrows: "/images/categories/lashes.png",
  spa: "/images/categories/spa.png",
  locs: "/images/categories/braids.png",
  photography: "/images/categories/photography.png",
  tattoos: "/images/categories/tattoos.png",
  piercings: "/images/categories/piercings.png",
  massage: "/images/categories/massage.png",
  fitness: "/images/categories/fitness.png",
  "home-services": "/images/categories/home-services.png",
  "pet-grooming": "/images/categories/pet-grooming.png",
  tutoring: "/images/categories/tutoring.png",
};

/** Fallback for interests that have no bundled artwork yet. */
export const fallbackCategoryImage = "/images/categories/other.png";

export function categoryImage(slug: string, imageUrl?: string | null) {
  return categoryImages[slug] ?? imageUrl ?? fallbackCategoryImage;
}
