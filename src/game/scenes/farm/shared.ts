/**
 * What the farm's renderer agrees on across its parts.
 *
 * The depth bands, the two faces and the walk-sheet arithmetic are read by the
 * scene and by more than one of the views it hands its drawing to, so they
 * live here rather than in any one of them: a depth band written out twice is
 * two depth bands the first time somebody moves one.
 */
import type Phaser from 'phaser';
import { tint } from '../../assets/palette.generated';
import type { SoundManager } from '../../audio/SoundManager';
import type { FarmState, PlayerState } from '../../state/types';
import type { AreaId, Direction } from '../../world/areas';

/**
 * Depth bands. World objects sort by tile row below `weather`; everything at or
 * above it is screen-space and pinned to the camera.
 */
export const DEPTH = {
  weather: 1000,
  overlay: 1100,
  hud: 1200,
  modal: 1300,
};

/**
 * What a walker adds to its tile row to get its depth.
 *
 * Avatars sort above every Tiled prop by sitting in a band of their own, and
 * anything that has to occlude a player — a building — has to be in the same
 * band or the comparison is between two different scales.
 */
export const AVATAR_DEPTH_BASE = 40;

/**
 * Where a Tiled prop sorts.
 *
 * A prop drawn no taller than its footprint lies flat on the ground — a bush,
 * a rug, a ribbon of flowers — and keeps the depth the map gave it, below
 * everything that stands up.
 *
 * A prop whose drawing rises out of its footprint stands up, and has to sort
 * with the things that walk past it. It used to keep its map depth too, which
 * sits under the whole avatar band: a rock one row north of a tree's trunk was
 * drawn on top of the canopy, and so was a player walking behind it. So it
 * joins the band by the row its feet stand on, exactly as a building does —
 * north of the trunk is behind the canopy, south of it is in front.
 */
export function propDepth(
  prop: { y: number; height: number; depth: number },
  drawnHeight: number,
  tileSize: number,
): number {
  if (drawnHeight <= prop.height) return prop.depth;
  const feetRow = Math.floor((prop.y + prop.height - 1) / tileSize);
  return feetRow + AVATAR_DEPTH_BASE;
}

/**
 * Where a thing that is walked over sits: above the tilled-plot fringe at 0.5
 * and below everything that stands on the ground. Paths and sprinklers.
 */
export const GROUND_ITEM_DEPTH = 0.75;

/**
 * The two faces, and which is for what.
 *
 * VT323 for anything short: the clock, the coins, the energy, a cell number, a
 * panel heading. It is one of exactly two pixel faces on Google Fonts that
 * carry the Vietnamese tone marks, and the readable one of the two at HUD
 * sizes. It is monospaced, so numbers in the HUD line up in a column, and it
 * has no bold at all — emphasis here is a colour, never a weight.
 *
 * Nunito for anything that is a sentence: a line of dialogue, a description,
 * the prompt bar. A terminal face set in paragraphs is a chore to read.
 */
export const PIXEL_FONT = 'VT323, "Courier New", monospace';
export const PROSE_FONT = 'Nunito, system-ui, sans-serif';

/** Below 16px VT323 loses its tone marks into the letters above them. */
export const PIXEL_MIN_SIZE = 16;

/** LPC walkcycle rows: 0 = up, 1 = left, 2 = down, 3 = right. */
export const WALK_ROW: Record<Direction, number> = { up: 0, left: 1, down: 2, right: 3 };

/**
 * A row is nine frames wide, and eight of them are the walk.
 *
 * The two numbers are different because the sheets that ship here carry eight
 * poses in a row the loader reads as nine — the ninth column is empty. An
 * animation built from `+ 1` to `+ 8`, which is what an LPC export with a
 * separate standing frame wants, therefore ran off the end of the art and
 * spent a tenth of every second drawing the blank: a square of nothing over
 * the player, once per stride, for as long as they were moving. Nobody
 * notices a missing frame; everybody notices the flicker.
 *
 * So `STRIDE` is how far apart two rows are in the sheet, and `WALK_FRAMES`
 * is how many of each row is a person walking. The first frame doubles as the
 * standing pose, which is what it has always been used for.
 */
export const WALK_STRIDE = 9;
export const WALK_FRAMES = 8;

/** The frame a sprite facing this way stands on. */
export function standFrame(facing: Direction): number {
  return WALK_ROW[facing] * WALK_STRIDE;
}

/** What a doomed crop is tinted. Drained of colour rather than made lurid. */
export const WILT_TINT = tint('light.2');

/**
 * What a view needs from the scene it draws for.
 *
 * The scene owns which area is built, the group everything in it lives in,
 * the store it reads and the sound it plays; the views only borrow them. Read
 * through getters rather than handed over as values, because the area and its
 * layer are replaced every time somebody walks through a doorway.
 */
export interface SceneContext {
  readonly scene: Phaser.Scene;
  readonly farm: FarmState;
  readonly localPlayer: PlayerState | null;
  readonly builtArea: AreaId | null;
  readonly areaLayer: Phaser.GameObjects.Group | null;
  readonly audio: SoundManager;
}
