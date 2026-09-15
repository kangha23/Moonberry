import type { PlotState } from './farming';
import { nextSequentialId } from './placeables';
import {
  START_AREA,
  TILE_SIZE,
  areaMap,
  plotKey,
  propLabel,
  tileAt,
  type AreaId,
  type Blocker,
  type Point,
} from '../world/areas';

/**
 * What stands on the farm because somebody paid for it.
 *
 * Everything in `maps/*.json` is static and identical in every world, so a
 * building cannot be a Tiled prop: it is per-world state, it appears mid-game,
 * and two farms will never have the same ones. It therefore lives in
 * `FarmState` and is drawn on top of the map — with the consequence, stated
 * plainly because it catches people out, that **collision is no longer purely
 * a map property**. `isWalkable` has to be told about these.
 */
export type BuildingKind = 'coop' | 'barn' | 'shed' | 'silo';

export const BUILDING_KINDS: readonly BuildingKind[] = ['shed', 'silo', 'coop', 'barn'];

export interface Building {
  id: string;
  kind: BuildingKind;
  /** Top-left tile on the farm map. */
  x: number;
  y: number;
  /**
   * The day the carpenter finishes, or null once he has.
   *
   * Null is "done", not "not started": a building under construction is
   * counting down to a day, and when that morning arrives the countdown is
   * over and there is nothing left to wait for. `isComplete` is the only
   * place that should have to know which way round that is.
   */
  readyOnDay: number | null;
  /**
   * Whether the door is propped open, for a building that has animals in it.
   *
   * On the building rather than on the animals, because it is the building's
   * door: eight chickens do not each decide, and a herd that is half out and
   * half in is not a state worth being able to reach. The shed and the silo
   * carry the field and ignore it — one dead boolean on two buildings is
   * cheaper than a second collection keyed by building id, and it disappears
   * along with the building rather than outliving it.
   */
  doorOpen: boolean;
}

export interface BuildingDef {
  kind: BuildingKind;
  label: string;
  /** Footprint in tiles. */
  width: number;
  height: number;
  cost: number;
  /** How many mornings until it is finished. */
  days: number;
  blurb: string;
}

/**
 * The catalogue, cheapest first, which is also most-useful-first for this game
 * as it stands.
 *
 * A building nobody needs is a money sink with no gameplay, so the shed leads:
 * it answers a problem a player already has the moment twenty-four slots start
 * to bite. The silo and the two animal houses used to be honest about being
 * ahead of themselves; they are not any more. A coop holds eight birds, a barn
 * six of the larger animals, and the silo holds what all of them eat — which
 * is why the silo is the cheapest of the three and wants building first.
 */
export const BUILDING_DEFS: Record<BuildingKind, BuildingDef> = {
  shed: {
    kind: 'shed',
    label: 'Nhà kho',
    width: 4,
    height: 3,
    cost: 1200,
    days: 2,
    blurb: 'Chỗ để đặt vụ mùa xuống. Thứ đầu tiên đáng dựng.',
  },
  silo: {
    kind: 'silo',
    label: 'Kho cỏ',
    width: 3,
    height: 3,
    cost: 900,
    days: 2,
    blurb: 'Chứa 240 bó cỏ khô. Dựng nó trước khi gia súc về, không phải sau.',
  },
  coop: {
    kind: 'coop',
    label: 'Chuồng gà',
    width: 6,
    height: 3,
    cost: 3400,
    days: 3,
    blurb: 'Ấm, thấp và đầy rơm. Chỗ cho tám con gà hoặc vịt.',
  },
  barn: {
    kind: 'barn',
    label: 'Chuồng lớn',
    width: 7,
    height: 4,
    cost: 5600,
    days: 4,
    blurb: 'Cái to nhất. Đủ chỗ cho sáu con bò hoặc dê.',
  },
};

export function buildingDef(kind: BuildingKind): BuildingDef {
  return BUILDING_DEFS[kind];
}

export function isBuildingKind(value: unknown): value is BuildingKind {
  return typeof value === 'string' && Object.hasOwn(BUILDING_DEFS, value);
}

/**
 * Where buildings may stand, which is the farm and only the farm.
 *
 * Not a field on `Building`, because a building somewhere else is not a thing
 * this game has: the village belongs to the village. Making it a constant
 * means every check asks the same question rather than four of them each
 * deciding what "on the farm" means.
 */
export const BUILDING_AREA: AreaId = START_AREA;

/** The footprint in world pixels, which is what collision and drawing want. */
export function buildingBounds(building: { kind: BuildingKind; x: number; y: number }): Blocker {
  const def = BUILDING_DEFS[building.kind];
  return {
    x: building.x * TILE_SIZE,
    y: building.y * TILE_SIZE,
    width: def.width * TILE_SIZE,
    height: def.height * TILE_SIZE,
  };
}

