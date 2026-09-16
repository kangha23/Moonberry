import {
  ANIMAL_DEFS,
  HAY_PRICE,
  MAX_HAY_PURCHASE,
  advanceAnimals,
  animalAtTile,
  animalById,
  animalsIn,
  animalsOn,
  nearestAnimal,
  checkPurchase,
  collectProduce,
  createAnimal,
  feedAnimal,
  hasProduce,
  hayCapacity,
  isAnimalHouse,
  petAnimal,
  resalePrice,
  type Animal,
  type AnimalKind,
} from '../systems/animals';
import {
  BUILDING_AREA,
  buildingAt,
  buildingDef,
  buildingTiles,
  buildingsOn,
  isComplete,
  type Building,
} from '../systems/buildings';
import { npcDef } from '../npcs/definitions';
import { pickDialogue, type DialogueContext } from '../npcs/dialogue';
import {
  REACTION_BLURB,
  giveGift,
  heartsWith,
  isBirthday,
  isGiftable,
  relationshipWith,
} from '../npcs/relationships';
import { activityAt, advanceNpcs, spawnNpcs, type NpcActor } from '../npcs/schedule';
import { applySweep, createPlot, sellAllCrops, type PlotState } from '../systems/farming';
import {
  HOTBAR_SIZE,
  createInventory,
  moveStack,
  removeItem,
  slotAt,
  splitStack,
} from '../systems/inventory';
import {
  ITEMS,
  areaOfEffectOf,
  isPlaceableItem,
  energyFactorOf,
  itemDef,
  type ItemId,
} from '../systems/items';
import { STARTING_RECIPES } from '../systems/crafting';
import { placeableAt } from '../systems/placeables';
import { claimQuestReward, createQuest, recordHarvest } from '../systems/quest';
import { nodeAt, nodeDef, seedNodes, workNodes, type ResourceNode } from '../systems/resources';
import { advanceTime, createTimeState, seasonForDay, weatherForDay } from '../systems/time';
import {
  AREAS,
  PLAYER_SPEED,
  START_AREA,
  areaOfEffectTiles,
  describeTile,
  interactableAt,
  isNear,
  isWithinReach,
  plotKey,
  propGap,
  plotTiles,
  isAreaId,
  portalAt,
  resolveMove,
  spawnPoints,
  targetTile,
  tileAt,
  worldToTile,
  type AreaId,
  type Point,
} from '../world/areas';
import type { ApplyResult, GameEvent, Intent } from './intents';
import {
  EXHAUSTED_SPEED_SCALE,
  MAX_PLAYERS,
  STARTING_MAX_ENERGY,
  type FarmState,
  type PlayerId,
  type PlayerState,
} from './types';
import { blockersFor, facingFor, unchanged, say } from './rules/common';
import { stillAwake, startNewDay, collapse, rollIfEveryoneAsleep, applySleep } from './rules/day';
import {
  counterAt,
  setPanel,
  panelSurvivesStep,
  applyBuy,
  applyUpgradeTool,
  applyCollectTool,
  applyPlaceBuilding,
} from './rules/counters';
import { applyCast, applyReel, applyCancelCast, advanceFishing } from './rules/fishing';
import {
  applyCraft,
  applyPlaceItem,
  applyPickUpItem,
  applyChestMoveStack,
  applyChestStow,
  applyMachineLoad,
  applyMachineCollect,
  applyPlaceableAct,
  learnRecipes,
} from './rules/placeables';

/**
 * Real milliseconds per in-game clock step.
 *
 * Exported because the renderer has to know it: everything the reducer walks —
 * the herd, the villagers — moves a whole step at a time on this beat, and the
 * frames in between are drawn by interpolating across exactly this long. See
 * `view/tickChase.ts`. Two copies of this number would drift into a walk that
 * finishes early and stutters.
 */
export const CLOCK_STEP_MS = 1200;
/**
 * In-game minutes added per clock step, and therefore how long a day lasts.
 *
 * Two minutes every 1.2 seconds is ten minutes every six, which puts 6am to 2am
 * at twelve real minutes — Stardew's own day is fourteen. It was ten minutes a
 * step once, and that made a whole day two and a half minutes long: not enough
 * to walk to the village, talk to two people and walk back, let alone farm.
 *
 * The beat stays at `CLOCK_STEP_MS` and only the minutes shrink, because the
 * beat is what the renderer interpolates the herd and the villagers across.
 * Their speeds are per in-game minute, so they were raised by the same factor
 * of five and still cover exactly the pixels per beat they always did.
 */
export const CLOCK_STEP_MINUTES = 2;

/** Guards against a long stall replaying hundreds of clock steps at once. */
const MAX_TICK_MS = 5000;

const STARTING_COINS = 24;

/**
 * What every new world's ground is drawn from.
 *
 * A constant rather than a draw, and that is deliberate. `createFarmState` is
 * not the reducer, so it *could* reach for `Math.random` — but a fixed seed
 * means the first morning is the same first morning for everybody, which is
 * the same bargain the Tiled maps already take: a screenshot of day one is
 * reproducible, and a test can say exactly what is standing where. It lives in
 * the state rather than here so that a future farm-layout choice is a value
 * somebody passes in and not a change to this file.
 */
const DEFAULT_SPAWN_SEED = 0x6d6f6f6e;

export function createFarmState(spawnSeed = DEFAULT_SPAWN_SEED): FarmState {
  const plots: Record<string, PlotState> = {};
  for (const area of Object.keys(AREAS) as AreaId[]) {
    for (const tile of plotTiles(area)) {
      plots[plotKey(area, tile.x, tile.y)] = createPlot(tile.x, tile.y);
    }
  }

  const time = createTimeState();
  const season = seasonForDay(1);
  return {
    revision: 0,
    time,
    season,
    weather: weatherForDay(1),
    plots,
    coins: STARTING_COINS,
    buildings: [],
    // The farm starts overgrown, which is the quieter half of this spec. A
    // field that begins swept clean gives the first week nothing to reclaim,
    // and half the pleasure of a first season is watching the land come out
    // from under the brambles.
    nodes: seedNodes({ plots, buildings: [], placeables: [] }, season, spawnSeed),
    spawnSeed,
    npcs: spawnNpcs(season, weatherForDay(1), time),
    animals: [],
    hay: 0,
    placeables: [],
    quest: createQuest(),
    players: {},
    clockMs: 0,
  };
}

