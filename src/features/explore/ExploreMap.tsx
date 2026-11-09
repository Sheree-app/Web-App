"use client";

import type { Professional } from "@/features/explore/data";
import { env } from "@/lib/env";
import { cn, formatDistance } from "@/lib/utils";
import { Expand, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

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
  setOptions(options: Record<string, unknown>): void;
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

/* ------------------------------ Phone layout ------------------------------ */

const PHONE_QUERY = "(max-width: 767px)";

function subscribePhone(onChange: () => void) {
  const query = window.matchMedia(PHONE_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** Phones get a preview that opens full screen; larger screens get the inline map. */
function useIsPhone() {
  return useSyncExternalStore(
    subscribePhone,
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false,
  );
}

/**
 * How the map takes touches and the wheel:
 * - phone preview: not at all, so swiping scrolls the page and a tap opens it;
 * - phone full screen: one finger pans, like the mobile app (nothing else to scroll);
 * - larger screens: drag pans, Ctrl/⌘ + wheel zooms, plain wheel scrolls the page.
 */
function gestureMode(isPhone: boolean, expanded: boolean) {
  if (!isPhone) return "cooperative";
  return expanded ? "greedy" : "none";
}

const MAP_HISTORY_KEY = "sheereMapOpen";

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

  const isPhone = useIsPhone();
  const [expanded, setExpanded] = useState(false);
  const fullScreen = isPhone && expanded;

  const openFullScreen = useCallback(() => {
    // A history entry lets the phone's Back gesture close the map instead of
    // leaving Explore.
    window.history.pushState({ ...window.history.state, [MAP_HISTORY_KEY]: true }, "");
    setExpanded(true);
  }, []);

  const closeFullScreen = useCallback(() => {
    if (window.history.state?.[MAP_HISTORY_KEY]) window.history.back();
    else setExpanded(false);
  }, []);

  // Back (button or gesture) pops the entry pushed on open.
  useEffect(() => {
    if (!expanded) return;
    const onPopState = () => setExpanded(false);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [expanded]);

  // Full screen owns the viewport: no page scroll behind it, Escape closes it.
  useEffect(() => {
    if (!fullScreen) return;
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeFullScreen();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      root.style.overflow = previous;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [closeFullScreen, fullScreen]);

  // Rotating or resizing past phone width while open drops back to inline.
  useEffect(() => {
    if (expanded && !isPhone) closeFullScreen();
  }, [closeFullScreen, expanded, isPhone]);

  // Same map instance in both layouts; only how it takes gestures changes.
  useEffect(() => {
    if (status !== "ready") return;
    mapRef.current?.setOptions({ gestureHandling: gestureMode(isPhone, expanded) });
  }, [expanded, isPhone, status]);

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
          gestureHandling: gestureMode(window.matchMedia(PHONE_QUERY).matches, false),
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
      <div className="mx-4 mt-4 flex h-[420px] items-center justify-center rounded-card bg-raised px-6 md:h-[520px]">
        <p className="text-center text-caption font-bold text-ink">
          The map couldn’t load. Switch to List to browse professionals.
        </p>
      </div>
    );
  }

  return (
    <div
      role={fullScreen ? "dialog" : undefined}
      aria-modal={fullScreen ? true : undefined}
      aria-label={fullScreen ? "Map of beauticians" : undefined}
      className={cn(
        "overflow-hidden bg-raised",
        fullScreen
          ? "fixed inset-0 z-[70] animate-fade"
          : "relative mx-4 mt-4 h-[420px] rounded-card md:h-[520px]",
      )}
    >
      <div ref={containerRef} className="absolute inset-0" />

      {isPhone && !expanded && status === "ready" ? (
        // The preview ignores touches (see gestureMode), so this layer takes the
        // tap; swipes still scroll the page because it isn't a scroll container.
        <button
          type="button"
          onClick={openFullScreen}
          aria-label="Open the map full screen"
          className={cn(
            "absolute inset-0 z-[1] flex justify-center",
            // Clear of the "no pins" card, which sits along the bottom.
            pinned.length === 0 ? "items-center" : "items-end pb-4",
          )}
        >
          <span className="flex items-center gap-2 rounded-full bg-ink px-4 py-2.5 text-caption font-bold text-surface shadow-card">
            <Expand aria-hidden className="size-4" />
            Tap to explore the map
          </span>
        </button>
      ) : null}

      {fullScreen ? (
        <button
          type="button"
          onClick={closeFullScreen}
          aria-label="Close map"
          className="absolute top-[calc(12px+env(safe-area-inset-top))] right-3 z-[2] flex size-11 items-center justify-center rounded-full bg-raised text-ink shadow-card"
        >
          <X aria-hidden className="size-5" />
        </button>
      ) : null}

      {status === "loading" ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="size-6 animate-spin rounded-full border-2 border-secondary border-t-primary" />
        </div>
      ) : null}

      <div
        className={cn(
          "pointer-events-none absolute left-3 z-[2] flex items-center gap-1.5 rounded-full bg-raised px-2.5 py-2",
          fullScreen ? "top-[calc(18px+env(safe-area-inset-top))]" : "top-3",
        )}
      >
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
        <div
          className={cn(
            "pointer-events-none absolute right-4 left-4 z-[2] rounded-panel bg-raised p-4",
            fullScreen ? "bottom-[calc(16px+env(safe-area-inset-bottom))]" : "bottom-4",
          )}
        >
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
