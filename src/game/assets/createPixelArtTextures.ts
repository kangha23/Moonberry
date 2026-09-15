import Phaser from 'phaser';
import { CROP_ORDER, ITEMS } from '../systems/items';
import { CROP_PALETTES, ICON_SIZE, foragePalette, iconFor } from './itemIcons';
import { PLACEABLE_KINDS } from '../systems/items';
import { FORAGE_DEFS } from '../systems/items';
import { TREE_STAGES } from '../systems/resources';

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

/** Deterministic pseudo-random from coords so grass looks varied but stable. */
function hash(x: number, y: number, seed = 7) {
  let h = (x * 374761393 + y * 668265263 + seed * 974634211) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function outline(ctx: CanvasRenderingContext2D, w: number, h: number, color = 'rgba(24,38,24,0.35)') {
  rect(ctx, color, 0, 0, w, 1);
  rect(ctx, color, 0, h - 1, w, 1);
  rect(ctx, color, 0, 0, 1, h);
  rect(ctx, color, w - 1, 0, 1, h);
}

function drawGrass(ctx: CanvasRenderingContext2D, base = '#63b04e', dark = '#4a8f3c', light = '#8fd47a') {
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
  px(ctx, '#fff7d6', 11, 6);
  px(ctx, '#ffd9e3', 26, 24);
  outline(ctx, TILE, TILE);
}

function drawSoil(ctx: CanvasRenderingContext2D, wet = false) {
  const base = wet ? '#5a3d2c' : '#7a5230';
  const furrow = wet ? '#3e2a1f' : '#5e3d24';
  const ridge = wet ? '#7a5c44' : '#a3764a';
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
    rect(ctx, '#4f7f8c', 7, 22, 10, 2);
    rect(ctx, '#6fa8b5', 8, 22, 5, 1);
  }
  outline(ctx, TILE, TILE);
}