function createPlayer(id: PlayerId, name: string, spawn: Point): PlayerState {
  return {
    id,
    name,
    area: START_AREA,
    x: spawn.x,
    y: spawn.y,
    facing: 'down',
    inventory: createInventory(),
    selectedSlot: 0,
    energy: STARTING_MAX_ENERGY,
    maxEnergy: STARTING_MAX_ENERGY,
    asleep: false,
    panel: null,
    openChest: null,
    // Everything with no condition on it, which is what `{ by: 'start' }` means.
    knownRecipes: [...STARTING_RECIPES],
    pendingUpgrade: null,
    relationships: {},
    // Nobody starts with a line in the water, and nobody starts with a rod
    // either: fishing is taken up at the stall rather than handed over on the
    // first morning. See the rod's row in `TOOL_BASES`.
    fishing: null,
    online: true,
  };
}

/** Writes the herd back, bumping the revision. The animal half of `withPlayer`. */
function withAnimals(state: FarmState, animals: Animal[]): FarmState {
  return { ...state, revision: state.revision + 1, animals };
}

/** One animal replaced in place, which is what every chore below produces. */
function replaceAnimal(animals: readonly Animal[], next: Animal): Animal[] {
  return animals.map((animal) => (animal.id === next.id ? next : animal));
}

/**
 * Whether this player is close enough to lay a hand on this animal.
 *
 * An animal indoors is reached through its house, which is checked the same
 * way: you have to be standing at the door. Without this, a panel left open on
 * one screen would be a remote control for a farm on the other side of the
 * valley — which is precisely the thing the market counter is not allowed to
 * be either.
 */
function canReachAnimal(state: FarmState, player: PlayerState, animal: Animal): boolean {
  if (player.area !== BUILDING_AREA) return false;
  if (animal.position) {
    return isWithinReach(player, worldToTile(animal.position.x), worldToTile(animal.position.y));
  }
  const home = state.buildings.find((building) => building.id === animal.home);
  if (!home) return false;
  return buildingTiles(home).some((tile) => isWithinReach(player, tile.x, tile.y));
}

const OUT_OF_REACH = 'Con vật đó không ở trong tầm tay bạn.';
const NO_SUCH_ANIMAL = 'Không có con vật nào như thế.';
const NOT_AT_RANCHER = 'Bạn không đứng ở chỗ người bán gia súc.';

/**
 * The animal a chore is about, and whether it can be reached.
 *
 * The three chores below differ in what they do and in nothing else, so the
 * two ways of refusing them are asked once here. Every one of them starts by
 * looking the id up rather than trusting it: an animal id off the wire is a
 * string a client chose.
 */
function reachableAnimal(
  state: FarmState,
  player: PlayerState,
  animalId: string,
): { ok: true; animal: Animal } | { ok: false; reason: string } {
  const animal = animalById(state.animals, animalId);
  if (!animal) return { ok: false, reason: NO_SUCH_ANIMAL };
  if (!canReachAnimal(state, player, animal)) return { ok: false, reason: OUT_OF_REACH };
  return { ok: true, animal };
}

/** A stroke. Once a day, and the fifteen points land now rather than at dawn. */
function applyPetAnimal(state: FarmState, playerId: PlayerId, animalId: string): ApplyResult {
  const player = state.players[playerId];
  if (!player) return unchanged(state);

  const found = reachableAnimal(state, player, animalId);
  if (!found.ok) return { state, events: [say(playerId, found.reason)] };

  const result = petAnimal(found.animal);
  if (!result.ok) return { state, events: [say(playerId, result.reason)] };

  return {
    state: withAnimals(state, replaceAnimal(state.animals, result.animal)),
    events: [
      { kind: 'animalPetted', playerId, animalId, animal: found.animal.kind },
      say(playerId, result.message),
    ],
  };
}

/**
 * Collecting.
 *
 * The animal's clock moves on in the same state change that puts the egg in
 * the satchel, which is what makes two farmhands racing for the same coop
 * safe: the second one arrives to find `produceOnDay` already in the future
 * and is told there is nothing there. Nothing needs locking, because the
 * reducer only ever applies one intent at a time.
 */
function applyCollectProduce(state: FarmState, playerId: PlayerId, animalId: string): ApplyResult {
  const player = state.players[playerId];
  if (!player) return unchanged(state);

  const found = reachableAnimal(state, player, animalId);
  if (!found.ok) return { state, events: [say(playerId, found.reason)] };

  const result = collectProduce(found.animal, player.inventory, state.time.day);
  if (!result.ok) return { state, events: [say(playerId, result.reason)] };

  const label = itemDef(result.item).label.toLowerCase();
  return {
    state: {
      ...withAnimals(state, replaceAnimal(state.animals, result.animal)),
      players: { ...state.players, [playerId]: { ...player, inventory: result.inventory } },
    },
    events: [
      { kind: 'produceCollected', playerId, animalId, item: result.item, grade: result.grade },
      say(
        playerId,
        `Bạn ${ANIMAL_DEFS[found.animal.kind].collectVerb} ${found.animal.name}: ${label}.`,
      ),
    ],
  };
}

/**
 * Feeding by hand.
 *
 * Only ever needed when the morning found the silo empty and somebody has been
 * to the rancher since. The everyday case is the trough, which `startAnimalDay`
 * fills without anybody pressing a key — a chore that has to be done every
 * single morning and can never be done wrong is not a decision, it is a tax.
 */
function applyFeedAnimal(state: FarmState, playerId: PlayerId, animalId: string): ApplyResult {
  const player = state.players[playerId];
  if (!player) return unchanged(state);

  const found = reachableAnimal(state, player, animalId);
  if (!found.ok) return { state, events: [say(playerId, found.reason)] };

  const result = feedAnimal(found.animal, state.hay);
  if (!result.ok) return { state, events: [say(playerId, result.reason)] };

  return {
    state: { ...withAnimals(state, replaceAnimal(state.animals, result.animal)), hay: result.hay },
    events: [{ kind: 'animalFed', playerId, animalId }, say(playerId, result.message)],
  };
}

/**
 * The coop door.
 *
 * On the farm and within arm's reach of the building, because it is a door: a
 * client that could swing it from the village could put somebody else's whole
 * herd out in the rain from a panel nobody is standing at.
 */
function applyToggleDoor(state: FarmState, playerId: PlayerId, buildingId: string): ApplyResult {
  const player = state.players[playerId];
  if (!player) return unchanged(state);

  const building = state.buildings.find((candidate) => candidate.id === buildingId);
  if (!building || !isAnimalHouse(building.kind)) {
    return { state, events: [say(playerId, 'Cái đó không có cửa chuồng.')] };
  }
  if (!isComplete(building)) {
    return { state, events: [say(playerId, `${buildingDef(building.kind).label} chưa dựng xong.`)] };
  }
  if (
    player.area !== BUILDING_AREA ||
    !buildingTiles(building).some((tile) => isWithinReach(player, tile.x, tile.y))
  ) {
    return { state, events: [say(playerId, 'Bạn phải đứng cạnh chuồng đã.')] };
  }

  const open = !building.doorOpen;
  return {
    state: {
      ...state,
      revision: state.revision + 1,
      buildings: state.buildings.map((candidate) =>
        candidate.id === buildingId ? { ...candidate, doorOpen: open } : candidate,
      ),
    },
    events: [
      { kind: 'doorToggled', buildingId, open },
      say(
        playerId,
        open
          ? 'Bạn chống cửa chuồng lên. Ngày nào khô ráo là chúng sẽ ra ngoài.'
          : 'Bạn đóng cửa chuồng lại.',
      ),
    ],
  };
}

