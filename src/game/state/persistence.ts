import {
  MAX_AFFECTION,
  MAX_ANIMAL_NAME,
  hayCapacity,
  isAnimalKind,
  type Animal,
} from '../systems/animals';
import {
  BUILDING_AREA,
  BUILDING_DEFS,
  isBuildingKind,
  type Building,
} from '../systems/buildings';
import type { PlotStage, PlotState } from '../systems/farming';
import {
  HOTBAR_SIZE,
  INVENTORY_SIZE,
  addItem,
  emptyInventory,
  newStack,
  type Inventory,
  type ItemStack,
} from '../systems/inventory';
import { isNpcId, type NpcId } from '../npcs/definitions';
import { STARTING_RECIPES, isRecipeId } from '../systems/crafting';
import {
  CHEST_SLOTS,
  isPlaceableKind,
  placeableDef,
  type Fixture,
  type MachineJob,
  type Placeable,
} from '../systems/placeables';
import {
  healthOf,
  isNodeKind,
  TREE_MATURE_STAGE,
  type ResourceNode,
} from '../systems/resources';
import type { Relationship, Relationships } from '../npcs/relationships';
import { spawnNpcs, type NpcActor } from '../npcs/schedule';
import {
  CROP_ORDER,
  ITEMS,
  STARTING_TOOLS,
  TOOL_TIERS,
  isItemId,
  type ChestKind,
  type CropId,
  type ItemId,
  type MachineKind,
} from '../systems/items';
import { SEASONS, type Weather } from '../systems/time';
import { areaMap, isAreaId } from '../world/areas';
import type { Direction } from '../world/areas';
import { STARTING_MAX_ENERGY, type FarmState, type PlayerState } from './types';

/**
 * Bumped whenever the shape of FarmState changes in a way an older save
 * cannot satisfy. `migrate` is where upgrades from earlier versions go.
 */
export const SAVE_VERSION = 10;

export const SAVE_KEY = 'moonberry:farm';

export interface SaveEnvelope {
  version: number;
  savedAt: string;
  farm: FarmState;
}

/**
 * Where a save lives. localStorage today; the server will supply a database
 * adapter with the same three methods and nothing else needs to change.
 */
export interface SaveStorage {
  read(key: string): string | null;
  write(key: string, value: string): void;
  remove(key: string): void;
}

/**
 * localStorage. It can throw on every method (private windows, blocked site
 * data, exceeded quota); the public helpers below absorb that, so adapters
 * are free to be written in the obvious way.
 */
export const localSaveStorage: SaveStorage = {
  read: (key) => globalThis.localStorage?.getItem(key) ?? null,
  write: (key, value) => globalThis.localStorage?.setItem(key, value),
  remove: (key) => globalThis.localStorage?.removeItem(key),
};

// --- validation -------------------------------------------------------------
//
// A save is untrusted input: anyone can edit localStorage by hand, and a save
// written by an older build may be missing fields. Every value is checked
// before it becomes game state, and anything unexpected discards the whole
// save rather than booting a half-valid farm.

const PLOT_STAGES: readonly PlotStage[] = ['wild', 'tilled', 'seeded', 'sprout', 'mature'];
/**
 * Read off the catalogue rather than listed again.
 *
 * A second copy of this list is the bug where adding a crop ships fine and
 * then refuses every save that has one in the ground.
 */
const CROP_IDS: readonly CropId[] = CROP_ORDER;
const WEATHERS: readonly Weather[] = ['Sunny', 'Drizzle', 'Breezy', 'Firefly Shower'];
const DIRECTIONS: readonly Direction[] = ['up', 'down', 'left', 'right'];

type Unknown = Record<string, unknown>;

