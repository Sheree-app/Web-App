/**
 * Visibility coordinator for feed clips.
 *
 * A feed page can hold dozens of clip cards. Only the most-visible one may
 * autoplay, and nothing else should keep playing in the background. The
 * decision is a pure function so it can be tested without a DOM; the tiny
 * registry below feeds it from IntersectionObserver updates.
 */

export type ClipVisibilityEntry = {
  id: string;
  /** Intersection ratio 0..1. */
  visible: number;
  /**
   * True once an IntersectionObserver has reported a real ratio for this card.
   *
   * A clip that has never been measured must not be treated as off screen: the
   * viewer can (and does) tap Play before the first observation lands, and a
   * clip parked at a partly scrolled position still deserves to play.
   */
  measured?: boolean;
  /** Whether this card is allowed to autoplay at all. */
  autoplay: boolean;
  /** Whether the clip is currently playing. */
  playing: boolean;
  /** A play the viewer started explicitly — it outranks autoplay. */
  manual: boolean;
};

export type PlaybackDecision = {
  /** Clip ids to start (at most one). */
  start: string[];
  /** Clip ids to pause. */
  pause: string[];
};

/** Below this fraction of the card on screen, a clip counts as not visible. */
export const MIN_VISIBLE_RATIO = 0.6;

/**
 * Visibility a clip must keep once the viewer started it by hand.
 *
 * This is deliberately far below `MIN_VISIBLE_RATIO`: the threshold above
 * decides whether a clip may start *on its own*, but a tap is an explicit
 * request. Reusing the autoplay threshold here cancelled playback the moment a
 * half-scrolled card was tapped — the clip mounted, the coordinator paused it,
 * and the player showed "Clip unavailable".
 */
export const MIN_MANUAL_VISIBLE_RATIO = 0.15;

/** Whether a clip the viewer started is still meant to be playing. */
function stillOnScreen(entry: ClipVisibilityEntry, minVisible: number): boolean {
  if (entry.measured === false) return true;
  return entry.visible >= Math.min(minVisible, MIN_MANUAL_VISIBLE_RATIO);
}

/**
 * Decides which clip owns playback.
 *
 * A manually started clip that is still on screen keeps playing (the viewer
 * chose it). Otherwise the most-visible autoplay-eligible clip wins, and every
 * other playing clip is paused.
 */
export function decidePlayback(
  entries: readonly ClipVisibilityEntry[],
  minVisible = MIN_VISIBLE_RATIO,
): PlaybackDecision {
  const playing = entries.filter((entry) => entry.playing);
  const manual = playing.find((entry) => entry.manual && stillOnScreen(entry, minVisible)) ?? null;

  const bestAutoplay =
    entries
      .filter((entry) => entry.autoplay && entry.visible >= minVisible)
      .sort((a, b) => b.visible - a.visible)[0] ?? null;

  const target = manual ?? bestAutoplay;
  const pause = playing
    .filter((entry) => !target || entry.id !== target.id)
    .map((entry) => entry.id);

  const start = target && !playing.some((entry) => entry.id === target.id) ? [target.id] : [];

  return { start, pause };
}

type RegisteredClip = {
  entry: ClipVisibilityEntry;
  start: () => void;
  pause: () => void;
};

const clips = new Map<string, RegisteredClip>();

function evaluate() {
  const decision = decidePlayback([...clips.values()].map((clip) => clip.entry));
  for (const id of decision.pause) clips.get(id)?.pause();
  for (const id of decision.start) clips.get(id)?.start();
}

/**
 * Registers one clip card with the page-wide coordinator.
 *
 * Re-registering keeps whatever playback state the clip already had (the effect
 * that registers also re-runs when the reduced-motion preference resolves), so
 * a playing clip is never silently forgotten by the coordinator.
 */
export function registerClip(
  id: string,
  handlers: { start: () => void; pause: () => void },
  initial: { autoplay: boolean },
) {
  const previous = clips.get(id)?.entry;
  const entry: ClipVisibilityEntry = previous
    ? { ...previous, autoplay: initial.autoplay }
    : {
        id,
        visible: 0,
        measured: false,
        autoplay: initial.autoplay,
        playing: false,
        manual: false,
      };
  clips.set(id, { entry, ...handlers });
}

/** Updates visibility or playback state and re-runs the decision. */
export function updateClip(
  id: string,
  patch: Partial<Pick<ClipVisibilityEntry, "visible" | "playing" | "manual" | "autoplay">>,
) {
  const clip = clips.get(id);
  if (!clip) return;
  clip.entry = {
    ...clip.entry,
    ...patch,
    // The first real ratio proves the card has been measured.
    ...(patch.visible === undefined ? {} : { measured: true }),
  };
  evaluate();
}

/** Removes a clip (and pauses it) when its card unmounts. */
export function unregisterClip(id: string) {
  const clip = clips.get(id);
  if (!clip) return;
  clip.pause();
  clips.delete(id);
  evaluate();
}

/** Test helper. */
export function __resetClipRegistry() {
  clips.clear();
}
