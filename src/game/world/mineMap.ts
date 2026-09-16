/**
 * A generated mine floor, as a map the renderer can draw.
 *
 * `areaMap('mine:12')` is deliberately a shell — the size and nothing else —
 * because the walls belong to today's seed and the world module is never
 * handed one. The renderer does have the seed (it reads the whole farm), so
 * this turns a `MineFloor` into the same `AreaMap` shape the Tiled maps are
 * parsed into, and the scene draws it down the very path it draws the farm:
 * `renderTiles`, then `renderProps`.
 *
 * Pure and Phaser-free, like everything else in `world/`. Nothing here is
 * state: it is rebuilt from `floorFor(mineSeed, depth)` whenever a floor is
 * entered.
 */
import { MAX_DEPTH, type MineFloor } from '../systems/mine';
import {
  START_AREA,
  TILE_SIZE,
  areaMap,
  mineArea,
  mineMouth,
  spawnPoints,
  type AreaMap,
  type Point,
  type TileDef,
} from './areas';

/**
 * The three looks a floor can have. Spec 13 wants floor 35 not to look like
 * floor 3; the bands follow the ore table — copper rock, iron rock, gold rock.
 */
export type MineBand = 'shallow' | 'middle' | 'deep';

export const MINE_BANDS: readonly MineBand[] = ['shallow', 'middle', 'deep'];

export function mineBand(depth: number): MineBand {
  if (depth >= 30) return 'deep';
  if (depth >= 10) return 'middle';
  return 'shallow';
}

/** The texture a mine tile of this kind is drawn with, on a floor of this band. */
export function mineTileTexture(kind: 'floor' | 'wall', band: MineBand): string {
  return `mine-${kind}-${band}`;
}

/**
 * Where the elevator stands on a floor that has one: the tile beside the
 * entrance. The carver opens the entrance as a 2x2, so this tile is always
 * floor, and the elevator is always the first thing you see on arrival.
 */
export function elevatorTile(floor: MineFloor): Point | null {
  return floor.hasElevator ? { x: floor.entrance.x + 1, y: floor.entrance.y } : null;
}

/** What standing on a tile of a floor lets the action key do. */
export type MineFixture = 'ladder' | 'exit' | 'elevator';

export function mineFixtureAt(floor: MineFloor, tile: Point): MineFixture | null {
  const same = (point: Point | null) => point !== null && point.x === tile.x && point.y === tile.y;
  if (same(floor.ladder) && floor.depth < MAX_DEPTH) return 'ladder';
  if (same(floor.entrance)) return 'exit';
  if (same(elevatorTile(floor))) return 'elevator';
  return null;
}

function centreOf(tile: Point): Point {
  return { x: tile.x * TILE_SIZE + TILE_SIZE / 2, y: tile.y * TILE_SIZE + TILE_SIZE / 2 };
}

const built = new WeakMap<MineFloor, AreaMap>();

/**
 * The floor as an `AreaMap`.
 *
 * The ladder, the way out and the elevator are both props (so they are drawn)
 * and portals (so they say where they go, `toArea` and all, exactly as a
 * doorway in a Tiled map does). They are not walked through like a doorway:
 * the reducer's own shell has no portals, so going down is always a press of
 * the action key and only ever moves the player who pressed it.
 */
export function mineFloorMap(floor: MineFloor): AreaMap {
  const cached = built.get(floor);
  if (cached) return cached;

  const shell = areaMap(mineArea(floor.depth));
  const band = mineBand(floor.depth);
  const floorTile: TileDef = { texture: mineTileTexture('floor', band), kind: 'floor', solid: false };
  const wallTile: TileDef = { texture: mineTileTexture('wall', band), kind: 'wall', solid: true };

  const tiles: TileDef[] = [];
  for (let y = 0; y < floor.height; y += 1) {
    for (let x = 0; x < floor.width; x += 1) tiles.push(floor.tiles[y][x] === 'floor' ? floorTile : wallTile);
  }

  const fixture = (name: string, texture: string, tile: Point) => ({
    name,
    texture,
    x: tile.x * TILE_SIZE,
    y: tile.y * TILE_SIZE,
    width: TILE_SIZE,
    height: TILE_SIZE,
    solid: false,
    // Flat on the ground, above the tiles and under anybody standing on it.
    depth: 1,
    interact: name,
    sign: null,
    arrow: null,
  });

  const portal = (name: string, tile: Point, toArea: string, to: Point, label: string) => ({
    name,
    x: tile.x * TILE_SIZE,
    y: tile.y * TILE_SIZE,
    width: TILE_SIZE,
    height: TILE_SIZE,
    toArea,
    toX: to.x,
    toY: to.y,
    label,
  });

  const props: AreaMap['props'] = [fixture('exit', 'mine-exit', floor.entrance)];
  const mouth = mineMouth() ?? { area: START_AREA, ...spawnPoints()[0] };
  const portals: AreaMap['portals'] = [portal('exit', floor.entrance, mouth.area, mouth, 'Lối lên')];
  if (floor.ladder && floor.depth < MAX_DEPTH) {
    props.push(fixture('ladder', 'mine-ladder', floor.ladder));
    // Every floor's entrance is the same tile, so where the ladder lands is
    // known without generating the floor below.
    portals.push(
      portal('ladder', floor.ladder, mineArea(floor.depth + 1), centreOf({ x: 1, y: 1 }), `Tầng ${floor.depth + 1}`),
    );
  }
  const elevator = elevatorTile(floor);
  if (elevator) props.push(fixture('elevator', 'mine-elevator', elevator));

  const map: AreaMap = { ...shell, tiles, props, portals };
  built.set(floor, map);
  return map;
}