function isObject(value: unknown): value is Unknown {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isCount(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

function parseStack(value: unknown): ItemStack | null {
  if (!isObject(value)) return null;
  // An item id this build has never heard of would draw nothing and price at
  // nothing, so the save is refused rather than quietly holding a ghost.
  if (!isItemId(value.item)) return null;
  const def = ITEMS[value.item];
  if (!Number.isInteger(value.count) || (value.count as number) < 1) return null;
  if ((value.count as number) > def.stackSize) return null;

  const stack: ItemStack = { item: value.item, count: value.count as number };
  if (def.charges === undefined) {
    // A stack carrying charges its item cannot hold is a hand-edited save.
    if (value.charges !== undefined) return null;
    return stack;
  }
  if (!Number.isInteger(value.charges) || (value.charges as number) < 0) return null;
  if ((value.charges as number) > def.charges) return null;
  return { ...stack, charges: value.charges as number };
}

function parseInventory(value: unknown): Inventory | null {
  if (!Array.isArray(value) || value.length !== INVENTORY_SIZE) return null;
  const inventory: Inventory = [];
  for (const raw of value) {
    if (raw === null) {
      inventory.push(null);
      continue;
    }
    const stack = parseStack(raw);
    if (!stack) return null;
    inventory.push(stack);
  }
  return inventory;
}

function parsePlot(value: unknown): PlotState | null {
  if (!isObject(value)) return null;
  if (!isFiniteNumber(value.x) || !isFiniteNumber(value.y)) return null;
  if (!oneOf(value.stage, PLOT_STAGES)) return null;
  if (value.crop !== null && !oneOf(value.crop, CROP_IDS)) return null;
  if (!isCount(value.daysWatered) || typeof value.wateredToday !== 'boolean') return null;
  return {
    x: value.x,
    y: value.y,
    stage: value.stage,
    crop: value.crop as CropId | null,
    daysWatered: value.daysWatered,
    wateredToday: value.wateredToday,
  };
}

/**
 * A tool left with the blacksmith.
 *
 * Checked against the item table rather than merely typed as a string: a save
 * naming a tool this build has never heard of would hand out a ghost item on
 * the day it came back, which is far worse than refusing the save.
 */
function parsePendingUpgrade(value: unknown): PlayerState['pendingUpgrade'] | null | 'invalid' {
  if (value === null || value === undefined) return null;
  if (!isObject(value)) return 'invalid';
  if (!isItemId(value.item) || !ITEMS[value.item].tool) return 'invalid';
  if (!Number.isInteger(value.readyOnDay) || (value.readyOnDay as number) < 1) return 'invalid';
  return { item: value.item, readyOnDay: value.readyOnDay as number };
}

/**
 * One building, whole.
 *
 * A footprint off the map would put a solid rectangle somewhere nobody can
 * walk round, so the bounds are checked here rather than trusted — this is
 * state a hand-edited save can move anywhere it likes.
 */
function parseBuilding(value: unknown): Building | null {
  if (!isObject(value)) return null;
  if (typeof value.id !== 'string' || value.id === '') return null;
  if (!isBuildingKind(value.kind)) return null;
  if (!Number.isInteger(value.x) || !Number.isInteger(value.y)) return null;

  const def = BUILDING_DEFS[value.kind];
  const map = areaMap(BUILDING_AREA);
  const x = value.x as number;
  const y = value.y as number;
  if (x < 0 || y < 0 || x + def.width > map.width || y + def.height > map.height) return null;

  // Absent is shut, which is what every save written before there were animals
  // means. Anything other than a boolean is a hand-edited save and refuses.
  if (value.doorOpen !== undefined && typeof value.doorOpen !== 'boolean') return null;
  const doorOpen = value.doorOpen === true;

  if (value.readyOnDay === null) {
    return { id: value.id, kind: value.kind, x, y, readyOnDay: null, doorOpen };
  }
  if (!Number.isInteger(value.readyOnDay) || (value.readyOnDay as number) < 1) return null;
  return { id: value.id, kind: value.kind, x, y, readyOnDay: value.readyOnDay as number, doorOpen };
}

/**
 * One animal, whole.
 *
 * Refused rather than repaired, unlike the villagers below: an animal is not
 * derived state. Nothing could rebuild a cow somebody paid 2400g for, and a
 * half-valid one — an affection off the scale, a home that is not a building —
 * would misbehave every morning rather than once.
 *
 * `home` is checked against the ids the save actually carries, because an
 * animal living in a building that is not there has nowhere to be fed from and
 * no door to come out of.
 */
function parseAnimal(value: unknown, buildingIds: ReadonlySet<string>): Animal | null {
  if (!isObject(value)) return null;
  if (typeof value.id !== 'string' || value.id === '') return null;
  if (!isAnimalKind(value.kind)) return null;
  if (typeof value.name !== 'string' || value.name === '' || value.name.length > MAX_ANIMAL_NAME) {
    return null;
  }
  if (typeof value.home !== 'string' || !buildingIds.has(value.home)) return null;
  if (!Number.isInteger(value.bornOnDay) || (value.bornOnDay as number) < 1) return null;
  if (!Number.isInteger(value.produceOnDay) || (value.produceOnDay as number) < 1) return null;
  if (typeof value.pettedToday !== 'boolean') return null;
  if (typeof value.fedToday !== 'boolean') return null;
  if (typeof value.outsideToday !== 'boolean') return null;
  if (!isFiniteNumber(value.affection)) return null;

  const position = parseAnimalPosition(value.position);
  if (position === 'invalid') return null;

  return {
    id: value.id,
    kind: value.kind,
    name: value.name,
    home: value.home,
    bornOnDay: value.bornOnDay as number,
    // Clamped rather than refused, for the same reason a friendship's points
    // are: the range is a balance decision that may well move, and a save
    // written before it moved is not corrupt.
    affection: Math.max(0, Math.min(MAX_AFFECTION, value.affection)),
    pettedToday: value.pettedToday,
    fedToday: value.fedToday,
    outsideToday: value.outsideToday,
    produceOnDay: value.produceOnDay as number,
    position,
  };
}

function parseAnimalPosition(value: unknown): Animal['position'] | 'invalid' {
  if (value === null || value === undefined) return null;
  if (!isObject(value)) return 'invalid';
  if (!isFiniteNumber(value.x) || !isFiniteNumber(value.y)) return 'invalid';
  return { x: value.x, y: value.y };
}

function parseAnimals(value: unknown, buildings: readonly Building[]): Animal[] | null {
  // Absent is an empty herd, which is every save written before spec 09.
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) return null;

  const ids = new Set(buildings.map((building) => building.id));
  const animals: Animal[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    const animal = parseAnimal(raw, ids);
    // Two animals sharing an id would make `nextAnimalId` hand out a third
    // copy of it, so a duplicate discards the save rather than the row.
    if (!animal || seen.has(animal.id)) return null;
    seen.add(animal.id);
    animals.push(animal);
  }
  return animals;
}

function parseBuildings(value: unknown): Building[] | null {
  if (!Array.isArray(value)) return null;
  const buildings: Building[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    const building = parseBuilding(raw);
    // Two buildings sharing an id would make `nextBuildingId` hand out a
    // third copy of it, so a duplicate discards the save rather than the row.
    if (!building || seen.has(building.id)) return null;
    seen.add(building.id);
    buildings.push(building);
  }
  return buildings;
}

/**
 * One node, whole.
 *
 * Refused rather than repaired, like the animals and unlike the villagers: a
 * node is not derived state. A boulder somewhere nobody can walk round, or a
 * tree with forty points of health, is a farm that misbehaves every time
 * somebody walks past it rather than once.
 *
 * `health` is clamped rather than refused, for the same reason a friendship's
 * points are: how many swings a tree takes is a balance decision that may well
 * move, and a save written before it moved is not corrupt.
 */
function parseNode(value: unknown): ResourceNode | null {
  if (!isObject(value)) return null;
  if (typeof value.id !== 'string' || value.id === '') return null;
  if (!isNodeKind(value.kind)) return null;
  // A map this build no longer has would put a tree somewhere nobody can
  // reach, and its collision rectangle somewhere nothing can see.
  if (!isAreaId(value.area)) return null;
  if (!Number.isInteger(value.x) || !Number.isInteger(value.y)) return null;

  const map = areaMap(value.area);
  const x = value.x as number;
  const y = value.y as number;
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return null;

  if (!oneOf(value.requires, TOOL_TIERS)) return null;

  // A tree carries a stage and nothing else does. Both halves are checked,
  // because a rock with a stage is a hand-edited save and a tree without one
  // would break every draw that reads it.
  let stage: number | null = null;
  if (value.kind === 'tree') {
    if (!Number.isInteger(value.stage)) return null;
    stage = Math.max(0, Math.min(TREE_MATURE_STAGE, value.stage as number));
  } else if (value.stage !== null && value.stage !== undefined) {
    return null;
  }

  // The same, for what a piece of forage is. An id this build has never heard
  // of would be picked up and then priced at nothing.
  let item: ItemId | null = null;
  if (value.kind === 'forage') {
    if (!isItemId(value.item)) return null;
    item = value.item;
  } else if (value.item !== null && value.item !== undefined) {
    return null;
  }

  if (!Number.isInteger(value.health)) return null;
  const health = Math.max(1, Math.min(healthOf(value.kind, stage), value.health as number));

  return { id: value.id, kind: value.kind, area: value.area, x, y, health, requires: value.requires, stage, item };
}

function parseNodes(value: unknown): ResourceNode[] | null {
  // Absent is bare ground, which is every save written before spec 10.
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) return null;

  const nodes: ResourceNode[] = [];
  const seen = new Set<string>();
  const tiles = new Set<string>();
  for (const raw of value) {
    const node = parseNode(raw);
    if (!node || seen.has(node.id)) return null;
    // Two nodes on one tile is a state nothing can produce and nothing can
    // draw: `nodeAt` would hand out whichever came first and the other would
    // be a solid rectangle with no sprite over it.
    const tile = `${node.area}:${node.x},${node.y}`;
    if (tiles.has(tile)) return null;
    seen.add(node.id);
    tiles.add(tile);
    nodes.push(node);
  }
  return nodes;
}

