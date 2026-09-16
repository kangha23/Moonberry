import Phaser from 'phaser';
import { PALETTE } from './palette.generated';
import { CROP_ORDER, ITEMS } from '../systems/items';
import { CROP_PALETTES, ICON_SIZE, foragePalette, iconFor } from './itemIcons';
import { PLACEABLE_KINDS } from '../systems/items';
import { FORAGE_DEFS } from '../systems/items';
import { TREE_STAGES } from '../systems/resources';
import { MINED_ITEMS } from '../systems/mine';
import { MILESTONE, SIGNBOARD, SIGNPOST } from '../ui/hudLayout';

const TILE = 32;

type CanvasTexture = ReturnType<Phaser.Textures.TextureManager['createCanvas']>;

function withTexture(
  scene: Phaser.Scene,
  key: string,
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
) {
  if (scene.textures.exists(key)) return;
  const texture = scene.textures.createCanvas(key, width, height) as CanvasTexture | null;
  if (!texture) throw new Error(`Unable to create texture ${key}`);
  const context = texture.getContext();
  context.imageSmoothingEnabled = false;
  draw(context);
  texture.refresh();
}

function rect(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

function px(ctx: CanvasRenderingContext2D, color: string, x: number, y: number) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
}

/**
 * A palette colour with an alpha channel, for the places canvas 2D wants a
 * translucent fill or stroke rather than an opaque `rect`/`px`.
 *
 * `scripts/palette-lock.test.mjs` only recognises `#rrggbb` and `0xRRGGBB`
 * literals, so a hand-typed `rgba(...)` slips past the lock completely
 * invisible to it — which is how this file ended up with 34 of them holding
 * colours nobody had checked against the 48. Building the string from a
 * palette hex instead means every translucent colour here is still one of
 * the 48, even though the lock itself cannot see that it is.
 */