export function createPixelArtTextures(scene: Phaser.Scene) {
  withTexture(scene, 'tile-grass', TILE, TILE, (ctx) => drawGrass(ctx));
  withTexture(scene, 'tile-grass-2', TILE, TILE, (ctx) => drawGrass(ctx, '#5da653', '#478739', '#86cc74'));
  withTexture(scene, 'tile-grass-3', TILE, TILE, (ctx) => drawGrass(ctx, '#6ab054', '#4f9040', '#9ade83'));

  withTexture(scene, 'tile-path', TILE, TILE, (ctx) => {
    rect(ctx, '#c9a06b', 0, 0, TILE, TILE);
    rect(ctx, '#e2c086', 0, 0, TILE, 5);
    rect(ctx, '#a87f4e', 0, 27, TILE, 5);
    // cobble dots
    rect(ctx, '#b78f5c', 5, 9, 7, 4);
    rect(ctx, '#d9b77e', 6, 9, 5, 1);
    rect(ctx, '#b78f5c', 19, 16, 8, 5);
    rect(ctx, '#e8cb90', 20, 16, 6, 1);
    rect(ctx, '#9a7345', 8, 21, 5, 3);
    for (let i = 0; i < 12; i += 1) {
      px(ctx, '#8a6840', Math.floor(hash(i, 3) * 30) + 1, Math.floor(hash(i, 11) * 30) + 1);
    }
    outline(ctx, TILE, TILE);
  });

  withTexture(scene, 'tile-water', TILE, TILE, (ctx) => {
    rect(ctx, '#3d7fa6', 0, 0, TILE, TILE);
    rect(ctx, '#2c5f80', 0, 26, TILE, 6);
    rect(ctx, '#5fb3c9', 0, 0, TILE, 3);
    // waves
    rect(ctx, '#7fd4de', 4, 9, 10, 2);
    rect(ctx, '#bff0ef', 5, 9, 4, 1);
    rect(ctx, '#5fb3c9', 17, 16, 11, 2);
    rect(ctx, '#dff7f3', 18, 16, 4, 1);
    rect(ctx, '#2c5f80', 7, 21, 8, 1);
    outline(ctx, TILE, TILE);
  });

  withTexture(scene, 'plot-wild', TILE, TILE, (ctx) => {
    drawGrass(ctx, '#5c9a49', '#43763a', '#8fca76');
    rect(ctx, '#3d6b35', 9, 8, 2, 14);
    rect(ctx, '#6fbf58', 11, 10, 2, 10);
    rect(ctx, '#2e5230', 20, 12, 2, 12);
    rect(ctx, '#7fd06a', 22, 14, 2, 8);
    rect(ctx, '#d9b06a', 24, 24, 3, 2);
  });

  withTexture(scene, 'plot-tilled', TILE, TILE, (ctx) => drawSoil(ctx, false));
  withTexture(scene, 'plot-watered', TILE, TILE, (ctx) => drawSoil(ctx, true));

  withTexture(scene, 'crop-seeded', TILE, TILE, (ctx) => {
    ctx.clearRect(0, 0, TILE, TILE);
    rect(ctx, '#8a613c', 12, 20, 8, 3);
    rect(ctx, '#e3c98c', 13, 16, 3, 4);
    rect(ctx, '#c9a86a', 16, 17, 3, 3);
    px(ctx, '#fff3cf', 14, 17);
  });

  withTexture(scene, 'crop-sprout', TILE, TILE, (ctx) => {
    ctx.clearRect(0, 0, TILE, TILE);
    rect(ctx, '#2f7d37', 15, 17, 2, 8);
    rect(ctx, '#57b84f', 9, 13, 7, 5);
    rect(ctx, '#8be06e', 10, 13, 4, 2);
    rect(ctx, '#3f9c46', 17, 11, 7, 6);
    rect(ctx, '#a9ec8f', 18, 11, 4, 2);
    rect(ctx, '#245c2c', 15, 22, 2, 3);
  });

  createCropTextures(scene);

  withTexture(scene, 'player', 24, 32, (ctx) => {
    ctx.clearRect(0, 0, 24, 32);
    // shadow anchor drawn separately in scene; body with outline feel
    rect(ctx, '#241612', 7, 2, 10, 3); // hat top shadow
    rect(ctx, '#8a5a33', 5, 4, 14, 4); // straw hat
    rect(ctx, '#e8b96a', 6, 5, 12, 2);
    rect(ctx, '#c98f45', 5, 7, 14, 1);
    rect(ctx, '#f2c189', 7, 8, 10, 7); // face
    rect(ctx, '#2b1d18', 9, 10, 2, 2);
    rect(ctx, '#2b1d18', 14, 10, 2, 2);
    rect(ctx, '#e89a7a', 8, 12, 2, 1);
    rect(ctx, '#e89a7a', 15, 12, 2, 1);
    rect(ctx, '#4d8f5f', 6, 15, 12, 9); // shirt
    rect(ctx, '#6fbf7f', 7, 16, 4, 6);
    rect(ctx, '#35663f', 14, 16, 4, 8);
    rect(ctx, '#f2c189', 3, 17, 3, 7); // arms
    rect(ctx, '#f2c189', 18, 17, 3, 7);
    rect(ctx, '#3a4a6b', 7, 24, 4, 6); // pants
    rect(ctx, '#3a4a6b', 13, 24, 4, 6);
    rect(ctx, '#2b3a55', 7, 27, 4, 1);
    rect(ctx, '#2b3a55', 13, 27, 4, 1);
    rect(ctx, '#211612', 6, 30, 5, 2); // boots
    rect(ctx, '#211612', 13, 30, 5, 2);
  });

  withTexture(scene, 'rowan', 24, 32, (ctx) => {
    ctx.clearRect(0, 0, 24, 32);
    rect(ctx, '#d9d0c1', 5, 2, 14, 5); // gray hair / hood
    rect(ctx, '#efe6c8', 6, 3, 12, 2);
    rect(ctx, '#f2d9a7', 7, 7, 10, 7);
    rect(ctx, '#2b1d18', 9, 9, 2, 2);
    rect(ctx, '#2b1d18', 14, 9, 2, 2);
    rect(ctx, '#ffffff', 9, 9, 1, 1);
    rect(ctx, '#5f7fa6', 5, 14, 14, 10); // robe
    rect(ctx, '#87a8cc', 6, 15, 5, 7);
    rect(ctx, '#32465a', 14, 15, 5, 9);
    rect(ctx, '#ffd36d', 11, 16, 2, 6); // clasp
    rect(ctx, '#5a3c32', 7, 24, 4, 6);
    rect(ctx, '#5a3c32', 13, 24, 4, 6);
    rect(ctx, '#2e211b', 6, 29, 5, 2);
    rect(ctx, '#2e211b', 13, 29, 5, 2);
  });

  withTexture(scene, 'farmhouse', 112, 84, (ctx) => {
    ctx.clearRect(0, 0, 112, 84);
    // shadow
    rect(ctx, 'rgba(0,0,0,0.25)', 4, 78, 104, 6);
    // walls
    rect(ctx, '#7a4a35', 10, 36, 92, 42);
    rect(ctx, '#9c6244', 12, 38, 88, 4);
    rect(ctx, '#5a3426', 12, 70, 88, 8);
    // timber frame
    rect(ctx, '#3d271d', 10, 36, 4, 42);
    rect(ctx, '#3d271d', 98, 36, 4, 42);
    rect(ctx, '#3d271d', 10, 52, 92, 3);
    // roof
    rect(ctx, '#b65a3d', 4, 22, 104, 16);
    rect(ctx, '#e08a5a', 6, 24, 100, 4);
    rect(ctx, '#7e3524', 6, 32, 100, 6);
    for (let x = 8; x < 104; x += 8) rect(ctx, '#7e3524', x, 24, 2, 12);
    // chimney
    rect(ctx, '#6b6b7a', 80, 8, 12, 18);
    rect(ctx, '#4c4c58', 80, 8, 12, 3);
    rect(ctx, 'rgba(255,255,255,0.7)', 84, 2, 5, 4);
    // door
    rect(ctx, '#2e1d14', 48, 52, 20, 26);
    rect(ctx, '#6b4429', 50, 54, 16, 24);
    rect(ctx, '#ffd36d', 62, 64, 3, 3);
    // windows warm
    rect(ctx, '#2e1d14', 18, 44, 20, 16);
    rect(ctx, '#ffd87a', 20, 46, 16, 12);
    rect(ctx, '#fff3bd', 21, 47, 6, 5);
    rect(ctx, '#2e1d14', 27, 46, 2, 12);
    rect(ctx, '#2e1d14', 20, 51, 16, 2);
    rect(ctx, '#2e1d14', 76, 44, 20, 16);
    rect(ctx, '#ffd87a', 78, 46, 16, 12);
    rect(ctx, '#fff3bd', 79, 47, 6, 5);
    rect(ctx, '#2e1d14', 85, 46, 2, 12);
    rect(ctx, '#2e1d14', 78, 51, 16, 2);
    // flower box
    rect(ctx, '#4a8f3c', 18, 61, 20, 4);
    px(ctx, '#ff8aa0', 20, 60);
    px(ctx, '#ffd36d', 24, 60);
    px(ctx, '#ffffff', 28, 60);
  });

  withTexture(scene, 'tree', 48, 64, (ctx) => {
    ctx.clearRect(0, 0, 48, 64);
    rect(ctx, 'rgba(0,0,0,0.22)', 12, 56, 26, 5);
    rect(ctx, '#6d4328', 20, 34, 9, 22);
    rect(ctx, '#8f5c38', 21, 35, 3, 20);
    rect(ctx, '#42291a', 25, 36, 4, 19);
    // canopy layers
    rect(ctx, '#2e6b38', 8, 24, 32, 16);
    rect(ctx, '#3f8c45', 4, 14, 38, 16);
    rect(ctx, '#63b458', 12, 6, 26, 16);
    rect(ctx, '#8fdc7c', 15, 8, 14, 8);
    rect(ctx, '#2e6b38', 26, 28, 14, 12);
    rect(ctx, '#3f8c45', 6, 28, 12, 8);
    // apples
    px(ctx, '#ff6b6b', 14, 20);
    px(ctx, '#ff6b6b', 30, 18);
    px(ctx, '#ffd36d', 22, 26);
  });

  withTexture(scene, 'tile-cursor', TILE, TILE, (ctx) => {
    ctx.clearRect(0, 0, TILE, TILE);
    ctx.strokeStyle = '#fff2a6';
    ctx.lineWidth = 3;
    ctx.shadowColor = 'rgba(255,242,166,0.9)';
    ctx.shadowBlur = 6;
    const r = 7;
    ctx.beginPath();
    ctx.roundRect(2, 2, TILE - 4, TILE - 4, r);
    ctx.stroke();
    ctx.shadowBlur = 0;
    // corners
    rect(ctx, '#fff7cf', 2, 2, 6, 2);
    rect(ctx, '#fff7cf', 2, 2, 2, 6);
  });

  withTexture(scene, 'shadow', 32, 12, (ctx) => {
    ctx.clearRect(0, 0, 32, 12);
    ctx.fillStyle = 'rgba(10,18,12,0.32)';
    ctx.beginPath();
    ctx.ellipse(16, 6, 13, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();
  });

  withTexture(scene, 'shadow-soft', 48, 20, (ctx) => {
    ctx.clearRect(0, 0, 48, 20);
    const layers: Array<[number, number, string]> = [
      [22, 8.5, 'rgba(10,20,14,0.16)'],
      [17, 6.5, 'rgba(10,20,14,0.20)'],
      [12, 4.8, 'rgba(10,20,14,0.26)'],
      [7, 3, 'rgba(10,20,14,0.30)'],
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
    rect(ctx, '#3d7a35', 14, 16, 2, 10);
    rect(ctx, '#5cb85a', 11, 13, 2, 12);
    rect(ctx, '#8be06e', 12, 13, 2, 4);
    rect(ctx, '#3d7a35', 19, 15, 2, 11);
    rect(ctx, '#6fbf58', 21, 12, 2, 10);
  });

  withTexture(scene, 'rain-drop', 3, 10, (ctx) => {
    ctx.clearRect(0, 0, 3, 10);
    rect(ctx, '#bfe9ff', 1, 1, 1, 8);
    px(ctx, '#ffffff', 1, 1);
  });

  // A bead, not a streak. `rain-drop` above is drawn as a falling line because
  // that is what rain looks like at speed; a splash is a round thing that
  // arcs and lands, and reusing the streak for it made watering look like
  // weather rather than like a can being tipped.
  withTexture(scene, 'water-bead', 5, 5, (ctx) => {
    ctx.clearRect(0, 0, 5, 5);
    rect(ctx, '#7fc6ea', 1, 0, 3, 5);
    rect(ctx, '#7fc6ea', 0, 1, 5, 3);
    rect(ctx, '#bfe9ff', 1, 1, 2, 2);
    px(ctx, '#ffffff', 1, 1);
  });

  withTexture(scene, 'firefly', 8, 8, (ctx) => {
    ctx.clearRect(0, 0, 8, 8);
    ctx.fillStyle = 'rgba(255,246,165,0.35)';
    ctx.beginPath();
    ctx.arc(4, 4, 3.5, 0, Math.PI * 2);
    ctx.fill();
    rect(ctx, '#fff6a5', 3, 3, 2, 2);
    px(ctx, '#ffffff', 3, 3);
  });

  withTexture(scene, 'dust', 12, 8, (ctx) => {
    ctx.clearRect(0, 0, 12, 8);
    ctx.fillStyle = 'rgba(232,214,175,0.85)';
    ctx.beginPath();
    ctx.ellipse(6, 5, 5, 2.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,246,220,0.9)';
    ctx.beginPath();
    ctx.ellipse(5, 4, 2.4, 1.4, 0, 0, Math.PI * 2);
    ctx.fill();
  });

  withTexture(scene, 'smoke', 16, 16, (ctx) => {
    ctx.clearRect(0, 0, 16, 16);
    ctx.fillStyle = 'rgba(235,232,225,0.75)';
    ctx.beginPath();
    ctx.arc(8, 9, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(6.5, 7.5, 2.4, 0, Math.PI * 2);
    ctx.fill();
  });

  withTexture(scene, 'sparkle', 12, 12, (ctx) => {
    ctx.clearRect(0, 0, 12, 12);
    ctx.fillStyle = '#fff8d1';
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
    rect(ctx, '#ffd9e3', 1, 1, 3, 3);
    px(ctx, '#ffffff', 2, 1);
    px(ctx, '#ff9eb5', 3, 3);
  });

  withTexture(scene, 'butterfly', 10, 8, (ctx) => {
    ctx.clearRect(0, 0, 10, 8);
    rect(ctx, '#ff9eb5', 0, 1, 4, 5);
    rect(ctx, '#ffd36d', 6, 1, 4, 5);
    rect(ctx, '#3a2b28', 4, 2, 2, 4);
    px(ctx, '#ffffff', 1, 2);
    px(ctx, '#ffffff', 7, 2);
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
        rect(ctx, depth > 0.3 ? 'rgba(20,35,30,0.20)' : 'rgba(20,35,30,0.11)', x, y, step, step);
      }
    }
  });

  withTexture(scene, 'glow', 96, 96, (ctx) => {
    ctx.clearRect(0, 0, 96, 96);
    const g = ctx.createRadialGradient(48, 48, 4, 48, 48, 48);
    g.addColorStop(0, 'rgba(255,220,130,0.85)');
    g.addColorStop(0.4, 'rgba(255,200,110,0.28)');
    g.addColorStop(1, 'rgba(255,200,110,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 96, 96);
  });

  // The village well. Previously assembled from loose rectangles in the scene;
  // now a texture, so the map can name it like any other prop.
  withTexture(scene, 'well', 64, 64, (ctx) => {
    ctx.clearRect(0, 0, 64, 64);
    rect(ctx, '#2e211b', 6, 30, 52, 28);
    rect(ctx, '#6e5846', 8, 32, 48, 24);
    rect(ctx, '#5b4738', 8, 40, 48, 4);
    rect(ctx, '#324b55', 14, 20, 36, 20);
    rect(ctx, '#93b5bd', 16, 22, 32, 16);
    rect(ctx, '#b8dbe2', 18, 24, 28, 5);
    rect(ctx, '#4a2a19', 8, 8, 48, 8);
    rect(ctx, '#7b4328', 10, 10, 44, 5);
    rect(ctx, '#4a2a19', 12, 14, 5, 18);
    rect(ctx, '#4a2a19', 47, 14, 5, 18);
    px(ctx, '#d9edf2', 30, 26);
    px(ctx, '#d9edf2', 36, 27);
  });

  // The forge in the village. An open-fronted shed with a lit hearth and an
  // anvil, so what it is for is legible without a sign over the door.
  withTexture(scene, 'blacksmith', 96, 64, (ctx) => {
    ctx.clearRect(0, 0, 96, 64);
    rect(ctx, 'rgba(0,0,0,0.24)', 4, 58, 88, 5);
    // Roof, low and heavy.
    rect(ctx, '#4a4a55', 0, 4, 96, 16);
    rect(ctx, '#6b6b7a', 2, 6, 92, 4);
    rect(ctx, '#33333c', 2, 16, 92, 4);
    // Posts, open front.
    rect(ctx, '#5a3c28', 6, 20, 7, 38);
    rect(ctx, '#5a3c28', 83, 20, 7, 38);
    rect(ctx, '#3d2a1c', 13, 20, 70, 26);
    // The hearth, which is the whole reason to walk over here.
    rect(ctx, '#7a2e18', 20, 26, 26, 20);
    rect(ctx, '#e2611f', 23, 30, 20, 16);
    rect(ctx, '#ffb347', 26, 34, 14, 12);
    rect(ctx, '#fff0b8', 30, 38, 7, 8);
    // Chimney, and the smoke it earns.
    rect(ctx, '#55555f', 24, 0, 14, 8);
    rect(ctx, '#3a3a42', 24, 0, 14, 3);
    // Anvil on its block.
    rect(ctx, '#4a3324', 58, 44, 16, 14);
    rect(ctx, '#3f4a55', 55, 36, 22, 6);
    rect(ctx, '#6b7c8c', 55, 36, 22, 2);
    rect(ctx, '#3f4a55', 62, 41, 8, 4);
    px(ctx, '#ffd36d', 60, 35);
    px(ctx, '#ffd36d', 72, 34);
  });

  createBuildingTextures(scene);
  createVillagerTextures(scene);
  createAnimalTextures(scene);

  withTexture(scene, 'splash', 10, 5, (ctx) => {
    ctx.clearRect(0, 0, 10, 5);
    ctx.strokeStyle = 'rgba(200,235,245,0.9)';
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
  { key: 'building-shed', width: 128, height: 96, wall: '#8a6a46', trim: '#5d452c', roof: '#7a4a35', roofLight: '#a96d4c' },
  { key: 'building-silo', width: 96, height: 96, wall: '#9aa3ab', trim: '#6b7480', roof: '#5d6b78', roofLight: '#8ba3b8' },
  // The two you want to pick out from the far side of the field.
  { key: 'building-coop', width: 192, height: 96, wall: '#d9c08a', trim: '#a3874f', roof: '#b65a3d', roofLight: '#e08a5a' },
  { key: 'building-barn', width: 224, height: 128, wall: '#b8452f', trim: '#7e2a1c', roof: '#5a3426', roofLight: '#8a5a3c' },
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
  rect(ctx, '#2e1d14', doorX, doorY, doorWidth, h - doorY - 5);
  rect(ctx, '#6b4429', doorX + 2, doorY + 2, doorWidth - 4, h - doorY - 9);
  rect(ctx, '#ffd36d', doorX + doorWidth - 5, doorY + Math.round((h - doorY) / 2), 2, 2);

  // A lit window each side, so a finished building reads as somewhere rather
  // than as a shape — even before there is anything living in it.
  const windowY = Math.round(h * 0.55);
  for (const windowX of [Math.round(w * 0.16), Math.round(w * 0.74)]) {
    rect(ctx, '#2e1d14', windowX, windowY, 18, 14);
    rect(ctx, '#ffd87a', windowX + 2, windowY + 2, 14, 10);
    rect(ctx, '#2e1d14', windowX + 8, windowY + 2, 2, 10);
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
    for (const x of [8, 60, 114]) rect(ctx, '#6b5136', x, 24, 6, 68);
    for (const y of [30, 56, 82]) rect(ctx, '#8a6a46', 8, y, 112, 5);
    // The diagonal brace, stepped, because the context only fills rectangles.
    for (let i = 0; i < 11; i += 1) rect(ctx, '#9c7a52', 12 + i * 9, 84 - i * 5, 9, 4);
    // A pale tarpaulin over the ridge.
    rect(ctx, '#d9c08a', 34, 12, 60, 9);
    rect(ctx, '#f0e0b8', 34, 12, 60, 3);
  });
}

/**
 * The four animals, and the pen they are bought from.
 *
 * Side-on and facing right, with a flipped copy doing duty for the other
 * direction — the scene mirrors the sprite rather than asking for a second
 * drawing. Four legs and a head is enough silhouette at this size to tell a
 * chicken from a goat across a field, which is the whole job: these are
 * placeholders in the same sense as the buildings and are credited as such,
 * and a hand-drawn `animal-cow.png` preloaded over the top wins.
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
    body: '#f2ece0',
    light: '#ffffff',
    dark: '#cfc6b4',
    accent: '#d9534f',
    bird: true,
  },
  {
    key: 'animal-duck',
    width: 22,
    height: 20,
    body: '#e8e4d6',
    light: '#ffffff',
    dark: '#b9b4a2',
    accent: '#e0a83c',
    bird: true,
  },
  {
    key: 'animal-cow',
    width: 32,
    height: 26,
    body: '#f4efe6',
    light: '#ffffff',
    dark: '#3a322c',
    accent: '#e9a7a7',
  },
  {
    key: 'animal-goat',
    width: 26,
    height: 24,
    body: '#c9bda6',
    light: '#e4dbc6',
    dark: '#8d8069',
    accent: '#6b5b45',
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
    rect(ctx, '#2e2a22', w - 4, 4, 1, 1);
    for (const legX of [5, w - 10]) rect(ctx, '#e0a83c', legX, h - 5, 2, 3);
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
  rect(ctx, '#2e2a22', w - 5, backTop + 5, 1, 1);
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
    rect(ctx, '#2b2119', 2, 0, 4, 10);
    rect(ctx, '#ffd36d', 3, 1, 2, 7);
    rect(ctx, '#2b2119', 2, 11, 4, 3);
    rect(ctx, '#ffd36d', 3, 12, 2, 1);
  });

  // The stock pen: a rail fence with a trough in it, three tiles by two.
  withTexture(scene, 'ranch-pen', 96, 64, (ctx) => {
    ctx.clearRect(0, 0, 96, 64);
    rect(ctx, 'rgba(0,0,0,0.16)', 6, 56, 84, 5);
    // Straw inside the rails, so the ground reads as trodden rather than grass.
    rect(ctx, '#c8a86a', 8, 22, 80, 32);
    rect(ctx, '#dcc088', 10, 24, 76, 6);
    // Two rails along the back and the front, with posts holding them up.
    for (const railY of [16, 26, 46]) rect(ctx, '#8a6a46', 4, railY, 88, 4);
    for (const postX of [4, 30, 60, 88]) rect(ctx, '#6b5136', postX, 12, 5, 40);
    // The trough, which is the bit you walk up to.
    rect(ctx, '#5f452f', 34, 34, 34, 12);
    rect(ctx, '#8a6a46', 36, 36, 30, 6);
    rect(ctx, '#b89a5e', 38, 37, 26, 3);
    // A hay bale stacked at the end.
    rect(ctx, '#d8bc78', 72, 32, 18, 14);
    rect(ctx, '#efd89c', 72, 32, 18, 4);
    rect(ctx, '#a8894c', 78, 32, 2, 14);
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
  rect(ctx, '#2f7d37', 15, top, 2, 26 - top);
  rect(ctx, '#57b84f', 7, top + 1, 7, 5);
  rect(ctx, '#8be06e', 8, top + 1, 4, 2);
  rect(ctx, '#3f9c46', 18, top, 7, 6);
  rect(ctx, '#a9ec8f', 19, top, 4, 2);
  rect(ctx, '#245c2c', 15, 23, 2, 3);
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
      rect(ctx, '#2f7d37', 6, 8, 4, 3);
      rect(ctx, '#57b84f', 22, 9, 5, 3);
      rect(ctx, '#3a5c2a', 15, 8, 2, 5);
      rect(ctx, body, 4, 12, 24, 14);
      rect(ctx, light, 7, 14, 4, 10);
      rect(ctx, light, 15, 13, 3, 12);
      rect(ctx, dark, 21, 14, 4, 10);
      rect(ctx, dark, 4, 24, 24, 2);
      return;
    // Ears on stalks. Three of them, leaning, so it does not read as a fence.
    case 'grain':
      rect(ctx, '#3a6b2c', 9, 16, 2, 10);
      rect(ctx, '#3a6b2c', 15, 14, 2, 12);
      rect(ctx, '#3a6b2c', 21, 17, 2, 9);
      rect(ctx, body, 7, 6, 5, 11);
      rect(ctx, light, 8, 7, 2, 7);
      rect(ctx, body, 14, 4, 5, 11);
      rect(ctx, dark, 17, 6, 2, 7);
      rect(ctx, body, 20, 8, 5, 10);
      rect(ctx, light, 21, 9, 2, 6);
      return;
    case 'bloom':
      rect(ctx, '#2f7d37', 15, 15, 2, 11);
      rect(ctx, '#57b84f', 8, 18, 6, 3);
      rect(ctx, '#57b84f', 18, 20, 6, 3);
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
        rect(ctx, '#efe6d6', x + Math.floor(w / 2) - 1, y + 6, 3, 5);
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
  rect(ctx, '#5a3f28', trunkX, trunkTop, trunkWidth, trunkHeight);
  rect(ctx, '#7a5636', trunkX, trunkTop, Math.max(1, trunkWidth - 2), trunkHeight);
  rect(ctx, '#3d2a1a', trunkX + trunkWidth - 1, trunkTop, 1, trunkHeight);

  // Two masses rather than one: a big one over the trunk and a smaller one
  // riding on its shoulder, which is what stops a wood of them looking like a
  // row of identical lollipops.
  const shade = (fromTop: number) =>
    fromTop < 0.22 ? '#63b04e' : fromTop < 0.62 ? '#3f8c3c' : '#2a5e2c';
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
  rect(ctx, '#4a3120', 18, top, 28, 22);
  rect(ctx, '#6b4629', 18, top, 24, 22);
  // The cut face, lighter, with two rings on it.
  rect(ctx, '#a07a4c', 18, top, 28, 7);
  rect(ctx, '#c49a62', 22, top + 1, 20, 4);
  rect(ctx, '#8a6234', 28, top + 2, 8, 2);
  // A root breaking the ground on each side.
  rect(ctx, '#4a3120', 14, h - 12, 6, 4);
  rect(ctx, '#4a3120', 44, h - 12, 6, 4);
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
    fromTop < 0.25 ? '#b3c0ca' : fromTop < 0.6 ? '#8c99a4' : '#5c6872',
  );
  // The shaded facet, cut straight down the right so the mass has a corner.
  rect(ctx, '#47525b', Math.round(centreX + radiusX * 0.35), bottom - radiusY * 2 + 3, 2, radiusY * 2 - 5);
  rect(ctx, '#cfdae2', Math.round(centreX - radiusX * 0.5), bottom - radiusY * 2 + 2, Math.round(radiusX * 0.5), 2);

  if (big) {
    // Chips at the foot, so the big one reads as the thing the small ones came
    // off rather than as a rock somebody has zoomed in on.
    rect(ctx, '#8c99a4', Math.round(centreX - radiusX - 4), bottom - 4, 6, 4);
    rect(ctx, '#5c6872', Math.round(centreX + radiusX - 1), bottom - 3, 5, 3);
  }
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
    [21, floor - 9, 22, 9, '#2f5a26'],
    [23, floor - 15, 18, 8, '#3d7130'],
    [27, floor - 20, 11, 7, '#4a8a3a'],
  ] as const) {
    rect(ctx, shade, x, y, bw, bh);
  }
  // Lit edges along the top-left of each slab, so it has a direction of light.
  rect(ctx, '#5f9c48', 22, floor - 8, 8, 2);
  rect(ctx, '#5f9c48', 24, floor - 14, 6, 2);
  rect(ctx, '#74b257', 28, floor - 19, 5, 2);
  // Two dry runners out of the top, which is what says weed and not shrub.
  rect(ctx, '#7a8f45', 25, floor - 26, 2, 7);
  rect(ctx, '#7a8f45', 36, floor - 24, 2, 6);
  rect(ctx, '#c8b46a', 24, floor - 28, 4, 3);
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
    rect(ctx, '#4f9040', x, floor - tall, 2, tall);
    rect(ctx, '#6ab054', x, floor - tall, 1, Math.round(tall * 0.6));
    rect(ctx, '#9ade83', x, floor - tall, 1, 3);
  }
  rect(ctx, '#3d7a33', 20, floor - 2, 24, 2);
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

  // The chip that flies off a node that was struck. One drawing, tinted per
  // kind by the scene, because a splinter and a stone chip are the same shape
  // at four pixels across.
  withTexture(scene, 'node-chip', 6, 6, (ctx) => {
    ctx.clearRect(0, 0, 6, 6);
    rect(ctx, '#ffffff', 1, 1, 4, 4);
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
    rect(ctx, '#2b241d', 1, 0, 12, 11);
    rect(ctx, '#2b241d', 0, 1, 14, 9);
    rect(ctx, '#f8f0d8', 2, 1, 10, 9);
    rect(ctx, '#f8f0d8', 1, 2, 12, 7);
    rect(ctx, '#2b241d', 5, 11, 4, 2);
    rect(ctx, '#e0a53c', 6, 3, 2, 4);
    rect(ctx, '#e0a53c', 6, 8, 2, 1);
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
    hair: '#d9d0c1',
    hairLight: '#efe6c8',
    skin: '#f2d9a7',
    cloth: '#5f7fa6',
    clothLight: '#87a8cc',
    clothDark: '#32465a',
    legs: '#5a3c32',
    boots: '#2e211b',
    accent: '#ffd36d',
  },
  {
    key: 'npc-maeve',
    hair: '#6d2f22',
    hairLight: '#9c4a33',
    skin: '#e6b489',
    cloth: '#4a4a52',
    clothLight: '#6f6f7a',
    clothDark: '#2b2b31',
    legs: '#3a3128',
    boots: '#1d1a16',
    accent: '#ff8a3d',
  },
  {
    key: 'npc-tobias',
    hair: '#3b2a1c',
    hairLight: '#5c4227',
    skin: '#f0c79a',
    cloth: '#b8843a',
    clothLight: '#dcaa5e',
    clothDark: '#7d5722',
    legs: '#4a5a6b',
    boots: '#2b2019',
    accent: '#e8e3d4',
  },
  {
    key: 'npc-juniper',
    hair: '#2f4a2c',
    hairLight: '#4c7344',
    skin: '#e9c49b',
    cloth: '#5e8a52',
    clothLight: '#86b877',
    clothDark: '#37522f',
    legs: '#6a5a3c',
    boots: '#2a2419',
    accent: '#d8e070',
  },
  {
    key: 'npc-bram',
    hair: '#8a8377',
    hairLight: '#b3aa99',
    skin: '#d8a877',
    cloth: '#7a6141',
    clothLight: '#a3855c',
    clothDark: '#4c3b26',
    legs: '#3f4a3a',
    boots: '#241c15',
    accent: '#c9d46a',
  },
  {
    key: 'npc-ash',
    hair: '#c7a24a',
    hairLight: '#e8cb79',
    skin: '#f4d2a6',
    cloth: '#4f7fa8',
    clothLight: '#79a9cd',
    clothDark: '#2f4f68',
    legs: '#43506b',
    boots: '#241d18',
    accent: '#ef6d6d',
    child: true,
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
  rect(ctx, '#2b1d18', 9, 9 + drop, 2, 2);
  rect(ctx, '#2b1d18', 14, 9 + drop, 2, 2);
  rect(ctx, '#ffffff', 9, 9 + drop, 1, 1);

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

  // One cottage, sized to its Tiled footprint like every other prop, so the
  // four on the village map are one drawing at four positions.
  withTexture(scene, 'cottage', 96, 64, (ctx) => {
    ctx.clearRect(0, 0, 96, 64);
    rect(ctx, 'rgba(0,0,0,0.22)', 4, 58, 88, 6);
    // walls
    rect(ctx, '#c9b089', 10, 26, 76, 32);
    rect(ctx, '#e0cba4', 12, 28, 72, 3);
    rect(ctx, '#9c8562', 12, 52, 72, 6);
    // timber
    rect(ctx, '#5f452f', 10, 26, 3, 32);
    rect(ctx, '#5f452f', 83, 26, 3, 32);
    rect(ctx, '#5f452f', 10, 40, 76, 2);
    // roof
    rect(ctx, '#7a4a35', 4, 14, 88, 14);
    rect(ctx, '#a96d4c', 6, 16, 84, 3);
    rect(ctx, '#5d3527', 6, 23, 84, 5);
    for (let x = 8; x < 88; x += 8) rect(ctx, '#5d3527', x, 16, 2, 10);
    // chimney, and the smoke that says somebody is home
    rect(ctx, '#6b6b7a', 68, 4, 9, 12);
    rect(ctx, '#4c4c58', 68, 4, 9, 3);
    // door
    rect(ctx, '#2e1d14', 40, 34, 16, 24);
    rect(ctx, '#6b4429', 42, 36, 12, 22);
    rect(ctx, '#ffd36d', 51, 46, 2, 2);
    // windows
    rect(ctx, '#2e1d14', 18, 32, 14, 12);
    rect(ctx, '#ffd87a', 20, 34, 10, 8);
    rect(ctx, '#2e1d14', 24, 34, 2, 8);
    rect(ctx, '#2e1d14', 64, 32, 14, 12);
    rect(ctx, '#ffd87a', 66, 34, 10, 8);
    rect(ctx, '#2e1d14', 70, 34, 2, 8);
  });

  // The heart the HUD pops when a gift lands well.
  withTexture(scene, 'heart', 14, 12, (ctx) => {
    ctx.clearRect(0, 0, 14, 12);
    rect(ctx, '#e0556b', 2, 2, 4, 3);
    rect(ctx, '#e0556b', 8, 2, 4, 3);
    rect(ctx, '#e0556b', 1, 4, 12, 3);
    rect(ctx, '#e0556b', 3, 7, 8, 2);
    rect(ctx, '#e0556b', 5, 9, 4, 2);
    rect(ctx, '#ff8fa0', 3, 3, 2, 2);
    rect(ctx, '#ff8fa0', 9, 3, 2, 2);
  });
}

// --- boundary fringes --------------------------------------------------------

/**
 * The two materials that spill over their neighbours.
 *
 * Grass creeps over a path and hangs over a bank; a path juts out over water.
 * Nothing creeps over grass, because grass is the ground everything else was
 * cut into.
 */
const FRINGE_PALETTES: Record<'grass' | 'path', { body: string; dark: string; light: string }> = {
  grass: { body: '#5da653', dark: '#3f7c36', light: '#8fd47a' },
  path: { body: '#c9a06b', dark: '#9a7345', light: '#e2c086' },
};

/**
 * One fringe: the material of a neighbouring tile, drawn over this one.
 *
 * The depth wobbles pixel by pixel and the leading edge is dithered, which is
 * the entire trick — a fringe of even depth is a second straight line drawn
 * beside the first, and the map still looks like a spreadsheet.
 */
function drawFringe(
  ctx: CanvasRenderingContext2D,
  mask: number,
  palette: { body: string; dark: string; light: string },
  seed: number,
) {
  ctx.clearRect(0, 0, TILE, TILE);

  const depthAt = (i: number, side: number) => 3 + Math.floor(hash(i, side, seed) * 5);

  const run = (side: number, place: (i: number, d: number) => void) => {
    for (let i = 0; i < TILE; i += 1) place(i, depthAt(i, side));
  };

  // North: the neighbour's ground hangs down into the top of this tile.
  if (mask & 1) {
    run(1, (x, d) => {
      rect(ctx, palette.body, x, 0, 1, d);
      px(ctx, palette.dark, x, d - 1);
      if (hash(x, 31, seed) > 0.66) px(ctx, palette.body, x, d);
      if (hash(x, 57, seed) > 0.82) px(ctx, palette.light, x, Math.max(0, d - 3));
    });
  }
  if (mask & 2) {
    run(2, (y, d) => {
      rect(ctx, palette.body, TILE - d, y, d, 1);
      px(ctx, palette.dark, TILE - d, y);
      if (hash(y, 41, seed) > 0.66) px(ctx, palette.body, TILE - d - 1, y);
      if (hash(y, 67, seed) > 0.82) px(ctx, palette.light, TILE - Math.max(1, d - 2), y);
    });
  }
  if (mask & 4) {
    run(4, (x, d) => {
      rect(ctx, palette.body, x, TILE - d, 1, d);
      px(ctx, palette.dark, x, TILE - d);
      if (hash(x, 53, seed) > 0.66) px(ctx, palette.body, x, TILE - d - 1);
      if (hash(x, 79, seed) > 0.82) px(ctx, palette.light, x, TILE - Math.max(1, d - 2));
    });
  }
  if (mask & 8) {
    run(8, (y, d) => {
      rect(ctx, palette.body, 0, y, d, 1);
      px(ctx, palette.dark, d - 1, y);
      if (hash(y, 61, seed) > 0.66) px(ctx, palette.body, d, y);
      if (hash(y, 83, seed) > 0.82) px(ctx, palette.light, Math.max(0, d - 3), y);
    });
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
  FRINGE_BOUNDARIES.forEach(({ over, under }, index) => {
    for (let mask = 1; mask <= 15; mask += 1) {
      withTexture(scene, fringeTexture(over, under, mask), TILE, TILE, (ctx) =>
        drawFringe(ctx, mask, FRINGE_PALETTES[over], index * 17 + 3),
      );
    }
  });
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
    disc(16, '#140d08');
    disc(15, '#c9924f');
    disc(13, '#8a5a2e');
    disc(12, '#f4e2b8');
    disc(11, '#e8d2a2');

    // Marks at dawn, mid-morning, noon, evening and the small hours, which is
    // what the hand is telling you — not minutes.
    for (let i = 0; i <= 4; i += 1) {
      const angle = ((-DIAL_SWEEP + (i * DIAL_SWEEP * 2) / 4) * Math.PI) / 180;
      const long = i % 2 === 0;
      for (let r = long ? 6 : 8; r <= 10; r += 1) {
        px(
          ctx,
          long ? '#6b4429' : '#9a7345',
          Math.round(mid + Math.sin(angle) * r),
          Math.round(mid - Math.cos(angle) * r),
        );
      }
    }

    // Noon sits at the top; a warm wash over the morning half and a cool one
    // over the evening half says which way the day is going, wordlessly.
    ctx.fillStyle = 'rgba(255,211,109,0.20)';
    ctx.beginPath();
    ctx.moveTo(mid, mid);
    ctx.arc(mid, mid, 11, Math.PI, Math.PI * 1.5);
    ctx.fill();
    ctx.fillStyle = 'rgba(80,110,160,0.18)';
    ctx.beginPath();
    ctx.moveTo(mid, mid);
    ctx.arc(mid, mid, 11, Math.PI * 1.5, Math.PI * 2);
    ctx.fill();

    disc(2, '#6b4429');
    px(ctx, '#f4e2b8', mid - 1, mid - 1);
  });

  // The origin sits at the pivot end, so the scene turns it about the dial's
  // centre by setting one angle and nothing else.
  withTexture(scene, 'clock-hand', 3, 14, (ctx) => {
    ctx.clearRect(0, 0, 3, 14);
    rect(ctx, '#7a2e18', 1, 0, 1, 14);
    rect(ctx, '#b64a24', 1, 1, 1, 9);
    px(ctx, '#e2611f', 1, 3);
    rect(ctx, '#7a2e18', 0, 11, 3, 3);
  });
}

/** A 16px icon, cleared and then drawn by whatever is handed in. */
function icon(scene: Phaser.Scene, key: string, draw: (ctx: CanvasRenderingContext2D) => void) {
  withTexture(scene, key, 16, 16, (ctx) => {
    ctx.clearRect(0, 0, 16, 16);
    draw(ctx);
  });
}

function drawSun(ctx: CanvasRenderingContext2D, body = '#ffd36d', rim = '#f0a63c') {
  ctx.fillStyle = rim;
  ctx.beginPath();
  ctx.arc(8, 8, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(8, 8, 4, 0, Math.PI * 2);
  ctx.fill();
  rect(ctx, '#fff3bd', 6, 5, 2, 2);
  for (const [x, y] of [
    [8, 0],
    [8, 14],
    [0, 8],
    [14, 8],
  ] as Array<[number, number]>) {
    rect(ctx, rim, x, y, 2, 2);
  }
}

function drawCloud(ctx: CanvasRenderingContext2D, body = '#cfd9e2', shade = '#9fb0c0') {
  rect(ctx, shade, 2, 6, 12, 5);
  rect(ctx, body, 2, 5, 12, 4);
  rect(ctx, body, 5, 3, 7, 3);
  rect(ctx, '#eef4f8', 6, 4, 4, 1);
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
      rect(ctx, '#f7a8c4', x, y, 4, 4);
      rect(ctx, '#ffd0e0', x, y, 2, 2);
    }
    rect(ctx, '#ffd36d', 6, 6, 4, 4);
    rect(ctx, '#4a8f3c', 7, 11, 2, 5);
  });

  icon(scene, 'icon-season-summer', (ctx) => drawSun(ctx));

  icon(scene, 'icon-season-autumn', (ctx) => {
    rect(ctx, '#7a4a25', 7, 10, 2, 6);
    rect(ctx, '#d9622b', 4, 4, 8, 7);
    rect(ctx, '#f08a3c', 5, 3, 6, 3);
    rect(ctx, '#b8431c', 4, 9, 8, 2);
    rect(ctx, '#ffb347', 6, 5, 2, 3);
    px(ctx, '#d9622b', 2, 6);
    px(ctx, '#d9622b', 13, 6);
  });

  icon(scene, 'icon-season-winter', (ctx) => {
    rect(ctx, '#bfe6f2', 7, 1, 2, 14);
    rect(ctx, '#bfe6f2', 1, 7, 14, 2);
    for (const [x, y] of [
      [3, 3],
      [11, 3],
      [3, 11],
      [11, 11],
    ] as Array<[number, number]>) {
      rect(ctx, '#8fd2e8', x, y, 2, 2);
    }
    rect(ctx, '#ffffff', 7, 7, 2, 2);
  });

  icon(scene, 'icon-weather-sunny', (ctx) => drawSun(ctx));

  icon(scene, 'icon-weather-drizzle', (ctx) => {
    drawCloud(ctx);
    for (const [x, y] of [
      [4, 11],
      [8, 12],
      [11, 11],
    ] as Array<[number, number]>) {
      rect(ctx, '#6fa8d9', x, y, 1, 3);
      px(ctx, '#bfe0f5', x, y);
    }
  });

  icon(scene, 'icon-weather-breezy', (ctx) => {
    drawCloud(ctx, '#dfe6ec', '#b2bfcb');
    rect(ctx, '#9fd4c2', 2, 11, 9, 1);
    rect(ctx, '#9fd4c2', 5, 13, 8, 1);
    px(ctx, '#d8f3e8', 10, 11);
    px(ctx, '#d8f3e8', 12, 13);
  });

  icon(scene, 'icon-weather-firefly', (ctx) => {
    rect(ctx, '#e8e6c2', 8, 2, 5, 5);
    rect(ctx, '#fffbd8', 9, 3, 2, 2);
    for (const [x, y] of [
      [3, 8],
      [7, 11],
      [12, 10],
      [5, 13],
    ] as Array<[number, number]>) {
      px(ctx, '#fff3a6', x, y);
      px(ctx, '#d9e06a', x + 1, y);
      px(ctx, '#d9e06a', x, y + 1);
    }
  });

  icon(scene, 'icon-coin', (ctx) => {
    ctx.fillStyle = '#b8801f';
    ctx.beginPath();
    ctx.arc(8, 8, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffd36d';
    ctx.beginPath();
    ctx.arc(8, 8, 5, 0, Math.PI * 2);
    ctx.fill();
    rect(ctx, '#fff3bd', 5, 4, 3, 1);
    rect(ctx, '#b8801f', 6, 5, 4, 1);
    rect(ctx, '#b8801f', 6, 10, 4, 1);
    rect(ctx, '#b8801f', 6, 5, 1, 6);
    rect(ctx, '#b8801f', 9, 5, 1, 6);
    rect(ctx, '#b8801f', 7, 7, 2, 2);
  });

  // The cap on the energy tube, so a column of colour has something naming it.
  icon(scene, 'icon-energy-bolt', (ctx) => {
    rect(ctx, '#f6d45a', 8, 1, 3, 6);
    rect(ctx, '#f6d45a', 5, 6, 6, 3);
    rect(ctx, '#f6d45a', 5, 8, 3, 7);
    rect(ctx, '#fff3bd', 8, 2, 1, 4);
    rect(ctx, '#c9a01f', 5, 12, 3, 3);
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