/**
 * Walking up to an animal.
 *
 * Produce wins over a stroke, deliberately: the egg is the errand, the stroke
 * is what you do afterwards, and one press should never leave a player
 * wondering whether the coop has been done. Both are still available — the
 * second press pets, because by then there is nothing left to pick up.
 */
function applyAnimalAct(state: FarmState, playerId: PlayerId, animal: Animal): ApplyResult {
  return hasProduce(animal, state.time.day)
    ? applyCollectProduce(state, playerId, animal.id)
    : applyPetAnimal(state, playerId, animal.id);
}

/**
 * Doing the round at a coop or a barn.
 *
 * There are no interiors in this game, so acting on the building is what
 * standing in the doorway has to mean: every egg picked up and every empty
 * trough filled, in one press. Only when there is nothing to do does the press
 * fall through to the door — which is the right order round, because the door
 * is the thing you touch once a day and the eggs are what you came for.
 */
function applyHouseChores(state: FarmState, playerId: PlayerId, building: Building): ApplyResult {
  const player = state.players[playerId];
  if (!player) return unchanged(state);

  const housed = animalsIn(state.animals, building.id);
  if (housed.length === 0) {
    const def = buildingDef(building.kind);
    return {
      state,
      events: [
        say(playerId, `${def.label} còn trống. Người bán gia súc ngoài làng có thứ để thả vào.`),
      ],
    };
  }

  let animals = state.animals;
  let inventory = player.inventory;
  let hay = state.hay;
  let collected = 0;
  let fed = 0;
  const events: GameEvent[] = [];

  for (const housedAnimal of housed) {
    const picked = collectProduce(housedAnimal, inventory, state.time.day);
    if (picked.ok) {
      animals = replaceAnimal(animals, picked.animal);
      inventory = picked.inventory;
      collected += 1;
      events.push({
        kind: 'produceCollected',
        playerId,
        animalId: housedAnimal.id,
        item: picked.item,
        grade: picked.grade,
      });
    }

    // Read off the running herd rather than the loop variable: an animal that
    // was just collected from is a different object by now.
    const current = animalById(animals, housedAnimal.id);
    if (!current) continue;
    const meal = feedAnimal(current, hay);
    if (meal.ok) {
      animals = replaceAnimal(animals, meal.animal);
      hay = meal.hay;
      fed += 1;
      events.push({ kind: 'animalFed', playerId, animalId: housedAnimal.id });
    }
  }

  if (collected === 0 && fed === 0) return applyToggleDoor(state, playerId, building.id);

  const done = [collected > 0 ? `thu được ${collected} món` : '', fed > 0 ? `cho ${fed} con ăn` : '']
    .filter(Boolean)
    .join(' và ');
  events.push(say(playerId, `${buildingDef(building.kind).label}: bạn ${done}.`));

  return {
    state: {
      ...withAnimals(state, animals),
      hay,
      players: { ...state.players, [playerId]: { ...player, inventory } },
    },
    events,
  };
}

// --- the rancher's counter ---------------------------------------------------

/**
 * Buying an animal.
 *
 * Everything a client could lie about is re-derived here: the price from the
 * table, the house from the farm's own building list, the room in it from the
 * herd, and the wallet from the farm. What the client genuinely supplies is
 * one thing — the name — and that is checked for shape and nothing else,
 * because a name is allowed to be whatever a person wants to call a goat.
 */
function applyBuyAnimal(
  state: FarmState,
  playerId: PlayerId,
  kind: AnimalKind,
  home: string,
  name: string,
): ApplyResult {
  const player = state.players[playerId];
  if (!player) return unchanged(state);

  if (counterAt(player) !== 'ranch') {
    return { state, events: [say(playerId, NOT_AT_RANCHER)] };
  }

  const check = checkPurchase(state.animals, state.buildings, kind, home, name);
  if (!check.ok) return { state, events: [say(playerId, check.reason)] };

  const def = ANIMAL_DEFS[kind];
  if (def.price > state.coins) {
    return {
      state,
      events: [say(playerId, `${def.label} giá ${def.price}g, mà nông trại chỉ có ${state.coins}g.`)],
    };
  }

  const animal = createAnimal(state.animals, kind, home, name, state.time.day);
  return {
    state: {
      ...state,
      revision: state.revision + 1,
      coins: state.coins - def.price,
      animals: [...state.animals, animal],
    },
    events: [
      { kind: 'animalBought', playerId, animalId: animal.id, animal: kind, coins: def.price },
      say(playerId, `${animal.name} về nông trại rồi. Nhớ cho ăn, và vuốt nó mỗi ngày một lần.`),
    ],
  };
}

/**
 * Selling one back, at half.
 *
 * Brutal, and necessary. Without a way out, a coop filled with the wrong bird
 * is a permanent decision taken by somebody who had been playing for an hour,
 * and there are eight places in it.
 */
function applySellAnimal(state: FarmState, playerId: PlayerId, animalId: string): ApplyResult {
  const player = state.players[playerId];
  if (!player) return unchanged(state);

  if (counterAt(player) !== 'ranch') {
    return { state, events: [say(playerId, NOT_AT_RANCHER)] };
  }

  const animal = animalById(state.animals, animalId);
  if (!animal) return { state, events: [say(playerId, NO_SUCH_ANIMAL)] };

  const paid = resalePrice(animal.kind);
  return {
    state: {
      ...state,
      revision: state.revision + 1,
      coins: state.coins + paid,
      animals: state.animals.filter((candidate) => candidate.id !== animalId),
    },
    events: [
      { kind: 'animalSold', playerId, animal: animal.kind, coins: paid },
      say(playerId, `${animal.name} theo người bán đi, và để lại ${paid}g.`),
    ],
  };
}

/**
 * Buying hay.
 *
 * The one purchase in the game that can be refused for having nowhere to put
 * it: hay lives in the silo and nowhere else, so a farm without one cannot buy
 * a single bale. That is the whole reason the silo is the cheapest of the
 * three farm buildings, and why its blurb says to put it up first.
 */
