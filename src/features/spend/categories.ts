import {
  Brush,
  Droplet,
  Eye,
  Flower2,
  Footprints,
  Gem,
  Leaf,
  Palette,
  Pencil,
  Ribbon,
  Scissors,
  ShoppingBag,
  Sparkles,
  UserRound,
  type LucideIcon,
} from "lucide-react";

/**
 * The spend tracker's categories: a line icon and a colour each, so every chart,
 * row and share card reads the same. Slugs match the server's fixed list
 * (`SPEND_CATEGORIES` in sheree-backend src/spend/spend-summary.ts); colours
 * match the mobile app. They are mid-tones that sit well on both themes and on
 * the cream share card.
 */
export type SpendCategory = {
  slug: string;
  name: string;
  icon: LucideIcon;
  color: string;
};

export const SPEND_CATEGORIES: SpendCategory[] = [
  { slug: "hair", name: "Hair", icon: Scissors, color: "#D98C9D" },
  { slug: "braids", name: "Braids", icon: Ribbon, color: "#B5647E" },
  { slug: "locs", name: "Locs", icon: Leaf, color: "#8C6A58" },
  { slug: "wigs", name: "Wigs", icon: Gem, color: "#C98FB0" },
  { slug: "nails", name: "Nails", icon: Brush, color: "#EE9DB4" },
  { slug: "pedicure", name: "Pedicure", icon: Footprints, color: "#F1AE94" },
  { slug: "lashes", name: "Lashes", icon: Eye, color: "#7A6390" },
  { slug: "brows", name: "Brows", icon: Pencil, color: "#A9836D" },
  { slug: "makeup", name: "Makeup", icon: Palette, color: "#DD7272" },
  { slug: "skincare", name: "Skincare", icon: Droplet, color: "#93B88A" },
  { slug: "spa", name: "Spa & massage", icon: Flower2, color: "#86B3C6" },
  { slug: "barber", name: "Barber", icon: UserRound, color: "#66727B" },
  { slug: "products", name: "Products", icon: ShoppingBag, color: "#E2B15E" },
  { slug: "other", name: "Other", icon: Sparkles, color: "#B9AEB2" },
];

const BY_SLUG = new Map(SPEND_CATEGORIES.map((c) => [c.slug, c]));

/** Any slug the server returns, including categories not in the picker. */
export function spendCategory(slug: string, name?: string): SpendCategory {
  return BY_SLUG.get(slug) ?? { slug, name: name ?? "Other", icon: Sparkles, color: "#B9AEB2" };
}
