import {
  BUILDING_AREA,
  buildingDef,
  isComplete,
  solidRects,
  type Building,
  type BuildingKind,
} from './buildings';
import { addItem, type Inventory } from './inventory';
import { gradedIdFor, type ItemId, type ProduceGrade } from './items';
import { solidPlaceableRects, type Placeable } from './placeables';
import { solidNodeRects, type ResourceNode } from './resources';
import { isRainy, type TimeState, type Weather } from './time';
import { TILE_SIZE, isNear, isWalkable, worldToTile, type AreaId, type Point } from '../world/areas';

/**
 * The four things that live on the farm.
 *
 * A union rather than a string, for the same reason `CropId` is one: a typo in
 * the table below should be a compile error rather than an animal that can be
 * bought and then never fed.
 */
export type AnimalKind = 'chicken' | 'duck' | 'cow' | 'goat';

/**
 * One animal.
 *
 * It belongs to the **farm**, not to a player, and that is the line this whole
 * file is drawn along. A cow eats grass on shared ground and anybody can milk
 * it, which makes it the opposite of `relationships` in spec 07: a friendship
 * is between two people, so it lives on the player; a cow is a thing the farm
 * owns, so it lives here.
 */
export interface Animal {
  id: string;
  kind: AnimalKind;
  /** What the player called it when they bought it. Display only; carries no rule. */
  name: string;
  /** The building it belongs to, by `Building['id']`. */
  home: string;
  /** The day it arrived, so its age can be told without storing one. */
  bornOnDay: number;
  /**
   * 0–1000. Decides what grade it gives, and whether it gives anything at all.
   * A number on the farm, not on a player — see the note on the interface.
   */
  affection: number;
  /** Petted today already. Cleared every morning. */
  pettedToday: boolean;
  /** Fed today. Decides whether there is anything to collect tomorrow. */
  fedToday: boolean;
  /**
   * Whether it got outside today.
   *
   * Not in the spec's sketch, and it has to be: the outdoor bonus is paid once
   * a day at the roll-over, and by then it is the middle of the night and
   * everybody is indoors. Something has to remember that the afternoon
   * happened.
   */
  outsideToday: boolean;
  /** The earliest day it has something to collect. */
  produceOnDay: number;
  /** Where it is standing out of doors. Null means it is inside its house. */
  position: Point | null;
}

export interface AnimalDef {
  kind: AnimalKind;
  label: string;
  /** Which house it lives in. */
  house: BuildingKind;
  price: number;
  /** Days between one collection and the next. */
  cycleDays: number;
  /** The ordinary grade of what it gives; better grades are suffixes on this. */
  produce: ItemId;
  /** What the act of collecting is called, which is not the same verb for eggs and milk. */
  collectVerb: string;
  blurb: string;
}

/**
 * The catalogue, cheapest first.
 *
 * Priced so that each one pays for itself in roughly a season and then keeps
 * paying: a chicken is 800g against 55g a day, a goat 5000g against 250g every
 * other day. Deliberately slower than a field of cranberries, because the
 * point of the herd is not that it earns more — it is that it earns in winter,
 * when the fields earn nothing and there would otherwise be no reason to get
 * up.
 */
export const ANIMAL_DEFS: Record<AnimalKind, AnimalDef> = {
  chicken: {
    kind: 'chicken',
    label: 'Gà',
    house: 'coop',
    price: 800,
    cycleDays: 1,
    produce: 'egg',
    collectVerb: 'nhặt',
    blurb: 'Mỗi ngày một quả trứng, quanh năm. Con vật đầu tiên đáng mua.',
  },
  duck: {
    kind: 'duck',
    label: 'Vịt',
    house: 'coop',
    price: 1600,
    cycleDays: 2,
    produce: 'duck-egg',
    collectVerb: 'nhặt',
    blurb: 'Hai ngày một quả, nhưng quả nào cũng đáng gấp đôi trứng gà.',
  },
  cow: {
    kind: 'cow',
    label: 'Bò',
    house: 'barn',
    price: 2400,
    cycleDays: 1,
    produce: 'milk',
    collectVerb: 'vắt sữa',
    blurb: 'Vắt mỗi sáng. Thứ gần nhất với một khoản lương trên nông trại này.',
  },
  goat: {
    kind: 'goat',
    label: 'Dê',
    house: 'barn',
    price: 5000,
    cycleDays: 2,
    produce: 'goat-milk',
    collectVerb: 'vắt sữa',
    blurb: 'Đắt, bướng, và cho thứ sữa đắt nhất thung lũng.',
  },
};

