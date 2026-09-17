import { emptyInventory, type Inventory } from './inventory';
import {
  artisanOutputFor,
  itemDef,
  type ChestKind,
  type ItemId,
  type MachineKind,
  type PlaceableKind,
  type SprinklerKind,
} from './items';
import type { PlotState } from './farming';
import {
  TILE_SIZE,
  areaMap,
  isMineArea,
  plotKey,
  tileAt,
  type AreaId,
  type Blocker,
  type Point,
} from '../world/areas';

/**
 * Everything standing on a tile because a player put it there.
 *
 * This file exists because of a warning spec 11 gave itself. `Building`,
 * `ResourceNode`, a chest and a machine are all the same shape — an id, a map,
 * a tile, and some state of their own — and they all want the same four
 * questions answered: what is on this tile, what is on this map, can a walker
 * pass through it, and what is the next free id. Spec 06 wrote that code once
 * for buildings and spec 10 wrote it again for nodes. Writing it a third time
 * for chests and a fourth for machines is how a codebase ends up with four
 * slightly different answers to "what is standing here".
 *
 * So the four questions are answered once, here, and the two lists that came
 * before borrow the answers rather than keeping their own copies — see
 * `nextSequentialId` and `tileRect`, which `buildings.ts` and `resources.ts`
 * now call. What did *not* get merged is the three state arrays themselves:
 * a building has a footprint and a build day, a node has health and a tool
 * tier, and folding those into one array would trade four small honest types
 * for one big type with most of its fields null most of the time.
 *
 * The new things share an array, though, and that is the part that matters:
 * chests, machines, sprinklers and fences are **one** list on the farm, not
 * four. Adding a fifth kind is a row in `PLACEABLE_DEFS` and nothing else.
 */
interface PlaceableBase {
  id: string;
  area: AreaId;
  /** Top-left tile. Everything here is one tile; see `placeableTiles`. */
  x: number;
  y: number;
}

/**
 * A box on the ground, and the reason the shed was worth 1200g.
 *
 * `contents` is an ordinary `Inventory` — the very same array-of-slots the
 * satchel is — so `addItem`, `moveStack` and `splitStack` work on it with no
 * argument changed and no special case written. That is spec 03's dividend
 * being collected: a chest is a bigger satchel that does not walk around.
 *
 * On the farm rather than on a player, and that is not an implementation
 * detail. In a world four people share, a private chest is the fastest way to
 * turn one co-operative farm into four farms standing next to each other.
 */
export interface Chest extends PlaceableBase {
  kind: ChestKind;
  contents: Inventory;
}

/** What a machine is chewing on, and the morning it will be done. */
export interface MachineJob {
  input: ItemId;
  output: ItemId;
  readyOnDay: number;
}

/**
 * A thing that takes produce in and gives something dearer back.
 *
 * Measured in days rather than in hours, unlike Stardew's. Every other clock
 * in this game is a day long — crops grow by the day, the blacksmith counts in
 * days, the carpenter counts in days — and one unit everywhere is worth more
 * than the precision an hour would buy. It also means a machine is something
 * you set going and walk away from, rather than something you stand next to.
 */
export interface Machine extends PlaceableBase {
  kind: MachineKind;
  job: MachineJob | null;
}

/** A sprinkler, a fence, a path, a torch: put down, and then just there. */
export interface Fixture extends PlaceableBase {
  kind: SprinklerKind | DecorKind;
}

export type DecorKind =
  | 'torch'
  | 'wood-fence'
  | 'stone-fence'
  | 'hardwood-fence'
  | 'wood-path'
  | 'stone-path'
  | 'gravel-path';

export type Placeable = Chest | Machine | Fixture;

/** Which of the four things a kind is, which decides what acting on it does. */
export type PlaceableFamily = 'chest' | 'machine' | 'sprinkler' | 'decor';

export interface PlaceableDef {
  kind: PlaceableKind;
  family: PlaceableFamily;
  /** Whether a walker is stopped by it. */
  solid: boolean;
  /**
   * Whether the night's growth refuses to put anything on this tile.
   *
   * What a path is *for*. Spec 10 already declines to spawn anything solid on
   * a map's own path tiles; this is the same rule, extended to the paths a
   * player lays themselves, and it is the whole mechanical content of the
   * three path rows — a route you cleared stays cleared.
   */
  clearsGround: boolean;
  /** How many slots, for a chest. */
  slots?: number;
}

/** How many slots each size of chest holds. Both multiples of the grid width. */
export const CHEST_SLOTS: Record<ChestKind, number> = { chest: 36, 'big-chest': 72 };