/**
 * One slot of a chest, which is the one place in this file where a bad row is
 * dropped rather than refusing the save.
 *
 * Everything else here is all-or-nothing: a malformed building or a malformed
 * animal discards the whole farm, because a half-valid one misbehaves every
 * morning rather than once. A chest slot is different, and spec 11 says so in
 * as many words — losing one stack is lighter than losing the farm. Four full
 * chests are 144 slots of JSON, by a distance the largest thing in the file
 * and so the likeliest to be truncated by a storage quota or scrambled by a
 * hand edit, and answering that with "your world is gone" would be a bad
 * trade for the player every single time.
 *
 * So: a slot that does not parse becomes an empty slot, and the other 143
 * survive.
 */
function parseChestSlot(value: unknown): ItemStack | null {
  if (value === null || value === undefined) return null;
  return parseStack(value);
}

function parseChestContents(value: unknown, slots: number): Inventory {
  if (!Array.isArray(value)) return emptyInventory(slots);
  const contents = emptyInventory(slots);
  for (let i = 0; i < Math.min(value.length, slots); i += 1) {
    contents[i] = parseChestSlot(value[i]);
  }
  return contents;
}

function parseMachineJob(value: unknown): MachineJob | null | 'invalid' {
  if (value === null || value === undefined) return null;
  if (!isObject(value)) return 'invalid';
  // Both ids are checked against this build's table: a job naming an item that
  // no longer exists would hand out a ghost on the morning it finished.
  if (!isItemId(value.input) || !isItemId(value.output)) return 'invalid';
  if (!Number.isInteger(value.readyOnDay) || (value.readyOnDay as number) < 1) return 'invalid';
  return { input: value.input, output: value.output, readyOnDay: value.readyOnDay as number };
}

