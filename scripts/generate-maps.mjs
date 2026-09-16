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
/**
 * Twelve grass tiles, which is three drawings and their mirrors.
 *
 * Three was not three. Measured against each other the three grass tiles
 * differ by about four parts in 255 — the same green, the same density, a
 * slightly different sprinkle of specks — so a field of them read as one tile
 * repeating, and the eye picks a 32px grid out of that in seconds.
 *
 * Mirroring is the fix that costs nothing. Grass has no light direction in it,
 * so a flipped tile is the same art with the specks somewhere else: identical
 * colour histogram, so the fringe overlays drawn in `FRINGE_PALETTES` still
 * match it exactly, and four times as many arrangements before anything
 * repeats.
 */
const GRASS_TEXTURES = [
  'tile-grass',
  'tile-grass-1x',
  'tile-grass-1y',
  'tile-grass-1xy',
  'tile-grass-2',
  'tile-grass-2x',
  'tile-grass-2y',
  'tile-grass-2xy',
  'tile-grass-3',
  'tile-grass-3x',
  'tile-grass-3y',
  'tile-grass-3xy',
];

/**
 * Every piece of the farmhouse's walls, one tile each.
 *
 * The back wall is two rows of timber-framed plaster, three drawings wide so
 * the posts do not line up into a grid. The other three sides are the ceiling
 * seen from above — a dark void with a wooden edge on whichever side faces the
 * room — so each edge and corner is its own drawing rather than a rotation of
 * one: LPC light comes from the top left, and a rotated beam would say so.
 */
const WALL_TEXTURES = [
  'tile-wall-upper-1',
  'tile-wall-upper-2',
  'tile-wall-upper-3',
  'tile-wall-lower-1',
  'tile-wall-lower-2',
  'tile-wall-lower-3',
  'tile-wall-left',
  'tile-wall-right',
  'tile-wall-bottom',
  'tile-wall-bottom-left',
  'tile-wall-bottom-right',
  'tile-wall-door-left',
  'tile-wall-door-right',
];

