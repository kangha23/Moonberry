/**
 * The screen layer: the one container everything pinned to the glass is drawn
 * in, and the few ways of making something to put in it.
 */
import Phaser from 'phaser';
import { PALETTE } from '../../assets/palette.generated';
import { DEPTH, PIXEL_FONT, PIXEL_MIN_SIZE } from './shared';

/**
 * The nine-slice frames, and how deep each one's border runs.
 *
 * The same three files the stylesheet uses. That is the point of them being
 * files: a panel edge drawn once in CSS and once in canvas drifts, and the two
 * halves of this interface arguing with each other is what this whole pass is
 * about.
 */
const FRAMES = {
  panel: { key: 'frame-wood', slice: 12 },
  slot: { key: 'frame-slot', slice: 4 },
  plate: { key: 'frame-plate', slice: 6 },
} as const;

/**
 * The screen layer, and why the HUD lives inside one container.
 *
 * The camera zooms the world, and a zoom scales everything it draws —
 * including objects pinned to it with `setScrollFactor(0)`. Left alone, a
 * 13px label would be 26px on a screen big enough for zoom 2, and a HUD laid
 * out in screen pixels would spread out from the middle of the viewport.
 *
 * So everything screen-space goes in one container which is scaled by 1/zoom
 * and placed so that the two transforms cancel exactly. Its children are then
 * in plain screen pixels with the origin at the top-left of the canvas, which
 * is the coordinate system `pointer.x` already speaks.
 */
export class ScreenLayer {
  /** The container itself. Null-asserted: `create` makes it, in scene order. */
  container!: Phaser.GameObjects.Container;

  private readonly scene: Phaser.Scene;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  create() {
    this.container = this.scene.add.container(0, 0).setScrollFactor(0).setDepth(DEPTH.weather - 1);
  }

  /**
   * Adds objects to the screen layer, in screen pixels.
   *
   * Each one is pinned to the camera on the way in, even though the container
   * already is and overrides them when it draws. Input is why: Phaser's hit
   * test reads the scroll factor off the object itself rather than off the
   * container holding it, so a hotbar cell left at the default would be
   * hit-tested in world coordinates while it is drawn in screen ones — and
   * every click on it would fall through onto the farm behind.
   */
  add(...objects: Phaser.GameObjects.GameObject[]) {
    for (const object of objects) {
      (object as Partial<Phaser.GameObjects.Components.ScrollFactor>).setScrollFactor?.(0);
    }
    this.container.add(objects);
  }

  /**
   * A framed box, in the same wood as the panels in the DOM.
   *
   * Always this, never `this.add.rectangle` with a stroke on it. The point of
   * the frames being files is that a box in the canvas and a box in React are
   * the same picture; a rounded rectangle drawn here would be the old argument
   * starting again in a new place.
   */
  frame(
    kind: keyof typeof FRAMES,
    x: number,
    y: number,
    width: number,
    height: number,
  ): Phaser.GameObjects.NineSlice {
    const { key, slice } = FRAMES[kind];
    return this.scene.add
      .nineslice(x, y, key, undefined, width, height, slice, slice, slice, slice)
      .setOrigin(0, 0);
  }

  /** Short text: the clock, a count, a label. Never below 16px. */
  pixelText(x: number, y: number, size = PIXEL_MIN_SIZE, colour = PALETTE['light.7']) {
    return this.scene.add.text(x, y, '', {
      fontFamily: PIXEL_FONT,
      fontSize: `${Math.max(PIXEL_MIN_SIZE, size)}px`,
      color: colour,
    });
  }
}