function withAlpha(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Deterministic pseudo-random from coords so grass looks varied but stable. */
function hash(x: number, y: number, seed = 7) {
  let h = (x * 374761393 + y * 668265263 + seed * 974634211) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

// Was 'rgba(24,38,24,0.35)', a dark green-black nobody had checked against
// the palette. shadow.1 (#0a2726) is the nearest entry — also a dark,
// slightly green-teal near-black — so the tile outline keeps the same weight
// and hue family it always had.
function outline(ctx: CanvasRenderingContext2D, w: number, h: number, color = withAlpha(PALETTE['shadow.1'], 0.35)) {
  rect(ctx, color, 0, 0, w, 1);
  rect(ctx, color, 0, h - 1, w, 1);
  rect(ctx, color, 0, 0, 1, h);
  rect(ctx, color, w - 1, 0, 1, h);
}

function drawGrass(
  ctx: CanvasRenderingContext2D,
  base: string = PALETTE['light.0'],
  dark: string = PALETTE['leaf.2'],
  light: string = PALETTE['light.1'],
) {
  rect(ctx, base, 0, 0, TILE, TILE);
  // large soft checker dither
  for (let y = 0; y < TILE; y += 4) {
    for (let x = 0; x < TILE; x += 4) {
      if (hash(x, y) > 0.62) rect(ctx, dark, x, y, 4, 4);
    }
  }
  // light speckles
  for (let i = 0; i < 26; i += 1) {
    const x = Math.floor(hash(i, 1) * 30) + 1;
    const y = Math.floor(hash(i, 99) * 30) + 1;
    px(ctx, hash(i, 7) > 0.5 ? light : dark, x, y);
    px(ctx, light, x + 1, y);
  }
  // tufts
  rect(ctx, dark, 5, 20, 1, 5);
  rect(ctx, dark, 7, 18, 1, 7);
  rect(ctx, light, 6, 19, 1, 5);
  rect(ctx, dark, 22, 8, 1, 5);
  rect(ctx, light, 23, 9, 1, 4);
  rect(ctx, dark, 15, 26, 1, 4);
  // tiny clover flowers
  px(ctx, PALETTE['light.7'], 11, 6);
  px(ctx, PALETTE['light.7'], 26, 24);
  outline(ctx, TILE, TILE);
}

function drawSoil(ctx: CanvasRenderingContext2D, wet = false) {
  const base = wet ? PALETTE['soil.2'] : PALETTE['soil.4'];
  const furrow = wet ? PALETTE['soil.0'] : PALETTE['soil.2'];
  const ridge = wet ? PALETTE['soil.4'] : PALETTE['soil.6'];
  rect(ctx, base, 0, 0, TILE, TILE);
  for (let r = 0; r < 4; r += 1) {
    const y = 4 + r * 8;
    rect(ctx, furrow, 1, y + 3, 30, 3);
    rect(ctx, ridge, 1, y, 30, 2);
  }
  // pebbles
  rect(ctx, ridge, 6, 6, 2, 1);
  rect(ctx, furrow, 22, 20, 3, 2);
  rect(ctx, ridge, 18, 27, 2, 1);
  if (wet) {
    rect(ctx, PALETTE['building.0'], 7, 22, 10, 2);
    rect(ctx, PALETTE['leaf.3'], 8, 22, 5, 1);
  }
  outline(ctx, TILE, TILE);
}

export function createPixelArtTextures(scene: Phaser.Scene) {
  withTexture(scene, 'tile-grass', TILE, TILE, (ctx) => drawGrass(ctx));
  withTexture(scene, 'tile-grass-2', TILE, TILE, (ctx) => drawGrass(ctx, PALETTE['light.0'], PALETTE['leaf.1'], PALETTE['light.1']));
  withTexture(scene, 'tile-grass-3', TILE, TILE, (ctx) => drawGrass(ctx, PALETTE['light.0'], PALETTE['leaf.2'], PALETTE['light.1']));

  withTexture(scene, 'tile-path', TILE, TILE, (ctx) => {
    rect(ctx, PALETTE['light.5'], 0, 0, TILE, TILE);
    rect(ctx, PALETTE['light.5'], 0, 0, TILE, 5);
    rect(ctx, PALETTE['soil.6'], 0, 27, TILE, 5);
    // cobble dots
    rect(ctx, PALETTE['light.2'], 5, 9, 7, 4);
    rect(ctx, PALETTE['light.5'], 6, 9, 5, 1);
    rect(ctx, PALETTE['light.2'], 19, 16, 8, 5);
    rect(ctx, PALETTE['light.7'], 20, 16, 6, 1);
    rect(ctx, PALETTE['soil.6'], 8, 21, 5, 3);
    for (let i = 0; i < 12; i += 1) {
      px(ctx, PALETTE['soil.5'], Math.floor(hash(i, 3) * 30) + 1, Math.floor(hash(i, 11) * 30) + 1);
    }
    outline(ctx, TILE, TILE);
  });

  withTexture(scene, 'tile-water', TILE, TILE, (ctx) => {
    rect(ctx, PALETTE['water.2'], 0, 0, TILE, TILE);
    // The deep band used to repaint this same water.2 over itself — a no-op
    // that told the next reader there was a darker band along the bottom
    // when there was not. `water` cannot be read as a light-to-dark ramp:
    // water.0 #3c49ad is indigo and water.1 #7f2c99 is magenta-purple, so
    // neither reads as "the same water, but deeper" the way soil.0..soil.6
    // does. water.0 is the nearest thing to a depth step this group has —
    // darker and cooler than water.2 without being a different hue family —
    // so it stands in for the deep band. water.1 stays unusable here for the
    // same reason it is unusable anywhere water needs a ramp: a purple deep
    // band would read as a dye spill, not depth.
    rect(ctx, PALETTE['water.0'], 0, 26, TILE, 6);
    rect(ctx, PALETTE['water.3'], 0, 0, TILE, 3);
    // waves
    rect(ctx, PALETTE['light.6'], 4, 9, 10, 2);
    rect(ctx, PALETTE['light.7'], 5, 9, 4, 1);
    rect(ctx, PALETTE['water.3'], 17, 16, 11, 2);
    rect(ctx, PALETTE['light.7'], 18, 16, 4, 1);
    // The ripple used to be water.2 painted over the deep band's own
    // water.2, invisible for the same reason the deep band's fill was.
    // Now that the deep band is water.0, this ripple in water.3 (the same
    // pale-teal highlight the waves above use) actually shows against it.
    rect(ctx, PALETTE['water.3'], 7, 21, 8, 1);
    outline(ctx, TILE, TILE);
  });

  withTexture(scene, 'plot-wild', TILE, TILE, (ctx) => {
    drawGrass(ctx, PALETTE['leaf.2'], PALETTE['leaf.1'], PALETTE['light.1']);
    rect(ctx, PALETTE['leaf.0'], 9, 8, 2, 14);
    rect(ctx, PALETTE['light.0'], 11, 10, 2, 10);
    rect(ctx, PALETTE['foliage.3'], 20, 12, 2, 12);
    rect(ctx, PALETTE['light.0'], 22, 14, 2, 8);
    rect(ctx, PALETTE['light.5'], 24, 24, 3, 2);
  });

  withTexture(scene, 'plot-tilled', TILE, TILE, (ctx) => drawSoil(ctx, false));
  withTexture(scene, 'plot-watered', TILE, TILE, (ctx) => drawSoil(ctx, true));

  // Fallback only: `crop-seeded.png` from [LPC] Crops is drawn when it loads.
  // A sown bed is a little heap of turned earth in soil tones, not pale blocks
  // lying on top of it, which on brown soil read as pebbles.
  withTexture(scene, 'crop-seeded', TILE, TILE, (ctx) => {
    ctx.clearRect(0, 0, TILE, TILE);
    rect(ctx, PALETTE['soil.1'], 10, 20, 12, 3);
    rect(ctx, PALETTE['soil.1'], 12, 17, 8, 3);
    rect(ctx, PALETTE['soil.3'], 11, 19, 10, 2);
    rect(ctx, PALETTE['soil.5'], 13, 17, 6, 2);
    rect(ctx, PALETTE['soil.6'], 14, 17, 3, 1);
    px(ctx, PALETTE['light.5'], 15, 18);
    px(ctx, PALETTE['light.5'], 18, 19);
  });

  withTexture(scene, 'crop-sprout', TILE, TILE, (ctx) => {
    ctx.clearRect(0, 0, TILE, TILE);
    rect(ctx, PALETTE['leaf.1'], 15, 17, 2, 8);
    rect(ctx, PALETTE['light.0'], 9, 13, 7, 5);
    rect(ctx, PALETTE['light.1'], 10, 13, 4, 2);
    rect(ctx, PALETTE['leaf.2'], 17, 11, 7, 6);
    rect(ctx, PALETTE['light.1'], 18, 11, 4, 2);
    rect(ctx, PALETTE['foliage.3'], 15, 22, 2, 3);
  });

  createCropTextures(scene);

  withTexture(scene, 'player', 24, 32, (ctx) => {
    ctx.clearRect(0, 0, 24, 32);
    // shadow anchor drawn separately in scene; body with outline feel
    rect(ctx, PALETTE['shadow.0'], 7, 2, 10, 3); // hat top shadow
    rect(ctx, PALETTE['soil.4'], 5, 4, 14, 4); // straw hat
    rect(ctx, PALETTE['light.5'], 6, 5, 12, 2);
    rect(ctx, PALETTE['light.2'], 5, 7, 14, 1);
    rect(ctx, PALETTE['light.5'], 7, 8, 10, 7); // face
    rect(ctx, PALETTE['shadow.0'], 9, 10, 2, 2);
    rect(ctx, PALETTE['shadow.0'], 14, 10, 2, 2);
    rect(ctx, PALETTE['light.5'], 8, 12, 2, 1);
    rect(ctx, PALETTE['light.5'], 15, 12, 2, 1);
    rect(ctx, PALETTE['leaf.3'], 6, 15, 12, 9); // shirt
    rect(ctx, PALETTE['light.0'], 7, 16, 4, 6);
    rect(ctx, PALETTE['leaf.0'], 14, 16, 4, 8);
    rect(ctx, PALETTE['light.5'], 3, 17, 3, 7); // arms
    rect(ctx, PALETTE['light.5'], 18, 17, 3, 7);
    rect(ctx, PALETTE['foliage.4'], 7, 24, 4, 6); // pants
    rect(ctx, PALETTE['foliage.4'], 13, 24, 4, 6);
    rect(ctx, PALETTE['shadow.3'], 7, 27, 4, 1);
    rect(ctx, PALETTE['shadow.3'], 13, 27, 4, 1);
    rect(ctx, PALETTE['outline.3'], 6, 30, 5, 2); // boots
    rect(ctx, PALETTE['outline.3'], 13, 30, 5, 2);
  });

  withTexture(scene, 'rowan', 24, 32, (ctx) => {
    ctx.clearRect(0, 0, 24, 32);
    rect(ctx, PALETTE['light.7'], 5, 2, 14, 5); // gray hair / hood
    rect(ctx, PALETTE['light.7'], 6, 3, 12, 2);
    rect(ctx, PALETTE['light.7'], 7, 7, 10, 7);
    rect(ctx, PALETTE['shadow.0'], 9, 9, 2, 2);
    rect(ctx, PALETTE['shadow.0'], 14, 9, 2, 2);
    rect(ctx, PALETTE['light.7'], 9, 9, 1, 1);
    rect(ctx, PALETTE['building.0'], 5, 14, 14, 10); // robe
    rect(ctx, PALETTE['water.3'], 6, 15, 5, 7);
    rect(ctx, PALETTE['foliage.4'], 14, 15, 5, 9);
    rect(ctx, PALETTE['light.5'], 11, 16, 2, 6); // clasp
    rect(ctx, PALETTE['soil.2'], 7, 24, 4, 6);
    rect(ctx, PALETTE['soil.2'], 13, 24, 4, 6);
    rect(ctx, PALETTE['soil.0'], 6, 29, 5, 2);
    rect(ctx, PALETTE['soil.0'], 13, 29, 5, 2);
  });

  withTexture(scene, 'farmhouse', 112, 84, (ctx) => {
    ctx.clearRect(0, 0, 112, 84);
    // shadow
    rect(ctx, 'rgba(0,0,0,0.25)', 4, 78, 104, 6);
    // walls
    rect(ctx, PALETTE['soil.4'], 10, 36, 92, 42);
    rect(ctx, PALETTE['soil.5'], 12, 38, 88, 4);
    rect(ctx, PALETTE['soil.2'], 12, 70, 88, 8);
    // timber frame
    rect(ctx, PALETTE['soil.0'], 10, 36, 4, 42);
    rect(ctx, PALETTE['soil.0'], 98, 36, 4, 42);
    rect(ctx, PALETTE['soil.0'], 10, 52, 92, 3);
    // roof
    rect(ctx, PALETTE['building.1'], 4, 22, 104, 16);
    rect(ctx, PALETTE['light.3'], 6, 24, 100, 4);
    rect(ctx, PALETTE['clothWarm.1'], 6, 32, 100, 6);
    for (let x = 8; x < 104; x += 8) rect(ctx, PALETTE['clothWarm.1'], x, 24, 2, 12);
    // chimney
    rect(ctx, PALETTE['building.0'], 80, 8, 12, 18);
    rect(ctx, PALETTE['foliage.4'], 80, 8, 12, 3);
    rect(ctx, 'rgba(255,255,255,0.7)', 84, 2, 5, 4);
    // door
    rect(ctx, PALETTE['shadow.0'], 48, 52, 20, 26);
    rect(ctx, PALETTE['soil.3'], 50, 54, 16, 24);
    rect(ctx, PALETTE['light.5'], 62, 64, 3, 3);
    // windows warm
    rect(ctx, PALETTE['shadow.0'], 18, 44, 20, 16);
    rect(ctx, PALETTE['light.7'], 20, 46, 16, 12);
    rect(ctx, PALETTE['light.7'], 21, 47, 6, 5);
    rect(ctx, PALETTE['shadow.0'], 27, 46, 2, 12);
    rect(ctx, PALETTE['shadow.0'], 20, 51, 16, 2);
    rect(ctx, PALETTE['shadow.0'], 76, 44, 20, 16);
    rect(ctx, PALETTE['light.7'], 78, 46, 16, 12);
    rect(ctx, PALETTE['light.7'], 79, 47, 6, 5);
    rect(ctx, PALETTE['shadow.0'], 85, 46, 2, 12);
    rect(ctx, PALETTE['shadow.0'], 78, 51, 16, 2);
    // flower box
    rect(ctx, PALETTE['leaf.2'], 18, 61, 20, 4);
    px(ctx, PALETTE['light.4'], 20, 60);
    px(ctx, PALETTE['light.5'], 24, 60);
    px(ctx, PALETTE['light.7'], 28, 60);
  });

  withTexture(scene, 'tree', 48, 64, (ctx) => {
    ctx.clearRect(0, 0, 48, 64);
    rect(ctx, 'rgba(0,0,0,0.22)', 12, 56, 26, 5);
    rect(ctx, PALETTE['soil.3'], 20, 34, 9, 22);
    rect(ctx, PALETTE['soil.5'], 21, 35, 3, 20);
    rect(ctx, PALETTE['soil.0'], 25, 36, 4, 19);
    // canopy layers
    rect(ctx, PALETTE['leaf.0'], 8, 24, 32, 16);
    rect(ctx, PALETTE['leaf.1'], 4, 14, 38, 16);
    rect(ctx, PALETTE['light.0'], 12, 6, 26, 16);
    rect(ctx, PALETTE['light.1'], 15, 8, 14, 8);
    rect(ctx, PALETTE['leaf.0'], 26, 28, 14, 12);
    rect(ctx, PALETTE['leaf.1'], 6, 28, 12, 8);
    // apples
    px(ctx, PALETTE['light.4'], 14, 20);
    px(ctx, PALETTE['light.4'], 30, 18);
    px(ctx, PALETTE['light.5'], 22, 26);
  });

  withTexture(scene, 'tile-cursor', TILE, TILE, (ctx) => {
    ctx.clearRect(0, 0, TILE, TILE);
    ctx.strokeStyle = PALETTE['light.7'];
    ctx.lineWidth = 3;
    // Was 'rgba(255,242,166,0.9)', a bright warm yellow the palette has no
    // real equivalent for (light.4 #ff7b3a is orange, not yellow). light.7
    // is the nearest entry and already the tile-cursor's own stroke colour,
    // so the glow reads as "the same colour, softened" rather than as a
    // second, off-palette yellow sitting right next to it.
    ctx.shadowColor = withAlpha(PALETTE['light.7'], 0.9);
    ctx.shadowBlur = 6;
    const r = 7;
    ctx.beginPath();
    ctx.roundRect(2, 2, TILE - 4, TILE - 4, r);
    ctx.stroke();
    ctx.shadowBlur = 0;
    // corners
    rect(ctx, PALETTE['light.7'], 2, 2, 6, 2);
    rect(ctx, PALETTE['light.7'], 2, 2, 2, 6);
  });

  withTexture(scene, 'shadow', 32, 12, (ctx) => {
    ctx.clearRect(0, 0, 32, 12);
    // Was 'rgba(10,18,12,0.32)'. This is a colour, not a neutral scrim like
    // the plain rgba(0,0,0,...) drop shadows elsewhere in this file — it has
    // a visible green cast — so it does not get the black exemption. outline.0
    // (#0f0608) is the nearest palette entry: still a near-black, just without
    // the green tint the original had.
    ctx.fillStyle = withAlpha(PALETTE['outline.0'], 0.32);
    ctx.beginPath();
    ctx.ellipse(16, 6, 13, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();
  });

  withTexture(scene, 'shadow-soft', 48, 20, (ctx) => {
    ctx.clearRect(0, 0, 48, 20);
    // Same colour as 'shadow' above and the same reasoning: 'rgba(10,20,14,*)'
    // is a near-black with a green cast, not a neutral scrim, so it is
    // migrated to outline.0 rather than exempted. Four alphas stack the same
    // four soft rings the original literal did.
    const layers: Array<[number, number, string]> = [
      [22, 8.5, withAlpha(PALETTE['outline.0'], 0.16)],
      [17, 6.5, withAlpha(PALETTE['outline.0'], 0.2)],
      [12, 4.8, withAlpha(PALETTE['outline.0'], 0.26)],
      [7, 3, withAlpha(PALETTE['outline.0'], 0.3)],
    ];
    layers.forEach(([rx, ry, color]) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.ellipse(24, 10, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
    });
  });

  withTexture(scene, 'grass-tuft', TILE, TILE, (ctx) => {
    ctx.clearRect(0, 0, TILE, TILE);
    rect(ctx, PALETTE['leaf.1'], 14, 16, 2, 10);
    rect(ctx, PALETTE['light.0'], 11, 13, 2, 12);
    rect(ctx, PALETTE['light.1'], 12, 13, 2, 4);
    rect(ctx, PALETTE['leaf.1'], 19, 15, 2, 11);
    rect(ctx, PALETTE['light.0'], 21, 12, 2, 10);
  });

  withTexture(scene, 'rain-drop', 3, 10, (ctx) => {
    ctx.clearRect(0, 0, 3, 10);
    rect(ctx, PALETTE['water.3'], 1, 1, 1, 8);
    px(ctx, PALETTE['light.7'], 1, 1);
  });

  // A bead, not a streak. `rain-drop` above is drawn as a falling line because
  // that is what rain looks like at speed; a splash is a round thing that
  // arcs and lands, and reusing the streak for it made watering look like
  // weather rather than like a can being tipped.
  withTexture(scene, 'water-bead', 5, 5, (ctx) => {
    ctx.clearRect(0, 0, 5, 5);
    rect(ctx, PALETTE['water.3'], 1, 0, 3, 5);
    rect(ctx, PALETTE['water.3'], 0, 1, 5, 3);
    // The inner ring's own literal (#bfe9ff) maps to water.3 everywhere else
    // in this file (it is the raindrop's main streak in the texture above),
    // but here it sits on top of this bead's outer body, which already is
    // water.3 via the #7fc6ea override two lines up. Kept distinct with
    // light.6 instead, preserving the outer < inner < highlight brightness
    // order (water.3 < light.6 < light.7).
    rect(ctx, PALETTE['light.6'], 1, 1, 2, 2);
    px(ctx, PALETTE['light.7'], 1, 1);
  });

  withTexture(scene, 'firefly', 8, 8, (ctx) => {
    ctx.clearRect(0, 0, 8, 8);
    // Was 'rgba(255,246,165,0.35)', another bright yellow the palette does
    // not have (see the tile-cursor glow above for the same gap). light.7 is
    // the nearest entry and, again, is already this same firefly's own core
    // colour two lines down, so the halo reads as a soft version of the body
    // rather than a mismatched second colour around it.
    ctx.fillStyle = withAlpha(PALETTE['light.7'], 0.35);
    ctx.beginPath();
    ctx.arc(4, 4, 3.5, 0, Math.PI * 2);
    ctx.fill();
    rect(ctx, PALETTE['light.7'], 3, 3, 2, 2);
    px(ctx, PALETTE['light.7'], 3, 3);
  });

  withTexture(scene, 'dust', 12, 8, (ctx) => {
    ctx.clearRect(0, 0, 12, 8);
    // Was 'rgba(232,214,175,0.85)', a tan close enough to light.7 (#f8dbbd)
    // to use it directly — both are pale and warm, just at different
    // saturations.
    //
    // The migration originally put light.7 here AND on the highlight below
    // (differing only by alpha, 0.85 vs 0.9), which is the same "two draws,
    // one colour" defect this fix wave's tile-water pass closed elsewhere:
    // two ellipses that are meant to read as a body and a brighter highlight
    // on top of it instead rendered as one flat mote, because canvas alpha
    // over the same clear background composites to two shades of the SAME
    // colour, not two different ones. light.6 (#acbfb0) is cooler and a
    // touch darker than light.7, so the fill now sits visibly behind the
    // light.7 highlight instead of underneath a second copy of it.
    ctx.fillStyle = withAlpha(PALETTE['light.6'], 0.85);
    ctx.beginPath();
    ctx.ellipse(6, 5, 5, 2.6, 0, 0, Math.PI * 2);
    ctx.fill();
    // Was 'rgba(255,246,220,0.9)', an almost-white cream. The palette has no
    // true white or pale grey (see art/palette.json's own note on the
    // light.* group), so this highlight stays on light.7 — now genuinely a
    // highlight, since the fill above it was moved to light.6 rather than
    // sharing the same colour.
    ctx.fillStyle = withAlpha(PALETTE['light.7'], 0.9);
    ctx.beginPath();
    ctx.ellipse(5, 4, 2.4, 1.4, 0, 0, Math.PI * 2);
    ctx.fill();
  });

  withTexture(scene, 'smoke', 16, 16, (ctx) => {
    ctx.clearRect(0, 0, 16, 16);
    // Was 'rgba(235,232,225,0.75)', a light neutral grey — close to white but
    // not the pure (255,255,255) that gets the neutral-scrim exemption, so it
    // still has to name a palette colour. The palette has nothing this pale
    // and this desaturated (see the dust highlight above for the same gap);
    // light.7 is the nearest entry it does have.
    ctx.fillStyle = withAlpha(PALETTE['light.7'], 0.75);
    ctx.beginPath();
    ctx.arc(8, 9, 5, 0, Math.PI * 2);
    ctx.fill();
    // Pure white, unlike the body above — a highlight wash rather than a
    // colour choice, so it keeps the same exemption 0xffffff has elsewhere.
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(6.5, 7.5, 2.4, 0, Math.PI * 2);
    ctx.fill();
  });

  withTexture(scene, 'sparkle', 12, 12, (ctx) => {
    ctx.clearRect(0, 0, 12, 12);
    ctx.fillStyle = PALETTE['light.7'];
    ctx.beginPath();
    ctx.moveTo(6, 0);
    ctx.lineTo(7.4, 4.6);
    ctx.lineTo(12, 6);
    ctx.lineTo(7.4, 7.4);
    ctx.lineTo(6, 12);
    ctx.lineTo(4.6, 7.4);
    ctx.lineTo(0, 6);
    ctx.lineTo(4.6, 4.6);
    ctx.closePath();
    ctx.fill();
  });

  withTexture(scene, 'petal', 5, 5, (ctx) => {
    ctx.clearRect(0, 0, 5, 5);
    rect(ctx, PALETTE['light.7'], 1, 1, 3, 3);
    px(ctx, PALETTE['light.7'], 2, 1);
    px(ctx, PALETTE['light.4'], 3, 3);
  });

  withTexture(scene, 'butterfly', 10, 8, (ctx) => {
    ctx.clearRect(0, 0, 10, 8);
    rect(ctx, PALETTE['light.4'], 0, 1, 4, 5);
    rect(ctx, PALETTE['light.5'], 6, 1, 4, 5);
    rect(ctx, PALETTE['soil.0'], 4, 2, 2, 4);
    px(ctx, PALETTE['light.7'], 1, 2);
    px(ctx, PALETTE['light.7'], 7, 2);
  });

  /**
   * A cloud's shadow, rasterised rather than drawn.
   *
   * This used to be two `ctx.ellipse` fills, which gave a smooth
   * anti-aliased blob — the one thing on screen with no pixels in it, sliding
   * over a world that is nothing but pixels. It read as a smudge on the lens
   * rather than as weather.
   *
   * Same two ellipses, same silhouette, but stepped onto a four-pixel grid
   * with hard edges and two flat tiers of darkness, and the rim broken up by
   * `hash` so the outline is ragged instead of geometric. Clouds have edges
   * like this; ellipses do not.
   */
  withTexture(scene, 'cloud-shadow', 160, 60, (ctx) => {
    ctx.clearRect(0, 0, 160, 60);
    const step = 4;
    const blobs = [
      { cx: 80, cy: 30, rx: 70, ry: 22 },
      { cx: 50, cy: 26, rx: 34, ry: 16 },
    ];
    for (let y = 0; y < 60; y += step) {
      for (let x = 0; x < 160; x += step) {
        // How far inside the silhouette this block sits: 1 at the centre of a
        // blob, 0 at its edge, below 0 outside it.
        let depth = 0;
        for (const blob of blobs) {
          const dx = (x + step / 2 - blob.cx) / blob.rx;
          const dy = (y + step / 2 - blob.cy) / blob.ry;
          depth = Math.max(depth, 1 - (dx * dx + dy * dy));
        }
        // The ragged edge. Only bites at the rim, so the body stays solid.
        if (depth <= hash(x, y, 31) * 0.14) continue;
        // Was 'rgba(20,35,30,0.20)' / 'rgba(20,35,30,0.11)' — a dark
        // green-grey, not the neutral black this shadow reads as at a
        // glance, so it does not qualify for the black exemption either.
        // shadow.1 (#0a2726) is the nearest palette entry and, like the
        // original, sits between plain black and green.
        rect(ctx, depth > 0.3 ? withAlpha(PALETTE['shadow.1'], 0.2) : withAlpha(PALETTE['shadow.1'], 0.11), x, y, step, step);
      }
    }
  });

  withTexture(scene, 'glow', 96, 96, (ctx) => {
    ctx.clearRect(0, 0, 96, 96);
    const g = ctx.createRadialGradient(48, 48, 4, 48, 48, 48);
    // The palette has no saturated warm gold or yellow-orange (light.4
    // #ff7b3a is the closest thing and is already a hard orange, not a
    // glow). The three original stops — 'rgba(255,220,130,0.85)',
    // 'rgba(255,200,110,0.28)' and the same colour faded to alpha 0 — ran
    // from a pale gold centre to a slightly deeper orange edge. light.7 and
    // light.5 are each the nearest palette entry to their own stop rather
    // than one colour reused for all three, which is a poor match on hue for
    // both (paler/pinker than a real gold glow) but keeps the same
    // light-centre-to-warmer-edge direction the original gradient had.
    g.addColorStop(0, withAlpha(PALETTE['light.7'], 0.85));
    g.addColorStop(0.4, withAlpha(PALETTE['light.5'], 0.28));
    g.addColorStop(1, withAlpha(PALETTE['light.5'], 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 96, 96);
  });

  // The fire in the farmhouse hearth. The furniture sheet draws the fireplace
  // cold — a dark arch over a clean hearthstone — and a room lit by nothing is
  // not the room at the end of a day. Two frames, so the scene can flick
  // between them: the tongues swap sides, which at this size is all a flicker
  // needs to be. Drawn at native 32px scale on a pair of logs.
  for (const [frame, lean] of [
    [0, 0],
    [1, 1],
  ] as const) {
    withTexture(scene, `hearth-fire-${frame}`, 20, 16, (ctx) => {
      ctx.clearRect(0, 0, 20, 16);
      // Logs, crossed.
      rect(ctx, PALETTE['soil.1'], 2, 13, 16, 3);
      rect(ctx, PALETTE['soil.4'], 3, 13, 6, 1);
      rect(ctx, PALETTE['soil.4'], 11, 14, 6, 1);
      // Outer flame, then the hotter core inside it, then the white heart.
      const tall = lean === 0 ? [7, 11] : [11, 7];
      rect(ctx, PALETTE['clothWarm.2'], 4, 7, 12, 6);
      rect(ctx, PALETTE['clothWarm.2'], tall[0] - 1, 2, 3, 5);
      rect(ctx, PALETTE['clothWarm.2'], tall[1] - 1, 4, 3, 3);
      rect(ctx, PALETTE['light.4'], 6, 8, 8, 5);
      rect(ctx, PALETTE['light.4'], tall[0], 4, 1, 4);
      rect(ctx, PALETTE['gold.0'], 8, 9, 4, 4);
      rect(ctx, PALETTE['light.7'], 9, 11, 2, 2);
    });
  }

  // The village well. Previously assembled from loose rectangles in the scene;
  // now a texture, so the map can name it like any other prop.
  withTexture(scene, 'well', 64, 64, (ctx) => {
    ctx.clearRect(0, 0, 64, 64);
    rect(ctx, PALETTE['soil.0'], 6, 30, 52, 28);
    rect(ctx, PALETTE['soil.4'], 8, 32, 48, 24);
    rect(ctx, PALETTE['soil.3'], 8, 40, 48, 4);
    rect(ctx, PALETTE['foliage.4'], 14, 20, 36, 20);
    rect(ctx, PALETTE['light.6'], 16, 22, 32, 16);
    rect(ctx, PALETTE['light.7'], 18, 24, 28, 5);
    rect(ctx, PALETTE['soil.1'], 8, 8, 48, 8);
    rect(ctx, PALETTE['clothWarm.1'], 10, 10, 44, 5);
    rect(ctx, PALETTE['soil.1'], 12, 14, 5, 18);
    rect(ctx, PALETTE['soil.1'], 47, 14, 5, 18);
    px(ctx, PALETTE['light.7'], 30, 26);
    px(ctx, PALETTE['light.7'], 36, 27);
  });

  // The forge in the village. An open-fronted shed with a lit hearth and an
  // anvil, so what it is for is legible without a sign over the door.
  withTexture(scene, 'blacksmith', 96, 64, (ctx) => {
    ctx.clearRect(0, 0, 96, 64);
    rect(ctx, 'rgba(0,0,0,0.24)', 4, 58, 88, 5);
    // Roof, low and heavy.
    rect(ctx, PALETTE['foliage.4'], 0, 4, 96, 16);
    rect(ctx, PALETTE['building.0'], 2, 6, 92, 4);
    rect(ctx, PALETTE['foliage.2'], 2, 16, 92, 4);
    // Posts, open front.
    rect(ctx, PALETTE['soil.2'], 6, 20, 7, 38);
    rect(ctx, PALETTE['soil.2'], 83, 20, 7, 38);
    rect(ctx, PALETTE['soil.0'], 13, 20, 70, 26);
    // The hearth, which is the whole reason to walk over here.
    rect(ctx, PALETTE['clothWarm.1'], 20, 26, 26, 20);
    rect(ctx, PALETTE['building.3'], 23, 30, 20, 16);
    rect(ctx, PALETTE['light.5'], 26, 34, 14, 12);
    rect(ctx, PALETTE['light.7'], 30, 38, 7, 8);
    // Chimney, and the smoke it earns.
    rect(ctx, PALETTE['foliage.4'], 24, 0, 14, 8);
    rect(ctx, PALETTE['foliage.2'], 24, 0, 14, 3);
    // Anvil on its block.
    rect(ctx, PALETTE['soil.1'], 58, 44, 16, 14);
    rect(ctx, PALETTE['foliage.4'], 55, 36, 22, 6);
    rect(ctx, PALETTE['building.0'], 55, 36, 22, 2);
    rect(ctx, PALETTE['foliage.4'], 62, 41, 8, 4);
    px(ctx, PALETTE['light.5'], 60, 35);
    px(ctx, PALETTE['light.5'], 72, 34);
  });

  createBuildingTextures(scene);
  createVillagerTextures(scene);
  createAnimalTextures(scene);

  withTexture(scene, 'splash', 10, 5, (ctx) => {
    ctx.clearRect(0, 0, 10, 5);
    // Was 'rgba(200,235,245,0.9)', a pale, cool blue — the palette has no
    // pale blue at all (see the water group's own note: it runs
    // indigo/magenta/teal/teal, never light). The first migration pass
    // mapped this to light.7 by raw hex distance alone, which is the
    // nearest ENTRY but the wrong choice for what this entry draws: a
    // splash is an arc of spray thrown up off the same water this texture
    // sits on top of (the watering-can and rain-drop textures above both
    // use water.3 for exactly that surface), and light.7 is warm cream —
    // on a water effect that reads as a stray patch of sand, not spray.
    // water.3 (#1896b3) is a genuinely cool, water-family colour, and it is
    // already what every other droplet/ripple texture in this file calls
    // "water" — so the splash now agrees with its own surroundings on hue,
    // even though (like the rest of this migration) it is not a pale tint
    // of it, because the palette has nothing paler in that family to reach
    // for.
    ctx.strokeStyle = withAlpha(PALETTE['water.3'], 0.9);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(5, 3, 4, 1.8, 0, Math.PI, 0);
    ctx.stroke();
  });

  createResourceTextures(scene);
  createItemTextures(scene);
  createPlaceableTextures(scene);
  createEdgeTextures(scene);
  createDialTextures(scene);
  createHudIcons(scene);
  createMineTextures(scene);
  createPlazaTextures(scene);
}

/**
 * Icons for the hotbar and the inventory grid.
 *
 * The shapes themselves live in `itemIcons`, because React draws the same ones
 * into SVG for the inventory grid. Here they are only replayed onto a canvas
 * texture, so the two panels cannot drift apart.
 *
 * Every key comes from the `texture` of a row in the item table, so adding an
 * item means one row there and one drawing there.
 */
/**
 * A ripe crop standing in a plot, one texture per crop.
 *
 * The seeded and sprout stages are shared by everything, because a shoot is a
 * shoot; only the mature plant has to be recognisable at a glance across a
 * field, so only that stage gets art of its own. The shapes come from the same
 * `CROP_PALETTES` the inventory icons use, scaled up and stood on a stem, so
 * the pumpkin in the ground and the pumpkin in the satchel are the same
 * pumpkin. Placeholders, and credited as such.
 */
/**
 * The farm's buildings, and the scaffold every one of them starts as.
 *
 * One drawing function and a table of four palettes, because these are four
 * versions of the same object: walls, a roof, a door and two lit windows. The
 * scene stretches each to its footprint the way it already does for the Tiled
 * props, so widening a coop in `BUILDING_DEFS` widens the sprite without
 * anybody touching this file.
 *
 * Placeholders, and credited as such in `public/assets/lpc/CREDITS.md`.
 * Dropping a hand-drawn `building-shed.png` in and preloading it wins over
 * anything generated here, exactly as it does for the crops.
 */
interface BuildingPalette {
  key: string;
  width: number;
  height: number;
  wall: string;
  trim: string;
  roof: string;
  roofLight: string;
}

const BUILDING_ART: readonly BuildingPalette[] = [
  // The two working buildings, in weathered timber and galvanised steel.
  { key: 'building-shed', width: 128, height: 96, wall: PALETTE['soil.5'], trim: PALETTE['soil.3'], roof: PALETTE['soil.4'], roofLight: PALETTE['soil.6'] },
  { key: 'building-silo', width: 96, height: 96, wall: PALETTE['light.6'], trim: PALETTE['building.0'], roof: PALETTE['building.0'], roofLight: PALETTE['building.2'] },
  // The two you want to pick out from the far side of the field.
  { key: 'building-coop', width: 192, height: 96, wall: PALETTE['light.5'], trim: PALETTE['light.2'], roof: PALETTE['building.1'], roofLight: PALETTE['light.3'] },
  { key: 'building-barn', width: 224, height: 128, wall: PALETTE['building.1'], trim: PALETTE['clothWarm.0'], roof: PALETTE['soil.2'], roofLight: PALETTE['soil.4'] },
];

function drawBuilding(ctx: CanvasRenderingContext2D, art: BuildingPalette) {
  const { width: w, height: h } = art;
  ctx.clearRect(0, 0, w, h);

  // Where the roof stops and the wall starts. A fraction rather than a
  // constant, so a short silo and a long barn both keep their proportions.
  const eaves = Math.round(h * 0.42);
  const ridge = Math.round(eaves * 0.35);

  rect(ctx, 'rgba(0,0,0,0.22)', 4, h - 5, w - 8, 5);

  rect(ctx, art.wall, 4, eaves, w - 8, h - eaves - 4);
  rect(ctx, art.trim, 4, eaves, w - 8, 3);
  rect(ctx, art.trim, 4, h - 8, w - 8, 4);
  // Corner posts, which is what makes it read as built rather than as a box.
  rect(ctx, art.trim, 4, eaves, 4, h - eaves - 4);
  rect(ctx, art.trim, w - 8, eaves, 4, h - eaves - 4);

  rect(ctx, art.roof, 0, ridge, w, eaves - ridge + 2);
  rect(ctx, art.roofLight, 2, ridge + 2, w - 4, 3);
  for (let x = 6; x < w - 6; x += 10) rect(ctx, art.roof, x, ridge + 2, 2, (eaves - ridge) * 0.7);

  const doorWidth = Math.max(10, Math.round(w * 0.14));
  const doorX = Math.round((w - doorWidth) / 2);
  const doorY = Math.round(h * 0.62);
  rect(ctx, PALETTE['shadow.0'], doorX, doorY, doorWidth, h - doorY - 5);
  rect(ctx, PALETTE['soil.3'], doorX + 2, doorY + 2, doorWidth - 4, h - doorY - 9);
  rect(ctx, PALETTE['light.5'], doorX + doorWidth - 5, doorY + Math.round((h - doorY) / 2), 2, 2);

  // A lit window each side, so a finished building reads as somewhere rather
  // than as a shape — even before there is anything living in it.
  const windowY = Math.round(h * 0.55);
  for (const windowX of [Math.round(w * 0.16), Math.round(w * 0.74)]) {
    rect(ctx, PALETTE['shadow.0'], windowX, windowY, 18, 14);
    rect(ctx, PALETTE['light.7'], windowX + 2, windowY + 2, 14, 10);
    rect(ctx, PALETTE['shadow.0'], windowX + 8, windowY + 2, 2, 10);
  }
}

function createBuildingTextures(scene: Phaser.Scene) {
  for (const art of BUILDING_ART) {
    withTexture(scene, art.key, art.width, art.height, (ctx) => drawBuilding(ctx, art));
  }

  // What every building spends its first days as: posts, planks, a brace and
  // nothing you could put an animal in. One texture for all four, stretched —
  // a building site looks like a building site whatever is going up.
  withTexture(scene, 'building-scaffold', 128, 96, (ctx) => {
    ctx.clearRect(0, 0, 128, 96);
    rect(ctx, 'rgba(0,0,0,0.18)', 4, 91, 120, 5);
    for (const x of [8, 60, 114]) rect(ctx, PALETTE['soil.3'], x, 24, 6, 68);
    for (const y of [30, 56, 82]) rect(ctx, PALETTE['soil.5'], 8, y, 112, 5);
    // The diagonal brace, stepped, because the context only fills rectangles.
    for (let i = 0; i < 11; i += 1) rect(ctx, PALETTE['soil.6'], 12 + i * 9, 84 - i * 5, 9, 4);
    // A pale tarpaulin over the ridge.
    rect(ctx, PALETTE['light.5'], 34, 12, 60, 9);
    rect(ctx, PALETTE['light.7'], 34, 12, 60, 3);
  });
}

/**
 * The four animals, and the pen they are bought from — the fallback now.
 *
 * All four have real art: `animal-<kind>-sheet.png` is a four-direction walk
 * cycle from the LPC farm animal set, and the scene prefers it wherever it
 * loaded. What is drawn here is what a player sees if that art is missing —
 * the same bargain the player sprite makes with `player-sheet.png`, and the
 * reason a blocked CDN or a half-cloned checkout is a plainer farm rather than
 * an empty one.
 *
 * Side-on and facing right, with a flipped copy doing duty for the other
 * direction: four legs and a head is enough silhouette at this size to tell a
 * chicken from a goat across a field, which is all a fallback has to do.
 */
interface AnimalPalette {
  key: string;
  /** How big the drawing is, which is also how big it reads in the field. */
  width: number;
  height: number;
  body: string;
  light: string;
  dark: string;
  /** Head, comb, horns — whatever is not the body colour. */
  accent: string;
  /** True for the two birds, which stand on two legs and have no tail to speak of. */
  bird?: boolean;
}

const ANIMAL_ART: readonly AnimalPalette[] = [
  {
    key: 'animal-chicken',
    width: 20,
    height: 20,
    body: PALETTE['light.7'],
    light: PALETTE['light.7'],
    dark: PALETTE['light.6'],
    accent: PALETTE['building.3'],
    bird: true,
  },
  {
    key: 'animal-duck',
    width: 22,
    height: 20,
    body: PALETTE['light.7'],
    light: PALETTE['light.7'],
    dark: PALETTE['light.6'],
    accent: PALETTE['light.5'],
    bird: true,
  },
  {
    key: 'animal-cow',
    width: 32,
    height: 26,
    body: PALETTE['light.7'],
    light: PALETTE['light.7'],
    dark: PALETTE['soil.1'],
    accent: PALETTE['light.5'],
  },
  {
    key: 'animal-goat',
    width: 26,
    height: 24,
    body: PALETTE['light.6'],
    light: PALETTE['light.7'],
    dark: PALETTE['soil.6'],
    accent: PALETTE['soil.4'],
  },
];

function drawAnimal(ctx: CanvasRenderingContext2D, art: AnimalPalette) {
  const { width: w, height: h } = art;
  ctx.clearRect(0, 0, w, h);

  rect(ctx, 'rgba(0,0,0,0.20)', 3, h - 3, w - 6, 3);

  if (art.bird) {
    // Two legs, a round body and a head held high: everything about a bird at
    // this size is the silhouette being taller than it is heavy.
    const bodyTop = 5;
    const bodyHeight = h - bodyTop - 5;
    rect(ctx, art.body, 2, bodyTop, w - 7, bodyHeight);
    rect(ctx, art.light, 3, bodyTop + 1, w - 11, 3);
    rect(ctx, art.dark, 2, bodyTop + bodyHeight - 3, w - 7, 3);
    // Tail, cocked up at the back.
    rect(ctx, art.dark, 0, bodyTop - 1, 3, 4);
    // Head and neck at the front.
    rect(ctx, art.body, w - 8, 2, 6, 6);
    rect(ctx, art.light, w - 7, 3, 4, 2);
    rect(ctx, art.accent, w - 6, 0, 3, 2);
    rect(ctx, art.accent, w - 2, 4, 2, 2);
    rect(ctx, PALETTE['soil.0'], w - 4, 4, 1, 1);
    for (const legX of [5, w - 10]) rect(ctx, PALETTE['light.5'], legX, h - 5, 2, 3);
    return;
  }

  // Four legs, a long back and a low head: the other half of the silhouette
  // rule, and the reason a goat and a cow can share one drawing routine.
  const backTop = 6;
  const bodyHeight = h - backTop - 7;
  rect(ctx, art.body, 2, backTop, w - 8, bodyHeight);
  rect(ctx, art.light, 3, backTop + 1, w - 14, 3);
  rect(ctx, art.dark, 2, backTop + bodyHeight - 2, w - 8, 2);
  // Two patches, so a white cow is a cow rather than a loaf.
  rect(ctx, art.dark, 6, backTop + 2, 5, 4);
  rect(ctx, art.dark, w - 16, backTop + 4, 4, 3);
  // Head, lowered to the grass, with horns or ears above it.
  rect(ctx, art.body, w - 9, backTop + 3, 7, 7);
  rect(ctx, art.light, w - 8, backTop + 4, 4, 2);
  rect(ctx, art.accent, w - 4, backTop + 8, 3, 2);
  rect(ctx, art.dark, w - 9, backTop, 2, 4);
  rect(ctx, art.dark, w - 4, backTop + 1, 2, 3);
  rect(ctx, PALETTE['soil.0'], w - 5, backTop + 5, 1, 1);
  // Tail.
  rect(ctx, art.dark, 1, backTop, 2, bodyHeight - 2);
  for (const legX of [4, 9, w - 14, w - 9]) rect(ctx, art.dark, legX, h - 7, 2, 5);
}

/**
 * A marker that floats over an animal: a heart when it is stroked, and an
 * exclamation when it has not been fed.
 *
 * Drawn here rather than tinted from the villagers' heart so the two can be
 * told apart at a glance — a hungry animal is information, and it has to read
 * as an alarm rather than as affection.
 */
function createAnimalTextures(scene: Phaser.Scene) {
  for (const art of ANIMAL_ART) {
    withTexture(scene, art.key, art.width, art.height, (ctx) => drawAnimal(ctx, art));
  }

  withTexture(scene, 'animal-hungry', 8, 14, (ctx) => {
    ctx.clearRect(0, 0, 8, 14);
    rect(ctx, PALETTE['soil.0'], 2, 0, 4, 10);
    rect(ctx, PALETTE['light.5'], 3, 1, 2, 7);
    rect(ctx, PALETTE['soil.0'], 2, 11, 4, 3);
    rect(ctx, PALETTE['light.5'], 3, 12, 2, 1);
  });

  // The stock pen: a rail fence with a trough in it, three tiles by two.
  withTexture(scene, 'ranch-pen', 96, 64, (ctx) => {
    ctx.clearRect(0, 0, 96, 64);
    rect(ctx, 'rgba(0,0,0,0.16)', 6, 56, 84, 5);
    // Straw inside the rails, so the ground reads as trodden rather than grass.
    rect(ctx, PALETTE['light.5'], 8, 22, 80, 32);
    rect(ctx, PALETTE['light.5'], 10, 24, 76, 6);
    // Two rails along the back and the front, with posts holding them up.
    for (const railY of [16, 26, 46]) rect(ctx, PALETTE['soil.5'], 4, railY, 88, 4);
    for (const postX of [4, 30, 60, 88]) rect(ctx, PALETTE['soil.3'], postX, 12, 5, 40);
    // The trough, which is the bit you walk up to.
    rect(ctx, PALETTE['soil.3'], 34, 34, 34, 12);
    rect(ctx, PALETTE['soil.5'], 36, 36, 30, 6);
    rect(ctx, PALETTE['light.2'], 38, 37, 26, 3);
    // A hay bale stacked at the end.
    rect(ctx, PALETTE['light.5'], 72, 32, 18, 14);
    rect(ctx, PALETTE['light.7'], 72, 32, 18, 4);
    rect(ctx, PALETTE['light.2'], 78, 32, 2, 14);
  });
}

function createCropTextures(scene: Phaser.Scene) {
  for (const crop of CROP_ORDER) {
    const { form, body, light, dark } = CROP_PALETTES[crop];
    withTexture(scene, `crop-${crop}`, TILE, TILE, (ctx) => {
      ctx.clearRect(0, 0, TILE, TILE);
      drawCropPlant(ctx, form, body, light, dark);
    });
  }
}

/** Leaves at the base, so every plant is rooted in something green. */
function drawFoliage(ctx: CanvasRenderingContext2D, top: number) {
  rect(ctx, PALETTE['leaf.1'], 15, top, 2, 26 - top);
  rect(ctx, PALETTE['light.0'], 7, top + 1, 7, 5);
  rect(ctx, PALETTE['light.1'], 8, top + 1, 4, 2);
  rect(ctx, PALETTE['leaf.2'], 18, top, 7, 6);
  rect(ctx, PALETTE['light.1'], 19, top, 4, 2);
  rect(ctx, PALETTE['foliage.3'], 15, 23, 2, 3);
}

function drawCropPlant(
  ctx: CanvasRenderingContext2D,
  form: string,
  body: string,
  light: string,
  dark: string,
) {
  switch (form) {
    // Sits in the soil with its shoulders showing, the way a turnip does.
    case 'root':
      drawFoliage(ctx, 4);
      rect(ctx, dark, 10, 14, 13, 3);
      rect(ctx, body, 10, 17, 13, 9);
      rect(ctx, light, 12, 18, 4, 5);
      px(ctx, dark, 15, 24);
      px(ctx, dark, 18, 25);
      return;
    // A cluster, not one big fruit: three beads so it reads as pickable.
    case 'berry':
      drawFoliage(ctx, 3);
      for (const [x, y] of [[8, 15], [17, 13], [12, 21]] as const) {
        rect(ctx, body, x, y, 7, 7);
        rect(ctx, light, x + 1, y + 1, 3, 3);
        rect(ctx, dark, x + 4, y + 4, 3, 3);
      }
      return;
    case 'fruit':
      drawFoliage(ctx, 3);
      rect(ctx, body, 8, 13, 14, 13);
      rect(ctx, light, 10, 15, 5, 5);
      rect(ctx, dark, 16, 19, 5, 6);
      rect(ctx, dark, 9, 25, 12, 1);
      return;
    // Wide and low, the only silhouette that has to read from across a field.
    case 'gourd':
      rect(ctx, PALETTE['leaf.1'], 6, 8, 4, 3);
      rect(ctx, PALETTE['light.0'], 22, 9, 5, 3);
      rect(ctx, PALETTE['foliage.3'], 15, 8, 2, 5);
      rect(ctx, body, 4, 12, 24, 14);
      rect(ctx, light, 7, 14, 4, 10);
      rect(ctx, light, 15, 13, 3, 12);
      rect(ctx, dark, 21, 14, 4, 10);
      rect(ctx, dark, 4, 24, 24, 2);
      return;
    // Ears on stalks. Three of them, leaning, so it does not read as a fence.
    case 'grain':
      rect(ctx, PALETTE['leaf.0'], 9, 16, 2, 10);
      rect(ctx, PALETTE['leaf.0'], 15, 14, 2, 12);
      rect(ctx, PALETTE['leaf.0'], 21, 17, 2, 9);
      rect(ctx, body, 7, 6, 5, 11);
      rect(ctx, light, 8, 7, 2, 7);
      rect(ctx, body, 14, 4, 5, 11);
      rect(ctx, dark, 17, 6, 2, 7);
      rect(ctx, body, 20, 8, 5, 10);
      rect(ctx, light, 21, 9, 2, 6);
      return;
    case 'bloom':
      rect(ctx, PALETTE['leaf.1'], 15, 15, 2, 11);
      rect(ctx, PALETTE['light.0'], 8, 18, 6, 3);
      rect(ctx, PALETTE['light.0'], 18, 20, 6, 3);
      rect(ctx, body, 10, 5, 12, 11);
      rect(ctx, light, 12, 6, 4, 4);
      rect(ctx, dark, 17, 11, 4, 4);
      rect(ctx, body, 13, 2, 6, 4);
      rect(ctx, dark, 13, 16, 6, 2);
      return;
    // Mushrooms: a clump of three, because one lone cap looks like a mistake.
    case 'cap':
    default:
      for (const [x, y, w] of [[6, 14, 10], [17, 12, 11], [12, 20, 9]] as const) {
        rect(ctx, body, x, y, w, 5);
        rect(ctx, light, x + 1, y, Math.floor(w / 2), 2);
        rect(ctx, dark, x, y + 5, w, 1);
        rect(ctx, PALETTE['light.7'], x + Math.floor(w / 2) - 1, y + 6, 3, 5);
      }
  }
}

// --- what stands on the ground -----------------------------------------------

/**
 * The trees, the rocks and everything else a tool can take down.
 *
 * All of them drawn on one canvas size per kind, and every one of them a
 * placeholder in exactly the sense the buildings and the animals are: a
 * hand-drawn `node-tree-4.png` preloaded over the top wins, and they are
 * credited as such in `public/assets/lpc/CREDITS.md`.
 *
 * The thing to get right here is not the drawing, it is the *silhouette*. A
 * player scanning a field has to tell at a glance which of these wants an axe,
 * which wants a pick, and which will fall to a scythe — so the three families
 * are three shapes: tall and round-topped, low and angular, and low and
 * feathery. Colour does the rest.
 */

/** How big a node's drawing is. Wider and taller than its tile, on purpose. */
const NODE = { width: 64, height: 80 };

/**
 * A rounded mass, drawn as rows of a squashed circle on the pixel grid.
 *
 * The one shape this file did not already have, and the one both the canopies
 * and the boulders needed. An earlier pass stacked flat slabs instead, and a
 * wood of two hundred of them read as a warehouse of green shelves: a
 * silhouette with a straight top edge is a box however it is shaded. Rows of
 * a circle, stepped, read as foliage — and the same routine at a different
 * squash and a different palette reads as stone.
 *
 * `rows` is a callback rather than a colour so a caller can shade by height,
 * which is what gives both of them a direction of light.
 */
function blob(
  ctx: CanvasRenderingContext2D,
  centreX: number,
  bottom: number,
  radiusX: number,
  radiusY: number,
  shade: (fromTop: number) => string,
) {
  const top = bottom - radiusY * 2;
  for (let y = 0; y < radiusY * 2; y += 1) {
    // How far down the mass this row is, as -1 at the top and 1 at the foot.
    const t = (y - radiusY) / radiusY;
    const half = Math.round(radiusX * Math.sqrt(Math.max(0, 1 - t * t)));
    if (half <= 0) continue;
    rect(ctx, shade(y / (radiusY * 2)), Math.round(centreX - half), Math.round(top + y), half * 2, 1);
  }
}

/**
 * A tree at one of its five stages.
 *
 * The trunk stays on the tile the node occupies and the canopy grows up and
 * out of it, which is why the drawing is two tiles wide and two and a half
 * tall: you walk *behind* a tree, and its collision is the tile of trunk you
 * actually bump into. The scene positions it by its feet for that reason.
 *
 * Everything scales off one number, so five stages are one drawing rather than
 * five — and a sapling is recognisably the same tree it is going to become,
 * which is what makes leaving one standing feel like a decision.
 */
function drawTree(ctx: CanvasRenderingContext2D, stage: number) {
  const { width: w, height: h } = NODE;
  ctx.clearRect(0, 0, w, h);

  const grown = stage / (TREE_STAGES - 1);
  const trunkHeight = Math.round(5 + grown * 22);
  const trunkWidth = Math.round(3 + grown * 5);
  const radiusX = Math.round(6 + grown * 15);
  const radiusY = Math.round(5 + grown * 13);
  const centreX = w / 2;
  const trunkX = Math.round(centreX - trunkWidth / 2);
  const trunkTop = h - 6 - trunkHeight;

  rect(ctx, 'rgba(0,0,0,0.18)', Math.round(centreX - radiusX * 0.6), h - 8, Math.round(radiusX * 1.2), 5);
  rect(ctx, PALETTE['soil.2'], trunkX, trunkTop, trunkWidth, trunkHeight);
  rect(ctx, PALETTE['soil.4'], trunkX, trunkTop, Math.max(1, trunkWidth - 2), trunkHeight);
  rect(ctx, PALETTE['soil.0'], trunkX + trunkWidth - 1, trunkTop, 1, trunkHeight);

  // Two masses rather than one: a big one over the trunk and a smaller one
  // riding on its shoulder, which is what stops a wood of them looking like a
  // row of identical lollipops.
  const shade = (fromTop: number) =>
    fromTop < 0.22 ? PALETTE['light.0'] : fromTop < 0.62 ? PALETTE['leaf.1'] : PALETTE['foliage.3'];
  blob(ctx, centreX, trunkTop + 3, radiusX, radiusY, shade);
  if (stage >= 2) {
    blob(
      ctx,
      centreX + Math.round(radiusX * 0.45),
      trunkTop - Math.round(radiusY * 0.5),
      Math.round(radiusX * 0.6),
      Math.round(radiusY * 0.55),
      shade,
    );
  }
}

/** Cut off at the knee, with the rings showing. Hardwood, and a copper axe. */
function drawStump(ctx: CanvasRenderingContext2D) {
  const { width: w, height: h } = NODE;
  ctx.clearRect(0, 0, w, h);
  const top = h - 26;
  rect(ctx, 'rgba(0,0,0,0.20)', 14, h - 8, 36, 5);
  rect(ctx, PALETTE['soil.1'], 18, top, 28, 22);
  rect(ctx, PALETTE['soil.3'], 18, top, 24, 22);
  // The cut face, lighter, with two rings on it.
  rect(ctx, PALETTE['soil.6'], 18, top, 28, 7);
  rect(ctx, PALETTE['light.2'], 22, top + 1, 20, 4);
  rect(ctx, PALETTE['soil.5'], 28, top + 2, 8, 2);
  // A root breaking the ground on each side.
  rect(ctx, PALETTE['soil.1'], 14, h - 12, 6, 4);
  rect(ctx, PALETTE['soil.1'], 44, h - 12, 6, 4);
}

/**
 * A rock, or the boulder that is the same rock at twice the size.
 *
 * Squatter than it is tall and lit from the top-left, which is the whole of
 * what makes it read as stone rather than as a headstone — the first pass
 * stacked three flat slabs and a field of them looked like a graveyard. The
 * facet down the right-hand side is what gives it an edge to have been split
 * along, and is where the pick is supposed to go.
 */
function drawRock(ctx: CanvasRenderingContext2D, big: boolean) {
  const { width: w, height: h } = NODE;
  ctx.clearRect(0, 0, w, h);
  const radiusX = big ? 20 : 12;
  const radiusY = big ? 13 : 8;
  const centreX = w / 2;
  const bottom = h - 6;

  rect(ctx, 'rgba(0,0,0,0.20)', Math.round(centreX - radiusX), h - 8, radiusX * 2, 5);
  blob(ctx, centreX, bottom, radiusX, radiusY, (fromTop) =>
    fromTop < 0.25 ? PALETTE['light.6'] : fromTop < 0.6 ? PALETTE['building.2'] : PALETTE['building.0'],
  );
  // The shaded facet, cut straight down the right so the mass has a corner.
  rect(ctx, PALETTE['foliage.4'], Math.round(centreX + radiusX * 0.35), bottom - radiusY * 2 + 3, 2, radiusY * 2 - 5);
  rect(ctx, PALETTE['light.7'], Math.round(centreX - radiusX * 0.5), bottom - radiusY * 2 + 2, Math.round(radiusX * 0.5), 2);

  if (big) {
    // Chips at the foot, so the big one reads as the thing the small ones came
    // off rather than as a rock somebody has zoomed in on.
    rect(ctx, PALETTE['building.2'], Math.round(centreX - radiusX - 4), bottom - 4, 6, 4);
    rect(ctx, PALETTE['building.0'], Math.round(centreX + radiusX - 1), bottom - 3, 5, 3);
  }
}

/** What flecks each vein, as a body colour and a glint. Plain stone has none. */
const ORE_FLECKS: Record<string, readonly [string, string] | null> = {
  stone: null,
  coal: [PALETTE['shadow.3'], PALETTE['building.0']],
  'copper-ore': [PALETTE['soil.6'], PALETTE['light.5']],
  'iron-ore': [PALETTE['foliage.4'], PALETTE['light.7']],
  'gold-ore': [PALETTE['light.5'], PALETTE['light.7']],
  gem: [PALETTE['water.3'], PALETTE['light.7']],
};

/**
 * A vein: the small rock, with the metal showing through it.
 *
 * Borrowed from the rock rather than drawn again, so a vein reads as a rock
 * that is worth more than a rock — which is all a player needs to know from
 * across a mine floor.
 */
function drawOre(ctx: CanvasRenderingContext2D, item: string) {
  drawRock(ctx, false);
  const fleck = ORE_FLECKS[item];
  if (!fleck) return;
  const [body, shine] = fleck;
  const centreX = NODE.width / 2;
  const bottom = NODE.height - 6;
  rect(ctx, body, Math.round(centreX - 6), bottom - 11, 4, 3);
  rect(ctx, body, Math.round(centreX + 2), bottom - 8, 3, 3);
  rect(ctx, body, Math.round(centreX - 2), bottom - 5, 3, 2);
  rect(ctx, shine, Math.round(centreX - 6), bottom - 11, 1, 1);
}

/**
 * Brambles: low, tangled, and the thing between you and a field.
 *
 * Mass rather than stalks, which is the difference between this and the grass
 * below. An early draft drew four thin uprights and it read across a field as
 * a row of fence posts — so this is a dark, leafy clump with only a couple of
 * dry tips showing out of the top of it, and the eye sorts the two apart at a
 * glance: cut the pale feathery thing for hay, hack the dark solid thing out
 * of the way.
 */
function drawWeed(ctx: CanvasRenderingContext2D) {
  const { width: w, height: h } = NODE;
  ctx.clearRect(0, 0, w, h);
  const floor = h - 6;
  rect(ctx, 'rgba(0,0,0,0.18)', 21, floor - 1, 22, 4);

  // The body: three overlapping slabs of leaf, widest at the bottom.
  for (const [x, y, bw, bh, shade] of [
    [21, floor - 9, 22, 9, PALETTE['foliage.3']],
    [23, floor - 15, 18, 8, PALETTE['leaf.0']],
    [27, floor - 20, 11, 7, PALETTE['leaf.1']],
  ] as const) {
    rect(ctx, shade, x, y, bw, bh);
  }
  // Lit edges along the top-left of each slab, so it has a direction of light.
  rect(ctx, PALETTE['leaf.2'], 22, floor - 8, 8, 2);
  rect(ctx, PALETTE['leaf.2'], 24, floor - 14, 6, 2);
  rect(ctx, PALETTE['light.0'], 28, floor - 19, 5, 2);
  // Two dry runners out of the top, which is what says weed and not shrub.
  rect(ctx, PALETTE['leaf.2'], 25, floor - 26, 2, 7);
  rect(ctx, PALETTE['leaf.2'], 36, floor - 24, 2, 6);
  rect(ctx, PALETTE['light.5'], 24, floor - 28, 4, 3);
}

/** Grass: the same family as the weed, shorter and bluer, and never solid. */
function drawGrassClump(ctx: CanvasRenderingContext2D) {
  const { width: w, height: h } = NODE;
  ctx.clearRect(0, 0, w, h);
  const floor = h - 6;
  for (const [x, tall] of [
    [21, 11],
    [25, 15],
    [29, 13],
    [33, 16],
    [37, 10],
    [41, 12],
  ] as const) {
    rect(ctx, PALETTE['leaf.2'], x, floor - tall, 2, tall);
    rect(ctx, PALETTE['light.0'], x, floor - tall, 1, Math.round(tall * 0.6));
    rect(ctx, PALETTE['light.1'], x, floor - tall, 1, 3);
  }
  rect(ctx, PALETTE['leaf.1'], 20, floor - 2, 24, 2);
}

/**
 * A piece of forage on the ground.
 *
 * Drawn from the very same palette its inventory icon uses, so what you saw in
 * the grass is what turns up in the satchel — which is the whole reason
 * `foragePalette` is exported rather than kept private to the icon table.
 */
function drawForage(ctx: CanvasRenderingContext2D, item: string) {
  const { width: w, height: h } = NODE;
  ctx.clearRect(0, 0, w, h);
  const palette = foragePalette(item);
  if (!palette) return;

  rect(ctx, 'rgba(0,0,0,0.16)', 24, h - 8, 16, 4);
  // The crop plant routine draws on a 32-tile grid, so the context is moved
  // and scaled rather than the drawing being written a second time.
  ctx.save();
  ctx.translate(w / 2 - TILE / 2, h - TILE - 4);
  drawCropPlant(ctx, palette.form, palette.body, palette.light, palette.dark);
  ctx.restore();
}

function createResourceTextures(scene: Phaser.Scene) {
  for (let stage = 0; stage < TREE_STAGES; stage += 1) {
    withTexture(scene, `node-tree-${stage}`, NODE.width, NODE.height, (ctx) => drawTree(ctx, stage));
  }
  withTexture(scene, 'node-stump', NODE.width, NODE.height, drawStump);
  withTexture(scene, 'node-rock', NODE.width, NODE.height, (ctx) => drawRock(ctx, false));
  withTexture(scene, 'node-boulder', NODE.width, NODE.height, (ctx) => drawRock(ctx, true));
  withTexture(scene, 'node-weed', NODE.width, NODE.height, drawWeed);
  withTexture(scene, 'node-grass', NODE.width, NODE.height, drawGrassClump);
  for (const forage of FORAGE_DEFS) {
    withTexture(scene, `node-forage-${forage.id}`, NODE.width, NODE.height, (ctx) =>
      drawForage(ctx, forage.id),
    );
  }
  for (const item of MINED_ITEMS) {
    withTexture(scene, `node-ore-${item}`, NODE.width, NODE.height, (ctx) => drawOre(ctx, item));
  }

  // The chip that flies off a node that was struck. One drawing, tinted per
  // kind by the scene, because a splinter and a stone chip are the same shape
  // at four pixels across.
  withTexture(scene, 'node-chip', 6, 6, (ctx) => {
    ctx.clearRect(0, 0, 6, 6);
    rect(ctx, PALETTE['light.7'], 1, 1, 4, 4);
    rect(ctx, 'rgba(0,0,0,0.3)', 3, 3, 3, 3);
  });
}

/**
 * A tile-sized drawing of each crafted thing, from its own inventory icon.
 *
 * Scaled up rather than drawn again, which is the same bargain the whole icon
 * system already takes: a chest in the field and a chest in the satchel are
 * the same chest, and two drawings of it are two drawings to keep in step. At
 * two pixels per source pixel with smoothing off it reads as deliberate pixel
 * art rather than as a blown-up icon.
 *
 * One tile square, unlike the resource nodes, because nothing here is taller
 * than the ground it stands on — a keg is a keg, not a tree you walk behind.
 */
const PLACEABLE_ART = 32;

function createPlaceableTextures(scene: Phaser.Scene) {
  const scale = PLACEABLE_ART / ICON_SIZE;
  for (const kind of PLACEABLE_KINDS) {
    const shapes = iconFor(kind);
    if (shapes.length === 0) continue;
    withTexture(scene, `placeable-${kind}`, PLACEABLE_ART, PLACEABLE_ART, (ctx) => {
      ctx.clearRect(0, 0, PLACEABLE_ART, PLACEABLE_ART);
      for (const [color, x, y, w, h] of shapes) {
        rect(ctx, color, x * scale, y * scale, w * scale, h * scale);
      }
    });
  }

  // The bubble that floats over a machine with something waiting in it.
  // Spec 11 asks for the finished state to be readable from across the farm,
  // and a bubble above the sprite is the only part of a 32-pixel object that
  // is still legible at that distance.
  withTexture(scene, 'machine-bubble', 14, 14, (ctx) => {
    ctx.clearRect(0, 0, 14, 14);
    rect(ctx, PALETTE['soil.0'], 1, 0, 12, 11);
    rect(ctx, PALETTE['soil.0'], 0, 1, 14, 9);
    rect(ctx, PALETTE['light.7'], 2, 1, 10, 9);
    rect(ctx, PALETTE['light.7'], 1, 2, 12, 7);
    rect(ctx, PALETTE['soil.0'], 5, 11, 4, 2);
    rect(ctx, PALETTE['light.5'], 6, 3, 2, 4);
    rect(ctx, PALETTE['light.5'], 6, 8, 2, 1);
  });
}

function createItemTextures(scene: Phaser.Scene) {
  for (const id of Object.keys(ITEMS)) {
    const shapes = iconFor(id);
    if (shapes.length === 0) continue;
    withTexture(scene, ITEMS[id].texture, ICON_SIZE, ICON_SIZE, (ctx) => {
      ctx.clearRect(0, 0, ICON_SIZE, ICON_SIZE);
      for (const [color, x, y, w, h] of shapes) rect(ctx, color, x, y, w, h);
    });
  }
}

/**
 * The villagers, and the cottages they go home to.
 *
 * Each person is a palette rather than a drawing, for the same reason the
 * buildings are: five hand-drawn sprites would be five places to edit when the
 * proportions change, and a sixth villager should be a row of colours rather
 * than an afternoon. The real walk cycles are recoloured LPC sheets loaded in
 * the scene; these are what is drawn when those have not loaded, and what the
 * inventory-style icons use.
 */
interface VillagerPalette {
  key: string;
  /** Hair or headwear. */
  hair: string;
  hairLight: string;
  skin: string;
  /** The main garment, its lit side and its shaded side. */
  cloth: string;
  clothLight: string;
  clothDark: string;
  legs: string;
  boots: string;
  /** A single accent square, which is what makes five sprites five people. */
  accent: string;
  /** How tall the garment is: a child is smaller and rounder than an adult. */
  child?: boolean;
}

const VILLAGER_PALETTES: VillagerPalette[] = [
  {
    key: 'npc-rowan',
    hair: PALETTE['light.7'],
    hairLight: PALETTE['light.7'],
    skin: PALETTE['light.7'],
    cloth: PALETTE['building.0'],
    clothLight: PALETTE['water.3'],
    clothDark: PALETTE['foliage.4'],
    legs: PALETTE['soil.2'],
    boots: PALETTE['soil.0'],
    accent: PALETTE['light.5'],
  },
  {
    key: 'npc-maeve',
    hair: PALETTE['clothWarm.1'],
    hairLight: PALETTE['clothWarm.3'],
    skin: PALETTE['light.5'],
    cloth: PALETTE['foliage.4'],
    clothLight: PALETTE['building.0'],
    clothDark: PALETTE['shadow.2'],
    legs: PALETTE['soil.1'],
    boots: PALETTE['shadow.0'],
    accent: PALETTE['light.4'],
  },
  {
    key: 'npc-tobias',
    hair: PALETTE['soil.0'],
    hairLight: PALETTE['soil.2'],
    skin: PALETTE['light.7'],
    cloth: PALETTE['light.2'],
    clothLight: PALETTE['light.5'],
    clothDark: PALETTE['soil.4'],
    legs: PALETTE['foliage.4'],
    boots: PALETTE['soil.0'],
    accent: PALETTE['light.7'],
  },
  {
    key: 'npc-juniper',
    hair: PALETTE['foliage.2'],
    hairLight: PALETTE['leaf.0'],
    skin: PALETTE['light.7'],
    cloth: PALETTE['leaf.2'],
    clothLight: PALETTE['light.0'],
    clothDark: PALETTE['foliage.3'],
    legs: PALETTE['soil.4'],
    boots: PALETTE['soil.0'],
    accent: PALETTE['light.1'],
  },
  {
    key: 'npc-bram',
    hair: PALETTE['building.2'],
    hairLight: PALETTE['light.6'],
    skin: PALETTE['light.5'],
    cloth: PALETTE['soil.4'],
    clothLight: PALETTE['light.2'],
    clothDark: PALETTE['soil.2'],
    legs: PALETTE['soil.2'],
    boots: PALETTE['shadow.0'],
    accent: PALETTE['light.1'],
  },
  {
    key: 'npc-ash',
    hair: PALETTE['light.5'],
    hairLight: PALETTE['light.7'],
    skin: PALETTE['light.7'],
    cloth: PALETTE['water.2'],
    clothLight: PALETTE['water.3'],
    clothDark: PALETTE['foliage.4'],
    legs: PALETTE['foliage.4'],
    boots: PALETTE['shadow.0'],
    accent: PALETTE['building.3'],
    child: true,
  },
  // Bà Xoan, spec 15: grey hair, a brown áo bà ba and black trousers. Only
  // ever seen if Tobias's walk sheet fails to load, since she borrows it.
  {
    key: 'npc-xoan',
    hair: PALETTE['light.6'],
    hairLight: PALETTE['light.7'],
    skin: PALETTE['light.5'],
    cloth: PALETTE['clothWarm.1'],
    clothLight: PALETTE['clothWarm.3'],
    clothDark: PALETTE['soil.1'],
    legs: PALETTE['shadow.0'],
    boots: PALETTE['soil.0'],
    accent: PALETTE['light.7'],
  },
];

function drawVillager(ctx: CanvasRenderingContext2D, palette: VillagerPalette) {
  ctx.clearRect(0, 0, 24, 32);
  // A child is drawn shorter, with the whole body pushed down the canvas so
  // the feet still land where every other sprite's do.
  const drop = palette.child ? 5 : 0;
  const bodyTop = 14 + drop;
  const bodyHeight = palette.child ? 8 : 10;

  rect(ctx, palette.hair, 5, 2 + drop, 14, 5);
  rect(ctx, palette.hairLight, 6, 3 + drop, 12, 2);
  rect(ctx, palette.skin, 7, 7 + drop, 10, 7);
  rect(ctx, PALETTE['shadow.0'], 9, 9 + drop, 2, 2);
  rect(ctx, PALETTE['shadow.0'], 14, 9 + drop, 2, 2);
  rect(ctx, PALETTE['light.7'], 9, 9 + drop, 1, 1);

  rect(ctx, palette.cloth, 5, bodyTop, 14, bodyHeight);
  rect(ctx, palette.clothLight, 6, bodyTop + 1, 5, bodyHeight - 3);
  rect(ctx, palette.clothDark, 14, bodyTop + 1, 5, bodyHeight - 1);
  rect(ctx, palette.accent, 11, bodyTop + 2, 2, bodyHeight - 4);
  // Arms, in the same skin as the face so they read as arms and not sleeves.
  rect(ctx, palette.skin, 3, bodyTop + 3, 2, bodyHeight - 4);
  rect(ctx, palette.skin, 19, bodyTop + 3, 2, bodyHeight - 4);

  const legTop = bodyTop + bodyHeight;
  rect(ctx, palette.legs, 7, legTop, 4, 30 - legTop);
  rect(ctx, palette.legs, 13, legTop, 4, 30 - legTop);
  rect(ctx, palette.boots, 6, 30, 5, 2);
  rect(ctx, palette.boots, 13, 30, 5, 2);
}

function createVillagerTextures(scene: Phaser.Scene) {
  for (const palette of VILLAGER_PALETTES) {
    withTexture(scene, palette.key, 24, 32, (ctx) => drawVillager(ctx, palette));
  }

  // The stand-in for the cottage drawings in the art folder, one for each of
  // the three names the village map uses, so a missing PNG is still a house
  // rather than a hole. It was made for the old three-by-two footprint and is
  // scaled to the four-by-three one — which is fine for a fallback.
  for (const key of ['cottage', 'cottage-brown', 'cottage-stone']) withTexture(scene, key, 96, 64, (ctx) => {
    ctx.clearRect(0, 0, 96, 64);
    rect(ctx, 'rgba(0,0,0,0.22)', 4, 58, 88, 6);
    // walls
    rect(ctx, PALETTE['light.5'], 10, 26, 76, 32);
    rect(ctx, PALETTE['light.7'], 12, 28, 72, 3);
    rect(ctx, PALETTE['light.2'], 12, 52, 72, 6);
    // timber
    rect(ctx, PALETTE['soil.3'], 10, 26, 3, 32);
    rect(ctx, PALETTE['soil.3'], 83, 26, 3, 32);
    rect(ctx, PALETTE['soil.3'], 10, 40, 76, 2);
    // roof
    rect(ctx, PALETTE['soil.4'], 4, 14, 88, 14);
    rect(ctx, PALETTE['soil.6'], 6, 16, 84, 3);
    rect(ctx, PALETTE['soil.2'], 6, 23, 84, 5);
    for (let x = 8; x < 88; x += 8) rect(ctx, PALETTE['soil.2'], x, 16, 2, 10);
    // chimney, and the smoke that says somebody is home
    rect(ctx, PALETTE['building.0'], 68, 4, 9, 12);
    rect(ctx, PALETTE['foliage.4'], 68, 4, 9, 3);
    // door
    rect(ctx, PALETTE['shadow.0'], 40, 34, 16, 24);
    rect(ctx, PALETTE['soil.3'], 42, 36, 12, 22);
    rect(ctx, PALETTE['light.5'], 51, 46, 2, 2);
    // windows
    rect(ctx, PALETTE['shadow.0'], 18, 32, 14, 12);
    rect(ctx, PALETTE['light.7'], 20, 34, 10, 8);
    rect(ctx, PALETTE['shadow.0'], 24, 34, 2, 8);
    rect(ctx, PALETTE['shadow.0'], 64, 32, 14, 12);
    rect(ctx, PALETTE['light.7'], 66, 34, 10, 8);
    rect(ctx, PALETTE['shadow.0'], 70, 34, 2, 8);
  });

  // The heart the HUD pops when a gift lands well.
  withTexture(scene, 'heart', 14, 12, (ctx) => {
    ctx.clearRect(0, 0, 14, 12);
    rect(ctx, PALETTE['building.3'], 2, 2, 4, 3);
    rect(ctx, PALETTE['building.3'], 8, 2, 4, 3);
    rect(ctx, PALETTE['building.3'], 1, 4, 12, 3);
    rect(ctx, PALETTE['building.3'], 3, 7, 8, 2);
    rect(ctx, PALETTE['building.3'], 5, 9, 4, 2);
    rect(ctx, PALETTE['light.5'], 3, 3, 2, 2);
    rect(ctx, PALETTE['light.5'], 9, 3, 2, 2);
  });
}

// --- boundary fringes --------------------------------------------------------

/** One rectangle of a fringe, and what it is for. */
export interface FringeSpan {
  x: number;
  y: number;
  w: number;
  h: number;
  role: 'body' | 'dark' | 'light';
}

/**
 * The shape of one fringe, without the colours.
 *
 * The depth wobbles pixel by pixel and the leading edge is dithered, which is
 * the entire trick — a fringe of even depth is a second straight line drawn
 * beside the first, and the map still looks like a spreadsheet. None of that
 * depends on what the fringe is made of, so it lives here where it can be
 * tested without a canvas.
 */
export function fringeSpans(mask: number, seed: number): FringeSpan[] {
  const spans: FringeSpan[] = [];
  const body = (x: number, y: number, w: number, h: number) => spans.push({ x, y, w, h, role: 'body' });
  const dot = (role: 'body' | 'dark' | 'light', x: number, y: number) => spans.push({ x, y, w: 1, h: 1, role });
  const depthAt = (i: number, side: number) => 3 + Math.floor(hash(i, side, seed) * 5);

  if (mask & 1) {
    for (let x = 0; x < TILE; x += 1) {
      const d = depthAt(x, 1);
      body(x, 0, 1, d);
      dot('dark', x, d - 1);
      if (hash(x, 31, seed) > 0.66) dot('body', x, d);
      if (hash(x, 57, seed) > 0.82) dot('light', x, Math.max(0, d - 3));
    }
  }
  if (mask & 2) {
    for (let y = 0; y < TILE; y += 1) {
      const d = depthAt(y, 2);
      body(TILE - d, y, d, 1);
      dot('dark', TILE - d, y);
      if (hash(y, 41, seed) > 0.66) dot('body', TILE - d - 1, y);
      if (hash(y, 67, seed) > 0.82) dot('light', TILE - Math.max(1, d - 2), y);
    }
  }
  if (mask & 4) {
    for (let x = 0; x < TILE; x += 1) {
      const d = depthAt(x, 4);
      body(x, TILE - d, 1, d);
      dot('dark', x, TILE - d);
      if (hash(x, 53, seed) > 0.66) dot('body', x, TILE - d - 1);
      if (hash(x, 79, seed) > 0.82) dot('light', x, TILE - Math.max(1, d - 2));
    }
  }
  if (mask & 8) {
    for (let y = 0; y < TILE; y += 1) {
      const d = depthAt(y, 8);
      body(0, y, d, 1);
      dot('dark', d - 1, y);
      if (hash(y, 61, seed) > 0.66) dot('body', d, y);
      if (hash(y, 83, seed) > 0.82) dot('light', Math.max(0, d - 3), y);
    }
  }
  return spans;
}

/**
 * One fringe: the material of a neighbouring tile, drawn over this one.
 *
 * The fringe used to be three flat colours standing in for grass. It is now
 * cut out of the grass — the mask is drawn, the composite is switched to
 * `source-in`, and the real tile is painted through it. Grass spilling over a
 * path is now literally the pixels of the grass beside it, which is one fewer
 * place for a hand-picked green to disagree with the art.
 *
 * It still works under the fallback, because it samples whatever `tile-grass`
 * currently is rather than a file it hopes is there.
 */
function drawFringe(
  ctx: CanvasRenderingContext2D,
  mask: number,
  seed: number,
  tile: CanvasImageSource,
) {
  ctx.clearRect(0, 0, TILE, TILE);
  const spans = fringeSpans(mask, seed);

  // Any opaque colour: only the alpha of this pass survives the composite.
  for (const span of spans) {
    if (span.role !== 'dark') rect(ctx, PALETTE['light.0'], span.x, span.y, span.w, span.h);
  }

  ctx.globalCompositeOperation = 'source-in';
  ctx.drawImage(tile, 0, 0, TILE, TILE);
  ctx.globalCompositeOperation = 'source-over';

  // The leading edge and the highlight go on top of the real pixels. Both are
  // translucent, so they shade the tile rather than replacing it — a fringe
  // that is only the tile has no edge, and the map goes back to looking flat.
  for (const span of spans) {
    if (span.role === 'dark') {
      rect(ctx, withAlpha(PALETTE['shadow.1'], 0.35), span.x, span.y, span.w, span.h);
    } else if (span.role === 'light') {
      rect(ctx, withAlpha(PALETTE['light.1'], 0.45), span.x, span.y, span.w, span.h);
    }
  }
}

/**
 * Names the overlay for one boundary and one mask.
 *
 * Exported because the scene has to ask for these by name, and a key built
 * from a template string in two files is a key that eventually differs in one.
 */
export function fringeTexture(over: 'grass' | 'path', under: string, mask: number): string {
  return `edge-${over}-on-${under}-${mask}`;
}

/** The three boundaries, and which side of each gets the overlay drawn on it. */
export const FRINGE_BOUNDARIES: ReadonlyArray<{ over: 'grass' | 'path'; under: 'path' | 'water' }> = [
  { over: 'grass', under: 'path' },
  { over: 'grass', under: 'water' },
  { over: 'path', under: 'water' },
];

/**
 * Fifteen overlays for each of the three boundaries.
 *
 * Forty-five small textures, drawn once at boot and never again. The cheapest
 * thing in the whole visual pass, and the one that changes a screenshot most:
 * it is what stops a dirt path being a rectangle cut out of a lawn.
 */
function createEdgeTextures(scene: Phaser.Scene) {
  for (const [index, { over, under }] of FRINGE_BOUNDARIES.entries()) {
    // No `?.`/existence guard: `tile-grass` and `tile-path` are both created,
    // unconditionally, earlier in this same function (the `withTexture(scene,
    // 'tile-grass', ...)`/`'tile-path'` draws happen before this is called),
    // and `textures.get()` never returns `undefined` even for a key that is
    // missing — it hands back Phaser's own `__MISSING` texture instead. A
    // guard that can never trigger is not defensive; it is a claim the reader
    // has to re-verify every time, for nothing.
    const tile = scene.textures.get(`tile-${over}`).getSourceImage() as CanvasImageSource;
    for (let mask = 1; mask <= 15; mask += 1) {
      withTexture(scene, fringeTexture(over, under, mask), TILE, TILE, (ctx) =>
        drawFringe(ctx, mask, index * 17 + 3, tile),
      );
    }
  }

  // Grass over a worked bed. Not one of the boundaries above, because those
  // are read off the map and never change: whether a plot is soil or still
  // lawn is save state, so `GroundView` asks for these as beds are dug.
  const grass = scene.textures.get('tile-grass').getSourceImage() as CanvasImageSource;
  for (let mask = 1; mask <= 15; mask += 1) {
    withTexture(scene, fringeTexture('grass', 'soil', mask), TILE, TILE, (ctx) =>
      drawFringe(ctx, mask, FRINGE_BOUNDARIES.length * 17 + 3, grass),
    );
  }
}

// --- the clock, and the icons beside it --------------------------------------

/** How wide the dial's sweep is, in degrees either side of straight up. */
export const DIAL_SWEEP = 118;

/** The clock face: brass rim, bone dial, five marks across the working day. */
function createDialTextures(scene: Phaser.Scene) {
  const size = 34;
  const mid = size / 2;

  withTexture(scene, 'clock-face', size, size, (ctx) => {
    ctx.clearRect(0, 0, size, size);
    const disc = (radius: number, colour: string) => {
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.arc(mid, mid, radius, 0, Math.PI * 2);
      ctx.fill();
    };
    disc(16, PALETTE['outline.0']);
    disc(15, PALETTE['light.2']);
    disc(13, PALETTE['soil.4']);
    disc(12, PALETTE['light.7']);
    disc(11, PALETTE['light.7']);

    // Marks at dawn, mid-morning, noon, evening and the small hours, which is
    // what the hand is telling you — not minutes.
    for (let i = 0; i <= 4; i += 1) {
      const angle = ((-DIAL_SWEEP + (i * DIAL_SWEEP * 2) / 4) * Math.PI) / 180;
      const long = i % 2 === 0;
      for (let r = long ? 6 : 8; r <= 10; r += 1) {
        px(
          ctx,
          long ? PALETTE['soil.3'] : PALETTE['soil.6'],
          Math.round(mid + Math.sin(angle) * r),
          Math.round(mid - Math.cos(angle) * r),
        );
      }
    }

    // Noon sits at the top; a warm wash over the morning half and a cool one
    // over the evening half says which way the day is going, wordlessly.
    // Was 'rgba(255,211,109,0.20)', a bright yellow with no palette
    // equivalent (the same gap as the tile-cursor and firefly glows above);
    // light.5 is the nearest entry.
    ctx.fillStyle = withAlpha(PALETTE['light.5'], 0.2);
    ctx.beginPath();
    ctx.moveTo(mid, mid);
    ctx.arc(mid, mid, 11, Math.PI, Math.PI * 1.5);
    ctx.fill();
    // Was 'rgba(80,110,160,0.18)', a cool blue. Unlike the yellow above, the
    // palette actually has a decent match here: water.0 (#3c49ad) is an
    // indigo blue in the same family and close enough in weight to read as
    // "the evening wash", not a substitution.
    ctx.fillStyle = withAlpha(PALETTE['water.0'], 0.18);
    ctx.beginPath();
    ctx.moveTo(mid, mid);
    ctx.arc(mid, mid, 11, Math.PI * 1.5, Math.PI * 2);
    ctx.fill();

    disc(2, PALETTE['soil.3']);
    px(ctx, PALETTE['light.7'], mid - 1, mid - 1);
  });

  // The origin sits at the pivot end, so the scene turns it about the dial's
  // centre by setting one angle and nothing else.
  withTexture(scene, 'clock-hand', 3, 14, (ctx) => {
    ctx.clearRect(0, 0, 3, 14);
    rect(ctx, PALETTE['clothWarm.1'], 1, 0, 1, 14);
    rect(ctx, PALETTE['building.1'], 1, 1, 1, 9);
    px(ctx, PALETTE['building.3'], 1, 3);
    rect(ctx, PALETTE['clothWarm.1'], 0, 11, 3, 3);
  });
}

/** A 16px icon, cleared and then drawn by whatever is handed in. */
function icon(scene: Phaser.Scene, key: string, draw: (ctx: CanvasRenderingContext2D) => void) {
  withTexture(scene, key, 16, 16, (ctx) => {
    ctx.clearRect(0, 0, 16, 16);
    draw(ctx);
  });
}

function drawSun(ctx: CanvasRenderingContext2D, body: string = PALETTE['light.5'], rim: string = PALETTE['light.5']) {
  ctx.fillStyle = rim;
  ctx.beginPath();
  ctx.arc(8, 8, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(8, 8, 4, 0, Math.PI * 2);
  ctx.fill();
  rect(ctx, PALETTE['light.7'], 6, 5, 2, 2);
  for (const [x, y] of [
    [8, 0],
    [8, 14],
    [0, 8],
    [14, 8],
  ] as Array<[number, number]>) {
    rect(ctx, rim, x, y, 2, 2);
  }
}

function drawCloud(ctx: CanvasRenderingContext2D, body: string = PALETTE['light.7'], shade: string = PALETTE['light.6']) {
  rect(ctx, shade, 2, 6, 12, 5);
  rect(ctx, body, 2, 5, 12, 4);
  rect(ctx, body, 5, 3, 7, 3);
  rect(ctx, PALETTE['light.7'], 6, 4, 4, 1);
}

/**
 * The season and the weather, as pictures.
 *
 * Small on purpose: these sit beside the dial at 16px, where a legible
 * silhouette beats detail. A blossom, a sun, a leaf and a flake are four
 * different shapes at eight pixels across, which is the only test that counts.
 */
function createHudIcons(scene: Phaser.Scene) {
  icon(scene, 'icon-season-spring', (ctx) => {
    for (const [x, y] of [
      [6, 2],
      [10, 6],
      [6, 10],
      [2, 6],
    ] as Array<[number, number]>) {
      rect(ctx, PALETTE['light.4'], x, y, 4, 4);
      rect(ctx, PALETTE['light.7'], x, y, 2, 2);
    }
    rect(ctx, PALETTE['light.5'], 6, 6, 4, 4);
    rect(ctx, PALETTE['leaf.2'], 7, 11, 2, 5);
  });

  icon(scene, 'icon-season-summer', (ctx) => drawSun(ctx));

  icon(scene, 'icon-season-autumn', (ctx) => {
    rect(ctx, PALETTE['soil.4'], 7, 10, 2, 6);
    rect(ctx, PALETTE['light.3'], 4, 4, 8, 7);
    rect(ctx, PALETTE['light.4'], 5, 3, 6, 3);
    rect(ctx, PALETTE['building.1'], 4, 9, 8, 2);
    rect(ctx, PALETTE['light.5'], 6, 5, 2, 3);
    px(ctx, PALETTE['light.3'], 2, 6);
    px(ctx, PALETTE['light.3'], 13, 6);
  });

  icon(scene, 'icon-season-winter', (ctx) => {
    rect(ctx, PALETTE['light.6'], 7, 1, 2, 14);
    rect(ctx, PALETTE['light.6'], 1, 7, 14, 2);
    for (const [x, y] of [
      [3, 3],
      [11, 3],
      [3, 11],
      [11, 11],
    ] as Array<[number, number]>) {
      rect(ctx, PALETTE['light.6'], x, y, 2, 2);
    }
    rect(ctx, PALETTE['light.7'], 7, 7, 2, 2);
  });

  icon(scene, 'icon-weather-sunny', (ctx) => drawSun(ctx));

  icon(scene, 'icon-weather-drizzle', (ctx) => {
    drawCloud(ctx);
    for (const [x, y] of [
      [4, 11],
      [8, 12],
      [11, 11],
    ] as Array<[number, number]>) {
      rect(ctx, PALETTE['water.3'], x, y, 1, 3);
      px(ctx, PALETTE['light.7'], x, y);
    }
  });

  icon(scene, 'icon-weather-breezy', (ctx) => {
    drawCloud(ctx, PALETTE['light.7'], PALETTE['light.6']);
    rect(ctx, PALETTE['light.6'], 2, 11, 9, 1);
    rect(ctx, PALETTE['light.6'], 5, 13, 8, 1);
    px(ctx, PALETTE['light.7'], 10, 11);
    px(ctx, PALETTE['light.7'], 12, 13);
  });

  icon(scene, 'icon-weather-firefly', (ctx) => {
    rect(ctx, PALETTE['light.7'], 8, 2, 5, 5);
    rect(ctx, PALETTE['light.7'], 9, 3, 2, 2);
    for (const [x, y] of [
      [3, 8],
      [7, 11],
      [12, 10],
      [5, 13],
    ] as Array<[number, number]>) {
      px(ctx, PALETTE['light.7'], x, y);
      px(ctx, PALETTE['light.1'], x + 1, y);
      px(ctx, PALETTE['light.1'], x, y + 1);
    }
  });

  icon(scene, 'icon-coin', (ctx) => {
    ctx.fillStyle = PALETTE['light.2'];
    ctx.beginPath();
    ctx.arc(8, 8, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = PALETTE['light.5'];
    ctx.beginPath();
    ctx.arc(8, 8, 5, 0, Math.PI * 2);
    ctx.fill();
    rect(ctx, PALETTE['light.7'], 5, 4, 3, 1);
    rect(ctx, PALETTE['light.2'], 6, 5, 4, 1);
    rect(ctx, PALETTE['light.2'], 6, 10, 4, 1);
    rect(ctx, PALETTE['light.2'], 6, 5, 1, 6);
    rect(ctx, PALETTE['light.2'], 9, 5, 1, 6);
    rect(ctx, PALETTE['light.2'], 7, 7, 2, 2);
  });

  // The cap on the energy tube, so a column of colour has something naming it.
  icon(scene, 'icon-energy-bolt', (ctx) => {
    rect(ctx, PALETTE['light.5'], 8, 1, 3, 6);
    rect(ctx, PALETTE['light.5'], 5, 6, 6, 3);
    rect(ctx, PALETTE['light.5'], 5, 8, 3, 7);
    rect(ctx, PALETTE['light.7'], 8, 2, 1, 4);
    rect(ctx, PALETTE['light.2'], 5, 12, 3, 3);
  });
}

/** Texture keys for the four seasons and the four skies, by state value. */
export const SEASON_ICONS: Record<string, string> = {
  Spring: 'icon-season-spring',
  Summer: 'icon-season-summer',
  Autumn: 'icon-season-autumn',
  Winter: 'icon-season-winter',
};

export const WEATHER_ICONS: Record<string, string> = {
  Sunny: 'icon-weather-sunny',
  Drizzle: 'icon-weather-drizzle',
  Breezy: 'icon-weather-breezy',
  'Firefly Shower': 'icon-weather-firefly',
};

/**
 * The mine (spec 13): three looks of rock, the three fixtures a floor has,
 * the mouth of the mine in the wood, six monsters, and the darkness.
 *
 * Placeholders in the same sense as everything else in this file, generated
 * from the palette so every pixel is ours to license. A tileset dropped in
 * through `lpc:import` under the same keys wins over all of it.
 */
interface MineBandPalette {
  band: 'shallow' | 'middle' | 'deep';
  /** The floor: its fill, the grit on it, and the crack across it. */
  floor: string;
  grit: string;
  crack: string;
  /** The rock face: its fill, its lit top edge, and the ore flecked in it. */
  wall: string;
  wallTop: string;
  wallDark: string;
  ore: string;
}

/**
 * Brown copper rock near the top, cold grey iron rock in the middle, and a
 * dark violet with gold in it at the bottom — so a screenshot of floor 35
 * could not be mistaken for one of floor 3.
 */
const MINE_BANDS: readonly MineBandPalette[] = [
  {
    band: 'shallow',
    floor: PALETTE['soil.2'],
    grit: PALETTE['soil.4'],
    crack: PALETTE['soil.0'],
    wall: PALETTE['soil.3'],
    wallTop: PALETTE['soil.5'],
    wallDark: PALETTE['soil.0'],
    ore: PALETTE['light.3'],
  },
  {
    band: 'middle',
    floor: PALETTE['foliage.4'],
    grit: PALETTE['building.0'],
    crack: PALETTE['outline.2'],
    wall: PALETTE['building.0'],
    wallTop: PALETTE['building.2'],
    wallDark: PALETTE['shadow.2'],
    ore: PALETTE['light.6'],
  },
  {
    band: 'deep',
    floor: PALETTE['shadow.2'],
    grit: PALETTE['shadow.3'],
    crack: PALETTE['outline.0'],
    wall: PALETTE['shadow.0'],
    wallTop: PALETTE['berry.0'],
    wallDark: PALETTE['outline.1'],
    ore: PALETTE['gold.0'],
  },
];

interface MonsterPalette {
  kind: string;
  size: number;
  body: string;
  light: string;
  dark: string;
  eye: string;
  shape: 'slime' | 'bat' | 'bug' | 'ghost';
}

const MONSTER_ART: readonly MonsterPalette[] = [
  { kind: 'green-slime', size: 32, body: PALETTE['leaf.2'], light: PALETTE['light.0'], dark: PALETTE['leaf.0'], eye: PALETTE['outline.2'], shape: 'slime' },
  { kind: 'slime', size: 32, body: PALETTE['water.3'], light: PALETTE['light.6'], dark: PALETTE['water.2'], eye: PALETTE['outline.2'], shape: 'slime' },
  { kind: 'bat', size: 32, body: PALETTE['shadow.0'], light: PALETTE['berry.0'], dark: PALETTE['outline.1'], eye: PALETTE['building.3'], shape: 'bat' },
  { kind: 'rock-bug', size: 32, body: PALETTE['building.0'], light: PALETTE['building.2'], dark: PALETTE['soil.1'], eye: PALETTE['light.4'], shape: 'bug' },
  { kind: 'ghost', size: 32, body: PALETTE['light.6'], light: PALETTE['light.7'], dark: PALETTE['building.0'], eye: PALETTE['shadow.3'], shape: 'ghost' },
  // The floor-40 boss is "a bigger monster, not a system" (spec 13's own
  // words), so it is a slime twice the size in the colours of a warning.
  { kind: 'floor-boss', size: 64, body: PALETTE['clothWarm.2'], light: PALETTE['building.1'], dark: PALETTE['clothDeep.0'], eye: PALETTE['gold.0'], shape: 'slime' },
];

function drawMonster(ctx: CanvasRenderingContext2D, art: MonsterPalette) {
  const u = art.size / 32;
  const r = (color: string, x: number, y: number, w: number, h: number) => rect(ctx, color, x * u, y * u, w * u, h * u);
  if (art.shape === 'slime') {
    r(withAlpha(PALETTE['outline.2'], 0.35), 5, 27, 22, 3);
    r(art.dark, 5, 16, 22, 11);
    r(art.body, 7, 11, 18, 14);
    r(art.body, 10, 8, 12, 4);
    r(art.light, 10, 11, 5, 3);
    r(art.light, 9, 14, 2, 4);
    r(art.eye, 12, 17, 2, 3);
    r(art.eye, 18, 17, 2, 3);
    if (art.kind === 'floor-boss') {
      r(art.eye, 11, 4, 10, 3);
      r(art.eye, 11, 2, 2, 2);
      r(art.eye, 15, 1, 2, 3);
      r(art.eye, 19, 2, 2, 2);
    }
  } else if (art.shape === 'bat') {
    r(art.dark, 2, 12, 10, 4);
    r(art.dark, 20, 12, 10, 4);
    r(art.light, 4, 11, 7, 2);
    r(art.light, 21, 11, 7, 2);
    r(art.body, 12, 10, 8, 10);
    r(art.body, 13, 8, 2, 2);
    r(art.body, 17, 8, 2, 2);
    r(art.eye, 13, 13, 2, 2);
    r(art.eye, 17, 13, 2, 2);
  } else if (art.shape === 'bug') {
    r(art.dark, 5, 22, 3, 4);
    r(art.dark, 24, 22, 3, 4);
    r(art.dark, 10, 24, 3, 3);
    r(art.dark, 19, 24, 3, 3);
    r(art.body, 6, 12, 20, 12);
    r(art.light, 8, 12, 14, 3);
    r(art.light, 11, 17, 3, 3);
    r(art.light, 18, 18, 3, 2);
    r(art.dark, 12, 9, 8, 4);
    r(art.eye, 13, 10, 2, 2);
    r(art.eye, 17, 10, 2, 2);
  } else {
    r(withAlpha(art.body, 0.9), 8, 6, 16, 18);
    r(withAlpha(art.body, 0.9), 6, 10, 20, 12);
    r(withAlpha(art.light, 0.9), 10, 7, 6, 4);
    r(withAlpha(art.body, 0.7), 6, 22, 4, 4);
    r(withAlpha(art.body, 0.7), 14, 22, 4, 5);
    r(withAlpha(art.body, 0.7), 22, 22, 4, 4);
    r(art.eye, 11, 13, 3, 4);
    r(art.eye, 18, 13, 3, 4);
  }
}

function createMineTextures(scene: Phaser.Scene) {
  for (const art of MINE_BANDS) {
    withTexture(scene, `mine-floor-${art.band}`, TILE, TILE, (ctx) => {
      rect(ctx, art.floor, 0, 0, TILE, TILE);
      for (let i = 0; i < 14; i += 1) {
        px(ctx, art.grit, Math.floor(hash(i, 5, 31) * 31), Math.floor(hash(i, 9, 31) * 31));
      }
      rect(ctx, art.crack, 6, 20, 7, 1);
      rect(ctx, art.crack, 12, 21, 5, 1);
      rect(ctx, art.grit, 22, 8, 4, 2);
      outline(ctx, TILE, TILE, withAlpha(art.crack, 0.25));
    });
    withTexture(scene, `mine-wall-${art.band}`, TILE, TILE, (ctx) => {
      rect(ctx, art.wall, 0, 0, TILE, TILE);
      rect(ctx, art.wallTop, 0, 0, TILE, 4);
      rect(ctx, art.wallDark, 0, 26, TILE, 6);
      // A few courses of rock, so a wall reads as stone rather than a fill.
      rect(ctx, art.wallDark, 0, 12, 14, 1);
      rect(ctx, art.wallDark, 16, 18, 16, 1);
      rect(ctx, art.wallTop, 3, 6, 8, 2);
      rect(ctx, art.wallTop, 19, 10, 9, 2);
      rect(ctx, art.ore, 9, 16, 2, 2);
      rect(ctx, art.ore, 24, 21, 2, 1);
      outline(ctx, TILE, TILE, withAlpha(art.wallDark, 0.5));
    });
  }

  // The ladder down: a black shaft with rungs going into it.
  withTexture(scene, 'mine-ladder', TILE, TILE, (ctx) => {
    rect(ctx, PALETTE['outline.0'], 5, 5, 22, 22);
    rect(ctx, PALETTE['shadow.0'], 7, 7, 18, 18);
    rect(ctx, PALETTE['soil.5'], 10, 4, 2, 22);
    rect(ctx, PALETTE['soil.5'], 20, 4, 2, 22);
    for (let y = 8; y < 26; y += 5) rect(ctx, PALETTE['soil.6'], 10, y, 12, 2);
  });

  // The way up: a ladder standing against a patch of daylight.
  withTexture(scene, 'mine-exit', TILE, TILE, (ctx) => {
    rect(ctx, withAlpha(PALETTE['light.7'], 0.35), 4, 2, 24, 28);
    rect(ctx, PALETTE['soil.4'], 9, 0, 2, 32);
    rect(ctx, PALETTE['soil.4'], 21, 0, 2, 32);
    for (let y = 4; y < 32; y += 6) rect(ctx, PALETTE['soil.6'], 9, y, 14, 2);
  });

  // The elevator: an iron cage with a lamp over it.
  withTexture(scene, 'mine-elevator', TILE, TILE, (ctx) => {
    rect(ctx, PALETTE['outline.2'], 3, 5, 26, 25);
    rect(ctx, PALETTE['building.0'], 5, 7, 22, 21);
    for (let x = 8; x < 27; x += 5) rect(ctx, PALETTE['building.2'], x, 7, 1, 21);
    rect(ctx, PALETTE['gold.1'], 3, 3, 26, 3);
    rect(ctx, PALETTE['light.5'], 14, 0, 4, 3);
  });

  // The mouth of the mine in Hollowpine Wood: a dark arch in a heap of rock,
  // timbered like every mine entrance anybody has ever drawn.
  withTexture(scene, 'mine-entrance', 64, 64, (ctx) => {
    rect(ctx, PALETTE['building.0'], 2, 14, 60, 50);
    rect(ctx, PALETTE['building.2'], 8, 8, 48, 10);
    rect(ctx, PALETTE['building.2'], 4, 18, 8, 8);
    rect(ctx, PALETTE['building.2'], 50, 22, 10, 6);
    rect(ctx, PALETTE['outline.0'], 18, 26, 28, 38);
    rect(ctx, PALETTE['shadow.0'], 21, 30, 22, 34);
    rect(ctx, PALETTE['soil.3'], 15, 22, 5, 42);
    rect(ctx, PALETTE['soil.3'], 44, 22, 5, 42);
    rect(ctx, PALETTE['soil.4'], 13, 20, 38, 6);
    rect(ctx, PALETTE['soil.6'], 13, 20, 38, 2);
    rect(ctx, PALETTE['light.5'], 30, 36, 4, 4);
    outline(ctx, 64, 64, withAlpha(PALETTE['outline.2'], 0.4));
  });

  for (const art of MONSTER_ART) {
    withTexture(scene, `monster-${art.kind}`, art.size, art.size, (ctx) => drawMonster(ctx, art));
  }

  // The dark, with a hole in it. Transparent in the middle and fully opaque
  // from `MINE_LIGHT_EDGE` out, so the scene can scale the hole to whatever a
  // torch buys and fill the rest of the screen with the opaque colour.
  withTexture(scene, 'mine-light', MINE_LIGHT_SIZE, MINE_LIGHT_SIZE, (ctx) => {
    const half = MINE_LIGHT_SIZE / 2;
    const g = ctx.createRadialGradient(half, half, half * 0.2, half, half, half * MINE_LIGHT_EDGE);
    g.addColorStop(0, withAlpha(PALETTE['outline.2'], 0));
    g.addColorStop(0.55, withAlpha(PALETTE['outline.2'], 0.45));
    g.addColorStop(1, withAlpha(PALETTE['outline.2'], 1));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, MINE_LIGHT_SIZE, MINE_LIGHT_SIZE);
  });

  // The cap on the health tube, the way the bolt caps the energy one.
  icon(scene, 'icon-health', (ctx) => {
    rect(ctx, PALETTE['building.3'], 2, 3, 5, 6);
    rect(ctx, PALETTE['building.3'], 9, 3, 5, 6);
    rect(ctx, PALETTE['building.3'], 3, 8, 10, 3);
    rect(ctx, PALETTE['building.3'], 5, 11, 6, 2);
    rect(ctx, PALETTE['building.3'], 7, 13, 2, 2);
    rect(ctx, PALETTE['light.7'], 4, 4, 2, 2);
    rect(ctx, PALETTE['clothWarm.0'], 11, 7, 2, 3);
  });

  // One mote of a monster coming apart.
  withTexture(scene, 'mine-mote', 4, 4, (ctx) => {
    rect(ctx, PALETTE['light.7'], 0, 0, 4, 4);
  });
}

/** How big the darkness texture is, and how far out from its centre it is fully dark. */
export const MINE_LIGHT_SIZE = 256;
export const MINE_LIGHT_EDGE = 1;

/**
 * The phố's stand-ins, spec 15.
 *
 * Every one of these is a placeholder in the sense `itemIcons.ts` means it:
 * drawn in code from the palette so the street is playable, and replaced the
 * moment a PNG under the same name is in the art folder — `withTexture` never
 * draws over a texture that loaded. The table at the end of the spec says
 * which tool and which import command each one wants.
 */

/** The three fronts: one drawing, three wall colours. */
const SHOPFRONTS: ReadonlyArray<{ key: string; wall: string; wallLight: string; awning: string }> = [
  { key: 'shopfront', wall: PALETTE['light.5'], wallLight: PALETTE['light.7'], awning: PALETTE['clothWarm.2'] },
  { key: 'shopfront-green', wall: PALETTE['light.0'], wallLight: PALETTE['light.1'], awning: PALETTE['leaf.0'] },
  { key: 'shopfront-blue', wall: PALETTE['water.3'], wallLight: PALETTE['light.6'], awning: PALETTE['water.0'] },
];

const SIGNPOST_W = TILE;
const SIGNPOST_H = TILE;
const MILESTONE_H = 48;

const SHOPFRONT_W = 5 * TILE;
const SHOPFRONT_H = 4 * TILE;

function createPlazaTextures(scene: Phaser.Scene) {
  // Brick pavement, running bond. Red for the phố, and the mortar the path's
  // own sand so the two read as the same town.
  withTexture(scene, 'tile-plaza', TILE, TILE, (ctx) => {
    rect(ctx, PALETTE['building.1'], 0, 0, TILE, TILE);
    for (let row = 0; row < 4; row += 1) {
      const y = row * 8;
      rect(ctx, PALETTE['light.2'], 0, y + 7, TILE, 1);
      const offset = row % 2 === 0 ? 0 : 8;
      for (let x = offset; x < TILE; x += 16) rect(ctx, PALETTE['light.2'], x, y, 1, 7);
      for (let x = offset + 2; x < TILE; x += 16) rect(ctx, PALETTE['building.3'], x, y + 1, 5, 1);
    }
    for (let i = 0; i < 6; i += 1) {
      px(ctx, PALETTE['clothWarm.0'], Math.floor(hash(i, 4, 17) * 31), Math.floor(hash(i, 8, 17) * 31));
    }
  });

  for (const front of SHOPFRONTS) {
    withTexture(scene, front.key, SHOPFRONT_W, SHOPFRONT_H, (ctx) => {
      const w = SHOPFRONT_W;
      const h = SHOPFRONT_H;
      ctx.clearRect(0, 0, w, h);
      // The wall, and a tin roof along the top: the silo's slate.
      rect(ctx, front.wall, 0, 8, w, h - 8);
      rect(ctx, front.wallLight, 0, 8, w, 2);
      rect(ctx, PALETTE['building.0'], 0, 0, w, 8);
      for (let x = 2; x < w; x += 6) rect(ctx, PALETTE['building.2'], x, 0, 2, 8);
      rect(ctx, PALETTE['shadow.2'], 0, 7, w, 1);

      // The board, blank, exactly where `signLayout` letters it.
      const bx = Math.round(w * SIGNBOARD.left);
      const by = Math.round(h * SIGNBOARD.top);
      const bw = Math.round(w * (SIGNBOARD.right - SIGNBOARD.left));
      const bh = Math.round(h * (SIGNBOARD.bottom - SIGNBOARD.top));
      rect(ctx, PALETTE['soil.3'], bx - 2, by - 2, bw + 4, bh + 4);
      rect(ctx, PALETTE['light.7'], bx, by, bw, bh);
      rect(ctx, PALETTE['light.5'], bx, by + bh - 2, bw, 2);

      // A striped awning under the board, scalloped along its edge.
      const ay = by + bh + 6;
      for (let x = 4; x < w - 4; x += 8) {
        const stripe = (x - 4) % 16 === 0 ? front.awning : PALETTE['light.7'];
        rect(ctx, stripe, x, ay, 8, 10);
        rect(ctx, stripe, x + 2, ay + 10, 4, 2);
      }
      rect(ctx, withAlpha(PALETTE['shadow.0'], 0.35), 4, ay + 12, w - 8, 3);

      // The shop's mouth: a rolled-up shutter over a dark room, between posts.
      const my = ay + 16;
      rect(ctx, PALETTE['shadow.2'], 14, my, w - 28, h - my - 4);
      rect(ctx, PALETTE['building.0'], 14, my, w - 28, 6);
      for (let x = 16; x < w - 16; x += 4) rect(ctx, PALETTE['building.2'], x, my + 1, 1, 4);
      rect(ctx, PALETTE['soil.4'], 8, my - 2, 6, h - my - 2);
      rect(ctx, PALETTE['soil.4'], w - 14, my - 2, 6, h - my - 2);
      // Shelves glimpsed inside, so it reads as a shop rather than a garage.
      for (let y = my + 12; y < h - 10; y += 10) rect(ctx, PALETTE['soil.2'], 20, y, w - 40, 2);
      rect(ctx, PALETTE['building.2'], 0, h - 4, w, 4);
    });
  }

  // Bà Xoan's cart: a wooden counter on two wheels under a striped canopy,
  // with the steamer on top.
  withTexture(scene, 'xoi-cart', 3 * TILE, 2 * TILE, (ctx) => {
    const w = 3 * TILE;
    ctx.clearRect(0, 0, w, 2 * TILE);
    for (let x = 0; x < w; x += 12) {
      rect(ctx, x % 24 === 0 ? PALETTE['building.3'] : PALETTE['light.7'], x, 0, 12, 8);
    }
    rect(ctx, PALETTE['soil.4'], 6, 8, 3, 26);
    rect(ctx, PALETTE['soil.4'], w - 9, 8, 3, 26);
    rect(ctx, PALETTE['light.6'], 34, 18, 28, 14);
    rect(ctx, PALETTE['light.7'], 36, 18, 24, 3);
    rect(ctx, PALETTE['building.2'], 34, 30, 28, 2);
    rect(ctx, PALETTE['light.2'], 2, 32, w - 4, 18);
    rect(ctx, PALETTE['light.5'], 2, 32, w - 4, 3);
    rect(ctx, PALETTE['soil.4'], 2, 48, w - 4, 2);
    rect(ctx, PALETTE['light.7'], 30, 37, 36, 8);
    rect(ctx, PALETTE['shadow.2'], 12, 50, 12, 12);
    rect(ctx, PALETTE['building.0'], 15, 53, 6, 6);
    rect(ctx, PALETTE['shadow.2'], w - 24, 50, 12, 12);
    rect(ctx, PALETTE['building.0'], w - 21, 53, 6, 6);
  });

  // A glass-fronted cabinet on legs, twice as tall as it is wide.
  withTexture(scene, 'street-cabinet', TILE, 2 * TILE, (ctx) => {
    ctx.clearRect(0, 0, TILE, 2 * TILE);
    rect(ctx, PALETTE['soil.4'], 4, 8, 24, 48);
    rect(ctx, PALETTE['light.6'], 7, 11, 18, 36);
    rect(ctx, PALETTE['light.7'], 8, 12, 3, 20);
    rect(ctx, PALETTE['soil.3'], 7, 23, 18, 2);
    rect(ctx, PALETTE['soil.3'], 7, 35, 18, 2);
    rect(ctx, PALETTE['light.5'], 10, 19, 5, 4);
    rect(ctx, PALETTE['building.3'], 16, 31, 6, 4);
    rect(ctx, PALETTE['soil.2'], 6, 56, 3, 8);
    rect(ctx, PALETTE['soil.2'], 23, 56, 3, 8);
  });

  // A concrete pole with a crossarm, and the knot of wire every pole in the
  // phố has. One tile wide and three and a half tall.
  withTexture(scene, 'street-pole', TILE, 112, (ctx) => {
    ctx.clearRect(0, 0, TILE, 112);
    rect(ctx, PALETTE['building.2'], 13, 4, 6, 108);
    rect(ctx, PALETTE['light.6'], 13, 4, 2, 108);
    rect(ctx, PALETTE['soil.3'], 3, 10, 26, 3);
    for (const x of [5, 15, 25]) rect(ctx, PALETTE['light.7'], x, 7, 2, 3);
    rect(ctx, PALETTE['shadow.2'], 8, 18, 16, 6);
    rect(ctx, PALETTE['outline.2'], 10, 20, 12, 2);
    rect(ctx, PALETTE['building.0'], 12, 40, 8, 10);
  });

  // A road sign, after the blue ones on Quốc lộ 1: a white-edged blue board on
  // two white poles banded in red. One tile, drawn at its own size rather than
  // shrunk from a bigger picture, which is what pixel art does badly. The
  // lettering and the arrow are drawn over it by the scene, inside `SIGNPOST`.
  withTexture(scene, 'signpost', SIGNPOST_W, SIGNPOST_H, (ctx) => {
    const w = SIGNPOST_W;
    const h = SIGNPOST_H;
    ctx.clearRect(0, 0, w, h);
    const bx = Math.round(w * SIGNPOST.board.left);
    const by = Math.round(h * SIGNPOST.board.top);
    const bw = Math.round(w * (SIGNPOST.board.right - SIGNPOST.board.left));
    const bh = Math.round(h * (SIGNPOST.board.bottom - SIGNPOST.board.top));
    for (const px0 of [Math.round(w * 0.25), Math.round(w * 0.75) - 1]) {
      rect(ctx, PALETTE['light.7'], px0, by + bh, 1, h - by - bh - 1);
      for (let y = by + bh + 2; y < h - 2; y += 4) rect(ctx, PALETTE['building.1'], px0, y, 1, 2);
    }
    rect(ctx, PALETTE['light.7'], bx, by, bw, bh);
    rect(ctx, PALETTE['water.0'], bx + 1, by + 1, bw - 2, bh - 2);
    rect(ctx, PALETTE['shadow.3'], bx + 1, by + bh - 2, bw - 2, 1);
    rect(ctx, withAlpha(PALETTE['shadow.0'], 0.35), Math.round(w * 0.2), h - 1, Math.round(w * 0.6), 1);
  });

  // A cột mốc: a white stone with a red cap and a rounded top, one tile wide.
  withTexture(scene, 'milestone', TILE, MILESTONE_H, (ctx) => {
    const h = MILESTONE_H;
    ctx.clearRect(0, 0, TILE, h);
    const capBottom = Math.round(h * ((MILESTONE.cap.bottom + MILESTONE.stone.top) / 2));
    rect(ctx, withAlpha(PALETTE['shadow.0'], 0.35), 3, h - 4, 26, 4);
    rect(ctx, PALETTE['light.6'], 3, capBottom, 26, h - capBottom - 3);
    rect(ctx, PALETTE['light.7'], 4, capBottom, 22, h - capBottom - 4);
    rect(ctx, PALETTE['building.1'], 6, 1, 20, 3);
    rect(ctx, PALETTE['building.1'], 4, 3, 24, capBottom - 3);
    rect(ctx, PALETTE['building.3'], 6, 3, 4, capBottom - 5);
    rect(ctx, PALETTE['building.2'], 3, h - 6, 26, 2);
  });

  // The wire strung between poles, sagging.
  withTexture(scene, 'street-wire', TILE, TILE, (ctx) => {
    ctx.clearRect(0, 0, TILE, TILE);
    for (const [y, sag] of [
      [12, 2],
      [15, 3],
      [19, 2],
    ] as const) {
      rect(ctx, PALETTE['outline.2'], 0, y, 8, 1);
      rect(ctx, PALETTE['outline.2'], 8, y + sag - 1, 16, 1);
      rect(ctx, PALETTE['outline.2'], 24, y, 8, 1);
    }
  });
}