export const ANIMAL_KINDS: readonly AnimalKind[] = ['chicken', 'duck', 'cow', 'goat'];

export function isAnimalKind(value: unknown): value is AnimalKind {
  return typeof value === 'string' && Object.hasOwn(ANIMAL_DEFS, value);
}

/** How many each house holds. The barn's animals are bigger, so it holds fewer. */
export const HOUSE_CAPACITY: Partial<Record<BuildingKind, number>> = { coop: 8, barn: 6 };

/** Whether a building is somewhere an animal could live at all. */
export function isAnimalHouse(kind: BuildingKind): boolean {
  return HOUSE_CAPACITY[kind] !== undefined;
}

export function capacityOf(kind: BuildingKind): number {
  return HOUSE_CAPACITY[kind] ?? 0;
}

/** The animals living in one building. */
export function animalsIn(animals: readonly Animal[], buildingId: string): Animal[] {
  return animals.filter((animal) => animal.home === buildingId);
}

export function animalById(animals: readonly Animal[], id: string): Animal | null {
  return animals.find((animal) => animal.id === id) ?? null;
}

// --- affection ---------------------------------------------------------------

export const MAX_AFFECTION = 1000;

/**
 * What a bought animal starts on: the bottom of the ordinary band.
 *
 * Not zero, and that is a departure worth naming. Zero would mean a new
 * chicken gives nothing at all for the fortnight it takes to pet it up to 200,
 * which reads as a broken purchase rather than as a relationship to build.
 * Starting at the ordinary threshold says the opposite and the right thing:
 * an animal gives ordinary produce from day one, care makes it better, and
 * neglect can still take it below the line.
 */
export const STARTING_AFFECTION = 200;

/** One stroke, once a day. The cheapest thing on the farm and the best value. */
export const PET_AFFECTION = 15;

/** A day spent out of doors. Paid at the roll-over, for the day just finished. */
export const OUTDOORS_AFFECTION = 8;

/**
 * What going hungry costs.
 *
 * A loss, never a death. An animal that starves would punish the player who
 * took a week off — and in a shared world, the person who pays is usually not
 * the person who was away.
 */
export const HUNGRY_AFFECTION = 20;

/** Where each grade starts. Below the first, nothing is produced at all. */
const GRADE_THRESHOLDS: ReadonlyArray<{ from: number; grade: ProduceGrade }> = [
  { from: 850, grade: 'fine' },
  { from: 600, grade: 'good' },
  { from: 200, grade: 'normal' },
];

/** The lowest affection that produces anything. */
export const MIN_PRODUCE_AFFECTION = 200;

/** What this animal's produce would come out as, or null for an animal too unhappy to give any. */
export function gradeFor(affection: number): ProduceGrade | null {
  return GRADE_THRESHOLDS.find((band) => affection >= band.from)?.grade ?? null;
}

function clampAffection(value: number): number {
  return Math.max(0, Math.min(MAX_AFFECTION, value));
}

/** Hearts, as the row of them a panel draws. Ten, like a villager's. */
export function heartsFor(affection: number): number {
  return Math.floor((affection / MAX_AFFECTION) * 10);
}

// --- hay ---------------------------------------------------------------------

/**
 * Why hay is a number on the farm rather than a stack in a satchel.
 *
 * Because feeding ten cows would otherwise be ten trips into the inventory
 * screen, and because a permanent stack of grass would sit in one of
 * twenty-four slots forever. The silo is a number; feeding subtracts from it.
 */
export const SILO_CAPACITY = 240;

/** What one animal eats in a day. */
export const HAY_PER_FEED = 1;

/** What the rancher charges for a bale. */
export const HAY_PRICE = 20;

