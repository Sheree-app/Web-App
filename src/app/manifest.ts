import type { MetadataRoute } from "next";

/**
 * Installable web app manifest. The mobile app shipped a native shell; this is
 * the web equivalent so Sheree can live on a home screen without an app store.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sheree — book beauty and wellness professionals",
    short_name: "Sheree",
    description:
      "Find, compare and book trusted hair, beauty, wellness and grooming professionals near you.",
    start_url: "/discover",
    display: "standalone",
    orientation: "portrait",
    background_color: "#FCFAF8",
    theme_color: "#FCFAF8",
    categories: ["beauty", "lifestyle", "shopping"],
    icons: [
      { src: "/images/icon.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/images/icon.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/images/icon.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