/**
 * One placeable, whole.
 *
 * Refused rather than repaired, like the buildings and the nodes: a chest
 * standing off the edge of a map is a solid rectangle nobody can reach and
 * nothing can draw. The contents are the exception, and only the contents —
 * see `parseChestSlot`.
 */
function parsePlaceable(value: unknown): Placeable | null {
  if (!isObject(value)) return null;
  if (typeof value.id !== 'string' || value.id === '') return null;
  if (!isPlaceableKind(value.kind)) return null;
  if (!isAreaId(value.area)) return null;
  if (!Number.isInteger(value.x) || !Number.isInteger(value.y)) return null;

  const map = areaMap(value.area);
  const x = value.x as number;
  const y = value.y as number;
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return null;

  const def = placeableDef(value.kind);
  if (def.family === 'chest') {
    return {
      id: value.id,
      kind: value.kind as ChestKind,
      area: value.area,
      x,
      y,
      contents: parseChestContents(value.contents, def.slots ?? CHEST_SLOTS.chest),
    };
  }

  if (def.family === 'machine') {
    const job = parseMachineJob(value.job);
    if (job === 'invalid') return null;
    return { id: value.id, kind: value.kind as MachineKind, area: value.area, x, y, job };
  }

  return { id: value.id, kind: value.kind as Fixture['kind'], area: value.area, x, y };
}

function parsePlaceables(value: unknown): Placeable[] | null {
  // Absent is bare ground, which is every save written before spec 11.
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) return null;

  const placeables: Placeable[] = [];
  const seen = new Set<string>();
  const tiles = new Set<string>();
  for (const raw of value) {
    const placeable = parsePlaceable(raw);
    if (!placeable || seen.has(placeable.id)) return null;
    // Two things on one tile is a state nothing can produce and nothing can
    // draw: `placeableAt` would hand out whichever came first and the other
    // would be a solid rectangle with no sprite over it.
    const tile = `${placeable.area}:${placeable.x},${placeable.y}`;
    if (tiles.has(tile)) return null;
    seen.add(placeable.id);
    tiles.add(tile);
    placeables.push(placeable);
  }
  return placeables;
}

/**
 * The recipes a player has learned.
 *
 * Repaired rather than refused, unlike almost everything else here, and for
 * the reason the villagers are: this is the one field in the save whose
 * contents are a *catalogue* that is expected to change between builds. A
 * recipe that has since been renamed or dropped should cost the player that
 * recipe, not their farm. Unknown ids are discarded, duplicates collapsed, and
 * the unconditional ones are always present — a returning player who somehow
 * lost `chest` from their list would otherwise be unable to make the first
 * thing in the game.
 */
function parseKnownRecipes(value: unknown): ItemId[] | 'invalid' {
  if (value === undefined || value === null) return [...STARTING_RECIPES];
  if (!Array.isArray(value)) return 'invalid';
  const known = new Set<ItemId>(STARTING_RECIPES);
  for (const raw of value) {
    if (typeof raw !== 'string') return 'invalid';
    if (isRecipeId(raw)) known.add(raw);
  }
  return [...known];
}

/**
 * One friendship.
 *
 * Points are clamped rather than refused: the range is a balance decision that
 * may well move, and a save written before it moved is not corrupt. Everything
 * structural — a villager this build has never heard of, a gift count that is
 * not a number — refuses, because that is a save that would misbehave rather
 * than merely disagree.
 */
function parseRelationship(value: unknown): Relationship | null {
  if (!isObject(value)) return null;
  if (!isFiniteNumber(value.points)) return null;
  if (!isCount(value.giftsThisWeek)) return null;
  if (typeof value.giftedToday !== 'boolean') return null;
  return {
    points: value.points,
    giftsThisWeek: value.giftsThisWeek,
    giftedToday: value.giftedToday,
  };
}