function applyBuyHay(state: FarmState, playerId: PlayerId, count: number): ApplyResult {
  const player = state.players[playerId];
  if (!player) return unchanged(state);

  if (counterAt(player) !== 'ranch') {
    return { state, events: [say(playerId, NOT_AT_RANCHER)] };
  }
  if (!Number.isInteger(count) || count < 1 || count > MAX_HAY_PURCHASE) {
    return { state, events: [say(playerId, 'Ông ta đếm lại một lượt rồi lắc đầu.')] };
  }

  const capacity = hayCapacity(state.buildings);
  if (capacity === 0) {
    return {
      state,
      events: [say(playerId, 'Nông trại chưa có kho cỏ nào. Không có chỗ chứa thì ông ta không bán.')],
    };
  }
  if (state.hay + count > capacity) {
    const room = capacity - state.hay;
    return { state, events: [say(playerId, `Kho cỏ chỉ còn chỗ cho ${room} bó nữa.`)] };
  }

  const spent = HAY_PRICE * count;
  if (spent > state.coins) {
    return {
      state,
      events: [say(playerId, `${count} bó cỏ giá ${spent}g, mà nông trại chỉ có ${state.coins}g.`)],
    };
  }

  return {
    state: {
      ...state,
      revision: state.revision + 1,
      coins: state.coins - spent,
      hay: state.hay + count,
    },
    events: [
      { kind: 'hayBought', playerId, count, coins: spent },
      say(playerId, `Đã mua ${count} bó cỏ với giá ${spent}g.`),
    ],
  };
}

/**
 * The villager a player is standing next to, and how far away they are.
 *
 * The gap comes back with them because a counter and a villager can both be in
 * reach at once — Maeve works the forge yard — and the nearer of the two has to
 * win. That is the rule two props have always followed; this only extends it to
 * cover people.
 */
function nearestNpc(state: FarmState, player: PlayerState): { actor: NpcActor; gap: number } | null {
  let best: { actor: NpcActor; gap: number } | null = null;
  for (const actor of state.npcs) {
    if (actor.area !== player.area) continue;
    if (!isNear(player, actor)) continue;
    const gap = Math.hypot(actor.x - player.x, actor.y - player.y);
    if (!best || gap < best.gap) best = { actor, gap };
  }
  return best;
}

/** Everything a line is allowed to depend on, gathered in one place. */
function dialogueContextFor(state: FarmState, player: PlayerState, actor: NpcActor): DialogueContext {
  const def = npcDef(actor.id);
  return {
    hearts: heartsWith(player.relationships, actor.id),
    season: state.season,
    weather: state.weather,
    day: state.time.day,
    birthday: isBirthday(def, state.season, state.time.day),
    questCompleted: state.quest.completed,
    questRewarded: state.quest.rewarded,
    activity: activityAt(def, state.season, state.weather, state.time),
  };
}

/** The line this villager has for this player right now. */
function speakLine(state: FarmState, playerId: PlayerId, actor: NpcActor): string {
  const player = state.players[playerId];
  const def = npcDef(actor.id);
  if (!player) return '';
  return pickDialogue(def, dialogueContextFor(state, player, actor));
}

/**
 * Saying hello, as the two things that produces.
 *
 * Only the talking path emits `npcSpoke`. A gift makes its own sound and
 * carries the same line in its message, and firing both would put two blips
 * over one interaction.
 */
function speakEvents(state: FarmState, playerId: PlayerId, actor: NpcActor): GameEvent[] {
  const line = speakLine(state, playerId, actor);
  if (!line) return [];
  return [
    { kind: 'npcSpoke', npc: actor.id, playerId, line },
    say(playerId, `${npcDef(actor.id).name}: ${line}`),
  ];
}

/**
 * Talking.
 *
 * The quest rides along on this rather than on a villager's name: `questGiver`
 * is a flag in the definition, so the promise that adding a villager never
 * means touching this file survives the one villager who predates all of it.
 */
function applyTalk(state: FarmState, playerId: PlayerId, actor: NpcActor): ApplyResult {
  const events = speakEvents(state, playerId, actor);
  const def = npcDef(actor.id);
  if (!def.questGiver) return { state, events };

  const result = claimQuestReward(state.quest);
  if (!result.claimed) return { state, events };

  events.push(say(playerId, result.message), { kind: 'questRewarded', playerId, coins: result.reward });
  return {
    state: {
      ...state,
      revision: state.revision + 1,
      quest: result.quest,
      coins: state.coins + result.reward,
    },
    events,
  };
}

/**
 * Handing something over.
 *
 * A refusal still gets a line. The alternative — silence until tomorrow — makes
 * a villager who has already had their gift feel broken rather than finished
 * with, and the refusal itself has to change nothing at all: no points, no
 * allowance spent, and the item stays in the satchel.
 */
function applyGift(
  state: FarmState,
  playerId: PlayerId,
  actor: NpcActor,
  item: ItemId,
): ApplyResult {
  const player = state.players[playerId];
  if (!player) return unchanged(state);

  const def = npcDef(actor.id);
  const before = relationshipWith(player.relationships, actor.id);
  const result = giveGift(before, def, item, state.season, state.time.day);
  if (!result.ok) {
    return { state, events: [say(playerId, result.reason), ...speakEvents(state, playerId, actor)] };
  }

  // Checked rather than assumed: `giveGift` has agreed the item is giftable,
  // but the satchel is the only thing that knows it is still in there.
  const inventory = removeItem(player.inventory, item, 1);
  if (!inventory) return { state, events: [say(playerId, 'Bạn không mang theo thứ đó.')] };

  const label = itemDef(item).label.toLowerCase();
  const next: PlayerState = {
    ...player,
    inventory,
    relationships: { ...player.relationships, [actor.id]: result.relationship },
  };

  const events: GameEvent[] = [
    {
      kind: 'giftGiven',
      npc: actor.id,
      playerId,
      item,
      reaction: result.reaction,
      heartsNow: result.hearts,
      heartGained: result.heartGained,
      birthday: result.birthday,
    },
    say(
      playerId,
      result.birthday
        ? `Bạn tặng ${def.name} ${label} — đúng ngày sinh nhật. ${def.name} ${REACTION_BLURB[result.reaction]}.`
        : `Bạn tặng ${def.name} ${label}. ${def.name} ${REACTION_BLURB[result.reaction]}.`,
    ),
    say(playerId, `${def.name}: ${speakLine(state, playerId, actor)}`),
  ];

  // This is where spec 11 pays spec 07's debt, and it is two lines long.
  // Before this, a friendship bought dialogue and nothing else, so a player who
  // worked out that gifts were optional was right. Now four hearts with Maeve
  // is a keg. Asked here rather than only at dawn on purpose: a recipe that
  // turned up the next morning would leave the player unsure the gift had done
  // anything, and the whole point is that it visibly did.
  const taught = learnRecipes(next, state.time.day);
  events.push(...taught.events);

  return {
    state: {
      ...state,
      revision: state.revision + 1,
      players: { ...state.players, [playerId]: taught.player },
    },
    events,
  };
}

