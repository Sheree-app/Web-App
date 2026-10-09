/**
 * Explore view models. The mobile version typed `image` as a React Native image
 * source; on the web every category resolves to a URL string instead.
 */
export type Category = {
  id: string;
  slug: string;
  name: string;
  image: string | null;
  blush: string;
};

export type Professional = {
  id: string;
  name: string;
  category: string;
  location: string;
  distance: number;
  rating: number;
  reviews: number;
  price: number;
  available: boolean;
  verified: boolean;
  image: string;
  new?: boolean;
  latitude?: number;
  longitude?: number;
};

export const professionals: Professional[] = [];

export const collections = [
  {
    slug: "trending",
    title: "Main character",
    subtitle: "The looks everyone is saving",
    prompt: "I want the look of the moment",
    icon: "flash-outline" as const,
    color: "#F3CAD4",
    ink: "#7C3044",
    categories: [] as string[],
  },
  {
    slug: "top-rated",
    title: "No surprises",
    subtitle: "Loved, reviewed, rebooked",
    prompt: "I want a safe pair of hands",
    icon: "shield-checkmark-outline" as const,
    color: "#E4E7C9",
    ink: "#4D5527",
    categories: [] as string[],
  },
  {
    slug: "new",
    title: "Fresh energy",
    subtitle: "New talent worth knowing",
    prompt: "Show me someone unexpected",
    icon: "sparkles-outline" as const,
    color: "#D8E8DE",
    ink: "#315B43",
    categories: [] as string[],
  },
  {
    slug: "wedding",
    title: "Big day energy",
    subtitle: "Soft glam to final pin",
    prompt: "I have somewhere special to be",
    icon: "flower-outline" as const,
    color: "#E5D8EF",
    ink: "#5D3E74",
    categories: ["makeup", "wig installs", "braids", "manicures", "lashes"],
  },
  {
    slug: "self-care",
    title: "Soft reset",
    subtitle: "Treatments that slow time down",
    prompt: "I need an hour for myself",
    icon: "water-outline" as const,
    color: "#D3E7E7",
    ink: "#28595B",
    categories: ["spa (massage)", "facials", "manicures", "pedicures"],
  },
];