function parseRelationships(value: unknown): Relationships | 'invalid' {
  // Absent is the normal case for anyone who has met nobody, and for every
  // save written before there was anybody to meet.
  if (value === null || value === undefined) return {};
  if (!isObject(value)) return 'invalid';

  const relationships: Relationships = {};
  for (const [id, raw] of Object.entries(value)) {
    // A villager who has been renamed or removed takes their history with
    // them rather than discarding the save: the farm is still perfectly
    // playable, and refusing it would cost somebody a world over a rename.
    if (!isNpcId(id)) continue;
    const relationship = parseRelationship(raw);
    if (!relationship) return 'invalid';
    relationships[id as NpcId] = relationship;
  }
  return relationships;
}

/**
 * Where the villagers are standing.
 *
 * Derived state, strictly — the schedule and the clock would reproduce all of
 * it — so anything that does not parse is rebuilt from the schedule rather
 * than refused. A save is not worth discarding over Maeve's coordinates.
 */
function parseNpcs(value: unknown, farm: { season: FarmState['season']; weather: Weather; time: FarmState['time'] }): NpcActor[] {
  if (!Array.isArray(value)) return spawnNpcs(farm.season, farm.weather, farm.time);

  const actors: NpcActor[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!isObject(raw)) continue;
    if (!isNpcId(raw.id) || seen.has(raw.id)) continue;
    if (!isAreaId(raw.area)) continue;
    if (!isFiniteNumber(raw.x) || !isFiniteNumber(raw.y)) continue;
    if (!Number.isInteger(raw.entry)) continue;
    seen.add(raw.id);
    actors.push({ id: raw.id, area: raw.area, x: raw.x, y: raw.y, entry: raw.entry as number });
  }

  // A villager added since the save was written has never been anywhere, so
  // they start their day where the schedule says rather than not existing.
  const fresh = spawnNpcs(farm.season, farm.weather, farm.time);
  for (const actor of fresh) if (!seen.has(actor.id)) actors.push(actor);
  return actors;
}

function parsePlayer(value: unknown): PlayerState | null {
  if (!isObject(value)) return null;
  if (typeof value.id !== 'string' || typeof value.name !== 'string') return null;
  if (!isFiniteNumber(value.x) || !isFiniteNumber(value.y)) return null;
  if (!oneOf(value.facing, DIRECTIONS)) return null;
  // An area that no longer exists would strand the player on a missing map,
  // so a save naming one is discarded rather than silently relocated.
  if (!isAreaId(value.area)) return null;
  if (typeof value.asleep !== 'boolean') return null;
  if (typeof value.online !== 'boolean') return null;
  const pendingUpgrade = parsePendingUpgrade(value.pendingUpgrade);
  if (pendingUpgrade === 'invalid') return null;
  if (!isCount(value.energy) || !isCount(value.maxEnergy)) return null;
  // The selected slot indexes an array every frame, so it is checked against
  // the hotbar rather than merely confirmed to be a number.
  if (!Number.isInteger(value.selectedSlot)) return null;
  if ((value.selectedSlot as number) < 0 || (value.selectedSlot as number) >= HOTBAR_SIZE) return null;
  const inventory = parseInventory(value.inventory);
  if (!inventory) return null;
  const relationships = parseRelationships(value.relationships);
  if (relationships === 'invalid') return null;
  const knownRecipes = parseKnownRecipes(value.knownRecipes);
  if (knownRecipes === 'invalid') return null;
  return {
    id: value.id,
    name: value.name,
    area: value.area,
    x: value.x,
    y: value.y,
    facing: value.facing,
    inventory,
    selectedSlot: value.selectedSlot as number,
    energy: value.energy,
    maxEnergy: value.maxEnergy,
    asleep: value.asleep,
    // Nowhere in particular, so certainly not at a counter. A restored save
    // that opened the stall for you would be a panel over a farm you have not
    // walked across yet. The tool at the blacksmith does survive: two days is
    // two days whether or not anybody was logged in for them.
    panel: null,
    // Which takes the chest with it: a restored save that opened a lid for you
    // would be a panel over a farm you have not walked across yet.
    openChest: null,
    // And never mid-cast. Spec 12 is explicit, and the reason is worth
    // keeping next to the code: a restored cast would come back holding a
    // bite window that closed before the process was restarted, so the first
    // thing a returning player would see is a fish they had already lost.
    // The energy was spent when it was spent; the line is simply not there.
    fishing: null,
    knownRecipes,
    pendingUpgrade,
    relationships,
    // Nobody is connected to a world that has just been read off a disk.
    online: false,
  };
}

function parseTime(value: unknown): FarmState['time'] | null {
  if (!isObject(value)) return null;
  const { day, hour, minute, totalMinutes } = value;
  if (!isCount(day) || !isCount(hour) || !isCount(minute) || !isCount(totalMinutes)) return null;
  return { day, hour, minute, totalMinutes };
}