/**
 * Walking up to somebody.
 *
 * What is in hand decides which of the two this is, exactly as it decides what
 * a swing at a plot does: something giftable means a gift, and anything else —
 * a tool, an empty slot — means hello.
 */
function applyNpcAct(state: FarmState, playerId: PlayerId, actor: NpcActor): ApplyResult {
  const player = state.players[playerId];
  if (!player) return unchanged(state);
  const held = slotAt(player.inventory, player.selectedSlot);
  return held && isGiftable(held.item)
    ? applyGift(state, playerId, actor, held.item)
    : applyTalk(state, playerId, actor);
}

/**
 * Swinging at something standing on the ground.
 *
 * The shape of the plot sweep one function below, deliberately: a steel axe
 * covers the same 3x3 a steel hoe does, and the two ought to be one mechanic
 * that a player learns once. Energy is charged per node actually struck, and
 * the tier's factor applied to the total.
 *
 * Three things this is careful about, and all three are rules the spec calls
 * out by name:
 *
 * - **Refusing the felling blow when the satchel is full.** The node keeps its
 *   last point of health and stays exactly where it was. Dropping twelve
 *   planks on the ground would need world items, pickup and despawn rules;
 *   losing them silently is worse than either.
 * - **Saying when the tool is too weak.** Ten swings at a boulder that was
 *   never going to break, with nothing said, is an interface failure rather
 *   than a difficulty — so it is an event as well as a sentence, and the
 *   cursor greys out on anything this tier cannot touch.
 * - **Hay never reaching the satchel.** Cut grass goes to the silo or nowhere,
 *   because a permanent stack of grass would hold one of twenty-four slots for
 *   ever.
 */
function applyNodeAct(
  state: FarmState,
  playerId: PlayerId,
  aimed: ResourceNode,
  tile: Point,
  held: ItemId | null,
): ApplyResult {
  const player = state.players[playerId];
  if (!player) return unchanged(state);

  // Everything the swing covers that is actually a node. The rectangle is the
  // tool's own, so a basic axe passes exactly the one tile it was aimed at.
  const covered = held
    ? areaOfEffectTiles(tile, areaOfEffectOf(held), player.area)
    : [tile];
  const targets: ResourceNode[] = [];
  for (const spot of covered) {
    const found = nodeAt(state.nodes, player.area, spot.x, spot.y);
    // Only nodes the aimed one's tool would work. Without this a steel axe
    // swung at a tree would report "you need a scythe" about a tuft of grass
    // three tiles away that the player never aimed at.
    if (found && nodeDef(found.kind).tool === nodeDef(aimed.kind).tool) targets.push(found);
  }
  if (targets.length === 0) targets.push(aimed);

  const result = workNodes(
    targets,
    held,
    player.inventory,
    state.hay,
    hayCapacity(state.buildings),
    state.time.day,
    state.spawnSeed,
    held ? energyFactorOf(held) : 1,
  );

  const events: GameEvent[] = [];
  if (result.tooWeak) {
    events.push({ kind: 'toolTooWeak', playerId, node: aimed.kind, requires: result.tooWeak });
  }
  events.push(say(playerId, result.message));

  // A refused swing costs nothing: the budget is spent on work done.
  if (result.changed.length === 0) return { state, events };

  const felled = new Set(
    result.changed.filter((entry) => entry.node === null).map((entry) => entry.id),
  );
  const struck = new Map(
    result.changed
      .filter((entry): entry is { id: string; node: ResourceNode } => entry.node !== null)
      .map((entry) => [entry.id, entry.node]),
  );
  const nodes = state.nodes
    .filter((node) => !felled.has(node.id))
    .map((node) => struck.get(node.id) ?? node);

  for (const hit of result.hit) events.push({ kind: 'nodeHit', playerId, id: hit.id, node: hit.kind });
  for (const fell of result.cleared) {
    events.push({ kind: 'nodeCleared', playerId, id: fell.id, node: fell.kind, drops: fell.drops });
  }

  const energy = Math.max(0, player.energy - result.energyCost);
  if (energy === 0 && player.energy > 0) events.push({ kind: 'exhausted', playerId });

  return {
    state: {
      ...state,
      revision: state.revision + 1,
      nodes,
      hay: result.hay,
      players: { ...state.players, [playerId]: { ...player, inventory: result.inventory, energy } },
    },
    events,
  };
}

/**
 * Resolves a context-sensitive action: talk to Rowan, sell at the market, or
 * use the equipped tool on a tile.
 *
 * What is interactive comes from the map rather than from constants here, so
 * moving the market stall in Tiled moves where crops can be sold.
 *
 * `target` is the tile the mouse named; without one the player acts on the
 * tile they face, which is the keyboard path and is unchanged by all of this.
 */