const DEFS: readonly PlaceableDef[] = [
  { kind: 'chest', family: 'chest', solid: true, clearsGround: true, slots: CHEST_SLOTS.chest },
  {
    kind: 'big-chest',
    family: 'chest',
    solid: true,
    clearsGround: true,
    slots: CHEST_SLOTS['big-chest'],
  },
  { kind: 'keg', family: 'machine', solid: true, clearsGround: true },
  { kind: 'jar', family: 'machine', solid: true, clearsGround: true },
  { kind: 'churn', family: 'machine', solid: true, clearsGround: true },
  { kind: 'kiln', family: 'machine', solid: true, clearsGround: true },
  { kind: 'furnace', family: 'machine', solid: true, clearsGround: true },
  // Walkable on purpose. A sprinkler you cannot step over is a sprinkler that
  // cuts a forty-tile field into eight little paddocks you have to walk round.
  { kind: 'sprinkler', family: 'sprinkler', solid: false, clearsGround: true },
  { kind: 'quality-sprinkler', family: 'sprinkler', solid: false, clearsGround: true },
  { kind: 'torch', family: 'decor', solid: false, clearsGround: true },
  { kind: 'wood-fence', family: 'decor', solid: true, clearsGround: true },
  { kind: 'stone-fence', family: 'decor', solid: true, clearsGround: true },
  { kind: 'hardwood-fence', family: 'decor', solid: true, clearsGround: true },
  { kind: 'wood-path', family: 'decor', solid: false, clearsGround: true },
  { kind: 'stone-path', family: 'decor', solid: false, clearsGround: true },
  { kind: 'gravel-path', family: 'decor', solid: false, clearsGround: true },
];

export const PLACEABLE_DEFS: Record<PlaceableKind, PlaceableDef> = Object.fromEntries(
  DEFS.map((def) => [def.kind, def]),
) as Record<PlaceableKind, PlaceableDef>;

export function placeableDef(kind: PlaceableKind): PlaceableDef {
  return PLACEABLE_DEFS[kind];
}

export function isPlaceableKind(value: unknown): value is PlaceableKind {
  return typeof value === 'string' && Object.hasOwn(PLACEABLE_DEFS, value);
}

export function isChest(placeable: Placeable): placeable is Chest {
  return PLACEABLE_DEFS[placeable.kind].family === 'chest';
}

export function isMachine(placeable: Placeable): placeable is Machine {
  return PLACEABLE_DEFS[placeable.kind].family === 'machine';
}

export function isSprinkler(placeable: Placeable): placeable is Fixture {
  return PLACEABLE_DEFS[placeable.kind].family === 'sprinkler';
}

// --- the four questions, answered once ---------------------------------------

/**
 * The next free id in a series, derived from the ids already in use.
 *
 * Derived rather than drawn, because the reducer is pure: the server and an
 * offline browser have to agree on what the new chest is called without a byte
 * crossing the wire to tell them. Taking the maximum rather than counting the
 * array means it stays right once something starts being removed — which for
 * placeables is on day one, because picking a chest back up is a thing.
 *
 * Shared with `buildings.ts` and `resources.ts`, which used to keep a copy of
 * this each. Three copies of a regular expression is three places to get the
 * off-by-one wrong.
 */
