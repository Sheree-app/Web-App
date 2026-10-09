import { categoryImages } from "@/features/explore/category-images";
import Image from "next/image";

/**
 * The lookbook rail, ported from the welcome screen.
 *
 * Original metrics, unchanged: 116px cards at a 1.05 aspect with the name
 * beneath, 12px between cards, and a marquee that travels at 55 points per
 * second. The strip is rendered twice so the loop is seamless, and the second
 * copy is hidden from assistive tech — exactly as the native version did with
 * `accessibilityElementsHidden`.
 */
const LOOKS = [
  { name: "Braids", slug: "braids" },
  { name: "Nail art", slug: "manicures" },
  { name: "Lashes", slug: "lashes" },
  { name: "Barbering", slug: "barbering" },
  { name: "Wig installs", slug: "wig-installs" },
  { name: "Makeup", slug: "makeup" },
  { name: "Facials", slug: "facials" },
  { name: "Massage", slug: "spa" },
  { name: "Pedicures", slug: "pedicures" },
  { name: "Photography", slug: "photography" },
  { name: "Tattoos", slug: "tattoos" },
  { name: "Piercings", slug: "piercings" },
];

const CARD_WIDTH = 116;
const CARD_GAP = 12;
/** 55 points per second across the full strip. */
const MARQUEE_SPEED = 55;
const STRIP_SECONDS = (LOOKS.length * (CARD_WIDTH + CARD_GAP)) / MARQUEE_SPEED;

export function LookbookRail() {
  const strip = (
    <>
      {LOOKS.map((look) => (
        <figure key={look.slug} className="w-[116px] shrink-0">
          <div className="relative aspect-[1.05] overflow-hidden rounded-panel bg-secondary">
            <Image
              src={categoryImages[look.slug]}
              alt=""
              fill
              sizes="116px"
              className="object-cover"
              priority
            />
          </div>
          <figcaption className="mt-2 truncate text-caption text-ink">{look.name}</figcaption>
        </figure>
      ))}
    </>
  );

  return (
    <div
      aria-label="Lookbook categories"
      className="relative -mx-6 overflow-hidden"
    >
      <div className="flex w-max">
        {[0, 1].map((copy) => (
          <div
            key={copy}
            aria-hidden={copy === 1}
            style={{ animationDuration: `${STRIP_SECONDS}s` }}
            className="flex shrink-0 animate-marquee gap-3 pr-3"
          >
            {strip}
          </div>
        ))}
      </div>
    </div>
  );
}
