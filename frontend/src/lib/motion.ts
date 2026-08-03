/**
 * Motion tokens & fluid-gesture helpers
 * ----------------------------------------------------------------------------
 * Single source for framer-motion spring presets, CSS-aligned easings/durations,
 * and Apple WWDC-style gesture math (rubberband, momentum projection, velocity).
 *
 * Spec: frontend/DESIGN.md §11–16 · details: frontend/docs/MOTION.md
 *
 * Usage:
 *   import { springs, variants, rubberband, project } from "@/lib/motion";
 *   <Motion.div transition={springs.sheet} variants={variants.sheetFromLeft} />
 *
 * Prefer `@/components/common/Motion` over bare `motion.*` so reduced-motion
 * is honored automatically.
 */

import type { Transition, Variants } from "framer-motion";

/* ============================================================================
 * CSS-aligned tokens (mirror :root in index.css)
 * ========================================================================= */

/** Strong custom curves — never use bare ease-in for UI. */
export const easings = {
  /** Default UI enter/exit — punchy ease-out */
  out: "cubic-bezier(0.23, 1, 0.32, 1)",
  /** Existing soft ease-out (legacy alias) */
  outSoft: "cubic-bezier(0.22, 1, 0.36, 1)",
  /** On-screen move / morph */
  inOut: "cubic-bezier(0.77, 0, 0.175, 1)",
  /** iOS/Ionic sheet curve */
  drawer: "cubic-bezier(0.32, 0.72, 0, 1)",
  linear: "linear",
} as const;

/** Durations in seconds (framer-motion) and ms notes for CSS. */
export const durations = {
  /** Keyboard / high-frequency toggles — no animation */
  instant: 0,
  /** Button press feedback */
  press: 0.12,
  /** Tooltips, small popovers */
  micro: 0.16,
  /** Dropdowns, segment controls (CSS --duration-fast) */
  fast: 0.15,
  /** Default UI (CSS --duration-normal) */
  normal: 0.22,
  /** Modals, medium panels */
  panel: 0.28,
  /** Full drawers / complex sheets */
  sheet: 0.36,
} as const;

/** CSS variable names for use in style props / class construction. */
export const cssVars = {
  easeOut: "var(--ease-out)",
  easeOutSoft: "var(--ease-out-soft)",
  easeInOut: "var(--ease-in-out-strong)",
  easeDrawer: "var(--ease-drawer)",
  durationInstant: "var(--duration-instant)",
  durationPress: "var(--duration-press)",
  durationMicro: "var(--duration-micro)",
  durationFast: "var(--duration-fast)",
  durationNormal: "var(--duration-normal)",
  durationPanel: "var(--duration-panel)",
  durationSheet: "var(--duration-sheet)",
} as const;

/* ============================================================================
 * Spring presets (Apple-style: bounce + duration ≈ damping + response)
 * Default is critically damped (bounce: 0). Add bounce only after momentum.
 * ========================================================================= */

export const springs = {
  /** Default UI reposition — critically damped, ~0.35s response */
  ui: { type: "spring", bounce: 0, duration: 0.35 } satisfies Transition,
  /** Side drawer / sheet open-close */
  sheet: { type: "spring", bounce: 0, duration: 0.32 } satisfies Transition,
  /** Centered modal */
  modal: { type: "spring", bounce: 0, duration: 0.28 } satisfies Transition,
  /** After flick / drag release — slight overshoot allowed */
  momentum: { type: "spring", bounce: 0.18, duration: 0.4 } satisfies Transition,
  /** Snappy chips, toggles, small popovers */
  snappy: { type: "spring", bounce: 0, duration: 0.22 } satisfies Transition,
  /** Soft settle for decorative follow (mouse parallax, etc.) */
  soft: { type: "spring", bounce: 0, duration: 0.5 } satisfies Transition,
} as const;

export type SpringName = keyof typeof springs;

/* ============================================================================
 * CSS transition snippets (string form for style / non-FM code)
 * ========================================================================= */

export const cssTransitions = {
  press: `transform ${durations.press * 1000}ms ${easings.out}`,
  fade: `opacity ${durations.micro * 1000}ms ${easings.out}`,
  fadeTransform: `opacity ${durations.normal * 1000}ms ${easings.out}, transform ${durations.normal * 1000}ms ${easings.out}`,
  colors: `background-color ${durations.fast * 1000}ms ${easings.outSoft}, color ${durations.fast * 1000}ms ${easings.outSoft}, border-color ${durations.fast * 1000}ms ${easings.outSoft}`,
} as const;

/* ============================================================================
 * framer-motion variants (recipes)
 * ========================================================================= */

/** Modal / dialog: scale from 0.96 + opacity (never scale(0)). */
export const fadeScaleIn: Variants = {
  initial: { opacity: 0, scale: 0.96 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.96 },
};

/** Scrim / backdrop fade. */
export const scrimFade: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
};

/** Sheet/drawer from left (mobile nav). Enter/exit same path. */
export const sheetFromLeft: Variants = {
  initial: { x: "-100%" },
  animate: { x: 0 },
  exit: { x: "-100%" },
};

/** Sheet from bottom (action sheets, compose). */
export const sheetFromBottom: Variants = {
  initial: { y: "100%" },
  animate: { y: 0 },
  exit: { y: "100%" },
};

