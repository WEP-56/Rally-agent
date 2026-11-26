import type { Transition } from "motion/react";

/**
 * Material 3 Expressive (Android 16 / Compose MotionScheme.expressive)
 * Physical spring parameters — zero fixed durations, velocity-preserving!
 */

/** Fast spatial spring: buttons, switches, chips, sliding pill indicators */
export const SPRING_FAST: Transition = {
  type: "spring",
  stiffness: 600,
  damping: 23,
  mass: 0.72,
};

/** Extra-bouncy micro jelly spring: tactile press/release, playful avatar/critter poke */
export const SPRING_JELLY: Transition = {
  type: "spring",
  stiffness: 520,
  damping: 16,
  mass: 0.68,
};

/** Default spatial spring: list FLIP layout reflow, card morphs, message pop-in */
export const SPRING_LAYOUT: Transition = {
  type: "spring",
  stiffness: 390,
  damping: 25,
  mass: 0.88,
};

/** Soft spatial spring: pane split expand/collapse, modal & popover entrance */
export const SPRING_PANEL: Transition = {
  type: "spring",
  stiffness: 330,
  damping: 26,
  mass: 0.95,
};
