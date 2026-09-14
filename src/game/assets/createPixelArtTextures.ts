import Phaser from 'phaser';

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

  withTexture(scene, 'crop-turnip', TILE, TILE, (ctx) => {
    ctx.clearRect(0, 0, TILE, TILE);
    // leaves
    rect(ctx, '#2f7d37', 12, 6, 3, 9);
    rect(ctx, '#57b84f', 7, 5, 7, 6);
    rect(ctx, '#8be06e', 8, 5, 4, 2);
    rect(ctx, '#3f9c46', 17, 4, 7, 7);
    rect(ctx, '#a9ec8f', 18, 4, 4, 2);
    // body with shading
    rect(ctx, '#efe3c6', 10, 13, 13, 12);
    rect(ctx, '#d8b7c1', 10, 20, 13, 5);
    rect(ctx, '#fff7df', 12, 14, 4, 6);
    rect(ctx, '#c99aa6', 19, 15, 2, 8);
    px(ctx, '#8a5f6b', 15, 23);
    px(ctx, '#8a5f6b', 17, 24);
  });

  withTexture(scene, 'crop-strawberry', TILE, TILE, (ctx) => {
    ctx.clearRect(0, 0, TILE, TILE);
    rect(ctx, '#2f7d37', 10, 6, 12, 5);
    rect(ctx, '#57b84f', 12, 4, 8, 4);
    rect(ctx, '#8be06e', 13, 4, 4, 2);
    rect(ctx, '#d94852', 10, 11, 12, 12);
    rect(ctx, '#ff7880', 11, 12, 5, 5);
    rect(ctx, '#a11e2e', 17, 17, 5, 6);
    px(ctx, '#ffd36d', 13, 15);
    px(ctx, '#ffd36d', 18, 14);
    px(ctx, '#fff3cf', 15, 18);
  });

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

  withTexture(scene, 'cloud-shadow', 160, 60, (ctx) => {
    ctx.clearRect(0, 0, 160, 60);
    ctx.fillStyle = 'rgba(20,35,30,0.16)';
    ctx.beginPath();
    ctx.ellipse(80, 30, 70, 22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(50, 26, 34, 16, 0, 0, Math.PI * 2);
    ctx.fill();
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

  withTexture(scene, 'splash', 10, 5, (ctx) => {
    ctx.clearRect(0, 0, 10, 5);
    ctx.strokeStyle = 'rgba(200,235,245,0.9)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(5, 3, 4, 1.8, 0, Math.PI, 0);
    ctx.stroke();
  });
}
