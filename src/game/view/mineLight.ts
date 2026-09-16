/**
 * How dark the mine is, and how far a light reaches into it.
 *
 * Numbers only, so the curve can be checked without a canvas: the scene turns
 * these into an overlay with a hole in it. Spec 13 wants the screen to darken
 * with depth and the torch from spec 11 to finally be worth carrying, and both
 * of those are decisions about numbers before they are about drawing.
 */
import { MAX_DEPTH } from '../systems/mine';
import { TILE_SIZE } from '../world/areas';

/** How opaque the dark is on the first floor, and on the last. */
export const DARKNESS_TOP = 0.5;
export const DARKNESS_BOTTOM = 0.9;

/**
 * The overlay's opacity on a floor. Straight from top to bottom, so every
 * floor is a little darker than the one above it and no floor is black.
 */
export function mineDarkness(depth: number): number {
  const through = (Math.min(Math.max(depth, 1), MAX_DEPTH) - 1) / (MAX_DEPTH - 1);
  return DARKNESS_TOP + (DARKNESS_BOTTOM - DARKNESS_TOP) * through;
}

/** How far the player can see with nothing in hand, and with a torch, in world pixels. */
export const BARE_LIGHT_RADIUS = 4 * TILE_SIZE;
export const TORCH_LIGHT_RADIUS = 7 * TILE_SIZE;
/** How far a torch set down on the floor lights around itself. */
export const PLACED_TORCH_RADIUS = 5 * TILE_SIZE;

/** The radius of the clear circle round the player. */
export function lightRadius(holdingTorch: boolean): number {
  return holdingTorch ? TORCH_LIGHT_RADIUS : BARE_LIGHT_RADIUS;
}

/**
 * A torch's flicker: a small wobble on its radius, from two sines at unrelated
 * rates so it never settles into a beat. The hearth uses the same trick.
 */
export function flicker(seconds: number, seed = 0): number {
  return 1 + Math.sin(seconds * 7.3 + seed) * 0.03 + Math.sin(seconds * 12.1 + seed * 1.7) * 0.02;
}
