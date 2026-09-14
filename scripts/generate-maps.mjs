#!/usr/bin/env node
/**
 * Writes the starter Tiled maps under `maps/`.
 *
 * This seeds the files; Tiled is the editor from here on. Re-running it
 * overwrites hand-made edits, so it is not part of any build — run it only to
 * start over from the shipped layout.
 *
 * `npm run maps:build` is the script that turns these into runtime data.
 */
import fs from 'node:fs';
import path from 'node:path';

const TILE = 32;
const outDir = 'maps';

/**
 * An image-collection tileset: every tile keeps its own PNG, so the existing
 * per-tile art is used as-is with no atlas to pack or keep in sync.
 */
const TILES = [
  { texture: 'tile-grass', kind: 'grass', solid: false },
  { texture: 'tile-grass-2', kind: 'grass', solid: false },
  { texture: 'tile-grass-3', kind: 'grass', solid: false },
  { texture: 'tile-path', kind: 'path', solid: false },
  { texture: 'tile-water', kind: 'water', solid: true },
  { texture: 'plot-wild', kind: 'plot', solid: false },
];

/** gid is the tileset index plus firstgid; firstgid is 1. */
const GID = Object.fromEntries(TILES.map((tile, index) => [tile.texture, index + 1]));

function tileset() {
  return {
    columns: 0,
    grid: { height: TILE, orientation: 'orthogonal', width: TILE },
    margin: 0,
    name: 'moonberry',
    spacing: 0,
    tilecount: TILES.length,
    tiledversion: '1.10.2',
    tileheight: TILE,
    tilewidth: TILE,
    type: 'tileset',
    version: '1.10',
    tiles: TILES.map((tile, id) => ({
      id,
      image: `../public/assets/lpc/${tile.texture}.png`,
      imageheight: TILE,
      imagewidth: TILE,
      properties: [
        { name: 'texture', type: 'string', value: tile.texture },
        { name: 'kind', type: 'string', value: tile.kind },
        { name: 'solid', type: 'bool', value: tile.solid },
      ],
    })),
  };
}

/** Deterministic grass variety, so the same map always looks the same. */
function grassGid(x, y) {
  const variant = (x * 31 + y * 17) % 10;
  if (variant < 6) return GID['tile-grass'];
  return variant < 8 ? GID['tile-grass-2'] : GID['tile-grass-3'];
}

function buildLayer(width, height, pick) {
  const data = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) data.push(pick(x, y));
  }
  return data;
}

function rectObject(id, name, type, tx, ty, tw, th, extra = {}) {
  return {
    id,
    name,
    type,
    x: tx * TILE,
    y: ty * TILE,
    width: tw * TILE,
    height: th * TILE,
    rotation: 0,
    visible: true,
    ...extra,
  };
}

function props(list) {
  return Object.entries(list).map(([name, value]) => ({
    name,
    type: typeof value === 'boolean' ? 'bool' : typeof value === 'number' ? 'int' : 'string',
    value,
  }));
}

function map({ width, height, layers, nextobjectid, displayName }) {
  return {
    compressionlevel: -1,
    height,
    infinite: false,
    layers,
    nextlayerid: layers.length + 1,
    nextobjectid,
    orientation: 'orthogonal',
    properties: props({ displayName }),
    renderorder: 'right-down',
    tiledversion: '1.10.2',
    tileheight: TILE,
    tilesets: [{ firstgid: 1, source: 'tileset.json' }],
    tilewidth: TILE,
    type: 'map',
    version: '1.10',
    width,
  };
}

function tileLayer(id, name, width, height, data) {
  return { data, height, id, name, opacity: 1, type: 'tilelayer', visible: true, width, x: 0, y: 0 };
}

function objectLayer(id, name, objects) {
  return { draworder: 'topdown', id, name, objects, opacity: 1, type: 'objectgroup', visible: true, x: 0, y: 0 };
}

// --- the farm ---------------------------------------------------------------
// Deliberately wider and taller than the 960x640 viewport, so the camera has
// somewhere to travel and the farm stops being one static screen.

const FARM_W = 40;
const FARM_H = 30;

