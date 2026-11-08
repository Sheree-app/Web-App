"use client";

import type { Professional } from "@/features/explore/data";
import { env } from "@/lib/env";
import { formatDistance } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/** Geographic centre of Ghana — the mobile app's fallback when location is off. */
export const GHANA = { latitude: 7.9465, longitude: -1.0232 };

type LatLng = { latitude: number; longitude: number };

/*
 * Minimal typings for the slice of the Google Maps JavaScript API used here.
 * The API is loaded from Google's script tag rather than an npm package, so
 * there is no new dependency (and no @types/google.maps).
 */
type GLatLng = { lat(): number; lng(): number };
type GPoint = { x: number; y: number };
type GProjection = { fromLatLngToDivPixel(latLng: GLatLng): GPoint | null };
type GMap = {
  fitBounds(bounds: unknown, padding?: number | Record<string, number>): void;
  panTo(latLng: { lat: number; lng: number }): void;
  setZoom(zoom: number): void;
};
type GOverlayView = {
  setMap(map: GMap | null): void;
  getPanes(): { overlayMouseTarget: HTMLElement } | null;
  getProjection(): GProjection;
};
type OverlayCtor = new () => GOverlayView;
type GoogleMaps = {
  importLibrary(name: "maps"): Promise<{
    Map: new (el: HTMLElement, opts: Record<string, unknown>) => GMap;
    OverlayView: OverlayCtor;
  }>;
  importLibrary(name: "core"): Promise<{
    LatLng: new (lat: number, lng: number) => GLatLng;
    LatLngBounds: new () => { extend(latLng: GLatLng): void };
  }>;
};

declare global {
  interface Window {
    google?: { maps?: GoogleMaps };
    gm_authFailure?: () => void;
    __shereeMapsReady?: () => void;
  }
}

let loader: Promise<GoogleMaps> | null = null;
let authFailed = false;
const authListeners = new Set<() => void>();

/** Load the Maps JavaScript API once per page. */
function loadGoogleMaps(key: string): Promise<GoogleMaps> {
  if (window.google?.maps?.importLibrary) return Promise.resolve(window.google.maps);
  if (loader) return loader;
  loader = new Promise<GoogleMaps>((resolve, reject) => {
    // Google calls this when the key is invalid or not allowed on this origin.
    window.gm_authFailure = () => {
      authFailed = true;
      authListeners.forEach((listener) => listener());
    };
    window.__shereeMapsReady = () => {
      if (window.google?.maps) resolve(window.google.maps);
      else reject(new Error("Google Maps failed to initialise"));
    };
    const script = document.createElement("script");
    script.src =
      "https://maps.googleapis.com/maps/api/js?" +
      new URLSearchParams({
        key,
        v: "weekly",
        loading: "async",
        callback: "__shereeMapsReady",
      }).toString();
    script.async = true;
    script.onerror = () => {
      loader = null;
      script.remove();
      reject(new Error("Google Maps script failed to load"));
    };
    document.head.appendChild(script);
  });
  return loader;
}

const BRUSH_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m11 10 3 3"/><path d="M6.5 21A3.5 3.5 0 1 0 3 17.5a2.62 2.62 0 0 1-.708 1.792A1 1 0 0 0 3 21z"/><path d="M9.969 17.031 21.378 5.624a1 1 0 0 0-3.002-3.002L6.967 14.031"/></svg>';

function beauticianElement(professional: Professional, onOpen: () => void) {
  const root = document.createElement("button");
  root.type = "button";
  root.className = "flex w-[156px] cursor-pointer flex-col items-center";
  root.setAttribute(
    "aria-label",
    `${professional.name}, ${formatDistance(professional.distance)} away, ${professional.location}`,
  );
  root.title = `${professional.name} · ${professional.location}`;

  const label = document.createElement("span");
  label.className =
    "flex min-h-[31px] max-w-[156px] items-center gap-[7px] rounded-[14px] bg-ink px-2.5 py-1.5 shadow-md";
  const name = document.createElement("span");
  name.className = "truncate text-[11px] font-bold text-surface";
  name.textContent = professional.name;
  const distance = document.createElement("span");
  distance.className = "shrink-0 text-[10px] font-bold text-[#F3C6D0]";
  distance.textContent = formatDistance(professional.distance);
  label.append(name, distance);

  const pin = document.createElement("span");
  pin.className =
    "relative z-10 mt-1 flex size-[38px] items-center justify-center rounded-full border-[3px] border-surface bg-primary text-surface";
  pin.innerHTML = BRUSH_SVG;

  const tip = document.createElement("span");
  tip.className = "-mt-1.5 size-[9px] rotate-45 bg-primary";

  root.append(label, pin, tip);
  root.addEventListener("click", (event) => {
    event.stopPropagation();
    onOpen();
  });
  return root;
}

function userElement() {
  const dot = document.createElement("span");
  dot.className =
    "block size-4 rounded-full border-[3px] border-white bg-[#4285F4] shadow-[0_0_0_6px_rgba(66,133,244,0.2)]";
  dot.setAttribute("aria-label", "Your location");
  return dot;
}

/**
 * An HTML overlay anchored by its bottom-centre (pins) or its centre (the
 * user's dot). OverlayView needs no Map ID, unlike AdvancedMarkerElement.
 */