function parseQuest(value: unknown): FarmState['quest'] | null {
  if (!isObject(value)) return null;
  if (value.id !== 'first-harvest') return null;
  if (typeof value.title !== 'string' || typeof value.description !== 'string') return null;
  if (!oneOf(value.targetCrop, CROP_IDS)) return null;
  if (!isCount(value.target) || !isCount(value.progress)) return null;
  if (typeof value.completed !== 'boolean' || typeof value.rewarded !== 'boolean') return null;
  return {
    id: 'first-harvest',
    title: value.title,
    description: value.description,
    targetCrop: value.targetCrop,
    target: value.target,
    progress: value.progress,
    completed: value.completed,
    rewarded: value.rewarded,
  };
}

function parseFarm(value: unknown): FarmState | null {
  if (!isObject(value)) return null;
  if (!isCount(value.revision) || !isCount(value.coins) || !isCount(value.clockMs)) return null;
  if (!oneOf(value.season, SEASONS) || !oneOf(value.weather, WEATHERS)) return null;

  const time = parseTime(value.time);
  const quest = parseQuest(value.quest);
  if (!time || !quest) return null;

  if (!isObject(value.plots) || !isObject(value.players)) return null;

  const buildings = parseBuildings(value.buildings);
  if (!buildings) return null;

  const animals = parseAnimals(value.animals, buildings);
  if (!animals) return null;

  const nodes = parseNodes(value.nodes);
  if (!nodes) return null;

  const placeables = parsePlaceables(value.placeables);
  if (!placeables) return null;
  // The seed decides every morning from here on, so a save that lost it would
  // be a farm whose nights stopped matching the one it was saved from. Absent
  // is the constant `migrateNodes` writes, never a fresh draw.
  if (value.spawnSeed !== undefined && !isCount(value.spawnSeed)) return null;
  const spawnSeed = (value.spawnSeed as number | undefined) ?? LEGACY_SPAWN_SEED;
  // Absent is none, and a silo the save no longer has would let a hand-edited
  // farm carry more hay than it can store — so it is clamped to what the
  // buildings above actually justify rather than believed.
  if (value.hay !== undefined && !isCount(value.hay)) return null;
  const hay = Math.min(value.hay ?? 0, hayCapacity(buildings));

  const plots: Record<string, PlotState> = {};
  for (const [key, raw] of Object.entries(value.plots)) {
    const plot = parsePlot(raw);
    if (!plot) return null;
    plots[key] = plot;
  }

  const players: Record<string, PlayerState> = {};
  for (const [key, raw] of Object.entries(value.players)) {
    const player = parsePlayer(raw);
    if (!player || player.id !== key) return null;
    players[key] = player;
  }

  return {
    revision: value.revision,
    time,
    season: value.season,
    weather: value.weather,
    plots,
    coins: value.coins,
    buildings,
    nodes,
    placeables,
    spawnSeed,
    npcs: parseNpcs(value.npcs, { season: value.season, weather: value.weather, time }),
    animals,
    hay,
    quest,
    players,
    clockMs: value.clockMs,
  };
}

/**
 * Upgrades a save written by an older build to the shape this one expects.
 *
 * It works on the raw JSON rather than a parsed farm, so `parseFarm` runs once
 * afterwards over the upgraded shape: an old save is still validated in full,
 * and the validator never has to know which versions used to be legal.
 * Returns null for a version this build cannot make sense of, including a
 * newer one written by a future build.
 */
function migrate(version: number, farm: unknown): unknown {
  if (!Number.isInteger(version) || version < 1 || version > SAVE_VERSION) return null;

  // Applied in order and each one at most once, so a version-1 save takes the
  // same path a version-1 save took when version 2 was current, and then the
  // next step on top. Nobody has to write a 1-to-N upgrade per new version.
  let current = farm;
  if (version <= 1) current = migrateEnergy(current);
  if (version <= 2) current = migrateInventory(current);
  if (version <= 3) current = migrateSeasons(current);
  if (version <= 4) current = migrateBuildings(current);
  if (version <= 5) current = migrateVillagers(current);
  if (version <= 6) current = migrateAnimals(current);
  if (version <= 7) current = migrateNodes(current);
  if (version <= 8) current = migratePlaceables(current);
  if (version <= 9) current = migrateFishing(current);
  return current;
}

/** Runs `upgrade` over every player, or gives up on the whole save. */
function upgradePlayers(farm: unknown, upgrade: (player: Unknown) => Unknown | null): unknown {
  if (!isObject(farm) || !isObject(farm.players)) return null;

  const players: Record<string, unknown> = {};
  for (const [id, player] of Object.entries(farm.players)) {
    if (!isObject(player)) return null;
    const next = upgrade(player);
    if (!next) return null;
    players[id] = next;
  }
  return { ...farm, players };
}

/**
 * Version 1 knew nothing about energy. Restoring a farm should not cost the
 * player a day, so everyone wakes up rested.
 */
function migrateEnergy(farm: unknown): unknown {
  return upgradePlayers(farm, (player) => ({
    ...player,
    energy: STARTING_MAX_ENERGY,
    maxEnergy: STARTING_MAX_ENERGY,
  }));
}