function applyAct(state: FarmState, playerId: PlayerId, target?: Point): ApplyResult {
  const player = state.players[playerId];
  if (!player) return unchanged(state);

  // A line in the water takes the action key over everything below. The
  // client sends `reel` rather than `act` while fishing, so this is only
  // reached by a client that is behind or is not ours; either way, hoeing a
  // bed halfway through landing a sturgeon is not what the press meant.
  if (player.fishing) return unchanged(state);

  // Reach is enforced here because here is the only place a modified client
  // cannot edit it out. The greyed-out cursor on the client is a courtesy;
  // this is the rule.
  if (target && !isWithinReach(player, target.x, target.y)) {
    return { state, events: [say(playerId, 'Chỗ đó ngoài tầm với.')] };
  }

  const tile = target ?? targetTile(player.area, player, player.facing);
  const key = plotKey(player.area, tile.x, tile.y);
  const plot = state.plots[key];

  // Standing beside somebody is enough to talk to them, which is what keeps
  // the keyboard path one key. A named target overrides that only when it
  // names soil: clicking a plot at Rowan's feet should till it, and clicking
  // anything else while stood at his gate should still be hello.
  const atCounter = target && plot ? null : interactableAt(player.area, player);
  const villager = target && plot ? null : nearestNpc(state, player);

  // Villagers walk, so one of them can be standing at a counter — Maeve works
  // the forge yard every day. The nearer of the two wins, which is the rule
  // two props already follow and the only one that stays predictable when the
  // thing you are standing next to moves around.
  if (villager && (!atCounter || villager.gap < propGap(atCounter, player))) {
    return applyNpcAct(state, playerId, villager.actor);
  }

  const nearby = atCounter;

  if (nearby?.interact === 'bed') return applySleep(state, playerId);

  // One press does both halves of a market visit: the basket is emptied onto
  // the counter and the stall opens with the coins it just paid you. Keeping
  // the sale on the keypress means the common trip is still one key, and
  // opening the panel is what makes the coins worth having.
  if (nearby?.interact === 'market') {
    const sale = sellAllCrops(player.inventory);
    const events: GameEvent[] = [say(playerId, sale.message)];
    const next: PlayerState = {
      ...player,
      inventory: sale.changed ? sale.inventory : player.inventory,
      panel: 'market',
    };
    if (sale.changed) {
      events.push({ kind: 'sold', playerId, coins: sale.coinsEarned, count: sale.soldCount });
    }
    if (player.panel !== 'market') events.push({ kind: 'panelChanged', playerId, panel: 'market' });
    return {
      state: {
        ...state,
        revision: state.revision + 1,
        coins: state.coins + sale.coinsEarned,
        players: { ...state.players, [playerId]: next },
      },
      events,
    };
  }

  // The blacksmith has nothing to sell over the counter, so acting at his
  // anvil only opens the panel; what to hand over is chosen there.
  if (nearby?.interact === 'blacksmith') {
    const ready = player.pendingUpgrade && state.time.day >= player.pendingUpgrade.readyOnDay;
    const opened = setPanel(state, playerId, 'workshop');
    return {
      state: opened.state,
      events: [
        ...opened.events,
        say(
          playerId,
          ready
            ? `"Của bạn đây, làm ra cũng đẹp." ${itemDef(player.pendingUpgrade!.item).label} đang chờ.`
            : '"Cứ để đó cho tôi, tôi sẽ làm ra trò."',
        ),
      ],
    };
  }

  // The rancher sells livestock and hay and buys nothing over the counter, so
  // acting here only opens the panel; which animal and which house are chosen
  // in it, because neither is a thing a keypress can say.
  if (nearby?.interact === 'rancher') {
    const opened = setPanel(state, playerId, 'ranch');
    const houses = state.buildings.filter(
      (building) => isAnimalHouse(building.kind) && isComplete(building),
    );
    return {
      state: opened.state,
      events: [
        ...opened.events,
        say(
          playerId,
          houses.length > 0
            ? '"Chuồng dựng xong rồi à? Vậy thì chọn đi."'
            : '"Dựng chuồng trước đã. Tôi không bán gà cho người chưa có chỗ nhốt."',
        ),
      ],
    };
  }

  // An animal comes before the ground under it, which is the whole of the
  // rule: a chicken standing on a plot is a chicken, and swinging a hoe
  // through it to till the soil underneath is not what anybody meant.
  //
  // Found two ways, in this order. The tile is what a click names, so clicking
  // the animal reaches it exactly. Standing beside one is what the keyboard
  // path has to mean, because an animal ambles and the tile it is on this
  // second is not something anybody can aim at — the same bargain a villager
  // gets, at the same radius. A click that named soil takes neither: that is
  // somebody aiming at a plot, and they get the plot.
  const herd = animalsOn(state.animals, player.area);
  const grazing =
    animalAtTile(herd, tile.x, tile.y) ?? (target && plot ? null : nearestAnimal(herd, player));
  if (grazing) return applyAnimalAct(state, playerId, grazing);

  // Standing on the farm's own construction. A coop or a barn is a morning's
  // round — eggs and troughs — and everything else is worth a word, because a
  // scaffold is something you paid for that is not doing anything yet.
  const standing = buildingAt(buildingsOn(state.buildings, player.area), tile.x, tile.y);
  if (standing) {
    const def = buildingDef(standing.kind);
    if (isComplete(standing) && isAnimalHouse(standing.kind)) {
      return applyHouseChores(state, playerId, standing);
    }
    return {
      state,
      events: [
        say(
          playerId,
          isComplete(standing)
            ? `${def.label}. ${def.blurb}`
            : `${def.label} mới dựng được nửa. Xong vào ngày ${standing.readyOnDay}.`,
        ),
      ],
    };
  }

  // Something a player put down, before the ground under it and before the
  // tool in hand. Same rule the animals and the trees get one branch up: a
  // chest is a chest, and hoeing the soil it is standing on is not what
  // anybody aiming at it meant.
  const standingItem = placeableAt(state.placeables, player.area, tile.x, tile.y);
  if (standingItem) return applyPlaceableAct(state, playerId, standingItem);

  // What is in hand decides how much of the field one swing covers. A basic
  // tool passes a single key here and this is the code it has always taken.
  const held = slotAt(player.inventory, player.selectedSlot);

  // A rod aimed at water is a cast, and it is asked here — after the props,
  // the villagers, the herd and the buildings, before the ground — so that
  // standing at the market with a rod in hand still sells the day's catch.
  // Nothing else in the game does anything to a water tile, so there is no
  // ambiguity to resolve below this line.
  if (held && ITEMS[held.item]?.tool === 'rod' && tileAt(player.area, tile.x, tile.y)?.kind === 'water') {
    return applyCast(state, playerId, tile);
  }

  // Whatever is standing on the tile comes before the ground under it, which
  // is the same rule the animals get one branch above and for the same reason:
  // a tree is a tree, and hoeing the soil it is rooted in is not what anybody
  // aiming at it meant. It is asked before the plot branch so that a wild plot
  // with a bramble on it is a bramble to clear rather than soil to till.
  const standingNode = nodeAt(state.nodes, player.area, tile.x, tile.y);
  if (standingNode) return applyNodeAct(state, playerId, standingNode, tile, held?.item ?? null);

  // Holding something crafted and swinging at clear ground puts it down. The
  // same gesture as everything else — hold, face, press — rather than a
  // separate cursor mode, which is what a chest deserves given that planting a
  // seed and swinging an axe already work exactly this way. Asked after the
  // nodes above, so a keg is never set down on top of a bramble.
  if (held && isPlaceableItem(held.item)) {
    return applyPlaceItem(state, playerId, held.item, tile.x, tile.y);
  }

  // Nothing farmable there: describing the tile is what the old Inspect tool
  // did, and it is a better default than a silent swing.
  if (!plot) {
    return { state, events: [say(playerId, describeTile(player.area, tile.x, tile.y))] };
  }

  // Anything with something standing on it is skipped, not worked: a swing
  // that tilled the soil under a bramble would be the one place in the game
  // where the ground wins over the thing on top of it, and the aimed tile —
  // checked above — has already been shown to be clear.
  const keys = held
    ? areaOfEffectTiles(tile, areaOfEffectOf(held.item), player.area)
        .filter((covered) => !nodeAt(state.nodes, player.area, covered.x, covered.y))
        .map((covered) => plotKey(player.area, covered.x, covered.y))
    : [key];
  const result = applySweep(
    state.plots,
    keys,
    player.inventory,
    player.selectedSlot,
    state.season,
    held ? energyFactorOf(held.item) : 1,
  );

  const events: GameEvent[] = [say(playerId, result.message)];
  // A refused action costs nothing: the budget is spent on work done.
  if (result.changed.length === 0) return { state, events };

  const plots = { ...state.plots };
  for (const { key: changedKey, plot: changedPlot } of result.changed) {
    plots[changedKey] = changedPlot;
    events.push({ kind: 'plotChanged', key: changedKey, action: result.action ?? undefined });
  }

  let quest = state.quest;
  for (const crop of result.harvested) {
    quest = recordHarvest(quest, crop);
    events.push({ kind: 'harvested', playerId, crop });
  }

  const energy = Math.max(0, player.energy - result.energyCost);
  if (energy === 0 && player.energy > 0) events.push({ kind: 'exhausted', playerId });

  return {
    state: {
      ...state,
      revision: state.revision + 1,
      plots,
      quest,
      players: { ...state.players, [playerId]: { ...player, inventory: result.inventory, energy } },
    },
    events,
  };
}

