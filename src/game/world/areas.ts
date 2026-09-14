import { AREA_IDS, MAP_SOURCES, TILESET, type AreaId } from './maps.generated';
import { parseTiledMap, type AreaMap, type AreaPortal, type AreaProp, type Point, type TileDef } from './tiled';

export type { AreaId };
export type { AreaMap, AreaPortal, AreaProp, Point, TileDef, TileKind } from './tiled';

export const TILE_SIZE = 32;
export const PLAYER_SPEED = 132;

/** How close a player must stand to a prop before acting on it does anything. */
export const INTERACT_RADIUS = 58;

export type Direction = 'up' | 'down' | 'left' | 'right';

/** Where a player starts, and where the farming happens. */
export const START_AREA: AreaId = 'farm';

/**
 * Every area, parsed once at module load.
 *
 * Maps never change at runtime, so they are derived rather than stored in game
 * state: the client and the server build byte-identical worlds from the same
 * generated source, and nothing has to send a map over the wire.
 */
export const AREAS: Record<AreaId, AreaMap> = Object.fromEntries(
  AREA_IDS.map((id) => [id, parseTiledMap(id, MAP_SOURCES[id], TILESET)]),
) as Record<AreaId, AreaMap>;

export function isAreaId(value: unknown): value is AreaId {
  return typeof value === 'string' && (AREA_IDS as readonly string[]).includes(value);
}

export function areaMap(area: AreaId): AreaMap {
  return AREAS[area];
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
  const map = AREAS[area];
  if (tileX < 0 || tileX >= map.width || tileY < 0 || tileY >= map.height) return null;
  return map.tiles[tileY * map.width + tileX];
}

/** Every farmable cell in an area, which is what seeds the plot records. */
export function plotTiles(area: AreaId): Point[] {
  return AREAS[area].plotTiles;
}

/** Player spawn points, taken from the starting area's spawn objects. */
export function spawnPoints(): Point[] {
  const spawns = AREAS[START_AREA].spawns;
  if (spawns.length > 0) return spawns;
  // A map with no spawn objects still has to put players somewhere.
  const map = AREAS[START_AREA];
  return [{ x: map.pixelWidth / 2, y: map.pixelHeight / 2 }];
}

function contains(rect: { x: number; y: number; width: number; height: number }, point: Point): boolean {
  return (
    point.x >= rect.x && point.x < rect.x + rect.width && point.y >= rect.y && point.y < rect.y + rect.height
  );
}

/** Whether a world-pixel position is somewhere a player may stand. */
export function isWalkable(area: AreaId, x: number, y: number): boolean {
  const map = AREAS[area];
  if (x < 0 || y < 0 || x >= map.pixelWidth || y >= map.pixelHeight) return false;

  const tile = tileAt(area, worldToTile(x), worldToTile(y));
  if (!tile || tile.solid) return false;

  for (const prop of map.props) {
    if (prop.solid && contains(prop, { x, y })) return false;
  }
  return true;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
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

  for (const prop of AREAS[area].props) {
    if (!prop.interact) continue;
    const gap = distance(point, propCentre(prop));
    if (gap < bestDistance) {
      best = prop;
      bestDistance = gap;
    }
  }
  return best;
}

/** The portal a player is standing in, if any. */
export function portalAt(area: AreaId, point: Point): AreaPortal | null {
  for (const portal of AREAS[area].portals) {
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
  const map = AREAS[area];
  const offset = FACING_OFFSETS[facing];
  return {
    x: clamp(worldToTile(position.x) + offset.x, 0, map.width - 1),
    y: clamp(worldToTile(position.y) + offset.y, 0, map.height - 1),
  };
}

/**
 * Applies a movement step with per-axis collision, so sliding along a wall
 * still works, and keeps the player inside the area.
 */
export function resolveMove(area: AreaId, from: Point, dx: number, dy: number, deltaMs: number): Point {
  const length = Math.hypot(dx, dy);
  if (length === 0) return from;

  const map = AREAS[area];
  const step = (PLAYER_SPEED * deltaMs) / 1000;
  // Half a tile of margin keeps the sprite from hanging off the edge.
  const margin = TILE_SIZE / 2;
  const nextX = clamp(from.x + (dx / length) * step, margin, map.pixelWidth - margin);
  const nextY = clamp(from.y + (dy / length) * step, margin, map.pixelHeight - margin);

  const resolved = { ...from };
  if (isWalkable(area, nextX, resolved.y)) resolved.x = nextX;
  if (isWalkable(area, resolved.x, nextY)) resolved.y = nextY;
  return resolved;
}

export function describeTile(area: AreaId, tileX: number, tileY: number): string {
  const tile = tileAt(area, tileX, tileY);
  if (!tile) return 'The world ends here.';
  if (tile.kind === 'water') return 'Still water reflects the sky. Watering cans refill each morning.';
  if (tile.kind === 'plot') return 'Choose a farming tool to work this plot.';
  if (tile.kind === 'path') return 'A packed path winds between the farm and the village.';
  return 'Wild grass waves in the valley breeze.';
}