/**
 * Version 3 had no seasons worth the name and no market panel.
 *
 * Nothing in the ground needs touching: every version-3 crop was a turnip or a
 * strawberry, both of which are spring crops now, so a restored farm either is
 * in spring and keeps them or is not and loses them at the next boundary like
 * any other. The only new field is the closed shop panel.
 */
function migrateSeasons(farm: unknown): unknown {
  return upgradePlayers(farm, (player) => ({ ...player, shopOpen: false }));
}

/**
 * Version 4 had no blacksmith and nothing built on the farm.
 *
 * An empty farm and empty hands: nobody who saved under version 4 had a tool
 * in for work or a scaffold up, so there is nothing to reconstruct — only
 * fields to default. The old `shopOpen` boolean becomes the `panel` field and
 * is dropped, so an upgraded save is a version-5 save rather than a hybrid.
 */
function migrateBuildings(farm: unknown): unknown {
  const withPlayers = upgradePlayers(farm, (player) => {
    const upgraded: Unknown = { ...player, panel: null, pendingUpgrade: null };
    delete upgraded.shopOpen;
    return upgraded;
  });
  if (!isObject(withPlayers)) return null;
  return { ...withPlayers, buildings: [] };
}

/**
 * Version 5 had a village with one person standing in it who never moved.
 *
 * Nothing to reconstruct and nothing to lose: nobody could have a friendship
 * with anybody, so every player starts on nought hearts with everyone, which
 * is the correct reading of a returning farmhand who has never met a soul.
 * The villagers themselves are left absent on purpose — `parseNpcs` builds
 * them from the schedule, so the migration does not have to know where five
 * people stand at six in the morning.
 */
function migrateVillagers(farm: unknown): unknown {
  return upgradePlayers(farm, (player) => ({ ...player, relationships: {} }));
}

/**
 * Version 6 had two animal houses with nothing in them.
 *
 * Nothing to reconstruct: nobody could own an animal, so the herd starts
 * empty and the silo starts empty with it. The doors are the only thing that
 * has to be written, and they are written shut — `parseBuilding` would default
 * them anyway, and saying so here means an upgraded save is a version-7 save
 * rather than a shape that only works because a parser is forgiving.
 */
function migrateAnimals(farm: unknown): unknown {
  if (!isObject(farm)) return null;
  const buildings = Array.isArray(farm.buildings)
    ? farm.buildings.map((building) => (isObject(building) ? { ...building, doorOpen: false } : building))
    : farm.buildings;
  return { ...farm, buildings, animals: [], hay: 0 };
}

/**
 * The seed every farm written before spec 10 is given.
 *
 * A constant, and emphatically not a fresh draw: the seed decides what grows
 * every night from here on, and two clients restoring the same save have to
 * agree about tomorrow morning. It is the same constant `createFarmState`
 * uses, which is the point — an upgraded farm and a new one see the same
 * nights, so there is one behaviour to reason about rather than two.
 */
const LEGACY_SPAWN_SEED = 0x6d6f6f6e;

/**
 * Version 7 had a farm with nothing standing on it.
 *
 * Bare ground, on purpose, and this is the one migration where doing the
 * obvious thing would be actively destructive. `seedNodes` scatters rocks,
 * brambles and stumps across every open tile of the farm — run against a
 * returning player's world it would drop boulders into the middle of a field
 * they have spent a season clearing, and a rock on a plot is a plot they
 * cannot plant. So an upgraded farm starts clear and fills in from the edges:
 * grass spreads, weeds come up, saplings take, and within a fortnight it looks
 * like everybody else's. The trees they never had in the wood are still there
 * to find, because the wood is a new map and nobody has cleared it.
 */
function migrateNodes(farm: unknown): unknown {
  if (!isObject(farm)) return null;
  return { ...farm, nodes: [], spawnSeed: LEGACY_SPAWN_SEED };
}

/**
 * Version 8 had a farm with nothing put down on it and nobody who knew a
 * recipe.
 *
 * The cheapest migration in the file, and it is worth saying why rather than
 * leaving it to look lazy. Everything spec 11 adds is opt-in: a returning
 * player has no chests because they never built one, and no machines because
 * they never crafted one. The one thing they must not be missing is the
 * unconditional recipes — a farm that could not make the first chest in the
 * game would be a farm this upgrade had broken — so those are written in, and
 * `parseKnownRecipes` puts them back even for a save that names none.
 *
 * `placeables` is left absent rather than written as `[]`, because the parser
 * already reads absent as bare ground and one of those two is a line of code.
 */
function migratePlaceables(farm: unknown): unknown {
  return upgradePlayers(farm, (player) => ({ ...player, knownRecipes: [...STARTING_RECIPES] }));
}

