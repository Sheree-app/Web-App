import { Copy } from "lucide-react";
import Link from "next/link";
import type { Look } from "./api";

/** A square thumbnail in the looks grid; opens the look. */
export function LookTile({ look }: { look: Look }) {
  const cover = look.photos[0];
  return (
    <Link
      href={`/looks/${look.id}`}
      aria-label={look.title}
      className="group relative block aspect-square overflow-hidden rounded-[14px] bg-tint transition active:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      {cover ? (
        // Look photos are private-diary objects on R2 at unguessable keys; a
        // plain <img> keeps them out of the image optimizer's cache.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={cover.thumbnail}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 size-full object-cover transition duration-300 md:group-hover:scale-[1.03]"
        />
      ) : null}
      {look.photos.length > 1 ? (
        <Copy aria-hidden className="absolute top-1.5 right-1.5 size-[13px] fill-white text-white drop-shadow" />
      ) : null}
    </Link>
  );
}