function createHtmlOverlay(
  OverlayView: OverlayCtor,
  position: GLatLng,
  element: HTMLElement,
  anchor: "bottom" | "center",
) {
  class HtmlOverlay extends OverlayView {
    onAdd() {
      element.style.position = "absolute";
      this.getPanes()?.overlayMouseTarget.appendChild(element);
    }
    draw() {
      const point = this.getProjection().fromLatLngToDivPixel(position);
      if (!point) return;
      element.style.left = `${point.x - element.offsetWidth / 2}px`;
      element.style.top =
        anchor === "bottom"
          ? `${point.y - element.offsetHeight}px`
          : `${point.y - element.offsetHeight / 2}px`;
    }
    onRemove() {
      element.remove();
    }
  }
  return new HtmlOverlay();
}

type MapStatus = "loading" | "ready" | "unavailable";

/**
 * The Explore map, ported from the mobile app's `Map`: every professional with
 * a pin, labelled with name and distance, the viewer as a blue dot, and a tap
 * through to the profile.
 */
export function ExploreMap({
  professionals,
  userLocation,
}: {
  professionals: Professional[];
  userLocation: LatLng | null;
}) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<GMap | null>(null);
  const [status, setStatus] = useState<MapStatus>(
    env.googleMapsApiKey ? "loading" : "unavailable",
  );

  const pinned = professionals.filter(
    (p) => typeof p.latitude === "number" && typeof p.longitude === "number",
  );

  // Create the map once.
  useEffect(() => {
    if (!env.googleMapsApiKey || !containerRef.current) return;
    let cancelled = false;
    const onAuthFailure = () => setStatus("unavailable");
    if (authFailed) {
      setStatus("unavailable");
      return;
    }
    authListeners.add(onAuthFailure);
    loadGoogleMaps(env.googleMapsApiKey)
      .then((maps) => maps.importLibrary("maps"))
      .then(({ Map }) => {
        if (cancelled || !containerRef.current) return;
        mapRef.current = new Map(containerRef.current, {
          center: { lat: GHANA.latitude, lng: GHANA.longitude },
          zoom: 7,
          disableDefaultUI: true,
          zoomControl: true,
          clickableIcons: false,
          gestureHandling: "cooperative",
        });
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("unavailable");
      });
    return () => {
      cancelled = true;
      authListeners.delete(onAuthFailure);
    };
  }, []);

  // Draw pins and the user's dot, then frame them like the mobile map does:
  // the user's surroundings when location is known, otherwise every pin.
  useEffect(() => {
    const map = mapRef.current;
    const maps = window.google?.maps;
    if (status !== "ready" || !map || !maps) return;
    let cancelled = false;
    const overlays: GOverlayView[] = [];

    void Promise.all([maps.importLibrary("maps"), maps.importLibrary("core")]).then(
      ([{ OverlayView }, { LatLng, LatLngBounds }]) => {
        if (cancelled) return;
        for (const professional of pinned) {
          const overlay = createHtmlOverlay(
            OverlayView,
            new LatLng(professional.latitude!, professional.longitude!),
            beauticianElement(professional, () =>
              router.push(`/professional/${professional.id}`),
            ),
            "bottom",
          );
          overlay.setMap(map);
          overlays.push(overlay);
        }
        if (userLocation) {
          const overlay = createHtmlOverlay(
            OverlayView,
            new LatLng(userLocation.latitude, userLocation.longitude),
            userElement(),
            "center",
          );
          overlay.setMap(map);
          overlays.push(overlay);
          map.panTo({ lat: userLocation.latitude, lng: userLocation.longitude });
          map.setZoom(14);
        } else if (pinned.length > 0) {
          const bounds = new LatLngBounds();
          pinned.forEach((p) => bounds.extend(new LatLng(p.latitude!, p.longitude!)));
          map.fitBounds(bounds, { top: 80, right: 48, bottom: 80, left: 48 });
        }
      },
    );

    return () => {
      cancelled = true;
      overlays.forEach((overlay) => overlay.setMap(null));
    };
    // `pinned` is derived from `professionals`; re-run only when inputs change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, professionals, userLocation?.latitude, userLocation?.longitude, router]);

  if (status === "unavailable") {
    return (
      <div className="mx-4 mt-4 flex h-[520px] items-center justify-center rounded-card bg-raised px-6">
        <p className="text-center text-caption font-bold text-ink">
          The map couldn’t load. Switch to List to browse professionals.
        </p>
      </div>
    );
  }

  return (
    <div className="relative mx-4 mt-4 h-[520px] overflow-hidden rounded-card bg-raised">
      <div ref={containerRef} className="absolute inset-0" />

      {status === "loading" ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="size-6 animate-spin rounded-full border-2 border-secondary border-t-primary" />
        </div>
      ) : null}

      <div className="pointer-events-none absolute top-3 left-3 flex items-center gap-1.5 rounded-full bg-raised px-2.5 py-2">
        <span
          className="flex size-[22px] items-center justify-center rounded-full bg-primary text-surface [&_svg]:size-3"
          dangerouslySetInnerHTML={{ __html: BRUSH_SVG }}
        />
        <span className="text-[10px] font-bold text-ink">Beautician</span>
        <span className="mx-0.5 h-4 w-px bg-line" />
        <span className="size-3 rounded-full border-2 border-surface bg-[#4285F4]" />
        <span className="text-[10px] font-bold text-ink">You</span>
      </div>

      {status === "ready" && pinned.length === 0 ? (
        <div className="pointer-events-none absolute right-4 bottom-4 left-4 rounded-panel bg-raised p-4">
          <p className="text-body font-medium text-ink">No beauticians have added a map pin</p>
          <p className="mt-0.5 text-caption text-muted">
            {userLocation
              ? "Your location is still shown in blue."
              : "Turn on location to see yourself on the map."}
          </p>
        </div>
      ) : null}
    </div>
  );
}
