import { MAX_DEPTH, floorSize } from '../systems/mine';
import { AREA_IDS, MAP_SOURCES, TILESET, type AreaId as StaticAreaId } from './maps.generated';
import {
  parseTiledMap,
  type AreaMap,
  type AreaPortal,
  type AreaProp,
  type Point,
  type TileDef,
  type TileKind,
} from './tiled';

export { AREA_IDS };
export type { StaticAreaId };

/** A floor of the mine. Generated, not drawn in Tiled — see spec 13. */
export type MineAreaId = `mine:${number}`;

/**
 * Every place a player can stand: the Tiled maps, and the mine's floors.
 *
 * Open rather than closed since spec 13, because forty generated floors are
 * not forty entries in `AREA_IDS`. Anything that iterates the world still
 * iterates `AREAS`, which is only the static maps.
 */
export type AreaId = StaticAreaId | MineAreaId;
export type { AreaCollider, AreaMap, AreaPortal, AreaProp, Point, TileDef, TileKind } from './tiled';
export {
  EDGE_EAST,
  EDGE_NORTH,
  EDGE_SOUTH,
  EDGE_WEST,
  edgeMask,
  pairKindAt,
} from './tiled';

export const TILE_SIZE = 32;
export const PLAYER_SPEED = 132;

/** How close a player must stand to a prop before acting on it does anything. */
export const INTERACT_RADIUS = 58;

export type Direction = 'up' | 'down' | 'left' | 'right';

/** Where a player starts, and where the farming happens. */
export const START_AREA: StaticAreaId = 'farm';

/**
 * Every area, parsed once at module load.
 *
 * Maps never change at runtime, so they are derived rather than stored in game
 * state: the client and the server build byte-identical worlds from the same
 * generated source, and nothing has to send a map over the wire.
 */
export const AREAS: Record<StaticAreaId, AreaMap> = Object.fromEntries(
  AREA_IDS.map((id) => [id, parseTiledMap(id, MAP_SOURCES[id], TILESET)]),
) as Record<StaticAreaId, AreaMap>;

export function mineArea(depth: number): MineAreaId {
  return `mine:${depth}`;
}

/** The depth of a mine floor, or null for anything that is not one. */
export function mineDepth(area: string): number | null {
  if (!area.startsWith('mine:')) return null;
  const depth = Number(area.slice('mine:'.length));
  if (!Number.isInteger(depth) || depth < 1 || depth > MAX_DEPTH) return null;
  return area === mineArea(depth) ? depth : null;
}

export function isMineArea(area: string): area is MineAreaId {
  return mineDepth(area) !== null;
}

export function isAreaId(value: unknown): value is AreaId {
  if (typeof value !== 'string') return false;
  return (AREA_IDS as readonly string[]).includes(value) || isMineArea(value);
}

/** Every mine tile before the seed has said where the walls are. */
const MINE_FLOOR_TILE: TileDef = { texture: 'mine-floor', kind: 'floor', solid: false };
const mineShells = new Map<number, AreaMap>();

/**
 * The shape of a mine floor that does not depend on the day: its size and
 * nothing else — no props, no portals, no plots, every tile open.
 *
 * The walls are the seed's, and the seed lives on `FarmState`, which this
 * module is never handed. They arrive through `Blockers.floor` exactly as
 * buildings and nodes do, so `isWalkable` stays a function of its arguments.
 */
function mineShell(depth: number): AreaMap {
  let shell = mineShells.get(depth);
  if (shell) return shell;
  const size = floorSize(depth);
  shell = {
    id: mineArea(depth),
    name: `Mỏ — tầng ${depth}`,
    // One bed for every floor. Indoors, so it outranks the rain and the night
    // the way the farmhouse's does: underground, neither is audible.
    music: 'mine-loop',
    indoor: true,
    width: size,
    height: size,
    pixelWidth: size * TILE_SIZE,
    pixelHeight: size * TILE_SIZE,
    tileSize: TILE_SIZE,
    tiles: Array<TileDef>(size * size).fill(MINE_FLOOR_TILE),
    props: [],
    colliders: [],
    portals: [],
    spawns: [],
    plotTiles: [],
  };
  mineShells.set(depth, shell);
  return shell;
}

export function areaMap(area: AreaId): AreaMap {
  const depth = mineDepth(area);
  return depth === null ? AREAS[area as StaticAreaId] : mineShell(depth);
}

/**
 * Plot keys carry their area, so two areas can both have soil at 9,7 without
 * colliding and a plot can never be silently read from the wrong place.
 */
export function plotKey(area: AreaId, x: number, y: number): string {
  return `${area}:${x},${y}`;
}