export function nextSequentialId(prefix: string, existing: readonly { id: string }[]): string {
  const pattern = new RegExp(`^${prefix}(\\d+)$`);
  let highest = 0;
  for (const item of existing) {
    const match = pattern.exec(item.id);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `${prefix}${highest + 1}`;
}

/** One tile as a world-pixel rectangle, which is what collision is measured in. */
export function tileRect(x: number, y: number): Blocker {
  return { x: x * TILE_SIZE, y: y * TILE_SIZE, width: TILE_SIZE, height: TILE_SIZE };
}

export function placeablesOn(placeables: readonly Placeable[], area: AreaId): Placeable[] {
  return placeables.filter((placeable) => placeable.area === area);
}

export function placeableAt(
  placeables: readonly Placeable[],
  area: AreaId,
  x: number,
  y: number,
): Placeable | null {
  return (
    placeables.find(
      (placeable) => placeable.area === area && placeable.x === x && placeable.y === y,
    ) ?? null
  );
}

export function placeableById(placeables: readonly Placeable[], id: string): Placeable | null {
  return placeables.find((placeable) => placeable.id === id) ?? null;
}

export function solidPlaceableRects(
  placeables: readonly Placeable[],
  area: AreaId,
): Blocker[] {
  const rects: Blocker[] = [];
  for (const placeable of placeables) {
    if (placeable.area !== area || !PLACEABLE_DEFS[placeable.kind].solid) continue;
    rects.push(tileRect(placeable.x, placeable.y));
  }
  return rects;
}

/** True when something a player put down keeps the night's growth off a tile. */
export function groundIsClaimed(
  placeables: readonly Placeable[],
  area: AreaId,
  x: number,
  y: number,
): boolean {
  const standing = placeableAt(placeables, area, x, y);
  return standing !== null && PLACEABLE_DEFS[standing.kind].clearsGround;
}

export function nextPlaceableId(placeables: readonly Placeable[]): string {
  return nextSequentialId('p', placeables);
}

/** Builds one, with whatever state its family needs and nothing it does not. */
export function createPlaceable(
  id: string,
  kind: PlaceableKind,
  area: AreaId,
  x: number,
  y: number,
): Placeable {
  const def = PLACEABLE_DEFS[kind];
  if (def.family === 'chest') {
    return { id, kind: kind as ChestKind, area, x, y, contents: emptyInventory(def.slots) };
  }
  if (def.family === 'machine') {
    return { id, kind: kind as MachineKind, area, x, y, job: null };
  }
  return { id, kind: kind as SprinklerKind | DecorKind, area, x, y };
}

// --- machines ----------------------------------------------------------------

export interface MachineDef {
  kind: MachineKind;
  label: string;
  /** Mornings from loading to collecting. */
  days: number;
  /** How many of the input one job eats. */
  intake: number;
  /**
   * A machine whose output is a plain material rather than an artisan good:
   * which input becomes which output. The kiln has one row, the furnace three
   * (spec 16). Everything else derives its output from its input through
   * `artisanOutputFor`.
   */
  converts?: Partial<Record<ItemId, ItemId>>;
  /** Consumed alongside `intake` of the input, or absent for a machine that needs none. */
  fuel?: { item: ItemId; count: number };
  /** What to tell somebody who offered it the wrong thing. */
  refusal: string;
}

export const MACHINE_DEFS: Record<MachineKind, MachineDef> = {
  keg: {
    kind: 'keg',
    label: 'Thùng ủ',
    days: 7,
    intake: 1,
    refusal: 'Thùng ủ chỉ nhận nông sản trồng được.',
  },
  jar: {
    kind: 'jar',
    label: 'Lọ ngâm',
    days: 3,
    intake: 1,
    refusal: 'Lọ ngâm chỉ nhận rau quả. Ngũ cốc thì đem ủ, không ngâm được.',
  },
  churn: {
    kind: 'churn',
    label: 'Máy vắt',
    days: 2,
    intake: 1,
    refusal: 'Máy vắt chỉ nhận sữa.',
  },
  kiln: {
    kind: 'kiln',
    label: 'Lò than',
    days: 1,
    intake: 10,
    converts: { wood: 'coal' },
    refusal: 'Lò than cần đúng 10 khúc gỗ.',
  },
  furnace: {
    kind: 'furnace',
    label: 'Lò nấu',
    days: 1,
    intake: 5,
    converts: { 'copper-ore': 'copper-bar', 'iron-ore': 'iron-bar', 'gold-ore': 'gold-bar' },
    fuel: { item: 'coal', count: 1 },
    refusal: 'Lò nấu cần 5 quặng cùng loại và 1 than.',
  },
};

export function machineDef(kind: MachineKind): MachineDef {
  return MACHINE_DEFS[kind];
}

export function isMachineKind(value: unknown): value is MachineKind {
  return typeof value === 'string' && Object.hasOwn(MACHINE_DEFS, value);
}

/** What a machine would turn an input into, or null when it will not take it. */
export function outputFor(kind: MachineKind, input: ItemId): ItemId | null {
  const def = MACHINE_DEFS[kind];
  if (def.converts) return def.converts[input] ?? null;
  return artisanOutputFor(input, kind);
}

export type MachineLoad =
  | { ok: true; job: MachineJob; takes: number; fuel: { item: ItemId; count: number } | null }
  | { ok: false; reason: string };

/**
 * Offers a machine something.
 *
 * Pure and answer-only: it neither takes the item out of the satchel nor
 * writes the job, because the reducer owns both and this has to be the same
 * function the client calls to grey out a button. Every refusal here is one a
 * modified client would otherwise talk its way past.
 */
export function loadMachine(machine: Machine, input: ItemId, day: number): MachineLoad {
  if (machine.job) {
    const def = MACHINE_DEFS[machine.kind];
    return {
      ok: false,
      reason:
        machine.job.readyOnDay <= day
          ? `${def.label} đã xong rồi. Lấy ra đã, rồi mới nạp tiếp.`
          : `${def.label} đang chạy, xong vào ngày ${machine.job.readyOnDay}.`,
    };
  }

  const def = MACHINE_DEFS[machine.kind];
  const output = outputFor(machine.kind, input);
  if (!output) return { ok: false, reason: def.refusal };

  return {
    ok: true,
    takes: def.intake,
    fuel: def.fuel ?? null,
    job: { input, output, readyOnDay: day + def.days },
  };
}

export function machineIsReady(machine: Machine, day: number): boolean {
  return machine.job !== null && machine.job.readyOnDay <= day;
}

/** What comes out, and how many. One, always — the multiplier is in the price. */
export function machineYield(machine: Machine): { item: ItemId; count: number } | null {
  return machine.job ? { item: machine.job.output, count: 1 } : null;
}

/** A sentence for the panel and the prompt: what this machine is doing. */
export function describeMachine(machine: Machine, day: number): string {
  const def = MACHINE_DEFS[machine.kind];
  if (!machine.job) return `${def.label} đang trống.`;
  if (machineIsReady(machine, day)) {
    return `${def.label}: ${itemDef(machine.job.output).label} đã xong.`;
  }
  const left = machine.job.readyOnDay - day;
  return `${def.label}: ${itemDef(machine.job.output).label} sau ${left} ngày nữa.`;
}

// --- sprinklers --------------------------------------------------------------

const ADJACENT: readonly Point[] = [
  { x: 0, y: -1 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
];

const SURROUNDING: readonly Point[] = [
  { x: -1, y: -1 },
  { x: 0, y: -1 },
  { x: 1, y: -1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
  { x: -1, y: 1 },
  { x: 0, y: 1 },
  { x: 1, y: 1 },
];

/**
 * The shape each sprinkler waters.
 *
 * Four tiles and eight, and the gap between them is the whole of why the
 * better one is worth copper. Four is a saving; eight is a forty-tile field
 * covered by five sprinklers instead of ten, which is the difference between
 * making the watering cheaper and deleting it.
 */
export const SPRINKLER_PATTERNS: Record<SprinklerKind, readonly Point[]> = {
  sprinkler: ADJACENT,
  'quality-sprinkler': SURROUNDING,
};

/**
 * Every plot key a sprinkler on this map will water tonight.
 *
 * Exists for the renderer rather than for the rule, and the reason is worth
 * writing down because it looks like a cheat. A sprinkler waters during the
 * night roll-over and `advancePlotDay` spends that water immediately, so
 * `wateredToday` is false again by the time anybody is awake to look at it —
 * which left a field under ten sprinklers looking exactly as parched as a
 * field under none, all day, every day.
 *
 * Drawing those tiles wet is not a lie: they *are* watered, on a schedule
 * nothing can interrupt, and the player has no decision left to make about
 * them. Showing dry soil would be the misleading picture, because dry soil in
 * this game has always meant "go and do something about it".
 */
export function sprinkledPlotKeys(
  placeables: readonly Placeable[],
  area: AreaId,
): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const placeable of placeables) {
    if (placeable.area !== area || !isSprinkler(placeable)) continue;
    for (const tile of sprinklerTiles(placeable)) keys.add(plotKey(tile.area, tile.x, tile.y));
  }
  return keys;
}

/** The tiles one sprinkler reaches, on its own map. */
export function sprinklerTiles(sprinkler: Fixture): Array<{ area: AreaId; x: number; y: number }> {
  const pattern = SPRINKLER_PATTERNS[sprinkler.kind as SprinklerKind] ?? [];
  return pattern.map((offset) => ({
    area: sprinkler.area,
    x: sprinkler.x + offset.x,
    y: sprinkler.y + offset.y,
  }));
}

// --- where a thing may stand -------------------------------------------------

/** How much room a doorway and a spawn point are given, in tiles. */
const KEEP_CLEAR_TILES = 1;

/**
 * Everything the placement rule needs to look at.
 *
 * `occupied` is a callback rather than the two arrays, and that is the one
 * concession this module makes to keeping its imports clean: `resources.ts`
 * imports *this* file for `nextSequentialId`, so this file cannot import it
 * back. The reducer, which has both lists in hand, closes over them.
 */
export interface PlacementWorld {
  plots: Record<string, PlotState>;
  placeables: readonly Placeable[];
  /** True when a building or a resource node already stands on this tile. */
  occupied: (area: AreaId, x: number, y: number) => boolean;
}

export type Placement = { ok: true } | { ok: false; reason: string };

function overlapsTile(rect: Blocker, x: number, y: number): boolean {
  const left = x * TILE_SIZE;
  const top = y * TILE_SIZE;
  return (
    rect.x < left + TILE_SIZE &&
    left < rect.x + rect.width &&
    rect.y < top + TILE_SIZE &&
    top < rect.y + rect.height
  );
}

/**
 * Whether a crafted thing may be put down on a tile.
 *
 * Pure, and exported for the same reason `checkPlacement` in `buildings.ts`
 * is: the client runs it to grey the ghost under the cursor and the server
 * runs the identical function to decide. The client's answer is a courtesy;
 * this is the rule, and every refusal below is one a modified client would
 * otherwise walk straight past.
 *
 * Whether the satchel actually holds one, and whether the player is close
 * enough to reach the tile, are the reducer's questions — neither is a
 * property of the ground.
 */
export function checkSpot(
  area: AreaId,
  x: number,
  y: number,
  kind: PlaceableKind,
  world: PlacementWorld,
): Placement {
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    return { ok: false, reason: 'Đó không phải một chỗ trên bản đồ.' };
  }

  // A mine floor is rebuilt from the seed the moment the last player leaves
  // it (spec 16), and a chest or a sprinkler set down on it would vanish with
  // that rebuild — so it never gets the chance (spec 16's F5 fix).
  if (isMineArea(area)) {
    return { ok: false, reason: 'Không đặt được thứ gì trong mỏ.' };
  }

  const map = areaMap(area);
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) {
    return { ok: false, reason: 'Chỗ đó ở ngoài bản đồ.' };
  }

  const tile = tileAt(area, x, y);
  if (!tile || tile.solid) {
    return {
      ok: false,
      reason: tile?.kind === 'water' ? 'Không đặt được trên mặt nước.' : 'Chỗ đó bị chắn.',
    };
  }

  // Worked ground belongs to whoever worked it, which is the same rule the
  // night's growth follows. Wild soil is fair game; a seeded bed is not.
  const plot = world.plots[plotKey(area, x, y)];
  if (plot && plot.stage !== 'wild') {
    return { ok: false, reason: 'Chỗ đó là luống đã cày. Đặt ra chỗ đất trống đi.' };
  }

  if (world.occupied(area, x, y)) {
    return { ok: false, reason: 'Chỗ đó đã có thứ khác đứng rồi.' };
  }
  if (placeableAt(world.placeables, area, x, y)) {
    return { ok: false, reason: 'Chỗ đó đã có thứ khác đứng rồi.' };
  }

  for (const prop of map.props) {
    if (overlapsTile(prop, x, y)) return { ok: false, reason: 'Chỗ đó đã có thứ khác đứng rồi.' };
  }

  // Only the solid ones have to keep out of doorways. A path laid across a
  // threshold is a path; a fence across one strands whoever walks through it.
  if (!PLACEABLE_DEFS[kind].solid) return { ok: true };

  for (const portal of map.portals) {
    const widened: Blocker = {
      x: portal.x - KEEP_CLEAR_TILES * TILE_SIZE,
      y: portal.y - KEEP_CLEAR_TILES * TILE_SIZE,
      width: portal.width + KEEP_CLEAR_TILES * TILE_SIZE * 2,
      height: portal.height + KEEP_CLEAR_TILES * TILE_SIZE * 2,
    };
    if (overlapsTile(widened, x, y)) {
      return { ok: false, reason: 'Không chắn lối đi được.' };
    }
  }
  for (const spawn of map.spawns) {
    const gap = Math.max(
      Math.abs(spawn.x / TILE_SIZE - 0.5 - x),
      Math.abs(spawn.y / TILE_SIZE - 0.5 - y),
    );
    if (gap <= KEEP_CLEAR_TILES) return { ok: false, reason: 'Không chắn chỗ ra vào được.' };
  }

  return { ok: true };
}

/** Whether something can be picked back up, and why not when it cannot. */
export function checkPickUp(placeable: Placeable): Placement {
  if (isChest(placeable) && placeable.contents.some((slot) => slot !== null)) {
    return { ok: false, reason: 'Dọn hết đồ trong rương ra đã.' };
  }
  if (isMachine(placeable) && placeable.job) {
    return { ok: false, reason: 'Đang có mẻ dở trong đó. Chờ xong rồi lấy ra đã.' };
  }
  return { ok: true };
}
