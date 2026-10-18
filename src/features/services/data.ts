export type Service = {
  id: string;
  name: string;
  categoryId?: string;
  category: string;
  price: number;
  durationMinutes: number;
  description: string;
  image: string;
  active: boolean;
  popular?: boolean;
};
export const DEPOSIT_PERCENT = 40;
export const demoServices: Service[] = [
  {
    id: "s1",
    name: "The signature silk press",
    category: "Natural hair",
    price: 220,
    durationMinutes: 120,
    description:
      "A gentle cleanse, conditioning treatment, precision blow-dry and weightless silk finish. Includes a trim consultation.",
    image:
      "https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=1000",
    active: true,
    popular: true,
  },
  {
    id: "s2",
    name: "Wash, shape & define",
    category: "Natural hair",
    price: 160,
    durationMinutes: 90,
    description:
      "Hydrating cleanse, curl-by-curl shaping and a defined finish using products chosen for your texture.",
    image: "https://images.unsplash.com/photo-1560869713-7d0a29430803?w=1000",
    active: true,
  },
  {
    id: "s3",
    name: "Event hair",
    category: "Styling",
    price: 300,
    durationMinutes: 150,
    description:
      "A collaborative occasion look with prep, styling and secure finishing for photos, dancing and long days.",
    image:
      "https://images.unsplash.com/photo-1580618672591-eb180b1a973f?w=1000",
    active: true,
  },
  {
    id: "s4",
    name: "Healthy ends trim",
    category: "Care",
    price: 90,
    durationMinutes: 45,
    description:
      "A careful trim that keeps your shape while removing split or weathered ends. Best added between full appointments.",
    image: "https://images.unsplash.com/photo-1562322140-8baeececf3df?w=1000",
    active: false,
  },
];
export const duration = (minutes: number) =>
  minutes >= 60
    ? `${Math.floor(minutes / 60)} hr${minutes >= 120 ? "s" : ""}${minutes % 60 ? ` ${minutes % 60} min` : ""}`
    : `${minutes} min`;