const TILES = [
  ...GRASS_TEXTURES.map((texture) => ({ texture, kind: 'grass', solid: false })),
  { texture: 'tile-path', kind: 'path', solid: false },
  { texture: 'tile-water', kind: 'water', solid: true },
  { texture: 'plot-wild', kind: 'plot', solid: false },
  // The farmhouse interior. Appended rather than slotted in beside the ground
  // they resemble, because a gid is a tile's index here and every map already
  // written stores gids: inserting one would repaint the farm.
  { texture: 'tile-floor-wood', kind: 'floor', solid: false },
  ...WALL_TEXTURES.map((texture) => ({ texture, kind: 'wall', solid: true })),
  // Spec 15's brick pavement. A path as far as any rule is concerned — nothing
  // solid grows on it and villagers walk it — and appended for the reason the
  // floor above was.
  { texture: 'tile-plaza', kind: 'path', solid: false },
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

/**
 * Deterministic grass variety, so the same map always looks the same.
 *
 * Evenly across all twelve rather than weighted towards the first: the old
 * weighting existed because two of the three variants were meant to be
 * occasional accents, and they were never different enough to be accents.
 */
function grassGid(x, y) {
  return GID[GRASS_TEXTURES[Math.floor(hash(x, y, 3) * GRASS_TEXTURES.length) % GRASS_TEXTURES.length]];
}

/** Deterministic pseudo-random from coords, so a seeded map is always the same map. */
function hash(x, y, seed = 1) {
  let h = (x * 374761393 + y * 668265263 + seed * 974634211) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

const GRASS_GIDS = new Set(GRASS_TEXTURES.map((texture) => GID[texture]));

/**
 * What gets sprinkled across the empty grass, and how often.
 *
 * Repeats are the weighting: a field wants far more tufts than tree stumps,
 * and a table of counts would be the same thing said less plainly.
 */
const SCATTER = [
  'tuft-tall',
  'tuft-tall',
  'tuft-tall',
  'bush',
  'bush',
  'flowers-red',
  'flowers-gold',
  'flowers-white',
  'stump',
  'log',
  'stump-flowers',
];

/** The ones you walk around rather than over. Flowers and tufts are underfoot. */
const SCATTER_SOLID = new Set(['bush', 'stump', 'stump-flowers']);

/** Roughly what share of eligible grass tiles gets something on it. */
const SCATTER_DENSITY = 0.07;

/**
 * Sprinkles decoration over the grass.
 *
 * The farm was four trees in a field the size of a car park, and an empty
 * lawn reads as unfinished however well the tiles under it are drawn. This is
 * the cheapest fix there is: no new systems, no map editing by hand, and the
 * seed makes it the same field every time so a screenshot is reproducible.
 *
 * Two rules keep it from being in the way. A tile is only eligible if it and
 * all eight of its neighbours are grass, which puts a clear tile between every
 * prop and every path, shore or field edge — so nothing solid can ever pinch a
 * route. And anything the map already placed is excluded outright, with a
 * tile of margin, so a bush never grows through a doorway.
 */
function scatterProps(ground, width, height, keepClear, firstId, seed, density = SCATTER_DENSITY) {
  const gidAt = (x, y) => (x < 0 || y < 0 || x >= width || y >= height ? 0 : ground[y * width + x]);
  const isGrass = (x, y) => GRASS_GIDS.has(gidAt(x, y));

  const objects = [];
  let id = firstId;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let open = true;
      for (let dy = -1; dy <= 1 && open; dy += 1) {
        for (let dx = -1; dx <= 1 && open; dx += 1) open = isGrass(x + dx, y + dy);
      }
      if (!open) continue;
      if (keepClear.some((r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1)) continue;
      if (hash(x, y, seed) >= density) continue;

      const texture = SCATTER[Math.floor(hash(x, y, seed + 11) * SCATTER.length) % SCATTER.length];
      objects.push(
        rectObject(id, texture, 'prop', x, y, 1, 1, {
          properties: props({ texture, solid: SCATTER_SOLID.has(texture), depth: y }),
        }),
      );
      id += 1;
    }
  }

  return { objects, nextId: id };
}

/** An object's tiles plus a tile of margin, as a keep-clear rectangle. */
function clearance(object) {
  return {
    x0: object.x / TILE - 1,
    y0: object.y / TILE - 1,
    x1: (object.x + object.width) / TILE,
    y1: (object.y + object.height) / TILE,
  };
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

function map({ width, height, layers, nextobjectid, displayName, music, indoor = false }) {
  return {
    compressionlevel: -1,
    height,
    infinite: false,
    layers,
    nextlayerid: layers.length + 1,
    nextobjectid,
    orientation: 'orthogonal',
    // `indoor` is only written when it is true, so the three outdoor maps stay
    // byte-for-byte what they were, and a map without it reads as outdoors.
    properties: props(indoor ? { displayName, music, indoor } : { displayName, music }),
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

/**
 * A road sign, one tile, standing on the tile given.
 *
 * `lines` are the sign's lines top to bottom — the small one, then the place in
 * capitals — and `arrow` is the way it points. Not solid: the poles are a
 * pixel wide, and a sign that stops a player on a lane is worse than one they
 * walk through.
 */
function signpost(id, name, tx, ty, lines, arrow) {
  return rectObject(id, name, 'prop', tx, ty, 1, 1, {
    properties: props({ texture: 'signpost', solid: false, depth: ty, sign: lines.join('\n'), arrow }),
  });
}

/** A cột mốc: one line on the red cap, one on the stone. */
function milestone(id, name, tx, ty, lines) {
  return rectObject(id, name, 'prop', tx, ty, 1, 1, {
    properties: props({ texture: 'milestone', solid: true, depth: ty, sign: lines.join('\n') }),
  });
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
    // And the lane west to the woods, which is the same lane on the other
    // side: the landing tile from a portal must be something the scatter never
    // touches, and a path is the only ground that qualifies.
    if (y === 14 && x <= 11) return GID['tile-path'];
    return grassGid(x, y);
  });

  let id = 1;
  const objects = [
    // Five wide and four tall, with its bottom edge on the ring road.
    //
    // A prop is drawn to the width of its footprint and stands on the bottom
    // edge, so the footprint is the house's own box rather than a round five
    // by five: `farmhouse.png` is 160x109, which is five tiles across and a
    // little under three and a half down. The extra row this used to have sat
    // above the roof as a wall you bumped into with nothing drawn on it.
    //
    // Not solid, and not the bed any more. The picture is one rectangle and
    // the wall is that rectangle with a doorway in it, so the collision is the
    // three colliders below, and the bed is indoors where a bed belongs.
    rectObject(id++, 'farmhouse', 'prop', 3, 3, 5, 4, {
      properties: props({ texture: 'farmhouse', solid: false, depth: 4 }),
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
    rectObject(id++, 'to-forest', 'portal', 0, 12, 1, 5, {
      properties: props({ toArea: 'forest', toTileX: 31, toTileY: 13, label: 'Hollowpine Wood' }),
    }),
  ];

  // Everything the map places by hand is off limits to the scatter, so a
  // doorway, a landing spot or a tree never ends up with a bush in it.
  const scattered = scatterProps(
    ground,
    FARM_W,
    FARM_H,
    [...objects, ...spawns, ...portals].map(clearance),
    id,
    5,
  );
  id = scattered.nextId;

  // The way in. Added after the scatter so every object id above keeps the
  // number it had before the house could be entered; all of it sits inside
  // the house's footprint, which the scatter keeps clear anyway.
  //
  // Column 5 is the door, measured off the drawing rather than by eye: the
  // door in `farmhouse.png` is at x 64..96 and the house stands at x=96, so
  // the doorway is world x 160..192 — tile 5. The rest of the footprint is wall.
  const colliders = [
    rectObject(id++, 'house-wall-west', 'collider', 3, 3, 2, 4),
    rectObject(id++, 'house-wall-east', 'collider', 6, 3, 2, 4),
    rectObject(id++, 'house-wall-door', 'collider', 5, 3, 1, 3),
  ];

  portals.push(
    // Lands a tile inside the door rather than on it: a landing tile that is
    // itself a portal would send the player straight back out.
    rectObject(id++, 'to-farmhouse', 'portal', 5, 6, 1, 1, {
      properties: props({ toArea: 'farmhouse', toTileX: 6, toTileY: 7, label: 'ngôi nhà' }),
    }),
    // Spec 15: the southern ring road runs on east to the phố, the way the
    // northern lane runs to the village. After the scatter for the reason the
    // door above is, and it needs no keep-clear from it: the scatter never
    // touches a tile beside a path or beside the map's edge.
    rectObject(id++, 'to-plaza', 'portal', 39, 20, 1, 5, {
      properties: props({ toArea: 'plaza', toTileX: 1, toTileY: 13, label: 'Phố Việt' }),
    }),
  );

  // Road signs at the two eastern doors, one on each lane, so the way to the
  // phố and the way to the village are both written down before either door.
  // After the scatter for the reason the doors are, and beside a path, which
  // the scatter never touches.
  objects.push(
    signpost(id++, 'signpost-plaza', 36, 21, ['Khu phố', 'PHỐ VIỆT'], 'right'),
    signpost(id++, 'signpost-village', 36, 13, ['Làng', 'MOONBERRY'], 'right'),
  );

  return map({
    displayName: 'Amberfall Farm',
    music: 'day-farm-loop',
    width: FARM_W,
    height: FARM_H,
    nextobjectid: id,
    layers: [
      tileLayer(1, 'ground', FARM_W, FARM_H, ground),
      objectLayer(2, 'props', [...objects, ...scattered.objects]),
      objectLayer(3, 'spawns', spawns),
      objectLayer(4, 'portals', portals),
      objectLayer(5, 'colliders', colliders),
    ],
  });
}

// --- the village ------------------------------------------------------------
// Where crops are sold and the five villagers live, so selling means a walk
// rather than a stall parked next to the field.
//
// Nobody is a prop any more. The villagers walk schedules out of `FarmState`
// and are drawn on top of the map, exactly as the farm's buildings are; what
// the map still owns is the places they walk between.

const VILLAGE_W = 30;
const VILLAGE_H = 24;

function villageMap() {
  const ground = buildLayer(VILLAGE_W, VILLAGE_H, (x, y) => {
    if (y >= 19 && x >= 22) return GID['tile-water'];
    if (y === 12 || y === 6) return GID['tile-path'];
    if (x === 8 || x === 18) return GID['tile-path'];
    // The two doorsteps that are not on a lane get a spur out to one, so every
    // house in the village is somewhere a path goes: Maeve's west to the
    // forge lane, Bram's east along the foot of the green to the south lane.
    if (y === 16 && x >= 19 && x <= 24) return GID['tile-path'];
    if (y === 22 && x >= 1 && x <= 7) return GID['tile-path'];
    return grassGid(x, y);
  });

  let id = 1;
  const objects = [
    rectObject(id++, 'market', 'prop', 12, 5, 3, 1, {
      properties: props({ texture: 'market-stall', solid: false, depth: 8, interact: 'market' }),
    }),
    rectObject(id++, 'well', 'prop', 12, 8, 2, 2, {
      properties: props({ texture: 'well', solid: true, depth: 9 }),
    }),
    // The forge. South of the lane so it is a walk from the stall rather than
    // a second counter beside it: the two errands are different errands.
    rectObject(id++, 'blacksmith', 'prop', 14, 14, 4, 2, {
      properties: props({ texture: 'blacksmith', solid: true, depth: 16, interact: 'blacksmith' }),
    }),
    // Five cottages, so the schedules have somewhere to send people home to.
    // A villager who stands outdoors at midnight is a villager on a timer
    // rather than one with a life, and a door is the cheapest way to say so.
    //
    // Four tiles by three. They were three by two while the cottage was a
    // drawing made to measure; a real timber-and-thatch house is a wall under
    // a roof wider than it, and at three tiles across there was no room for a
    // door and a window side by side. Each grew up and to the right, so its
    // bottom row and its left edge — and therefore the doorstep below its
    // second column, which is where "home" means — stayed where they were.
    // Bram's is the exception: to the right was the lane, so it moved one
    // tile west and its doorstep with it — and then, see below, to the edge.
    //
    // The two northern houses sit two rows lower than their old footprint,
    // with their doorsteps on the lane itself. At rows 1 to 3 the drawing's
    // roof rose 62 pixels past the top edge of the map, where the camera
    // cannot go, and both houses were drawn without a roof ridge.
    //
    // A house's roof reaches three rows above its footprint, so two houses in
    // one column need that much between them. Rowan's sits a row lower than
    // it did, doorstep on the middle lane, so its roof clears Tobias's door;
    // Bram's is against the west edge, so its roof clears the tree on the
    // green — which is Ash's tree, and stays where Ash stands beside it.
    rectObject(id++, 'cottage-tobias', 'prop', 3, 3, 4, 3, {
      properties: props({ texture: 'cottage', solid: true, depth: 4 }),
    }),
    rectObject(id++, 'cottage-juniper', 'prop', 23, 3, 4, 3, {
      properties: props({ texture: 'cottage-brown', solid: true, depth: 4 }),
    }),
    rectObject(id++, 'cottage-rowan', 'prop', 2, 9, 4, 3, {
      properties: props({ texture: 'cottage-stone', solid: true, depth: 11 }),
    }),
    rectObject(id++, 'cottage-maeve', 'prop', 23, 13, 4, 3, {
      properties: props({ texture: 'cottage', solid: true, depth: 16 }),
    }),
    rectObject(id++, 'cottage-bram', 'prop', 0, 19, 4, 3, {
      properties: props({ texture: 'cottage-brown', solid: true, depth: 22 }),
    }),
    // The stock pen, where animals are bought. Not solid: it is a rail fence
    // and a trough, and a counter you cannot walk up to is not a counter.
    //
    // Down at the southern end, away from everything else. Two reasons, and
    // the second is the one that bites: buying a cow and selling a crop should
    // be two errands rather than two ends of one aisle — and an interactive
    // prop within `INTERACT_RADIUS` of anywhere a villager stands would start
    // stealing keypresses from them, because the nearest thing wins.
    rectObject(id++, 'ranch', 'prop', 10, 20, 3, 2, {
      properties: props({ texture: 'ranch-pen', solid: false, depth: 22, interact: 'rancher' }),
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

  // A thinner sprinkle than the farm: the village is where people are, and a
  // green that has to be walked across for five different errands should read
  // as tended rather than as scrubland.
  const scattered = scatterProps(ground, VILLAGE_W, VILLAGE_H, [...objects, ...portals].map(clearance), id, 9);
  id = scattered.nextId;

  // Spec 15: the south lane carries on down to the phố. Added after the
  // scatter so every object above keeps its id, and safe to: the scatter never
  // places anything beside a path or on the map's edge, and this is both.
  portals.push(
    rectObject(id++, 'to-plaza', 'portal', 17, 23, 3, 1, {
      properties: props({ toArea: 'plaza', toTileX: 22, toTileY: 13, label: 'Phố Việt' }),
    }),
  );
  // And a road sign at each of the village's two ways out.
  objects.push(
    signpost(id++, 'signpost-plaza', 20, 21, ['Khu phố', 'PHỐ VIỆT'], 'down'),
    signpost(id++, 'signpost-farm', 2, 13, ['Nông trại', 'AMBERFALL'], 'left'),
  );

  return map({
    displayName: 'Moonberry Village',
    music: 'day-village-loop',
    width: VILLAGE_W,
    height: VILLAGE_H,
    nextobjectid: id,
    layers: [
      tileLayer(1, 'ground', VILLAGE_W, VILLAGE_H, ground),
      objectLayer(2, 'props', [...objects, ...scattered.objects]),
      objectLayer(3, 'portals', portals),
    ],
  });
}

// --- the wood ---------------------------------------------------------------
// The third area, and the one spec 10 exists to make worth walking to.
//
// It is deliberately almost empty as a *map*: some grass, a lane, and a pond.
// Everything you actually go there for — the trees, the boulders, the forage —
// is `ResourceNode` state rather than Tiled props, because a tree you have
// felled is per-world and `maps/*.json` is identical in every world. Putting
// them here would mean every farm looks at the same four trees for ever.
//
// The pond is the other half of the reason. Spec 12 needs somewhere to fish
// that is not the farm's own corner puddle, and cutting the water now costs
// nothing and saves editing this map again later.

const FOREST_W = 34;
const FOREST_H = 26;

function forestMap() {
  const ground = buildLayer(FOREST_W, FOREST_H, (x, y) => {
    // The pond, north-east, with a shore wide enough to stand and cast from.
    if (x >= 22 && x <= 30 && y >= 3 && y <= 10) return GID['tile-water'];
    // One lane in from the farm gate, running the width of the wood.
    if (y === 13) return GID['tile-path'];
    // And a spur south, so the bottom half is somewhere rather than nowhere.
    if (x === 12 && y >= 13) return GID['tile-path'];
    return grassGid(x, y);
  });

  let id = 1;
  const objects = [
    // A forester's hut, empty, solid, and nobody's home. It is scenery with a
    // job: it tells you somebody used to work this wood, which is why there
    // are stumps in the farm's own field.
    rectObject(id++, 'cottage-woodcutter', 'prop', 4, 4, 3, 2, {
      properties: props({ texture: 'cottage', solid: true, depth: 6 }),
    }),
    rectObject(id++, 'well-forest', 'prop', 15, 18, 2, 2, {
      properties: props({ texture: 'well', solid: true, depth: 19 }),
    }),
  ];

  const portals = [
    rectObject(id++, 'to-farm', 'portal', 33, 11, 1, 5, {
      properties: props({ toArea: 'farm', toTileX: 2, toTileY: 14, label: 'Amberfall Farm' }),
    }),
  ];

  // Barely any scatter. The wood is drawn by its nodes, and a Tiled bush is a
  // permanent fixture standing in the way of something a player could have
  // cleared — which is exactly the frustration this spec is here to remove.
  const scattered = scatterProps(
    ground,
    FOREST_W,
    FOREST_H,
    [...objects, ...portals].map(clearance),
    id,
    17,
    0.015,
  );
  id = scattered.nextId;

  return map({
    displayName: 'Hollowpine Wood',
    music: 'day-farm-loop',
    width: FOREST_W,
    height: FOREST_H,
    nextobjectid: id,
    layers: [
      tileLayer(1, 'ground', FOREST_W, FOREST_H, ground),
      objectLayer(2, 'props', [...objects, ...scattered.objects]),
      objectLayer(3, 'portals', portals),
    ],
  });
}

// --- the farmhouse -----------------------------------------------------------
// Twelve by nine, about a tenth of the farm, and smaller than one screen on
// purpose: the whole room reads in one frame, with nothing for a camera to go
// looking for.
//
//        0  1  2  3  4  5  6  7  8  9 10 11
//   0    #  =  =  =  =  =  =  =  =  =  =  #    #  ceiling edge   =  back wall
//   1    #  =  =  =  =  =  =  =  =  =  =  #    .  floorboards
//   2    #  B  .  .  S  S  .  F  F  F  .  #    B  bed            S  sink and stove
//   3    #  B  .  .  .  .  .  F  F  F  .  #    F  fireplace      T  table
//   4    #  .  .  .  T  T  .  R  R  R  .  #    c  chairs         R  rug
//   5    #  .  .  c  T  T  c  R  R  R  .  #    ^  where you land coming in
//   6    #  .  .  .  .  .  .  R  R  R  .  #    D  the doorway, back to the yard
//   7    #  .  .  .  .  .  ^  .  .  .  .  #
//   8    #  #  #  #  #  #  D  #  #  #  #  #

const HOUSE_W = 12;
const HOUSE_H = 9;
const HOUSE_DOOR_X = 6;

function farmhouseGround(x, y) {
  if (y === HOUSE_H - 1) {
    if (x === HOUSE_DOOR_X) return GID['tile-floor-wood'];
    if (x === 0) return GID['tile-wall-bottom-left'];
    if (x === HOUSE_W - 1) return GID['tile-wall-bottom-right'];
    if (x === HOUSE_DOOR_X - 1) return GID['tile-wall-door-left'];
    if (x === HOUSE_DOOR_X + 1) return GID['tile-wall-door-right'];
    return GID['tile-wall-bottom'];
  }
  if (x === 0) return GID['tile-wall-left'];
  if (x === HOUSE_W - 1) return GID['tile-wall-right'];
  if (y <= 1) return GID[`tile-wall-${y === 0 ? 'upper' : 'lower'}-${((x - 1) % 3) + 1}`];
  return GID['tile-floor-wood'];
}

function farmhouseMap() {
  const ground = buildLayer(HOUSE_W, HOUSE_H, farmhouseGround);

  let id = 1;
  // Depth is the bottom row, the way every other prop on every other map sorts.
  const furniture = (name, texture, tx, ty, tw, th, extra = {}) =>
    rectObject(id++, name, 'prop', tx, ty, tw, th, {
      properties: props({ texture, solid: true, depth: ty + th - 1, ...extra }),
    });

  const objects = [
    // Headboard against the back wall, with its whole long side free to stand at.
    furniture('bed', 'furniture-bed', 1, 2, 1, 2, { interact: 'bed' }),
    // Nothing to do at it yet; it is here for cooking, which is not a spec yet.
    furniture('stove', 'furniture-stove', 4, 2, 2, 1),
    furniture('table', 'furniture-table', 4, 4, 2, 2),
    furniture('chair-west', 'furniture-chair-east', 3, 5, 1, 1),
    furniture('chair-east', 'furniture-chair-west', 6, 5, 1, 1),
    // The room's only light, built into the back wall where a hearth belongs.
    // The scene hangs a flickering glow on it.
    furniture('fireplace', 'furniture-fireplace', 7, 2, 3, 2),
    // Underfoot, so neither solid nor above anything.
    rectObject(id++, 'rug', 'prop', 7, 4, 3, 3, {
      properties: props({ texture: 'furniture-rug', solid: false, depth: 0 }),
    }),
  ];

  const portals = [
    // Lands on the road in front of the step, not back on the doorstep portal.
    rectObject(id++, 'to-farm', 'portal', HOUSE_DOOR_X, HOUSE_H - 1, 1, 1, {
      properties: props({ toArea: 'farm', toTileX: 5, toTileY: 7, label: 'sân nông trại' }),
    }),
  ];

  return map({
    displayName: 'Farmhouse',
    music: 'home-loop',
    indoor: true,
    width: HOUSE_W,
    height: HOUSE_H,
    nextobjectid: id,
    layers: [
      tileLayer(1, 'ground', HOUSE_W, HOUSE_H, ground),
      objectLayer(2, 'props', objects),
      objectLayer(3, 'portals', portals),
    ],
  });
}

// --- the phố ------------------------------------------------------------------
// Spec 15's street, and a cul-de-sac between the farm and the village: in
// from the farm's southern ring road on the west, out to the village's south
// lane on the east, and nowhere else.
//
// Built from what is already here. The pavement is a tile, the three shops
// are plain fronts with a board left blank — what the board says is the
// prop's `sign`, drawn by the client in a system font, so the diacritics are
// right and renaming a shop is an edit here rather than a drawing — and the
// only interactive thing on the street is Bà Xoan's xôi cart.

const PLAZA_W = 24;
const PLAZA_H = 18;

/** The bottom row of the shop fronts. North of the pavement is back gardens. */
const PLAZA_FRONT_ROW = 8;

function plazaMap() {
  const ground = buildLayer(PLAZA_W, PLAZA_H, (x, y) =>
    y >= PLAZA_FRONT_ROW - 2 ? GID['tile-plaza'] : grassGid(x, y),
  );

  let id = 1;
  const shop = (name, x, texture, sign) =>
    rectObject(id++, name, 'prop', x, PLAZA_FRONT_ROW - 1, 5, 2, {
      properties: props({ texture, solid: true, depth: PLAZA_FRONT_ROW, sign }),
    });

  const objects = [
    shop('shopfront-banh-bao', 1, 'shopfront', 'BÁNH BAO'),
    shop('shopfront-tap-hoa', 9, 'shopfront-green', 'TẠP HOÁ'),
    shop('shopfront-che', 17, 'shopfront-blue', 'CHÈ'),

    // The one counter on the street. Not solid, like the market stall it is
    // recoloured from: a counter you cannot walk up to is not a counter.
    rectObject(id++, 'xoi-cart', 'prop', 3, PLAZA_FRONT_ROW + 1, 3, 1, {
      properties: props({ texture: 'xoi-cart', solid: false, depth: PLAZA_FRONT_ROW + 1, interact: 'xoi-stall' }),
    }),
    rectObject(id++, 'street-cabinet', 'prop', 11, PLAZA_FRONT_ROW + 1, 1, 1, {
      properties: props({ texture: 'street-cabinet', solid: true, depth: PLAZA_FRONT_ROW + 1 }),
    }),

    // Two poles in the gaps between the shops, and the wire strung from them
    // above everybody's heads.
    rectObject(id++, 'street-pole-west', 'prop', 7, PLAZA_FRONT_ROW + 1, 1, 1, {
      properties: props({ texture: 'street-pole', solid: true, depth: PLAZA_FRONT_ROW + 1 }),
    }),
    rectObject(id++, 'street-pole-east', 'prop', 15, PLAZA_FRONT_ROW + 1, 1, 1, {
      properties: props({ texture: 'street-pole', solid: true, depth: PLAZA_FRONT_ROW + 1 }),
    }),
    ...[8, 9, 10, 11, 12, 13, 14, 16, 17, 18, 19, 20, 21, 22, 23].map((x) =>
      rectObject(id++, 'street-wire', 'prop', x, PLAZA_FRONT_ROW - 2, 1, 1, {
        properties: props({ texture: 'street-wire', solid: false, depth: 60 }),
      }),
    ),

    // A road sign at each end, pointing out the way it goes, and a cột mốc at
    // the farm end: this is kilometre nought of the phố.
    signpost(id++, 'signpost-farm', 2, 16, ['Nông trại', 'AMBERFALL'], 'left'),
    signpost(id++, 'signpost-village', 21, 16, ['Làng', 'MOONBERRY'], 'right'),
    milestone(id++, 'milestone', 1, PLAZA_FRONT_ROW + 2, ['PV', '0 km']),

    // Stone benches and potted flowers along the pavement. Underfoot, all of
    // them: a street is somewhere to walk through.
    ...[
      ['bench', 9, 14, 'log'],
      ['bench', 13, 14, 'log'],
      ['pot', 8, PLAZA_FRONT_ROW + 1, 'flowers-red'],
      ['pot', 16, PLAZA_FRONT_ROW + 1, 'flowers-gold'],
      ['pot', 6, 16, 'flowers-white'],
      ['pot', 17, 16, 'flowers-red'],
    ].map(([name, x, y, texture]) =>
      rectObject(id++, name, 'prop', x, y, 1, 1, {
        properties: props({ texture, solid: false, depth: y }),
      }),
    ),
  ];

  const portals = [
    rectObject(id++, 'to-farm', 'portal', 0, 11, 1, 5, {
      properties: props({ toArea: 'farm', toTileX: 37, toTileY: 22, label: 'Amberfall Farm' }),
    }),
    rectObject(id++, 'to-village', 'portal', PLAZA_W - 1, 11, 1, 5, {
      properties: props({ toArea: 'village', toTileX: 18, toTileY: 21, label: 'Moonberry Village' }),
    }),
  ];

  const scattered = scatterProps(ground, PLAZA_W, PLAZA_H, [...objects, ...portals].map(clearance), id, 15);
  id = scattered.nextId;

  return map({
    displayName: 'Phố Việt',
    music: 'day-village-loop',
    width: PLAZA_W,
    height: PLAZA_H,
    nextobjectid: id,
    layers: [
      tileLayer(1, 'ground', PLAZA_W, PLAZA_H, ground),
      objectLayer(2, 'props', [...objects, ...scattered.objects]),
      objectLayer(3, 'portals', portals),
    ],
  });
}

fs.mkdirSync(outDir, { recursive: true });

const files = {
  'tileset.json': tileset(),
  'farm.json': farmMap(),
  'village.json': villageMap(),
  'forest.json': forestMap(),
  'farmhouse.json': farmhouseMap(),
  'plaza.json': plazaMap(),
};

// Named files only, when any are named: `npm run maps:seed -- plaza.json`
// writes the phố without overwriting hand edits made to the others in Tiled.
const only = process.argv.slice(2);
for (const name of only) {
  if (!(name in files)) {
    console.error(`No map called ${name}. Known: ${Object.keys(files).join(', ')}.`);
    process.exit(1);
  }
}

for (const [name, contents] of Object.entries(files)) {
  if (only.length > 0 && !only.includes(name)) continue;
  fs.writeFileSync(path.join(outDir, name), `${JSON.stringify(contents, null, 2)}\n`);
  console.log(`wrote ${path.join(outDir, name)}`);
}