function farmMap() {
  const ground = buildLayer(FARM_W, FARM_H, (x, y) => {
    // Pond in the south-west corner.
    if (y >= 23 && x <= 7) return GID['tile-water'];
    // The field: eight by six tilled-able plots, centre-north.
    if (x >= 13 && x < 21 && y >= 9 && y < 15) return GID['plot-wild'];
    // A second field to the south, so the farm is worth walking across.
    if (x >= 13 && x < 21 && y >= 17 && y < 21) return GID['plot-wild'];
    // Paths: one ring road and the lane east to the village.
    if (y === 7 || y === 22) return GID['tile-path'];
    if (x === 11 || x === 22) return GID['tile-path'];
    if (y === 14 && x >= 22) return GID['tile-path'];
    return grassGid(x, y);
  });

  let id = 1;
  const objects = [
    rectObject(id++, 'farmhouse', 'prop', 3, 2, 5, 5, {
      properties: props({ texture: 'farmhouse', solid: true, depth: 4 }),
    }),
    rectObject(id++, 'tree-west', 'prop', 2, 16, 2, 2, {
      properties: props({ texture: 'tree', solid: true, depth: 16 }),
    }),
    rectObject(id++, 'tree-north', 'prop', 30, 4, 2, 2, {
      properties: props({ texture: 'tree', solid: true, depth: 4 }),
    }),
    rectObject(id++, 'tree-east', 'prop', 33, 18, 2, 2, {
      properties: props({ texture: 'tree', solid: true, depth: 18 }),
    }),
    rectObject(id++, 'tree-south', 'prop', 26, 25, 2, 2, {
      properties: props({ texture: 'tree', solid: true, depth: 25 }),
    }),
  ];

  const spawns = [
    rectObject(id++, 'spawn-1', 'spawn', 15, 22, 1, 1),
    rectObject(id++, 'spawn-2', 'spawn', 16, 22, 1, 1),
    rectObject(id++, 'spawn-3', 'spawn', 15, 23, 1, 1),
    rectObject(id++, 'spawn-4', 'spawn', 16, 23, 1, 1),
  ];

  const portals = [
    rectObject(id++, 'to-village', 'portal', 39, 12, 1, 5, {
      properties: props({ toArea: 'village', toTileX: 2, toTileY: 12, label: 'the village lane' }),
    }),
  ];

  return map({
    displayName: 'Amberfall Farm',
    width: FARM_W,
    height: FARM_H,
    nextobjectid: id,
    layers: [
      tileLayer(1, 'ground', FARM_W, FARM_H, ground),
      objectLayer(2, 'props', objects),
      objectLayer(3, 'spawns', spawns),
      objectLayer(4, 'portals', portals),
    ],
  });
}

// --- the village ------------------------------------------------------------
// Where crops are sold and Rowan waits, so selling means a walk rather than a
// stall parked next to the field.

const VILLAGE_W = 30;
const VILLAGE_H = 24;

function villageMap() {
  const ground = buildLayer(VILLAGE_W, VILLAGE_H, (x, y) => {
    if (y >= 19 && x >= 22) return GID['tile-water'];
    if (y === 12 || y === 6) return GID['tile-path'];
    if (x === 8 || x === 18) return GID['tile-path'];
    return grassGid(x, y);
  });

  let id = 1;
  const objects = [
    rectObject(id++, 'market', 'prop', 12, 5, 3, 1, {
      properties: props({ texture: 'market-ribbon', solid: false, depth: 8, interact: 'market' }),
    }),
    rectObject(id++, 'well', 'prop', 12, 8, 2, 2, {
      properties: props({ texture: 'well', solid: true, depth: 9 }),
    }),
    rectObject(id++, 'rowan', 'prop', 12, 7, 1, 1, {
      properties: props({ texture: 'rowan', solid: true, depth: 40, interact: 'rowan' }),
    }),
    rectObject(id++, 'tree-lane', 'prop', 22, 9, 2, 2, {
      properties: props({ texture: 'tree', solid: true, depth: 9 }),
    }),
    rectObject(id++, 'tree-green', 'prop', 4, 16, 2, 2, {
      properties: props({ texture: 'tree', solid: true, depth: 16 }),
    }),
  ];

  const portals = [
    rectObject(id++, 'to-farm', 'portal', 0, 10, 1, 5, {
      properties: props({ toArea: 'farm', toTileX: 37, toTileY: 14, label: 'Amberfall Farm' }),
    }),
  ];

  return map({
    displayName: 'Moonberry Village',
    width: VILLAGE_W,
    height: VILLAGE_H,
    nextobjectid: id,
    layers: [
      tileLayer(1, 'ground', VILLAGE_W, VILLAGE_H, ground),
      objectLayer(2, 'props', objects),
      objectLayer(3, 'portals', portals),
    ],
  });
}

fs.mkdirSync(outDir, { recursive: true });

const files = {
  'tileset.json': tileset(),
  'farm.json': farmMap(),
  'village.json': villageMap(),
};

for (const [name, contents] of Object.entries(files)) {
  fs.writeFileSync(path.join(outDir, name), `${JSON.stringify(contents, null, 2)}\n`);
  console.log(`wrote ${path.join(outDir, name)}`);
}
