import type Phaser from 'phaser';

/**
 * Full screen, which belongs to the browser rather than to the farm.
 *
 * Not in `FarmState` and not in the save: it is a property of this window on
 * this machine right now, the same as the volume would be if the volume were
 * not already kept separately for exactly that reason. A player who reloads
 * comes back in a window, and nothing about the farm has changed.
 *
 * Routed through Phaser's scale manager rather than `requestFullscreen` on an
 * element of our choosing, because the scale manager is what has to be told:
 * going full screen is a resize, and the camera zoom and the whole HUD layout
 * are chosen from the size of the canvas.
 */
let game: Phaser.Game | null = null;

export function registerGame(instance: Phaser.Game | null): void {
  game = instance;
}

/** True when the browser will allow it at all. Some will not, and say nothing. */
export function fullscreenAvailable(): boolean {
  return Boolean(game?.scale.fullscreen.available);
}

export function isFullscreen(): boolean {
  return Boolean(game?.scale.isFullscreen);
}

/**
 * Toggles it, if there is a game to toggle.
 *
 * Must be called from a real user gesture — a keypress or a click — or the
 * browser refuses. Both callers are one.
 */
export function toggleFullscreen(): void {
  game?.scale.toggleFullscreen();
}