function applyTick(state: FarmState, deltaMs: number): ApplyResult {
  const elapsed = Math.min(deltaMs, MAX_TICK_MS);

  // The casts move first, and on the frame delta rather than the clock step.
  // This is the one simulation in the game that does not wait for the ten
  // minute hand: everything else here happens on the hour, and a bite window
  // that could only open on the hour would be a metronome.
  const fished = advanceFishing(state, elapsed);
  const fishEvents = fished.events;

  const clockMs = fished.state.clockMs + elapsed;
  if (clockMs < CLOCK_STEP_MS) {
    return { state: { ...fished.state, clockMs }, events: fishEvents };
  }

  const steps = Math.floor(clockMs / CLOCK_STEP_MS);
  let next: FarmState = {
    ...fished.state,
    clockMs: clockMs % CLOCK_STEP_MS,
    revision: fished.state.revision + 1,
  };
  const events: GameEvent[] = [...fishEvents];

  for (let i = 0; i < steps; i += 1) {
    const advanced = advanceTime(next.time, CLOCK_STEP_MINUTES);
    if (advanced.newDay) {
      // 02:00. Anybody still standing collapses; a farm nobody is awake on
      // simply turns over, because nobody stayed up to be charged for it.
      const rolled = stillAwake(next).length > 0 ? collapse(next) : startNewDay(next);
      // The roll resets clockMs; keep the remainder we already banked.
      next = { ...rolled.state, clockMs: next.clockMs };
      events.push(...rolled.events);
      continue;
    }

    next = { ...next, time: advanced.time };

    // The village moves on the clock step rather than the frame. Ten in-game
    // minutes of walking is a short hop, and the renderer smooths between the
    // hops — which keeps six villagers out of the state on every frame and
    // off the wire on every tick.
    const walked = advanceNpcs(next.npcs, next.season, next.weather, next.time, CLOCK_STEP_MINUTES);
    if (walked !== next.npcs) next = { ...next, npcs: walked };

    // The herd grazes on the same step and for the same reasons. Fourteen
    // animals is smaller than the six villagers already cost, and the walk
    // is a pure function of the clock, so two clients simulating the same
    // farm draw the same herd in the same places with nothing sent to say so.
    const grazed = advanceAnimals(
      next.animals,
      next.buildings,
      next.nodes,
      next.placeables,
      next.weather,
      next.time,
      CLOCK_STEP_MINUTES,
    );
    if (grazed !== next.animals) next = { ...next, animals: grazed };

    const slept = rollIfEveryoneAsleep(next);
    if (slept) {
      next = { ...slept.state, clockMs: next.clockMs };
      events.push(...slept.events);
    }
  }

  return { state: next, events };
}

/**
 * The single authority over farm state. Pure: the same state plus the same
 * intent always yields the same next state and the same events, with no I/O
 * and no dependency on Phaser, React, or the DOM.
 *
 * This function is what will later move to the server unchanged.
 */