/** Every tile a building covers, row-major. */
export function buildingTiles(building: { kind: BuildingKind; x: number; y: number }): Point[] {
  const def = BUILDING_DEFS[building.kind];
  const tiles: Point[] = [];
  for (let dy = 0; dy < def.height; dy += 1) {
    for (let dx = 0; dx < def.width; dx += 1) tiles.push({ x: building.x + dx, y: building.y + dy });
  }
  return tiles;
}

/** True once the carpenter has finished; false while it is still a scaffold. */
export function isComplete(building: Building): boolean {
  return building.readyOnDay === null;
}

function covers(building: Building, tileX: number, tileY: number): boolean {
  const def = BUILDING_DEFS[building.kind];
  return (
    tileX >= building.x &&
    tileX < building.x + def.width &&
    tileY >= building.y &&
    tileY < building.y + def.height
  );
}

/** The building standing on a tile, if any. Scaffolds count: they are solid too. */
export function buildingAt(
  buildings: readonly Building[],
  tileX: number,
  tileY: number,
): Building | null {
  return buildings.find((building) => covers(building, tileX, tileY)) ?? null;
}

/**
 * The rectangles a walker cannot pass through.
 *
 * A scaffold blocks exactly as a finished building does — a half-built barn
 * is a building site, and walking through one because the roof is not on yet
 * is the kind of thing that only looks deliberate until somebody tries it.
 */
export function solidRects(buildings: readonly Building[]): Blocker[] {
  return buildings.map(buildingBounds);
}

/**
 * The buildings standing on an area.
 *
 * Every caller that needs collision goes through this rather than reaching for
 * the array, so the "only on the farm" rule is stated once. The empty array is
 * shared so a caller comparing by identity — the store does — is not handed a
 * fresh object every frame.
 */
const NO_BUILDINGS: readonly Building[] = [];

export function buildingsOn(buildings: readonly Building[], area: AreaId): readonly Building[] {
  return area === BUILDING_AREA ? buildings : NO_BUILDINGS;
}

/**
 * The next free id, derived from the ids already in use.
 *
 * Derived rather than random because the reducer is pure and has to produce
 * the same world on the server and in an offline browser given the same
 * intents. The counting itself lives in `placeables.ts` now: this was the
 * first of three identical copies of it, and spec 11 was about to write a
 * fourth.
 */
export function nextBuildingId(buildings: readonly Building[]): string {
  return nextSequentialId('b', buildings);
}

export type Placement = { ok: true } | { ok: false; reason: string };

/**
 * Whether a building may stand here.
 *
 * Pure, and deliberately so: the client runs it to grey out the footprint
 * under the cursor, and the server runs the identical function to decide. A
 * client-side check is a convenience, never the rule — every refusal below is
 * one a modified client would otherwise be able to talk its way past.
 *
 * The wallet is not checked here. It belongs to the farm rather than to the
 * map, and the reducer holds it.
 */
export function checkPlacement(
  area: AreaId,
  buildings: readonly Building[],
  plots: Record<string, PlotState>,
  kind: BuildingKind,
  x: number,
  y: number,
): Placement {
  if (area !== BUILDING_AREA) {
    return { ok: false, reason: `Nhà cửa chỉ dựng được trên nông trại, không phải ở ${areaMap(area).name}.` };
  }
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    return { ok: false, reason: 'Đó không phải một chỗ trên bản đồ.' };
  }

  const def = BUILDING_DEFS[kind];
  const map = areaMap(BUILDING_AREA);
  if (x < 0 || y < 0 || x + def.width > map.width || y + def.height > map.height) {
    return { ok: false, reason: `${def.label} sẽ thò ra khỏi rìa nông trại.` };
  }

  for (const tile of buildingTiles({ kind, x, y })) {
    const ground = tileAt(BUILDING_AREA, tile.x, tile.y);
    if (!ground || ground.solid) {
      return {
        ok: false,
        reason:
          ground?.kind === 'water'
            ? 'Không thể xây trên mặt ao.'
            : 'Có thứ gì đó chắn ngang chỗ đó.',
      };
    }

    const plot = plots[plotKey(BUILDING_AREA, tile.x, tile.y)];
    if (plot?.crop) {
      return { ok: false, reason: 'Chỗ đó đang có cây trồng. Thu hoạch đi đã.' };
    }

    if (buildingAt(buildings, tile.x, tile.y)) {
      return { ok: false, reason: 'Chỗ đó đã có công trình rồi.' };
    }
  }

  // Props are rectangles in world pixels, so the overlap is measured there
  // rather than tile by tile: a prop is not obliged to sit on the grid.
  const bounds = buildingBounds({ kind, x, y });
  for (const prop of map.props) {
    if (!overlaps(bounds, prop)) continue;
    return { ok: false, reason: `${propLabel(prop.name)} đang chắn chỗ đó.` };
  }

  return { ok: true };
}

function overlaps(a: Blocker, b: Blocker): boolean {
  return (
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
  );
}
