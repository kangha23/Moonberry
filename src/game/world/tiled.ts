/**
 * Turns Tiled's JSON into the shape the game actually plays with.
 *
 * Tiled is the editing format, not the runtime format: it is verbose, stores
 * everything as loose property lists, and knows nothing about farms. Parsing
 * it once at startup keeps every other module free of that detail, and keeps
 * this file the only place that has to change if the map format does.
 */

export type TileKind = 'grass' | 'path' | 'water' | 'plot' | 'floor' | 'wall';

export interface Point {
  x: number;
  y: number;
}

// --- the Tiled JSON shapes we read ------------------------------------------

export interface TiledProperty {
  name: string;
  type: string;
  value: string | number | boolean;
}

export interface TiledTilesetTile {
  id: number;
  image: string;
  imagewidth: number;
  imageheight: number;
  properties?: TiledProperty[];
}

export interface TiledTileset {
  tilecount: number;
  tilewidth: number;
  tileheight: number;
  tiles: TiledTilesetTile[];
}

export interface TiledTileLayer {
  type: 'tilelayer';
  name: string;
  width: number;
  height: number;
  data: number[];
}

export interface TiledObject {
  id: number;
  name: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  properties?: TiledProperty[];
}

export interface TiledObjectLayer {
  type: 'objectgroup';
  name: string;
  objects: TiledObject[];
}

export type TiledLayer = TiledTileLayer | TiledObjectLayer;

export interface TiledMap {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  layers: TiledLayer[];
  properties?: TiledProperty[];
}

// --- the runtime shapes ------------------------------------------------------

export interface TileDef {
  /** Texture key the renderer draws for this tile. */
  texture: string;
  kind: TileKind;
  solid: boolean;
}

/** A standing object: a house, a tree, a market stall, an NPC. */
export interface AreaProp {
  name: string;
  texture: string;
  /** World-pixel bounds. */
  x: number;
  y: number;
  width: number;
  height: number;
  solid: boolean;
  depth: number;
  /** Non-null when walking up to it and pressing act does something. */
  interact: string | null;
  /**
   * What the board on a shop front says, for a prop drawn with one.
   *
   * Text rather than pixels: the client draws it over the blank board in a
   * system font, so the diacritics are right and renaming a shop is an edit in
   * Tiled rather than a drawing. Null for every prop that has no board.
   */
  sign: string | null;
  /** Which way a road sign points. Null for everything that is not one. */
  arrow: SignArrow | null;
}

/** A doorway: stepping into it moves the player to another area. */
export interface AreaPortal {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  toArea: string;
  /** World-pixel landing spot in the target area. */
  toX: number;
  toY: number;
  label: string;
}

/**
 * A rectangle that blocks the way with nothing drawn on it, in world pixels.
 *
 * A solid prop is its own collision box, which is exactly wrong for a
 * building with a door in it: the picture is one rectangle and the wall is
 * that rectangle minus a doorway. Colliders let the map say the second thing
 * while the prop goes on saying the first.
 */
