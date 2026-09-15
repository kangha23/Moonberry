import Phaser from 'phaser';
import FarmScene from './scenes/FarmScene';
import { MIN_VIEW_HEIGHT, MIN_VIEW_WIDTH } from './constants';
import { PALETTE } from './assets/palette.generated';

/**
 * The game fills whatever it is given.
 *
 * `RESIZE` rather than `FIT`: a fitted canvas is a fixed 960x640 world blown
 * up by CSS to whatever fraction of the window it happens to need, which on
 * most screens is not a whole number, and pixel art at 1.4x is a blurred mess
 * of the exact kind `pixelArt: true` is switched on to prevent.
 *
 * So the canvas is the window, and the camera picks a whole-number zoom to
 * suit — which means a bigger screen shows more world rather than a bigger
 * picture of the same world. That is how Stardew does it, and the scene sets
 * the zoom, because only the scene has a camera.
 */
export function createGameConfig(parent: HTMLElement): Phaser.Types.Core.GameConfig {
  return {
    type: Phaser.AUTO,
    parent,
    backgroundColor: PALETTE['shadow.1'],
    pixelArt: true,
    roundPixels: true,
    scene: [FarmScene],
    scale: {
      mode: Phaser.Scale.RESIZE,
      width: '100%',
      height: '100%',
      // Below this the HUD has nowhere left to go. The window can still be
      // smaller; the canvas simply stops shrinking with it.
      min: { width: MIN_VIEW_WIDTH / 2, height: MIN_VIEW_HEIGHT / 2 },
    },
    render: {
      antialias: false,
    },
  };
}