export function applyIntent(state: FarmState, intent: Intent): ApplyResult {
  switch (intent.type) {
    case 'player/join': {
      // A returning member is not a new one: they keep their inventory and
      // the spot they logged out from, and take no extra seat.
      const existing = state.players[intent.playerId];
      if (existing) {
        if (existing.online) return unchanged(state);
        return {
          state: {
            ...state,
            revision: state.revision + 1,
            players: { ...state.players, [intent.playerId]: { ...existing, online: true } },
          },
          events: [{ kind: 'playerJoined', playerId: intent.playerId }],
        };
      }

      const taken = Object.keys(state.players).length;
      if (taken >= MAX_PLAYERS) return unchanged(state);
      const spawns = spawnPoints();
      return {
        state: {
          ...state,
          revision: state.revision + 1,
          players: {
            ...state.players,
            [intent.playerId]: createPlayer(intent.playerId, intent.name, spawns[taken % spawns.length]),
          },
        },
        events: [{ kind: 'playerJoined', playerId: intent.playerId }],
      };
    }

    case 'player/leave': {
      // Disconnecting, not moving out. The record stays so the world keeps a
      // place for them; only their presence ends.
      const player = state.players[intent.playerId];
      if (!player || !player.online) return unchanged(state);
      const left: FarmState = {
        ...state,
        revision: state.revision + 1,
        players: {
          ...state.players,
          // The cast goes with the connection, and this is the one piece of a
          // player that leaving takes. Everything else survives on purpose —
          // the satchel, the spot by the gate, the tool at the blacksmith —
          // because membership outlives a session. A cast does not: it is a
          // minigame with a second-wide window in it, and one left hanging
          // would be simulated on every tick for a player who is not there,
          // then resumed hours later with a fish that bit this morning.
          [intent.playerId]: { ...player, online: false, fishing: null },
        },
      };
      const events: GameEvent[] = [{ kind: 'playerLeft', playerId: intent.playerId }];

      // The last person awake logging off should end the night, not hang it.
      const rolled = rollIfEveryoneAsleep(left);
      return rolled ? { state: rolled.state, events: [...events, ...rolled.events] } : { state: left, events };
    }

    case 'player/move': {
      const player = state.players[intent.playerId];
      if (!player) return unchanged(state);
      // In bed. Getting up is an action, not a step.
      if (player.asleep) return unchanged(state);
      // A line in the water pins you to the bank. Dropped rather than treated
      // as a cancel, and spec 12 is right to insist on the difference: a
      // fumbled key at the wrong second should cost a step, never the fish.
      // Winding in is `player/cancelCast`, which is a thing somebody chose.
      if (player.fishing) return unchanged(state);

      const facing = facingFor(intent.dx, intent.dy, player.facing);
      // Running out of energy does not refuse the action, it drags: the
      // interesting decision is whether to push on, and a wall removes it.
      const speed = player.energy > 0 ? PLAYER_SPEED : PLAYER_SPEED * EXHAUSTED_SPEED_SCALE;
      // Buildings are state, not map, so collision has to be handed them.
      const position = resolveMove(
        player.area,
        player,
        intent.dx,
        intent.dy,
        intent.deltaMs,
        speed,
        blockersFor(state, player.area),
      );

      // Walking into a doorway is what moves a player between maps. Resolving
      // it here rather than in the renderer means the server decides where a
      // player ends up, and an offline client follows the identical rule.
      const portal = portalAt(player.area, position);
      if (portal && isAreaId(portal.toArea)) {
        const moved: PlayerState = {
          ...player,
          area: portal.toArea,
          x: portal.toX,
          y: portal.toY,
          facing,
          // Walking onto another map is the most definite way there is of
          // leaving a counter, and no map is obliged to keep its doorway out
          // of reach of one.
          panel: null,
          openChest: null,
        };
        const events: GameEvent[] = [
          { kind: 'areaChanged', playerId: intent.playerId, area: portal.toArea },
          say(intent.playerId, `Bạn theo con đường tới ${portal.label}.`),
        ];
        if (player.panel) {
          events.push({ kind: 'panelChanged', playerId: intent.playerId, panel: null });
        }
        return {
          state: {
            ...state,
            revision: state.revision + 1,
            players: { ...state.players, [intent.playerId]: moved },
          },
          events,
        };
      }

      // Walking out of range shuts the counter. A panel is tied to a place,
      // so a player who wandered off cannot keep trading from where they are.
      // It can only ever close here — a step never opens one — so the event
      // this emits always carries a null panel.
      const moved: PlayerState = { ...player, ...position, facing };
      const panel = panelSurvivesStep(state, moved) ? player.panel : null;
      const panelEvents: GameEvent[] =
        panel === player.panel ? [] : [{ kind: 'panelChanged', playerId: intent.playerId, panel: null }];

      if (
        position.x === player.x &&
        position.y === player.y &&
        facing === player.facing &&
        panel === player.panel
      ) {
        return unchanged(state);
      }
      return {
        state: {
          ...state,
          revision: state.revision + 1,
          players: {
            ...state.players,
            [intent.playerId]: { ...moved, panel, openChest: panel ? player.openChest : null },
          },
        },
        events: panelEvents,
      };
    }

    case 'player/selectSlot': {
      const player = state.players[intent.playerId];
      if (!player) return unchanged(state);
      // Checked again here even though the protocol already bounds-checked it:
      // an intent can also arrive from the offline path, which never parsed.
      if (!Number.isInteger(intent.slot) || intent.slot < 0 || intent.slot >= HOTBAR_SIZE) {
        return unchanged(state);
      }
      if (player.selectedSlot === intent.slot) return unchanged(state);

      const held = slotAt(player.inventory, intent.slot);
      const label = held ? (ITEMS[held.item]?.label ?? held.item) : '';
      return {
        state: {
          ...state,
          revision: state.revision + 1,
          players: { ...state.players, [intent.playerId]: { ...player, selectedSlot: intent.slot } },
        },
        events: [say(intent.playerId, held ? `Đang cầm ${label.toLowerCase()}.` : 'Tay không.')],
      };
    }

    case 'player/moveStack':
    case 'player/splitStack': {
      const player = state.players[intent.playerId];
      if (!player) return unchanged(state);
      const rearrange = intent.type === 'player/moveStack' ? moveStack : splitStack;
      // Both refuse an out-of-range index by returning the same array, so a
      // client asking for slot -1 or 999 bumps no revision and moves nothing.
      const inventory = rearrange(player.inventory, intent.from, intent.to);
      if (inventory === player.inventory) return unchanged(state);
      return {
        state: {
          ...state,
          revision: state.revision + 1,
          players: { ...state.players, [intent.playerId]: { ...player, inventory } },
        },
        events: [],
      };
    }

    case 'player/act':
      return applyAct(state, intent.playerId, intent.target);

    case 'player/sleep':
      return applySleep(state, intent.playerId);

    case 'shop/buy':
      return applyBuy(state, intent.playerId, intent.item, intent.count);

    case 'panel/close':
      return setPanel(state, intent.playerId, null);

    case 'player/upgradeTool':
      return applyUpgradeTool(state, intent.playerId, intent.item);

    case 'player/collectTool':
      return applyCollectTool(state, intent.playerId);

    case 'player/placeBuilding':
      return applyPlaceBuilding(state, intent.playerId, intent.kind, intent.x, intent.y);

    case 'player/buyAnimal':
      return applyBuyAnimal(state, intent.playerId, intent.kind, intent.home, intent.name);

    case 'player/sellAnimal':
      return applySellAnimal(state, intent.playerId, intent.animalId);

    case 'player/buyHay':
      return applyBuyHay(state, intent.playerId, intent.count);

    case 'player/petAnimal':
      return applyPetAnimal(state, intent.playerId, intent.animalId);

    case 'player/collectProduce':
      return applyCollectProduce(state, intent.playerId, intent.animalId);

    case 'player/feedAnimal':
      return applyFeedAnimal(state, intent.playerId, intent.animalId);

    case 'player/craft':
      return applyCraft(state, intent.playerId, intent.recipe, intent.count);

    case 'player/placeItem':
      return applyPlaceItem(state, intent.playerId, intent.item, intent.x, intent.y);

    case 'player/pickUpItem':
      return applyPickUpItem(state, intent.playerId, intent.x, intent.y);

    case 'chest/moveStack':
      return applyChestMoveStack(state, intent.playerId, intent.chestId, intent.from, intent.to);

    case 'chest/stow':
      return applyChestStow(state, intent.playerId, intent.chestId);

    case 'machine/load':
      return applyMachineLoad(state, intent.playerId, intent.machineId);

    case 'machine/collect':
      return applyMachineCollect(state, intent.playerId, intent.machineId);

    case 'animals/toggleDoor':
      return applyToggleDoor(state, intent.playerId, intent.buildingId);

    case 'player/cast':
      return applyCast(state, intent.playerId, intent.target);

    case 'player/reel':
      return applyReel(state, intent.playerId, intent.down);

    case 'player/cancelCast':
      return applyCancelCast(state, intent.playerId);

    case 'world/tick':
      return applyTick(state, intent.deltaMs);
  }
}
