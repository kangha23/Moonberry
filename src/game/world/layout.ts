import { GAME_HEIGHT, GAME_WIDTH } from '../constants';

export const TILE_SIZE = 32;
export const MAP_WIDTH = GAME_WIDTH / TILE_SIZE;
export const MAP_HEIGHT = GAME_HEIGHT / TILE_SIZE;

export const PLOT_START_X = 9;
export const PLOT_START_Y = 7;
export const PLOT_COLS = 8;
export const PLOT_ROWS = 6;

export const PLAYER_SPEED = 132;

/** Distance in pixels at which a player can talk to Rowan or trade at the market. */
export const INTERACT_RADIUS = 58;

export type TileKind = 'grass' | 'path' | 'water' | 'plot';
export type Direction = 'up' | 'down' | 'left' | 'right';

export interface Point {
  x: number;
  y: number;
}

/** World-pixel positions of fixed landmarks. Shared by rendering and by collision. */
export const LANDMARKS = {
  rowan: { x: 22 * TILE_SIZE, y: 7.2 * TILE_SIZE },
  market: { x: 23.6 * TILE_SIZE, y: 5.8 * TILE_SIZE },
  farmhouse: { x: 4.5 * TILE_SIZE, y: 2.7 * TILE_SIZE },
} as const;

/** Tile rectangle the farmhouse occupies; players cannot walk through it. */
const FARMHOUSE_TILES = { minX: 2, maxX: 7, minY: 1, maxY: 4 };

/** Radius around Rowan that blocks movement, so players cannot stand inside her. */
const ROWAN_BLOCK_RADIUS = 22;

/** Where each of the four players starts, spread so they do not overlap on join. */
export const SPAWN_POINTS: readonly Point[] = [
  { x: 15.5 * TILE_SIZE, y: 15.5 * TILE_SIZE },
  { x: 14.0 * TILE_SIZE, y: 15.5 * TILE_SIZE },
  { x: 15.5 * TILE_SIZE, y: 17.0 * TILE_SIZE },
  { x: 14.0 * TILE_SIZE, y: 17.0 * TILE_SIZE },
];

/** Movement bounds in world pixels, keeping sprites fully on screen. */
export const MOVE_BOUNDS = {
  minX: 12,
  maxX: GAME_WIDTH - 12,
  minY: 18,
  maxY: GAME_HEIGHT - 66,
};

export function plotKey(x: number, y: number): string {
  return `${x},${y}`;
}

export function worldToTile(value: number): number {
  return Math.floor(value / TILE_SIZE);
}

export function isPlotTile(x: number, y: number): boolean {
  return (
    x >= PLOT_START_X && x < PLOT_START_X + PLOT_COLS && y >= PLOT_START_Y && y < PLOT_START_Y + PLOT_ROWS
  );
}

/**
 * Builds the static tile grid. Deterministic and free of Phaser, so the server
 * can build the identical map from the same code.
 */
export function createMap(): TileKind[][] {
  return Array.from({ length: MAP_HEIGHT }, (_, y) =>
    Array.from({ length: MAP_WIDTH }, (_, x): TileKind => {
      if (y >= 17 && x < 9) return 'water';
      if (y === 4 || x === 14 || (x >= 3 && x <= 7 && y >= 4 && y <= 6)) return 'path';
      if (isPlotTile(x, y)) return 'plot';
      return 'grass';
    }),
  );
}

/** Every plot tile on the map, in row-major order. */
export function plotTiles(): Point[] {
  const tiles: Point[] = [];
  for (let y = PLOT_START_Y; y < PLOT_START_Y + PLOT_ROWS; y += 1) {
    for (let x = PLOT_START_X; x < PLOT_START_X + PLOT_COLS; x += 1) {
      tiles.push({ x, y });
    }
  }
  return tiles;
}

function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

/** Whether a world-pixel position is a legal place for a player to stand. */
export function isWalkable(map: TileKind[][], x: number, y: number): boolean {
  const tileX = worldToTile(x);
  const tileY = worldToTile(y);
  if (tileX < 0 || tileX >= MAP_WIDTH || tileY < 0 || tileY >= MAP_HEIGHT) return false;
  if (map[tileY][tileX] === 'water') return false;
  if (
    tileX >= FARMHOUSE_TILES.minX &&
    tileX <= FARMHOUSE_TILES.maxX &&
    tileY >= FARMHOUSE_TILES.minY &&
    tileY <= FARMHOUSE_TILES.maxY
  ) {
    return false;
  }
  if (distance(x, y, LANDMARKS.rowan.x, LANDMARKS.rowan.y) < ROWAN_BLOCK_RADIUS) return false;
  return true;
}

export function isNear(point: Point, landmark: Point, radius = INTERACT_RADIUS): boolean {
  return distance(point.x, point.y, landmark.x, landmark.y) < radius;
}

const FACING_OFFSETS: Record<Direction, Point> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** The tile a player at `position` facing `facing` would act on. */
export function targetTile(position: Point, facing: Direction): Point {
  const offset = FACING_OFFSETS[facing];
  return {
    x: clamp(worldToTile(position.x) + offset.x, 0, MAP_WIDTH - 1),
    y: clamp(worldToTile(position.y) + offset.y, 0, MAP_HEIGHT - 1),
  };
}

/**
 * Applies a movement step with per-axis collision, so sliding along a wall
 * still works. Returns the resolved position.
 */
export function resolveMove(map: TileKind[][], from: Point, dx: number, dy: number, deltaMs: number): Point {
  const length = Math.hypot(dx, dy);
  if (length === 0) return from;

  const step = (PLAYER_SPEED * deltaMs) / 1000;
  const nextX = clamp(from.x + (dx / length) * step, MOVE_BOUNDS.minX, MOVE_BOUNDS.maxX);
  const nextY = clamp(from.y + (dy / length) * step, MOVE_BOUNDS.minY, MOVE_BOUNDS.maxY);

  const resolved = { ...from };
  if (isWalkable(map, nextX, resolved.y)) resolved.x = nextX;
  if (isWalkable(map, resolved.x, nextY)) resolved.y = nextY;
  return resolved;
}

export function describeTile(map: TileKind[][], x: number, y: number): string {
  const tile = map[y][x];
  if (tile === 'water') return 'The pond reflects the sky. Water refills automatically each morning.';
  if (tile === 'plot') return 'Choose a farming tool to work this plot.';
  if (tile === 'path') return 'A packed path leads between the farmhouse, fields, and Rowan.';
  return 'Wild grass waves in the valley breeze.';
}