/** The most that can be bought in one go, matching the stall's own limit. */
export const MAX_HAY_PURCHASE = 240;

/**
 * How much hay the farm can keep.
 *
 * No silo, no capacity — which means no hay, which means the herd goes hungry.
 * That is the intended reading and it is why the silo is priced at 900g and
 * why its blurb has always said to put it up before the livestock arrive.
 */
export function hayCapacity(buildings: readonly Building[]): number {
  return buildings.filter((building) => building.kind === 'silo' && isComplete(building)).length * SILO_CAPACITY;
}

// --- houses ------------------------------------------------------------------

/**
 * The next free id, derived rather than drawn.
 *
 * The reducer is pure and has to produce the same herd on the server and in an
 * offline browser given the same intents, so this counts what is there instead
 * of reaching for a random number. Taking the maximum rather than the length
 * matters here in a way it does not for buildings: animals can be sold.
 */
export function nextAnimalId(animals: readonly Animal[]): string {
  let highest = 0;
  for (const animal of animals) {
    const match = /^a(\d+)$/.exec(animal.id);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `a${highest + 1}`;
}

export type Purchase = { ok: true } | { ok: false; reason: string };

/** The longest a name may be, so a panel row stays a row. */
export const MAX_ANIMAL_NAME = 24;

function isValidAnimalName(name: unknown): name is string {
  return typeof name === 'string' && name.trim().length > 0 && name.length <= MAX_ANIMAL_NAME;
}

/**
 * Whether this animal may move into this building.
 *
 * Pure, and run twice on purpose: the panel greys out the rows that would fail
 * so a click is not wasted, and the reducer asks the identical question because
 * the panel's answer is a courtesy and never the rule. The wallet is not asked
 * about here — it belongs to the farm, and the reducer holds it.
 */
export function checkPurchase(
  animals: readonly Animal[],
  buildings: readonly Building[],
  kind: AnimalKind,
  home: string,
  name: unknown,
): Purchase {
  const def = ANIMAL_DEFS[kind];
  if (!isValidAnimalName(name)) {
    return { ok: false, reason: 'Đặt cho nó một cái tên trước đã.' };
  }

  const building = buildings.find((candidate) => candidate.id === home);
  if (!building) return { ok: false, reason: 'Nông trại không có cái chuồng đó.' };
  if (!isComplete(building)) {
    return { ok: false, reason: `${buildingDef(building.kind).label} chưa dựng xong.` };
  }
  if (building.kind !== def.house) {
    return {
      ok: false,
      reason: `${def.label} không ở ${buildingDef(building.kind).label.toLowerCase()} được.`,
    };
  }

  const capacity = capacityOf(building.kind);
  if (animalsIn(animals, home).length >= capacity) {
    return { ok: false, reason: `${buildingDef(building.kind).label} đã đủ ${capacity} con rồi.` };
  }
  return { ok: true };
}

/** A brand new animal, delivered fed so its first night is not counted as neglect. */
export function createAnimal(
  animals: readonly Animal[],
  kind: AnimalKind,
  home: string,
  name: string,
  day: number,
): Animal {
  return {
    id: nextAnimalId(animals),
    kind,
    name: name.trim(),
    home,
    bornOnDay: day,
    affection: STARTING_AFFECTION,
    pettedToday: false,
    // The rancher does not hand over a hungry animal, and the morning roll
    // reads this field to decide whether last night was neglect.
    fedToday: true,
    outsideToday: false,
    produceOnDay: day + ANIMAL_DEFS[kind].cycleDays,
    position: null,
  };
}

/** Half of what it cost. Harsh, and the only way out of a coop full of ducks. */
export function resalePrice(kind: AnimalKind): number {
  return Math.floor(ANIMAL_DEFS[kind].price / 2);
}

// --- the day's four chores ---------------------------------------------------

/** Whether there is something to collect from this animal today. */
export function hasProduce(animal: Animal, day: number): boolean {
  return day >= animal.produceOnDay && animal.affection >= MIN_PRODUCE_AFFECTION;
}

export type ChoreResult =
  | { ok: false; reason: string }
  | { ok: true; animal: Animal; message: string };

/** A stroke. Once a day, and the second one is refused rather than ignored. */
export function petAnimal(animal: Animal): ChoreResult {
  if (animal.pettedToday) {
    return { ok: false, reason: `Hôm nay bạn đã vuốt ${animal.name} rồi.` };
  }
  return {
    ok: true,
    animal: {
      ...animal,
      pettedToday: true,
      affection: clampAffection(animal.affection + PET_AFFECTION),
    },
    message: `${animal.name} rúc vào tay bạn.`,
  };
}

export interface CollectResult {
  animal: Animal;
  inventory: Inventory;
  item: ItemId;
  grade: ProduceGrade;
}

/**
 * Collecting, or the reason there is nothing to collect.
 *
 * The clock is moved on the animal before anything reaches the satchel, which
 * is what makes two players racing for the same egg safe: the second one finds
 * `produceOnDay` already in the future and is told there is nothing there.
 */
export function collectProduce(
  animal: Animal,
  inventory: Inventory,
  day: number,
): { ok: false; reason: string } | ({ ok: true } & CollectResult) {
  if (animal.affection < MIN_PRODUCE_AFFECTION) {
    return { ok: false, reason: `${animal.name} chưa đủ tin bạn để cho gì cả.` };
  }
  if (day < animal.produceOnDay) {
    const days = animal.produceOnDay - day;
    return { ok: false, reason: `${animal.name} chưa có gì. Quay lại sau ${days} ngày.` };
  }

  const grade = gradeFor(animal.affection);
  const item = grade ? gradedIdFor(ANIMAL_DEFS[animal.kind].produce, grade) : null;
  if (!grade || !item) return { ok: false, reason: `${animal.name} chưa có gì cho bạn.` };

  const next = addItem(inventory, item, 1);
  if (!next) return { ok: false, reason: 'Túi của bạn không còn chỗ.' };

  return {
    ok: true,
    animal: { ...animal, produceOnDay: day + ANIMAL_DEFS[animal.kind].cycleDays },
    inventory: next,
    item,
    grade,
  };
}

export type FeedResult =
  | { ok: false; reason: string }
  | { ok: true; animal: Animal; hay: number; message: string };

/** A handful of hay, by hand. Only ever needed when the morning found the silo empty. */
export function feedAnimal(animal: Animal, hay: number): FeedResult {
  if (animal.fedToday) return { ok: false, reason: `${animal.name} đã ăn hôm nay rồi.` };
  if (hay < HAY_PER_FEED) return { ok: false, reason: 'Kho cỏ đã cạn.' };
  return {
    ok: true,
    animal: { ...animal, fedToday: true },
    hay: hay - HAY_PER_FEED,
    message: `${animal.name} vùi mặt vào máng.`,
  };
}

// --- the morning -------------------------------------------------------------

export interface AnimalDayResult {
  animals: Animal[];
  hay: number;
  /** How many went to bed hungry last night, for the morning summary. */
  hungry: number;
}

/**
 * The herd, rolled over to a new morning.
 *
 * Four things in one pass, in this order, and the order is the rule: last
 * night's neglect is settled before today's feed is handed out, so a farm that
 * ran out of hay yesterday still pays for it this morning even if somebody
 * bought a bale overnight.
 *
 * Petting is deliberately *not* here, though the spec sketch put it here. The
 * fifteen points land the moment the animal is stroked, because that is the
 * moment the player is looking at it — house style is that a feeling is shown
 * rather than settled up in a ledger overnight.
 */
export function startAnimalDay(
  animals: readonly Animal[],
  hay: number,
  day: number,
): AnimalDayResult {
  let left = hay;
  let hungry = 0;

  const next = animals.map((animal) => {
    let affection = animal.affection;
    let produceOnDay = animal.produceOnDay;

    if (!animal.fedToday) {
      hungry += 1;
      affection -= HUNGRY_AFFECTION;
      // No breakfast, no egg. Pushed rather than cleared, so an animal on a
      // two-day cycle does not have its whole cycle reset by one lean night.
      produceOnDay = Math.max(produceOnDay, day + 1);
    }
    if (animal.outsideToday) affection += OUTDOORS_AFFECTION;

    const fedToday = left >= HAY_PER_FEED;
    if (fedToday) left -= HAY_PER_FEED;

    return {
      ...animal,
      affection: clampAffection(affection),
      produceOnDay,
      pettedToday: false,
      outsideToday: false,
      fedToday,
      // Everybody wakes up indoors, exactly as the villagers wake up at their
      // own front doors: an animal left standing in a field overnight is a
      // simulation artefact, not a thing that happened.
      position: null,
    };
  });

  return { animals: next, hay: left, hungry };
}

// --- wandering ---------------------------------------------------------------

/** When the door lets them out, and when they take themselves back in. */
export const OUT_FROM_HOUR = 8;
export const IN_AT_HOUR = 18;

/**
 * How long an animal keeps ambling toward the same spot before choosing another.
 *
 * Five clock steps, or six real seconds: long enough to arrive and stand there
 * grazing for a moment, short enough that a field of them never looks frozen.
 */
export const WANDER_PERIOD_MINUTES = 10;

/** How far from its own door an animal will get, in tiles. */
export const WANDER_RADIUS_TILES = 4;

/**
 * World pixels per in-game minute. Half a villager's pace: they are grazing,
 * and an animal that crosses the field in a minute reads as a dog. Sixty
 * pixels a two-minute clock step, which is what `view/tickChase.ts` expects.
 */
export const ANIMAL_SPEED_PER_MINUTE = 30;

/**
 * The patch of ground an animal calls its own: the row of tiles below its
 * house, which is the side the door is on.
 */
export function housePoint(building: Building): Point {
  const def = buildingDef(building.kind);
  return {
    x: (building.x + def.width / 2) * TILE_SIZE,
    y: (building.y + def.height) * TILE_SIZE + TILE_SIZE / 2,
  };
}

/**
 * A deterministic 32-bit hash of a string. FNV-1a, which is short enough to
 * read and good enough to keep two animals from choosing the same tile.
 */
function hashId(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Where this animal is ambling toward.
 *
 * Seeded from its id and the half-hour it is in, so it is a pure function of
 * state: two clients simulating the same farm draw the same herd standing in
 * the same places without a single byte crossing the wire to say so. The
 * reducer is not allowed `Math.random()` and this is why that rule is cheap to
 * keep rather than expensive.
 *
 * `home` is a parameter rather than something read off the animal, because an
 * `Animal` carries the id of its house and not its coordinates — and the
 * building can be looked up once by the caller rather than once per animal.
 */
export function wanderTarget(animal: Animal, home: Point, totalMinutes: number): Point {
  const slot = Math.floor(totalMinutes / WANDER_PERIOD_MINUTES);
  const seed = hashId(`${animal.id}:${slot}`);
  // Two independent draws out of one hash: the low half and the high half.
  const spread = WANDER_RADIUS_TILES * 2 + 1;
  const dx = ((seed & 0xffff) % spread) - WANDER_RADIUS_TILES;
  const dy = (((seed >>> 16) & 0xffff) % spread) - WANDER_RADIUS_TILES;
  return { x: home.x + dx * TILE_SIZE, y: home.y + dy * TILE_SIZE };
}

/** The hour the day is actually on, counting past midnight rather than wrapping. */
function dayHour(time: TimeState): number {
  return Math.floor(time.totalMinutes / 60);
}

/**
 * Whether the herd of one house should be out of doors right now.
 *
 * Three conditions and no others: the roof is on, somebody opened the door,
 * and it is a dry daytime. Rain sends them in on its own, which is why a wet
 * day costs the whole herd its outdoor bonus without anything having to say so.
 */
function isOutdoorTime(building: Building | null, weather: Weather, time: TimeState): boolean {
  if (!building || !isComplete(building) || !building.doorOpen) return false;
  if (isRainy(weather)) return false;
  const hour = dayHour(time);
  return hour >= OUT_FROM_HOUR && hour < IN_AT_HOUR;
}

/**
 * Walks the herd a little way.
 *
 * Called from `world/tick` alongside the villagers and for the same reasons:
 * ten in-game minutes of grazing is a short hop, the renderer smooths between
 * the hops, and fourteen animals never reach the wire on a frame. Returns the
 * same array when nothing moved, so the store and the scene can compare by
 * identity rather than diff a herd.
 */
export function advanceAnimals(
  animals: readonly Animal[],
  buildings: readonly Building[],
  nodes: readonly ResourceNode[],
  placeables: readonly Placeable[],
  weather: Weather,
  time: TimeState,
  minutes: number,
): Animal[] {
  if (animals.length === 0) return animals as Animal[];

  const houses = new Map(buildings.map((building) => [building.id, building]));
  // A cow cannot walk through a tree any more than through a barn, or through
  // the fence somebody built to keep it out of the crops. Handed as one
  // `Blockers` rather than three lists, which is the whole reason that type
  // exists — see the note on it in `areas.ts`.
  const blocked = {
    buildings: solidRects(buildings),
    nodes: solidNodeRects(nodes, BUILDING_AREA),
    // And a fence, which is half of what a player builds one for.
    placeables: solidPlaceableRects(placeables, BUILDING_AREA),
  };
  const step = ANIMAL_SPEED_PER_MINUTE * minutes;
  let changed = false;

  const next = animals.map((animal) => {
    const home = houses.get(animal.home) ?? null;

    if (!isOutdoorTime(home, weather, time)) {
      if (animal.position === null) return animal;
      changed = true;
      return { ...animal, position: null };
    }

    const origin = housePoint(home!);
    // Straight out of the door and no further, on the first tick of the day.
    if (animal.position === null) {
      changed = true;
      return { ...animal, position: origin, outsideToday: true };
    }

    const here = animal.position;
    const target = wanderTarget(animal, origin, time.totalMinutes);
    const dx = target.x - here.x;
    const dy = target.y - here.y;
    const distance = Math.hypot(dx, dy);
    const wanted =
      distance <= step
        ? target
        : { x: here.x + (dx / distance) * step, y: here.y + (dy / distance) * step };

    // Water, fences and the farm's own buildings. An animal that wandered into
    // the pond would be a long-running joke rather than a bug report, and it
    // is one check to prevent. A blocked step simply stands still: the next
    // half-hour draws somewhere else to head for.
    const position = isWalkable(BUILDING_AREA, wanted.x, wanted.y, blocked) ? wanted : here;
    if (position === here && animal.outsideToday) return animal;
    changed = true;
    return { ...animal, position, outsideToday: true };
  });

  return changed ? next : (animals as Animal[]);
}

/** Stood in for a map with no herd on it, so a caller comparing by identity is safe. */
const NO_ANIMALS: Animal[] = [];

/** The animals standing on one map, which is all the renderer ever wants. */
export function animalsOn(animals: readonly Animal[], area: AreaId): Animal[] {
  if (area !== BUILDING_AREA) return NO_ANIMALS;
  return animals.filter((animal) => animal.position !== null);
}

/**
 * The animal a player is standing beside, if any.
 *
 * Proximity rather than the exact tile, and the same radius a villager is
 * greeted from — because an animal is a thing that walks, and the tile it
 * happens to be standing on is not something a player can aim at while it
 * ambles. This is the rule the prompt bar promises and the rule the reducer
 * keeps; they have to be the same function or the hint is a lie.
 */
export function nearestAnimal(animals: readonly Animal[], point: Point): Animal | null {
  let best: { animal: Animal; gap: number } | null = null;
  for (const animal of animals) {
    if (!animal.position || !isNear(point, animal.position)) continue;
    const gap = Math.hypot(animal.position.x - point.x, animal.position.y - point.y);
    if (!best || gap < best.gap) best = { animal, gap };
  }
  return best?.animal ?? null;
}

/** The animal standing on a tile, if any. Indoor animals are on no tile at all. */
export function animalAtTile(animals: readonly Animal[], tileX: number, tileY: number): Animal | null {
  return (
    animals.find(
      (animal) =>
        animal.position !== null &&
        worldToTile(animal.position.x) === tileX &&
        worldToTile(animal.position.y) === tileY,
    ) ?? null
  );
}