export function worldToTile(value: number): number {
  return Math.floor(value / TILE_SIZE);
}

export function tileAt(area: AreaId, tileX: number, tileY: number): TileDef | null {
  const map = areaMap(area);
  if (tileX < 0 || tileX >= map.width || tileY < 0 || tileY >= map.height) return null;
  return map.tiles[tileY * map.width + tileX];
}

/** Every farmable cell in an area, which is what seeds the plot records. */
export function plotTiles(area: AreaId): Point[] {
  return areaMap(area).plotTiles;
}

/**
 * Where somebody climbing out of the mine stands: just south of the prop whose
 * `interact` is `mine`, on whichever map has one, so the mouth of the mine is
 * in front of them and the action key takes them straight back down.
 *
 * Read off the maps rather than written down, like every other interactive
 * prop — moving the entrance in Tiled moves where the mine lets you out. Null
 * when no map has an entrance, and the caller falls back to the farm.
 */
export function mineMouth(): ({ area: StaticAreaId } & Point) | null {
  for (const area of AREA_IDS) {
    const entrance = AREAS[area].props.find((prop) => prop.interact === 'mine');
    if (!entrance) continue;
    return {
      area,
      x: entrance.x + entrance.width / 2,
      y: entrance.y + entrance.height + TILE_SIZE / 2,
    };
  }
  return null;
}

/** Player spawn points, taken from the starting area's spawn objects. */
export function spawnPoints(): Point[] {
  const spawns = AREAS[START_AREA].spawns;
  if (spawns.length > 0) return spawns;
  // A map with no spawn objects still has to put players somewhere.
  const map = AREAS[START_AREA];
  return [{ x: map.pixelWidth / 2, y: map.pixelHeight / 2 }];
}

/**
 * A solid rectangle in world pixels that the map knows nothing about.
 *
 * The farm's buildings are state rather than map data, so collision stopped
 * being purely a map property the moment they existed. Rather than teach this
 * module what a building is — which would make the map depend on the farm —
 * callers hand it the footprints, and it treats them exactly like a solid prop.
 */
export interface Blocker {
  x: number;
  y: number;
  width: number;
  height: number;
}

function contains(rect: Blocker, point: Point): boolean {
  return (
    point.x >= rect.x && point.x < rect.x + rect.width && point.y >= rect.y && point.y < rect.y + rect.height
  );
}

/**
 * Everything in the way that the map knows nothing about.
 *
 * An object with named fields rather than a second, third and fourth list
 * parameter, and that is the whole reason it exists. Spec 06 opened this door
 * by handing `isWalkable` the buildings; spec 10 has resource nodes to add and
 * spec 13 will have whatever the mine turns out to need. One more parameter
 * each time ends with a five-argument call nobody can read at the site.
 *
 * Passed in rather than read from a module-level store, because this is called
 * from the reducer, which is pure, and from the server's movement path. The
 * empty set is the map on its own, which is what every caller outside the farm
 * wants.
 */
export interface Blockers {
  buildings: readonly Blocker[];
  nodes: readonly Blocker[];
  /**
   * Chests, machines and fences. Spec 11's, and the third source exactly as
   * this type was written expecting: a field here, not a third parameter at
   * every call site.
   */
  placeables: readonly Blocker[];
  /**
   * A generated floor's walls, in tiles. Spec 13's source, and the reason this
   * type is an object: absent on every Tiled map, present on a mine floor.
   */
  floor?: FloorGrid | null;
}

/** The part of a mine floor collision needs. `MineFloor` satisfies it. */
export interface FloorGrid {
  width: number;
  height: number;
  tiles: ReadonlyArray<ReadonlyArray<TileKind>>;
}

export const NO_BLOCKERS: Blockers = { buildings: [], nodes: [], placeables: [] };

/** Whether a world-pixel position is somewhere a player may stand. */
export function isWalkable(
  area: AreaId,
  x: number,
  y: number,
  blocked: Blockers = NO_BLOCKERS,
): boolean {
  const map = areaMap(area);
  if (x < 0 || y < 0 || x >= map.pixelWidth || y >= map.pixelHeight) return false;

  const tile = tileAt(area, worldToTile(x), worldToTile(y));
  if (!tile || tile.solid) return false;
  if (blocked.floor && blocked.floor.tiles[worldToTile(y)]?.[worldToTile(x)] !== 'floor') return false;

  for (const prop of map.props) {
    if (prop.solid && contains(prop, { x, y })) return false;
  }
  for (const rect of map.colliders) {
    if (contains(rect, { x, y })) return false;
  }
  for (const rect of blocked.buildings) {
    if (contains(rect, { x, y })) return false;
  }
  for (const rect of blocked.nodes) {
    if (contains(rect, { x, y })) return false;
  }
  for (const rect of blocked.placeables) {
    if (contains(rect, { x, y })) return false;
  }
  return true;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * How far a point is from the nearest edge of a rectangle, and 0 inside it.
 *
 * Proximity is measured to the footprint rather than to the centre because
 * props are not all the same size: a farmhouse is five tiles across, and its
 * centre is somewhere nobody can stand.
 */
function distanceToRect(rect: { x: number; y: number; width: number; height: number }, point: Point): number {
  const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.width));
  const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.height));
  return Math.hypot(dx, dy);
}