/** Sheet from right. */
export const sheetFromRight: Variants = {
  initial: { x: "100%" },
  animate: { x: 0 },
  exit: { x: "100%" },
};

/** Small popover-style fade + scale (use transformOrigin from trigger). */
export const popoverIn: Variants = {
  initial: { opacity: 0, scale: 0.97 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.97 },
};

/** List item stagger child — pair with staggerChildren on parent. */
export const listItemIn: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
};

/** Parent list stagger config (30–50ms). Never block pointer events. */
export const listStagger: Variants = {
  animate: {
    transition: { staggerChildren: 0.04, delayChildren: 0.02 },
  },
};

export const variants = {
  fadeScaleIn,
  scrimFade,
  sheetFromLeft,
  sheetFromBottom,
  sheetFromRight,
  popoverIn,
  listItemIn,
  listStagger,
} as const;

/* ============================================================================
 * Press feedback constants
 * ========================================================================= */

/** Recommended active scale for buttons / pressable rows. */
export const PRESS_SCALE = 0.97;
/** Slightly subtler scale already used on Button primitive. */
export const PRESS_SCALE_SUBTLE = 0.98;

/* ============================================================================
 * Apple fluid-interface math (WWDC Designing Fluid Interfaces)
 * ========================================================================= */

/**
 * Progressive resistance past a boundary. Hard stops feel frozen;
 * rubberbanding feels responsive with "nothing more here".
 *
 * @param overshoot  Distance past the bound (signed)
 * @param dimension  Relevant axis size (e.g. sheet height) for normalization
 * @param constant   Apple sample uses ~0.55
 */
export function rubberband(
  overshoot: number,
  dimension: number,
  constant = 0.55,
): number {
  if (dimension <= 0) return 0;
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

/**
 * Project resting position from release velocity (exponential decay form
 * Apple ships — not textbook v²/(2a)).
 *
 * @param initialVelocity  px/s at release
 * @param decelerationRate  ~0.998 normal scroll feel; ~0.99 snappier
 * @returns additional distance the gesture would travel
 */
export function project(initialVelocity: number, decelerationRate = 0.998): number {
  return ((initialVelocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

/**
 * Nearest snap point to a projected endpoint.
 */
export function nearestSnap(value: number, points: readonly number[]): number {
  if (points.length === 0) return value;
  let best = points[0]!;
  let bestDist = Math.abs(value - best);
  for (let i = 1; i < points.length; i++) {
    const p = points[i]!;
    const d = Math.abs(value - p);
    if (d < bestDist) {
      best = p;
      bestDist = d;
    }
  }
  return best;
}

/** One sample for velocity estimation. */
export type VelocitySample = { position: number; time: number };

/**
 * Estimate velocity (px/s) from the last two (or more) pointer samples.
 * Prefer a short history (~2–5 samples) rather than only the final point.
 */
export function velocityFromHistory(
  samples: readonly VelocitySample[],
  /** Look back window in ms */
  windowMs = 100,
): number {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1]!;
  const cutoff = last.time - windowMs;
  let first = samples[0]!;
  for (let i = samples.length - 2; i >= 0; i--) {
    const s = samples[i]!;
    first = s;
    if (s.time <= cutoff) break;
  }
  const dt = last.time - first.time;
  if (dt <= 0) return 0;
  return ((last.position - first.position) / dt) * 1000;
}

/**
 * Relative spring velocity for APIs that want velocity normalized by remaining distance.
 * Framer Motion usually wants absolute px/s — use that when available.
 */
export function relativeVelocity(
  gestureVelocity: number,
  current: number,
  target: number,
): number {
  const remaining = target - current;
  if (Math.abs(remaining) < 1e-6) return 0;
  return gestureVelocity / remaining;
}

/**
 * Dismiss if past distance threshold OR flick velocity (Sonner/Emil style).
 * Default velocity threshold ~0.11 px/ms (= 110 px/s) is a common feel.
 */
export function shouldDismissFromGesture(opts: {
  distance: number;
  /** px/s */
  velocity: number;
  distanceThreshold: number;
  /** px/s — quick flick */
  velocityThreshold?: number;
}): boolean {
  const vThresh = opts.velocityThreshold ?? 110;
  return (
    Math.abs(opts.distance) >= opts.distanceThreshold ||
    Math.abs(opts.velocity) >= vThresh
  );
}

/**
 * Hysteresis: require this many px of movement before locking gesture axis.
 */
export const GESTURE_AXIS_LOCK_PX = 10;

/**
 * Build a spring transition that continues at the finger's release velocity.
 */
export function springWithVelocity(
  base: Transition,
  velocityPxPerSec: number,
): Transition {
  return {
    ...base,
    type: "spring",
    velocity: velocityPxPerSec,
  };
}

/* ============================================================================
 * Decision helpers (documentation-as-code)
 * ========================================================================= */

/**
 * Whether an interaction should animate at all.
 * Keyboard-driven and very high-frequency actions must not animate.
 */
export function shouldAnimate(opts: {
  /** Estimated times user sees this per day */
  dailyFrequency?: number;
  /** True for Cmd-K, shortcuts, arrow list nav, etc. */
  keyboardInitiated?: boolean;
}): boolean {
  if (opts.keyboardInitiated) return false;
  if (opts.dailyFrequency != null && opts.dailyFrequency >= 100) return false;
  return true;
}