/**
 * Version 9 had thirty water tiles that did nothing but block the way.
 *
 * The emptiest migration in the file, and it is written out rather than
 * skipped for two reasons. The first is that `PlayerState` genuinely gained a
 * field, and a save format that changes shape gets a version whether or not
 * the upgrade has work to do — the alternative is a parser quietly forgiving
 * two shapes for ever. The second is that `null` here is not a default, it is
 * the rule: a cast never survives a reload, so a version-9 save and a
 * version-10 save written mid-cast both come back with an empty line, and
 * `parsePlayer` writes the same null over the top either way.
 *
 * Nothing else is touched. The rod, the bait and the eighteen species are all
 * bought, crafted or caught; a returning player owns none of them because
 * they never could have, and handing them a rod would be this upgrade making
 * a decision that is the player's.
 */
function migrateFishing(farm: unknown): unknown {
  return upgradePlayers(farm, (player) => ({ ...player, fishing: null }));
}

/** Which slot the old tool enum should leave the player holding. */
const TOOL_SLOTS: Record<string, ItemId> = {
  hoe: 'hoe',
  water: 'watering-can',
  harvest: 'basket',
  inspect: 'hoe',
};

/**
 * Version 2 carried a satchel of named counts. This turns those counts into
 * stacks in a stable slot order — tools first, then seeds, then crops, then
 * materials — so the same old save always lands in the same layout.
 *
 * Real work rather than a default: a player who had eight turnip seeds still
 * has eight turnip seeds, in a slot they can find.
 */
function migrateInventory(farm: unknown): unknown {
  return upgradePlayers(farm, (player) => {
    const satchel = player.satchel;
    if (!isObject(satchel)) return null;
    const seeds = isObject(satchel.seeds) ? satchel.seeds : {};
    const crops = isObject(satchel.crops) ? satchel.crops : {};

    const inventory = emptyInventory();
    STARTING_TOOLS.forEach((tool, index) => {
      inventory[index] = newStack(tool);
    });
    // The can comes back as full as it was, not as full as a new one.
    const can = inventory[STARTING_TOOLS.indexOf('watering-can')];
    if (can && isCount(satchel.water)) can.charges = Math.min(satchel.water, can.charges ?? 0);

    // Spilled through `addItem` rather than one slot each, so a hoard larger
    // than a stack survives the upgrade instead of being clipped to 99.
    let packed: Inventory | null = inventory;
    const place = (item: ItemId, amount: unknown) => {
      if (!packed || !isCount(amount) || amount < 1) return;
      packed = addItem(packed, item, Math.floor(amount));
    };
    for (const crop of CROP_IDS) place(`${crop}-seeds`, seeds[crop]);
    for (const crop of CROP_IDS) place(crop, crops[crop]);
    place('wood', satchel.wood);
    // More than 24 slots' worth: nothing sensible to drop, so the save is
    // refused rather than silently lightened.
    if (!packed) return null;
    const filled: Inventory = packed;

    // What they had equipped, kept where it can still be found. A player on
    // the old Seeds tool gets the seed packet itself, which is the same thing
    // now that seeds are items.
    const held =
      player.tool === 'seed'
        ? `${typeof player.seed === 'string' ? player.seed : 'turnip'}-seeds`
        : TOOL_SLOTS[String(player.tool)];
    // Clamped to the hotbar: the slot has to be one the player can reach.
    const found = filled.findIndex((stack) => stack?.item === held);
    const selectedSlot = found >= 0 && found < HOTBAR_SIZE ? found : 0;

    // The old fields are dropped rather than left alongside the new ones, so
    // the upgraded save is a version-3 save and not a hybrid of both.
    const upgraded: Unknown = { ...player, inventory: filled, selectedSlot };
    delete upgraded.satchel;
    delete upgraded.tool;
    delete upgraded.seed;
    return upgraded;
  });
}

// --- public API -------------------------------------------------------------

export function encodeSave(farm: FarmState, now = new Date()): string {
  const envelope: SaveEnvelope = { version: SAVE_VERSION, savedAt: now.toISOString(), farm };
  return JSON.stringify(envelope);
}

/** Parses a serialized save, returning null for anything unusable. */
export function decodeSave(serialized: string | null): FarmState | null {
  if (!serialized) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return null;
  }

  if (!isObject(parsed) || !isFiniteNumber(parsed.version)) return null;

  const upgraded = migrate(parsed.version, parsed.farm);
  if (upgraded === null) return null;

  return parseFarm(upgraded);
}

// Storage is allowed to fail, and a failed save must never take the game
// down with it. Losing a save is bad; crashing the render loop is worse.

export function saveFarm(farm: FarmState, storage: SaveStorage = localSaveStorage): boolean {
  try {
    storage.write(SAVE_KEY, encodeSave(farm));
    return true;
  } catch {
    return false;
  }
}

export function loadFarm(storage: SaveStorage = localSaveStorage): FarmState | null {
  try {
    return decodeSave(storage.read(SAVE_KEY));
  } catch {
    return null;
  }
}

export function clearSave(storage: SaveStorage = localSaveStorage): boolean {
  try {
    storage.remove(SAVE_KEY);
    return true;
  } catch {
    return false;
  }
}