/**
 * How far a player is standing from a prop, in world pixels.
 *
 * Exported because a villager and a counter can both be in reach at once, and
 * whichever is nearer should win — the same rule two props already follow.
 * Measuring both against the same function is what keeps that rule one rule.
 */
export function propGap(prop: AreaProp, point: Point): number {
  return distanceToRect(prop, point);
}

/** The centre of a prop, which is what proximity is measured against. */
export function propCentre(prop: AreaProp): Point {
  return { x: prop.x + prop.width / 2, y: prop.y + prop.height / 2 };
}

export function isNear(point: Point, target: Point, radius = INTERACT_RADIUS): boolean {
  return distance(point, target) < radius;
}

/**
 * The interactive prop a player is standing next to, if any. When two are in
 * range the nearest wins, so a market stall beside an NPC stays usable.
 */
export function interactableAt(area: AreaId, point: Point, radius = INTERACT_RADIUS): AreaProp | null {
  let best: AreaProp | null = null;
  let bestDistance = radius;

  for (const prop of areaMap(area).props) {
    if (!prop.interact) continue;
    const gap = distanceToRect(prop, point);
    if (gap < bestDistance) {
      best = prop;
      bestDistance = gap;
    }
  }
  return best;
}

/** The portal a player is standing in, if any. */
export function portalAt(area: AreaId, point: Point): AreaPortal | null {
  for (const portal of areaMap(area).portals) {
    if (contains(portal, point)) return portal;
  }
  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

const FACING_OFFSETS: Record<Direction, Point> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/** The tile a player at `position` facing `facing` would act on. */
export function targetTile(area: AreaId, position: Point, facing: Direction): Point {
  const map = areaMap(area);
  const offset = FACING_OFFSETS[facing];
  return {
    x: clamp(worldToTile(position.x) + offset.x, 0, map.width - 1),
    y: clamp(worldToTile(position.y) + offset.y, 0, map.height - 1),
  };
}

/**
 * The tiles a swing works: a rectangle centred on the tile that was aimed at.
 *
 * Centred rather than swept out in front, so a click means the same rectangle
 * however the farmhand happens to be standing — and so the translucent
 * footprint the client draws under the cursor is the truth rather than an
 * approximation of it. Even sides round towards the top-left, which never
 * comes up: every tier is odd on both axes.
 *
 * Tiles off the edge of the map are simply absent; the caller looks each one
 * up and skips what is not there.
 */
export function areaOfEffectTiles(
  centre: Point,
  size: { width: number; height: number },
  area: AreaId,
): Point[] {
  const map = areaMap(area);
  const left = centre.x - Math.floor((size.width - 1) / 2);
  const top = centre.y - Math.floor((size.height - 1) / 2);
  const tiles: Point[] = [];
  for (let y = top; y < top + size.height; y += 1) {
    for (let x = left; x < left + size.width; x += 1) {
      if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
      tiles.push({ x, y });
    }
  }
  return tiles;
}

/**
 * How far a player can reach, in tiles.
 *
 * 1.5 is Stardew's feel: the eight neighbours and the tile underfoot, and
 * nothing across the fence. The diagonal is 1.41 and so is included; two tiles
 * out is 2 and so is not.
 */
export const REACH_TILES = 1.5;

/**
 * Whether a player standing at `from` may act on a tile.
 *
 * Measured tile to tile rather than in pixels, which matters: the tile a
 * player faces is then always exactly one away, so the keyboard path can never
 * be refused by a reach check that its own standing position failed.
 */
export function isWithinReach(from: Point, tileX: number, tileY: number): boolean {
  const dx = tileX - worldToTile(from.x);
  const dy = tileY - worldToTile(from.y);
  return Math.hypot(dx, dy) <= REACH_TILES;
}

/**
 * The largest tile coordinate any area has.
 *
 * This is as much as the protocol can check about a target, since validating
 * off the wire happens before anyone knows which map the sender is standing
 * on. It is a shape check, not a permission: the reducer still asks whether
 * the tile is in *this* area and within *this* player's reach.
 */
export const MAX_AREA_TILES = Math.max(
  floorSize(MAX_DEPTH),
  ...AREA_IDS.map((id) => Math.max(AREAS[id].width, AREAS[id].height)),
);

/**
 * Applies a movement step with per-axis collision, so sliding along a wall
 * still works, and keeps the player inside the area.
 *
 * `speed` is a parameter rather than a constant because an exhausted player
 * walks slower, and the client predicts movement with the very same call the
 * server makes — a local flag would drift the two apart.
 */
export function resolveMove(
  area: AreaId,
  from: Point,
  dx: number,
  dy: number,
  deltaMs: number,
  speed = PLAYER_SPEED,
  blocked: Blockers = NO_BLOCKERS,
): Point {
  const length = Math.hypot(dx, dy);
  if (length === 0) return from;

  const map = areaMap(area);
  const step = (speed * deltaMs) / 1000;
  // Half a tile of margin keeps the sprite from hanging off the edge.
  const margin = TILE_SIZE / 2;
  const nextX = clamp(from.x + (dx / length) * step, margin, map.pixelWidth - margin);
  const nextY = clamp(from.y + (dy / length) * step, margin, map.pixelHeight - margin);

  const resolved = { ...from };
  if (isWalkable(area, nextX, resolved.y, blocked)) resolved.x = nextX;
  if (isWalkable(area, resolved.x, nextY, blocked)) resolved.y = nextY;
  return resolved;
}

export function describeTile(area: AreaId, tileX: number, tileY: number): string {
  if (isMineArea(area)) return 'Đá lạnh và ẩm. Đâu đó dưới sâu có tiếng nước nhỏ giọt.';
  const tile = tileAt(area, tileX, tileY);
  if (!tile) return 'Thế giới kết thúc ở đây.';
  if (tile.kind === 'water') return 'Mặt nước lặng phản chiếu bầu trời. Bình tưới đầy lại mỗi sáng.';
  if (tile.kind === 'plot') return 'Hãy chọn một nông cụ để làm luống đất này.';
  if (tile.kind === 'path' && tile.texture === 'tile-plaza') {
    return 'Vỉa hè lát gạch đỏ, mòn nhẵn ở chỗ xe xôi vẫn đỗ.';
  }
  if (tile.kind === 'path') return 'Con đường mòn nện chặt lượn giữa nông trại và ngôi làng.';
  if (tile.kind === 'floor') return 'Sàn gỗ ấm, kêu cót két dưới chân.';
  if (tile.kind === 'wall') return 'Tường vữa khung gỗ của căn nhà.';
  return 'Cỏ dại đung đưa trong làn gió thung lũng.';
}

/**
 * What a map object is called in Vietnamese.
 *
 * Prop names in the Tiled maps are identifiers — `tree-west`, `cottage-rowan` —
 * and are matched on by prefix rather than listed one by one, so a sixth
 * cottage or a ninth tree needs no edit here. Anything unrecognised falls back
 * to the id with its hyphens opened out, which is ugly but never wrong.
 */
const PROP_LABELS: ReadonlyArray<[prefix: string, label: string]> = [
  ['farmhouse', 'Ngôi nhà nông trại'],
  ['market', 'Sạp chợ'],
  ['blacksmith', 'Lò rèn'],
  ['cottage', 'Căn nhà nhỏ'],
  ['tree', 'Cái cây'],
  ['well', 'Cái giếng'],
  ['ranch', 'Bãi quây gia súc'],
  ['bed', 'Cái giường'],
  ['stove', 'Bếp lò'],
  ['table', 'Bàn ăn'],
  ['chair', 'Cái ghế'],
  ['fireplace', 'Lò sưởi'],
  ['rug', 'Tấm thảm'],
  // Spec 15's street.
  ['shopfront', 'Cửa hàng'],
  ['signpost', 'Biển chỉ đường'],
  ['milestone', 'Cột mốc'],
  ['xoi-cart', 'Xe xôi bà Xoan'],
  ['street-cabinet', 'Tủ kính'],
  ['street-pole', 'Cột điện'],
  ['street-wire', 'Dây điện'],
  ['bench', 'Ghế đá'],
  ['pot', 'Chậu hoa'],
];

export function propLabel(name: string): string {
  const match = PROP_LABELS.find(([prefix]) => name === prefix || name.startsWith(`${prefix}-`));
  return match ? match[1] : name.replace(/-/g, ' ');
}
