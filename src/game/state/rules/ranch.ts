/**
 * The herd and the rancher.
 *
 * Petting, collecting, feeding and the coop door, the morning round a house
 * gets when somebody walks into it, and the rancher's counter that sells
 * animals and hay. Reach to an animal is decided here, once.
 */
import {
  ANIMAL_DEFS,
  HAY_PRICE,
  MAX_HAY_PURCHASE,
  animalById,
  animalsIn,
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
} from '../../systems/animals';
import {
  BUILDING_AREA,
  buildingDef,
  buildingTiles,
  isComplete,
  type Building,
} from '../../systems/buildings';
import { itemDef } from '../../systems/items';
import { isWithinReach, worldToTile } from '../../world/areas';
import type { ApplyResult, GameEvent } from '../intents';
import type { FarmState, PlayerId, PlayerState } from '../types';
import { unchanged, say } from './common';
import { counterAt } from './counters';

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
export function applyPetAnimal(state: FarmState, playerId: PlayerId, animalId: string): ApplyResult {
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
export function applyCollectProduce(state: FarmState, playerId: PlayerId, animalId: string): ApplyResult {
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
export function applyFeedAnimal(state: FarmState, playerId: PlayerId, animalId: string): ApplyResult {
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
export function applyToggleDoor(state: FarmState, playerId: PlayerId, buildingId: string): ApplyResult {
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
export function applyAnimalAct(state: FarmState, playerId: PlayerId, animal: Animal): ApplyResult {
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
export function applyHouseChores(state: FarmState, playerId: PlayerId, building: Building): ApplyResult {
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
export function applyBuyAnimal(
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
export function applySellAnimal(state: FarmState, playerId: PlayerId, animalId: string): ApplyResult {
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
export function applyBuyHay(state: FarmState, playerId: PlayerId, count: number): ApplyResult {
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