export interface AreaCollider {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AreaMap {
  id: string;
  /** What the map calls itself, set as a map property in Tiled. */
  name: string;
  /**
   * The music bed this area plays by day, set as a map property in Tiled.
   * Null when the map names none, which the audio layer reads as "the
   * default bed". Named rather than enumerated so a new area can bring its
   * own track with an audio file and a map property, and no code change.
   */
  music: string | null;
  /**
   * True when this area is under a roof, set as a map property in Tiled: no
   * rain, no night sky, and the area's own music bed whatever the weather.
   */
  indoor: boolean;
  /** Size in tiles. */
  width: number;
  height: number;
  /** Size in world pixels, which is what the camera and bounds care about. */
  pixelWidth: number;
  pixelHeight: number;
  tileSize: number;
  /** One entry per cell, row-major. Null where the layer had no tile. */
  tiles: Array<TileDef | null>;
  props: AreaProp[];
  /** Rectangles that block the way without being drawn. */
  colliders: AreaCollider[];
  portals: AreaPortal[];
  spawns: Point[];
  /** Every cell whose tile is farmable, in row-major order. */
  plotTiles: Point[];
}

// --- edges -------------------------------------------------------------------

/**
 * The four sides of a tile, as bits of an edge mask.
 *
 * Clockwise from the top, so a mask reads the way a compass does and the
 * sixteen texture variants can be named by the number alone.
 */
export const EDGE_NORTH = 1;
export const EDGE_EAST = 2;
export const EDGE_SOUTH = 4;
export const EDGE_WEST = 8;

/** Every mask that draws something. 0 is a tile surrounded by its own kind. */
export const EDGE_MASKS: readonly number[] = Array.from({ length: 15 }, (_, i) => i + 1);

/**
 * Which sides of a tile meet a different kind of ground, as 0-15.
 *
 * Four directions rather than eight: sixteen variants need sixteen tiles in
 * the set, where the 47 of an eight-way bitmask look better and are three
 * times the drawing. At this camera distance the difference is all but
 * invisible.
 *
 * `kindAt` returns null off the edge of the map, and a null neighbour sets no
 * bit: the world carries on past the border as far as anyone looking at it is
 * concerned, and a fringe drawn along the map boundary would say otherwise.
 *
 * Pure, so the renderer can run it once per tile when an area is built rather
 * than once per tile per frame — and so this file can be the only place the
 * rule lives, whichever boundary it is asked about.
 */
export function edgeMask(
  kindAt: (x: number, y: number) => TileKind | null,
  x: number,
  y: number,
): number {
  const here = kindAt(x, y);
  if (here === null) return 0;

  const differs = (nx: number, ny: number): boolean => {
    const neighbour = kindAt(nx, ny);
    return neighbour !== null && neighbour !== here;
  };

  return (
    (differs(x, y - 1) ? EDGE_NORTH : 0) |
    (differs(x + 1, y) ? EDGE_EAST : 0) |
    (differs(x, y + 1) ? EDGE_SOUTH : 0) |
    (differs(x - 1, y) ? EDGE_WEST : 0)
  );
}

/**
 * Reads a map as if only two kinds of ground existed.
 *
 * `edgeMask` answers "which sides are not me", which on a tile that touches
 * both grass and water is one mask for two different boundaries. Flattening
 * everything that is not `other` into `self` first turns the same function
 * into "which sides are water" — so one boundary can be drawn at a time, and
 * the three of them stack.
 */
export function pairKindAt(
  kindAt: (x: number, y: number) => TileKind | null,
  self: TileKind,
  other: TileKind,
): (x: number, y: number) => TileKind | null {
  return (x, y) => {
    const kind = kindAt(x, y);
    if (kind === null) return null;
    return kind === other ? other : self;
  };
}

// --- parsing -----------------------------------------------------------------

function propertyMap(properties: TiledProperty[] | undefined): Record<string, string | number | boolean> {
  const map: Record<string, string | number | boolean> = {};
  for (const property of properties ?? []) map[property.name] = property.value;
  return map;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

const TILE_KINDS: readonly TileKind[] = ['grass', 'path', 'water', 'plot', 'floor', 'wall'];

function asTileKind(value: unknown): TileKind {
  return TILE_KINDS.includes(value as TileKind) ? (value as TileKind) : 'grass';
}

/**
 * Builds the gid lookup. Tiled numbers tiles from `firstgid`, with 0 meaning
 * "no tile", so index 0 of the returned array is deliberately null.
 */
function tileDefs(tileset: TiledTileset, firstGid: number): Array<TileDef | null> {
  const defs: Array<TileDef | null> = [null];
  for (const tile of tileset.tiles) {
    const properties = propertyMap(tile.properties);
    defs[firstGid + tile.id] = {
      texture: asString(properties.texture, `tile-${tile.id}`),
      kind: asTileKind(properties.kind),
      solid: asBoolean(properties.solid),
    };
  }
  return defs;
}

function findTileLayer(map: TiledMap, name: string): TiledTileLayer | null {
  for (const layer of map.layers) {
    if (layer.type === 'tilelayer' && layer.name === name) return layer;
  }
  return null;
}

function objectsOfType(map: TiledMap, type: string): TiledObject[] {
  const found: TiledObject[] = [];
  for (const layer of map.layers) {
    if (layer.type !== 'objectgroup') continue;
    for (const object of layer.objects) {
      if (object.type === type) found.push(object);
    }
  }
  return found;
}

/**
 * The kinds of board a prop can be drawn with, by texture prefix.
 *
 * Every prop drawn with one must carry a `sign`, and nothing else may: a board
 * with nothing on it is a shop somebody forgot to name, and a sign on a bush
 * would be words floating over nothing.
 *
 * - `shopfront` is a shop's name, one line across the board over the awning.
 * - `signpost` is a road sign, spec 15's second half: a blue board on two
 *   poles, up to three lines — a small one, the place in capitals, and a small
 *   one under the arrow — and an `arrow` it must have, pointing the way.
 * - `milestone` is a cột mốc: a short line on the red cap and one on the stone.
 */
export type SignKind = 'shopfront' | 'signpost' | 'milestone';

export const SIGN_KINDS: Record<SignKind, { maxLines: number; arrow: boolean }> = {
  shopfront: { maxLines: 1, arrow: false },
  signpost: { maxLines: 3, arrow: true },
  milestone: { maxLines: 2, arrow: false },
};

/** The most characters one line of a board has room for. */
export const MAX_SIGN_LENGTH = 16;

export type SignArrow = 'left' | 'right' | 'up' | 'down';

const SIGN_ARROWS: readonly SignArrow[] = ['left', 'right', 'up', 'down'];

/**
 * Every property a prop may carry.
 *
 * A closed list, so a misspelt `sigm` or `interract` is an error when the map
 * loads rather than a board that is quietly blank or a counter that quietly
 * does nothing — the second of which is how a typo in Tiled used to behave.
 */
const PROP_PROPERTIES: readonly string[] = ['texture', 'solid', 'depth', 'interact', 'sign', 'arrow'];

/** Which kind of board a texture is drawn with, or null for one with none. */
export function signKindOf(texture: string): SignKind | null {
  for (const kind of Object.keys(SIGN_KINDS) as SignKind[]) {
    if (texture === kind || texture.startsWith(`${kind}-`)) return kind;
  }
  return null;
}

export function hasSignboard(texture: string): boolean {
  return signKindOf(texture) !== null;
}

/** A sign's lines. A newline in the Tiled property starts the next one. */
export function signLines(sign: string): string[] {
  return sign.split('\n');
}

/**
 * A prop's sign and arrow, checked, or a thrown error naming the map and prop.
 *
 * Loud on purpose, and at load rather than at draw: a sign that is wrong is a
 * map that is wrong, and the place to find that out is starting the game, not
 * walking down the street and noticing a board with nothing on it.
 */
function parseSign(
  mapId: string,
  object: TiledObject,
  texture: string,
  value: unknown,
  arrowValue: unknown,
): { sign: string | null; arrow: SignArrow | null } {
  const where = `Map "${mapId}" prop "${object.name}"`;
  const kind = signKindOf(texture);

  if (arrowValue !== undefined && !(kind && SIGN_KINDS[kind].arrow)) {
    throw new Error(`${where} has an "arrow", but "${texture}" has nowhere to draw one.`);
  }
  if (value === undefined) {
    if (kind) throw new Error(`${where} is drawn with a signboard ("${texture}") and has no "sign".`);
    return { sign: null, arrow: null };
  }
  if (!kind) {
    throw new Error(`${where} has a "sign", but "${texture}" has no board to write it on.`);
  }
  if (typeof value !== 'string') throw new Error(`${where} has a "sign" that is not a string.`);

  const lines = value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim());
  if (lines.every((line) => line === '')) throw new Error(`${where} has an empty "sign".`);
  if (lines.some((line) => line === '')) throw new Error(`${where} has a "sign" with an empty line in it.`);
  const { maxLines, arrow: wantsArrow } = SIGN_KINDS[kind];
  if (lines.length > maxLines) {
    throw new Error(`${where} has a "sign" of ${lines.length} lines; a ${kind} has room for ${maxLines}.`);
  }
  for (const line of lines) {
    if ([...line].length > MAX_SIGN_LENGTH) {
      throw new Error(`${where} has a "sign" line longer than ${MAX_SIGN_LENGTH} characters: "${line}".`);
    }
  }

  let arrow: SignArrow | null = null;
  if (wantsArrow) {
    if (!SIGN_ARROWS.includes(arrowValue as SignArrow)) {
      throw new Error(`${where} is a ${kind} and needs an "arrow": one of ${SIGN_ARROWS.join(', ')}.`);
    }
    arrow = arrowValue as SignArrow;
  }
  return { sign: lines.join('\n'), arrow };
}

function toProp(mapId: string, object: TiledObject): AreaProp {
  for (const property of object.properties ?? []) {
    if (!PROP_PROPERTIES.includes(property.name)) {
      throw new Error(
        `Map "${mapId}" prop "${object.name}" has an unknown property "${property.name}". ` +
          `A prop may carry: ${PROP_PROPERTIES.join(', ')}.`,
      );
    }
  }
  const properties = propertyMap(object.properties);
  const interact = asString(properties.interact);
  const texture = asString(properties.texture, object.name);
  return {
    name: object.name,
    texture,
    x: object.x,
    y: object.y,
    width: object.width,
    height: object.height,
    solid: asBoolean(properties.solid),
    depth: asNumber(properties.depth),
    interact: interact === '' ? null : interact,
    ...parseSign(mapId, object, texture, properties.sign, properties.arrow),
  };
}

function toPortal(object: TiledObject, tileSize: number): AreaPortal {
  const properties = propertyMap(object.properties);
  return {
    name: object.name,
    x: object.x,
    y: object.y,
    width: object.width,
    height: object.height,
    toArea: asString(properties.toArea),
    // Tiled stores the landing spot in tiles, because that is what is easy to
    // read off the grid while editing; the game works in pixels.
    toX: asNumber(properties.toTileX) * tileSize + tileSize / 2,
    toY: asNumber(properties.toTileY) * tileSize + tileSize / 2,
    label: asString(properties.label, object.name),
  };
}

/**
 * Converts one Tiled map into an `AreaMap`.
 *
 * Throws when the ground layer is missing or the wrong size: a map that cannot
 * be trusted should fail loudly at startup rather than produce a world with
 * holes in it that only shows up when somebody walks into one.
 */
export function parseTiledMap(id: string, map: TiledMap, tileset: TiledTileset, firstGid = 1): AreaMap {
  const ground = findTileLayer(map, 'ground');
  if (!ground) throw new Error(`Map "${id}" has no "ground" tile layer.`);
  if (ground.data.length !== map.width * map.height) {
    throw new Error(
      `Map "${id}" ground layer has ${ground.data.length} tiles, expected ${map.width * map.height}.`,
    );
  }

  const defs = tileDefs(tileset, firstGid);
  const tiles = ground.data.map((gid) => defs[gid] ?? null);

  const plotTiles: Point[] = [];
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      if (tiles[y * map.width + x]?.kind === 'plot') plotTiles.push({ x, y });
    }
  }

  const mapProperties = propertyMap(map.properties);

  return {
    id,
    name: asString(mapProperties.displayName, id),
    music: asString(mapProperties.music) || null,
    indoor: asBoolean(mapProperties.indoor),
    width: map.width,
    height: map.height,
    pixelWidth: map.width * map.tilewidth,
    pixelHeight: map.height * map.tileheight,
    tileSize: map.tilewidth,
    tiles,
    props: objectsOfType(map, 'prop').map((object) => toProp(id, object)),
    colliders: objectsOfType(map, 'collider').map(({ name, x, y, width, height }) => ({
      name,
      x,
      y,
      width,
      height,
    })),
    portals: objectsOfType(map, 'portal').map((object) => toPortal(object, map.tilewidth)),
    spawns: objectsOfType(map, 'spawn').map((object) => ({
      x: object.x + object.width / 2,
      y: object.y + object.height / 2,
    })),
    plotTiles,
  };
}
