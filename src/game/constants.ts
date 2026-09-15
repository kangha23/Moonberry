/**
 * The HUD's design size.
 *
 * No longer the size of the canvas: the canvas is whatever the window is, and
 * the camera picks an integer zoom to suit it. These two numbers survive as
 * the size the HUD was laid out against — the smallest screen the bar, the
 * clock and the energy tube were drawn to fit — so anything that needs a
 * reference rather than a measurement has one.
 */
export const GAME_WIDTH = 960;
export const GAME_HEIGHT = 640;

/**
 * The smallest view the world is ever shown at, in world pixels.
 *
 * The zoom is chosen so that at least this much world fits on screen. Twenty
 * tiles across and twelve and a half down: enough that a player can see what
 * is coming, on the narrowest window worth playing on.
 */
export const MIN_VIEW_WIDTH = 640;
export const MIN_VIEW_HEIGHT = 400;

/** Past this the world is more magnified than it is legible. */
export const MAX_ZOOM = 4;

/**
 * The camera zoom for a window, always a whole number.
 *
 * Being a whole number is the entire point of this function: 1.4x turns a
 * 32px tile into 44.8px, and pixel art at a fractional scale shimmers as the
 * camera moves. Better to show a little more world than to show it blurred.
 *
 * Which is the cost, and it is worth saying out loud: a player on a large
 * screen sees further than a player on a small one. In a co-operative game
 * with nothing to win off each other that is fine. If anything competitive
 * ever lands, this is the decision to revisit.
 *
 * Never returns 0 — a zoom of 0 is a blank screen, and a window can be
 * arbitrarily small while it is being dragged.
 */
export function zoomFor(width: number, height: number): number {
  const fit = Math.min(width / MIN_VIEW_WIDTH, height / MIN_VIEW_HEIGHT);
  if (!Number.isFinite(fit)) return 1;
  return Math.min(Math.max(Math.floor(fit), 1), MAX_ZOOM);
}
