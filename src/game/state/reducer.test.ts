import { describe, expect, it } from 'vitest';
import { ACTION_ENERGY_COST, CROP_DEFINITIONS } from '../systems/farming';
import {
  HOTBAR_SIZE,
  INVENTORY_SIZE,
  addItem,
  countItem,
  newStack,
  type Inventory,
} from '../systems/inventory';
import { BUILDING_DEFS, buildingTiles, checkPlacement, isComplete } from '../systems/buildings';
import {
  ANIMAL_DEFS,
  HAY_PRICE,
  SILO_CAPACITY,
  capacityOf,
  hasProduce,
  resalePrice,
} from '../systems/animals';
import { NPCS, type NpcId } from '../npcs/definitions';
import { ALL_RECIPES } from '../systems/crafting';
import {
  MACHINE_DEFS,
  createPlaceable,
  solidPlaceableRects,
  type Chest,
  type Machine,
  type Placeable,
} from '../systems/placeables';
import { POINTS_PER_HEART, REACTION_POINTS } from '../npcs/relationships';
import { entryPosition, scheduleEntryAt, type NpcActor } from '../npcs/schedule';
import { ITEMS, WATERING_CAN_CHARGES, type CropId, type ItemId } from '../systems/items';
import { QUEST_REWARD_COINS } from '../systems/quest';
import { DAY_END, DAY_START, SEASON_DAYS, createTimeState, seasonForDay } from '../systems/time';
import {
  START_AREA,
  TILE_SIZE,
  areaMap,
  interactableAt,
  isWalkable,
  isWithinReach,
  plotKey,
  spawnPoints,
  tileAt,
  type AreaId,
} from '../world/areas';
import { nodeAt, nodeDef, type NodeKind, type ResourceNode } from '../systems/resources';
import { CAST_ENERGY } from '../systems/fishing';
import { CLOCK_STEP_MINUTES, CLOCK_STEP_MS, applyIntent, createFarmState } from './reducer';
import type { ApplyResult, GameEvent } from './intents';
import {
  COLLAPSE_COIN_CAP,
  MAX_PLAYERS,
  STARTING_MAX_ENERGY,
  UPGRADE_DAYS,
  type FarmState,
  type PlayerId,
} from './types';

/** Where the starting tools and seeds sit, by the layout `createInventory` uses. */
const SLOT = {
  hoe: 0,
  can: 1,
  basket: 2,
  axe: 3,
  pickaxe: 4,
  scythe: 5,
  turnipSeeds: 6,
  berrySeeds: 7,
};

/** Puts a player's hand on a slot without going through the intent. */
function holding(state: FarmState, id: PlayerId, slot: number): FarmState {
  return { ...state, players: { ...state.players, [id]: { ...state.players[id], selectedSlot: slot } } };
}

/** Gives a player some of an item, failing loudly if it would not fit. */
function give(state: FarmState, id: PlayerId, item: ItemId, count: number): FarmState {
  const inventory = addItem(state.players[id].inventory, item, count);
  if (!inventory) throw new Error(`no room for ${count} ${item}`);
  return { ...state, players: { ...state.players, [id]: { ...state.players[id], inventory } } };
}

/** Replaces one slot outright, to reach a state the game would take a day to. */
function setSlot(state: FarmState, id: PlayerId, slot: number, stack: Inventory[number]): FarmState {
  const inventory = state.players[id].inventory.map((existing, i) => (i === slot ? stack : existing));
  return { ...state, players: { ...state.players, [id]: { ...state.players[id], inventory } } };
}

function join(state: FarmState, ...ids: PlayerId[]): FarmState {
  return ids.reduce((acc, id) => applyIntent(acc, { type: 'player/join', playerId: id, name: id }).state, state);
}

/** Places a player at a world position without going through movement. */
function place(state: FarmState, id: PlayerId, x: number, y: number, area: AreaId = START_AREA): FarmState {
  return { ...state, players: { ...state.players, [id]: { ...state.players[id], area, x, y } } };
}

/**
 * The farmable tiles a swing would actually reach soil on.
 *
 * Filtered against a fresh world's brambles rather than taken straight off the
 * map: since spec 10 a third of the field starts under weeds, and a swing at
 * one of those clears the weed rather than tilling the bed. Every test below
 * that asks for soil means soil.
 */
const FIELD = (() => {
  const fresh = createFarmState();
  return areaMap(START_AREA).plotTiles.filter(
    (tile) => !nodeAt(fresh.nodes, START_AREA, tile.x, tile.y),
  );
})();

/** A copy of the farm with nothing standing on it, for tests about the soil. */
function bareGround(state: FarmState): FarmState {
  return { ...state, nodes: [] };
}

/** Where Rowan and the market stand, read off the map rather than hard-coded. */
function propCentreOf(interact: string): { x: number; y: number } {
  for (const area of ['farm', 'village'] as const) {
    for (const prop of areaMap(area).props) {
      if (prop.interact === interact) {
        return { x: prop.x + prop.width / 2, y: prop.y + prop.height / 2 };
      }
    }
  }
  throw new Error(`No prop interacts as "${interact}".`);
}

/**
 * Where a villager is standing right now, read off the world.
 *
 * Villagers walk, so nothing about their position can be hard-coded or read
 * off the map: `FarmState` is the only thing that knows where Rowan is at
 * nine in the morning on the first day of spring.
 */
function npcAt(state: FarmState, id: NpcId): NpcActor {
  const actor = state.npcs.find((npc) => npc.id === id);
  if (!actor) throw new Error(`No villager called "${id}" in the world.`);
  return actor;
}

/** Which area a given interactive prop lives on. */
function propArea(interact: string): 'farm' | 'village' {
  for (const area of ['farm', 'village'] as const) {
    if (areaMap(area).props.some((prop) => prop.interact === interact)) return area;
  }
  throw new Error(`No prop interacts as "${interact}".`);
}

/** Puts a ripe turnip in a plot so harvest paths can be exercised directly. */
function ripen(state: FarmState, x: number, y: number): FarmState {
  const key = plotKey(START_AREA, x, y);
  return {
    ...state,
    plots: {
      ...state.plots,
      [key]: { ...state.plots[key], stage: 'mature', crop: 'turnip', daysWatered: 2, wateredToday: false },
    },
  };
}

/** Stands a player one tile below `tile`, facing up at it. */
function faceTileFromBelow(state: FarmState, id: PlayerId, tileX: number, tileY: number): FarmState {
  const placed = place(state, id, tileX * TILE_SIZE + 16, (tileY + 1) * TILE_SIZE + 16, START_AREA);
  return { ...placed, players: { ...placed.players, [id]: { ...placed.players[id], facing: 'up' } } };
}

/** Stands a player at the foot of the bed, which is inside the farmhouse. */
function standAtBed(state: FarmState, id: PlayerId): FarmState {
  const bed = areaMap('farmhouse').props.find((prop) => prop.interact === 'bed')!;
  return place(state, id, bed.x + bed.width / 2, bed.y + bed.height + 8, 'farmhouse');
}

/** Runs the clock forward by whole in-game minutes, collecting every event. */
function runClock(state: FarmState, minutes: number): { state: FarmState; events: GameEvent[] } {
  let next = state;
  const events: GameEvent[] = [];
  for (let i = 0; i < minutes / CLOCK_STEP_MINUTES; i += 1) {
    const result = applyIntent(next, { type: 'world/tick', deltaMs: CLOCK_STEP_MS });
    next = result.state;
    events.push(...result.events);
  }
  return { state: next, events };
}


/**
 * Puts everybody to bed and collects the morning that follows.
 *
 * The only way to reach a new day through the reducer, which is the point: a
 * test that reached in and bumped `time.day` would skip every overnight step
 * this spec cares about.
 */
function sleepThrough(state: FarmState): { state: FarmState; events: GameEvent[] } {
  let next = state;
  const events: GameEvent[] = [];
  for (const id of Object.keys(next.players)) {
    next = standAtBed(next, id);
    const result = applyIntent(next, { type: 'player/sleep', playerId: id });
    next = result.state;
    events.push(...result.events);
  }
  return { state: next, events };
}

describe('player seats', () => {
  it('seats up to the player cap and refuses the next arrival', () => {
    let state = createFarmState();
    for (let i = 0; i < MAX_PLAYERS; i += 1) {
      state = applyIntent(state, { type: 'player/join', playerId: `p${i}`, name: `P${i}` }).state;
    }
    expect(Object.keys(state.players)).toHaveLength(MAX_PLAYERS);

    const overflow = applyIntent(state, { type: 'player/join', playerId: 'extra', name: 'Extra' });

    expect(overflow.state).toBe(state);
    expect(overflow.events).toHaveLength(0);
  });

  it('gives each player a distinct spawn point', () => {
    const state = join(createFarmState(), 'a', 'b');
    const [a, b] = [state.players.a, state.players.b];

    expect([a.x, a.y]).not.toEqual([b.x, b.y]);
  });

  it('ignores a duplicate join without disturbing the seated player', () => {
    const state = join(createFarmState(), 'a');
    const again = applyIntent(state, { type: 'player/join', playerId: 'a', name: 'Impostor' });

    expect(again.state).toBe(state);
  });

  it('keeps a member when they leave, marking them away rather than gone', () => {
    let state = join(createFarmState(), 'a', 'b');
    state = give(state, 'a', 'wood', 37);

    const after = applyIntent(state, { type: 'player/leave', playerId: 'a' }).state;

    expect(after.players.a.online).toBe(false);
    expect(countItem(after.players.a.inventory, 'wood')).toBe(37);
    expect(after.players.b.online).toBe(true);
  });

  it('gives a returning member their own things back, not a new start', () => {
    let state = join(createFarmState(), 'a');
    state = give(state, 'a', 'wood', 37);
    state = { ...state, players: { ...state.players, a: { ...state.players.a, x: 500, y: 400 } } };
    state = applyIntent(state, { type: 'player/leave', playerId: 'a' }).state;

    const back = applyIntent(state, { type: 'player/join', playerId: 'a', name: 'A' }).state;

    expect(back.players.a.online).toBe(true);
    expect(countItem(back.players.a.inventory, 'wood')).toBe(37);
    expect(back.players.a.x).toBe(500);
  });

  it('does not spend a seat on a member who comes back', () => {
    let state = createFarmState();
    for (let i = 0; i < MAX_PLAYERS; i += 1) {
      state = applyIntent(state, { type: 'player/join', playerId: `p${i}`, name: `P${i}` }).state;
    }
    state = applyIntent(state, { type: 'player/leave', playerId: 'p0' }).state;

    const back = applyIntent(state, { type: 'player/join', playerId: 'p0', name: 'P0' }).state;

    expect(back.players.p0.online).toBe(true);
    expect(Object.keys(back.players)).toHaveLength(MAX_PLAYERS);
  });
});

describe('shared wallet, private satchel', () => {
  it('credits the farm wallet but empties only the selling player inventory', () => {
    let state = join(createFarmState(), 'a', 'b');
    state = give(state, 'a', 'turnip', 3);
    state = give(state, 'b', 'turnip', 2);
    const market = propCentreOf('market');
    state = place(state, 'a', market.x, market.y, propArea('market'));
    const walletBefore = state.coins;

    const result = applyIntent(state, { type: 'player/act', playerId: 'a' });

    expect(result.state.coins).toBe(walletBefore + 3 * ITEMS.turnip.sellPrice);
    expect(countItem(result.state.players.a.inventory, 'turnip')).toBe(0);
    expect(countItem(result.state.players.b.inventory, 'turnip')).toBe(2);
  });

  it('spends seeds from the acting player inventory only', () => {
    let state = join(createFarmState(), 'a', 'b');
    const cell = FIELD[0];
    const cellKey = plotKey(START_AREA, cell.x, cell.y);
    state = faceTileFromBelow(state, 'a', cell.x, cell.y);
    state = { ...state, plots: { ...state.plots, [cellKey]: { ...state.plots[cellKey], stage: 'tilled' } } };
    state = holding(state, 'a', SLOT.turnipSeeds);

    const after = applyIntent(state, { type: 'player/act', playerId: 'a' }).state;

    expect(countItem(after.players.a.inventory, 'turnip-seeds')).toBe(7);
    expect(countItem(after.players.b.inventory, 'turnip-seeds')).toBe(8);
  });
});

describe('farm-wide quest', () => {
  it('lets one player harvest and another claim the reward, once', () => {
    let state = holding(join(createFarmState(), 'a', 'b'), 'a', SLOT.basket);

    // Player A harvests the three turnips the quest asks for.
    for (const { x, y } of FIELD.slice(0, 3)) {
      state = ripen(state, x, y);
      state = faceTileFromBelow(state, 'a', x, y);
      state = applyIntent(state, { type: 'player/act', playerId: 'a' }).state;
    }

    expect(state.quest.progress).toBe(3);
    expect(state.quest.completed).toBe(true);

    // Player B, who harvested nothing, can still collect for the farm.
    // Rowan walks a schedule now, so where he is standing is asked of the
    // world rather than of the map.
    const rowan = npcAt(state, 'rowan');
    state = place(state, 'b', rowan.x, rowan.y + 28, rowan.area);
    const walletBefore = state.coins;
    const claim = applyIntent(state, { type: 'player/act', playerId: 'b' });

    expect(claim.state.coins).toBe(walletBefore + QUEST_REWARD_COINS);
    expect(claim.events).toContainEqual({ kind: 'questRewarded', playerId: 'b', coins: QUEST_REWARD_COINS });

    // A second claim by anyone pays nothing.
    const second = applyIntent(claim.state, { type: 'player/act', playerId: 'b' });
    expect(second.state.coins).toBe(claim.state.coins);
  });
});

describe('movement', () => {
  it('refuses to walk into the pond', () => {
    let state = join(createFarmState(), 'a');
    // Just east of the pond, which covers tiles x <= 7 at y >= 23.
    state = place(state, 'a', 8 * TILE_SIZE + 4, 25 * TILE_SIZE);

    const after = applyIntent(state, { type: 'player/move', playerId: 'a', dx: -1, dy: 0, deltaMs: 200 }).state;

    expect(after.players.a.x).toBe(state.players.a.x);
  });

  it('turns to face the direction of travel', () => {
    const state = join(createFarmState(), 'a');
    const after = applyIntent(state, { type: 'player/move', playerId: 'a', dx: 1, dy: 0, deltaMs: 16 }).state;

    expect(after.players.a.facing).toBe('right');
  });

  it('walks into the farmhouse and back out onto the same doorstep', () => {
    // The round trip through the front door, through the reducer, because the
    // reducer is what decides where a player lands. A landing tile that was
    // itself a doorway would bounce a player between the two maps on every
    // step, which is a hung game rather than a wrong picture.
    const doorstep = { x: 5 * TILE_SIZE + 16, y: 7 * TILE_SIZE + 16 };
    let state = place(join(createFarmState(), 'a'), 'a', doorstep.x, doorstep.y);

    const inward = applyIntent(state, { type: 'player/move', playerId: 'a', dx: 0, dy: -1, deltaMs: 250 });
    state = inward.state;
    expect(state.players.a.area).toBe('farmhouse');
    expect(inward.events).toContainEqual({ kind: 'areaChanged', playerId: 'a', area: 'farmhouse' });
    const landed = { x: state.players.a.x, y: state.players.a.y };

    // A step further in stays in: landing did not put anybody on a portal.
    const settled = applyIntent(state, { type: 'player/move', playerId: 'a', dx: 0, dy: -1, deltaMs: 16 }).state;
    expect(settled.players.a.area).toBe('farmhouse');

    // Straight back down the way they came.
    state = applyIntent(state, { type: 'player/move', playerId: 'a', dx: 0, dy: 1, deltaMs: 250 }).state;
    expect(state.players.a.area).toBe('farm');
    expect({ x: state.players.a.x, y: state.players.a.y }).toEqual(doorstep);
    expect(landed).toEqual({ x: 6 * TILE_SIZE + 16, y: 7 * TILE_SIZE + 16 });
  });

  it('ignores movement intents for an unknown player', () => {
    const state = join(createFarmState(), 'a');
    const after = applyIntent(state, { type: 'player/move', playerId: 'ghost', dx: 1, dy: 0, deltaMs: 16 });

    expect(after.state).toBe(state);
  });
});

describe('shared clock', () => {
  it('banks partial ticks instead of dropping them', () => {
    const state = join(createFarmState(), 'a');
    const after = applyIntent(state, { type: 'world/tick', deltaMs: 400 }).state;

    expect(after.clockMs).toBe(400);
    expect(after.time.totalMinutes).toBe(state.time.totalMinutes);
  });

  it('advances the clock for everyone at once', () => {
    const state = join(createFarmState(), 'a', 'b');
    const after = applyIntent(state, { type: 'world/tick', deltaMs: CLOCK_STEP_MS }).state;

    expect(after.time.totalMinutes).toBe(state.time.totalMinutes + CLOCK_STEP_MINUTES);
  });

  it('makes a day from 6am to 2am last about as long as a Stardew day', () => {
    const realMinutes = ((20 * 60) / CLOCK_STEP_MINUTES) * CLOCK_STEP_MS / 60_000;

    expect(realMinutes).toBeGreaterThanOrEqual(10);
    expect(realMinutes).toBeLessThanOrEqual(15);
  });

  it('rolls the day over and refills every player watering can', () => {
    let state = join(createFarmState(), 'a', 'b');
    state = setSlot(state, 'a', SLOT.can, { item: 'watering-can', count: 1, charges: 0 });
    state = setSlot(state, 'b', SLOT.can, { item: 'watering-can', count: 1, charges: 3 });

    // 6am to 2am is 20 in-game hours, and nobody went to bed, so it ends in a
    // collapse — which still hands the farm a morning.
    const { state: morning, events } = runClock(state, DAY_END - DAY_START + 10);
    state = morning;

    expect(state.time.day).toBe(2);
    expect(state.players.a.inventory[SLOT.can]?.charges).toBe(WATERING_CAN_CHARGES);
    expect(state.players.b.inventory[SLOT.can]?.charges).toBe(WATERING_CAN_CHARGES);
    expect(events.some((event) => event.kind === 'dayStarted')).toBe(true);
  });
});

describe('energy', () => {
  /** Stands a player at the first plot holding a slot, ready to swing. */
  function readyToWork(id: PlayerId, slot: number): FarmState {
    const cell = FIELD[0];
    const state = faceTileFromBelow(join(createFarmState(), id), id, cell.x, cell.y);
    return holding(state, id, slot);
  }

  it('starts everyone with a full day in them', () => {
    const state = join(createFarmState(), 'a');

    expect(state.players.a.energy).toBe(STARTING_MAX_ENERGY);
    expect(state.players.a.maxEnergy).toBe(STARTING_MAX_ENERGY);
  });

  it('charges for tilling', () => {
    const state = readyToWork('a', SLOT.hoe);

    const after = applyIntent(state, { type: 'player/act', playerId: 'a' }).state;

    expect(after.players.a.energy).toBe(STARTING_MAX_ENERGY - ACTION_ENERGY_COST.till);
  });

  it('charges nothing for an action the plot refused', () => {
    // Tilling soil that is already tilled changes nothing, so it costs nothing.
    let state = readyToWork('a', SLOT.hoe);
    state = applyIntent(state, { type: 'player/act', playerId: 'a' }).state;
    const rested = state.players.a.energy;

    const after = applyIntent(state, { type: 'player/act', playerId: 'a' });

    expect(after.state.players.a.energy).toBe(rested);
    expect(after.state).toBe(state);
  });

  it('lets a player harvest all day for free', () => {
    const cell = FIELD[0];
    let state = readyToWork('a', SLOT.basket);
    state = ripen(state, cell.x, cell.y);

    const after = applyIntent(state, { type: 'player/act', playerId: 'a' }).state;

    expect(countItem(after.players.a.inventory, 'turnip')).toBe(1);
    expect(after.players.a.energy).toBe(STARTING_MAX_ENERGY);
  });

  it('stops at zero rather than going into debt, and says so once', () => {
    let state = readyToWork('a', SLOT.hoe);
    state = { ...state, players: { ...state.players, a: { ...state.players.a, energy: 1 } } };

    const first = applyIntent(state, { type: 'player/act', playerId: 'a' });
    expect(first.state.players.a.energy).toBe(0);
    expect(first.events).toContainEqual({ kind: 'exhausted', playerId: 'a' });

    // Working on is still allowed, costs nothing more, and is not announced twice.
    const next = faceTileFromBelow(first.state, 'a', FIELD[1].x, FIELD[1].y);
    const second = applyIntent(next, { type: 'player/act', playerId: 'a' });

    expect(second.state.players.a.energy).toBe(0);
    expect(second.state.plots[plotKey(START_AREA, FIELD[1].x, FIELD[1].y)].stage).toBe('tilled');
    expect(second.events.some((event) => event.kind === 'exhausted')).toBe(false);
  });

  it('drags an exhausted player to half speed', () => {
    let state = join(createFarmState(), 'a', 'b');
    const spawn = spawnPoints()[0];
    state = place(state, 'a', spawn.x, spawn.y);
    state = place(state, 'b', spawn.x, spawn.y);
    state = { ...state, players: { ...state.players, b: { ...state.players.b, energy: 0 } } };

    const rested = applyIntent(state, { type: 'player/move', playerId: 'a', dx: 1, dy: 0, deltaMs: 100 }).state;
    const spent = applyIntent(state, { type: 'player/move', playerId: 'b', dx: 1, dy: 0, deltaMs: 100 }).state;

    const restedStep = rested.players.a.x - state.players.a.x;
    const spentStep = spent.players.b.x - state.players.b.x;

    expect(restedStep).toBeGreaterThan(0);
    expect(spentStep).toBeCloseTo(restedStep / 2, 6);
  });
});

describe('sleeping', () => {
  function inBed(...ids: PlayerId[]): FarmState {
    return ids.reduce((state, id) => standAtBed(state, id), join(createFarmState(), ...ids));
  }

  it('refuses to turn in away from a bed', () => {
    const state = join(createFarmState(), 'a');

    const after = applyIntent(state, { type: 'player/sleep', playerId: 'a' });

    expect(after.state).toBe(state);
    expect(after.state.players.a.asleep).toBe(false);
  });

  it('puts a player to bed when they act at the bed', () => {
    const state = inBed('a', 'b');

    const after = applyIntent(state, { type: 'player/act', playerId: 'a' });

    expect(after.state.players.a.asleep).toBe(true);
    expect(after.events).toContainEqual({ kind: 'sleepChanged', playerId: 'a', asleep: true });
  });

  it('is idempotent, and waking up re-opens the vote', () => {
    let state = inBed('a', 'b');
    state = applyIntent(state, { type: 'player/sleep', playerId: 'a' }).state;
    const day = state.time.day;

    // Asleep twice is not asleep-er: the toggle is what gets a player up again.
    state = applyIntent(state, { type: 'player/sleep', playerId: 'a' }).state;
    expect(state.players.a.asleep).toBe(false);

    state = applyIntent(state, { type: 'player/sleep', playerId: 'a' }).state;
    expect(state.players.a.asleep).toBe(true);
    expect(state.time.day).toBe(day);
  });

  it('rolls the day only once the last player awake turns in', () => {
    let state = inBed('a', 'b');

    state = applyIntent(state, { type: 'player/sleep', playerId: 'a' }).state;
    expect(state.time.day).toBe(1);

    const result = applyIntent(state, { type: 'player/sleep', playerId: 'b' });

    expect(result.state.time.day).toBe(2);
    expect(result.state.time.totalMinutes).toBe(DAY_START);
    expect(result.events.some((event) => event.kind === 'dayStarted')).toBe(true);
    // Everybody is up again in the morning, wherever they slept.
    expect(Object.values(result.state.players).every((player) => !player.asleep)).toBe(true);
  });

  it('does not let an offline member hold the night open', () => {
    let state = inBed('a', 'b');
    state = applyIntent(state, { type: 'player/leave', playerId: 'b' }).state;

    const result = applyIntent(state, { type: 'player/sleep', playerId: 'a' });

    expect(result.state.time.day).toBe(2);
  });

  it('ends the night when the last player awake disconnects', () => {
    let state = inBed('a', 'b');
    state = applyIntent(state, { type: 'player/sleep', playerId: 'a' }).state;

    const result = applyIntent(state, { type: 'player/leave', playerId: 'b' });

    expect(result.state.time.day).toBe(2);
    expect(result.events.some((event) => event.kind === 'dayStarted')).toBe(true);
  });

  it('does not roll the day on a farm nobody is on', () => {
    let state = inBed('a');
    state = applyIntent(state, { type: 'player/sleep', playerId: 'a' }).state;
    expect(state.time.day).toBe(2);

    // Nobody is connected now, so there is no vote to be unanimous about.
    state = applyIntent(state, { type: 'player/leave', playerId: 'a' }).state;
    const after = runClock(state, 60).state;

    expect(after.time.day).toBe(2);
  });

  it('restores a full day of energy in the morning', () => {
    let state = inBed('a');
    state = { ...state, players: { ...state.players, a: { ...state.players.a, energy: 4 } } };

    state = applyIntent(state, { type: 'player/sleep', playerId: 'a' }).state;

    expect(state.players.a.energy).toBe(STARTING_MAX_ENERGY);
  });

  it('keeps a sleeping player in bed rather than letting them walk out of reach', () => {
    let state = inBed('a', 'b');
    state = applyIntent(state, { type: 'player/sleep', playerId: 'a' }).state;

    const after = applyIntent(state, { type: 'player/move', playerId: 'a', dx: 1, dy: 1, deltaMs: 200 });

    expect(after.state).toBe(state);
  });
});

describe('collapsing at 02:00', () => {
  /** Ten in-game minutes before the night runs out, with one player still up. */
  function atClosingTime(coins: number): FarmState {
    let state = join(createFarmState(), 'a', 'b');
    state = { ...state, coins, time: createTimeState(state.time.day, DAY_END - 10) };
    return { ...state, players: { ...state.players, b: { ...state.players.b, asleep: true } } };
  }

  it('charges a tenth of the wallet and wakes everyone half rested', () => {
    const cell = FIELD[0];
    let state = atClosingTime(400);
    state = { ...state, players: { ...state.players, a: { ...state.players.a, energy: 200 } } };
    state = ripen(state, cell.x, cell.y);
    state = give(state, 'a', 'turnip', 4);
    const carried = state.players.a.inventory;

    const { state: morning, events } = runClock(state, 10);

    expect(morning.coins).toBe(360);
    expect(events).toContainEqual({ kind: 'collapsed', coinsLost: 40 });
    expect(morning.players.a.energy).toBe(Math.floor(STARTING_MAX_ENERGY / 2));
    expect(morning.players.b.energy).toBe(Math.floor(STARTING_MAX_ENERGY / 2));
    // Never the crops: the person who stayed up is not the only one who pays.
    expect(morning.plots[plotKey(START_AREA, cell.x, cell.y)].crop).toBe('turnip');
    expect(countItem(morning.players.a.inventory, 'turnip')).toBe(countItem(carried, 'turnip'));
    expect(countItem(morning.players.a.inventory, 'turnip-seeds')).toBe(
      countItem(carried, 'turnip-seeds'),
    );
  });

  it('never takes more than the cap, however rich the farm is', () => {
    const { events } = runClock(atClosingTime(100_000), 10);

    expect(events).toContainEqual({ kind: 'collapsed', coinsLost: COLLAPSE_COIN_CAP });
  });

  it('leaves a broke farm at zero rather than in debt', () => {
    const { state: morning } = runClock(atClosingTime(0), 10);

    expect(morning.coins).toBe(0);
  });

  it('does not charge a farm nobody was awake on', () => {
    let state = atClosingTime(400);
    state = applyIntent(state, { type: 'player/leave', playerId: 'a' }).state;
    state = applyIntent(state, { type: 'player/leave', playerId: 'b' }).state;

    const { state: morning, events } = runClock(state, 10);

    expect(morning.coins).toBe(400);
    expect(morning.time.day).toBe(2);
    expect(events.some((event) => event.kind === 'collapsed')).toBe(false);
  });
});

describe('reducer contract', () => {
  it('never mutates the state it was given', () => {
    const state = join(createFarmState(), 'a');
    const before = JSON.stringify(state);

    applyIntent(state, { type: 'player/move', playerId: 'a', dx: 1, dy: 1, deltaMs: 50 });
    applyIntent(state, { type: 'player/act', playerId: 'a' });
    applyIntent(state, { type: 'world/tick', deltaMs: 4000 });

    expect(JSON.stringify(state)).toBe(before);
  });

  it('produces state that survives a JSON round trip', () => {
    const state = applyIntent(join(createFarmState(), 'a'), { type: 'world/tick', deltaMs: 1200 }).state;
    const roundTripped = JSON.parse(JSON.stringify(state)) as FarmState;

    expect(roundTripped).toEqual(state);
  });

  it('bumps the revision only when something actually changed', () => {
    const state = join(createFarmState(), 'a');
    const noop = applyIntent(state, { type: 'player/selectSlot', playerId: 'a', slot: 0 });
    const real = applyIntent(state, { type: 'player/selectSlot', playerId: 'a', slot: 1 });

    expect(noop.state.revision).toBe(state.revision);
    expect(real.state.revision).toBe(state.revision + 1);
  });
});

describe('holding a slot', () => {
  it('puts the named slot in hand and says what is in it', () => {
    const state = join(createFarmState(), 'a');

    const result = applyIntent(state, { type: 'player/selectSlot', playerId: 'a', slot: SLOT.can });

    expect(result.state.players.a.selectedSlot).toBe(SLOT.can);
    expect(result.events).toContainEqual({
      kind: 'message',
      playerId: 'a',
      text: 'Đang cầm bình tưới.',
    });
  });

  it('holds an empty slot happily, and acting with it does nothing', () => {
    let state = join(createFarmState(), 'a');
    const cell = FIELD[0];
    state = faceTileFromBelow(state, 'a', cell.x, cell.y);
    state = applyIntent(state, { type: 'player/selectSlot', playerId: 'a', slot: 11 }).state;

    const after = applyIntent(state, { type: 'player/act', playerId: 'a' });

    expect(after.state).toBe(state);
    expect(after.state.plots[plotKey(START_AREA, cell.x, cell.y)].stage).toBe('wild');
  });

  it('does nothing when the held item is not a tool', () => {
    const cell = FIELD[0];
    let state = join(createFarmState(), 'a');
    state = faceTileFromBelow(state, 'a', cell.x, cell.y);
    state = setSlot(state, 'a', 5, newStack('wood', 3));
    state = holding(state, 'a', 5);

    const after = applyIntent(state, { type: 'player/act', playerId: 'a' });

    expect(after.state).toBe(state);
  });

  it('refuses a slot outside the hotbar, however the intent got here', () => {
    const state = join(createFarmState(), 'a');

    for (const slot of [-1, HOTBAR_SIZE, INVENTORY_SIZE, 999, 1.5, Number.NaN]) {
      expect(applyIntent(state, { type: 'player/selectSlot', playerId: 'a', slot }).state).toBe(state);
    }
  });
});

describe('rearranging the satchel', () => {
  it('merges two stacks of the same item', () => {
    let state = join(createFarmState(), 'a');
    state = setSlot(state, 'a', 20, newStack('turnip-seeds', 4));

    const after = applyIntent(state, {
      type: 'player/moveStack',
      playerId: 'a',
      from: 20,
      to: SLOT.turnipSeeds,
    }).state;

    expect(after.players.a.inventory[SLOT.turnipSeeds]?.count).toBe(12);
    expect(after.players.a.inventory[20]).toBeNull();
  });

  it('swaps something into the hotbar and the thing it displaced out of it', () => {
    let state = join(createFarmState(), 'a');
    state = setSlot(state, 'a', 18, newStack('wood', 2));

    const after = applyIntent(state, {
      type: 'player/moveStack',
      playerId: 'a',
      from: 18,
      to: SLOT.hoe,
    }).state;

    expect(after.players.a.inventory[SLOT.hoe]?.item).toBe('wood');
    expect(after.players.a.inventory[18]?.item).toBe('hoe');
  });

  it('ignores out-of-range indices without throwing or bumping the revision', () => {
    const state = join(createFarmState(), 'a');

    for (const [from, to] of [
      [-1, 0],
      [0, -1],
      [0, 999],
      [999, 0],
      [1.5, 2],
      [Number.NaN, 0],
    ]) {
      expect(applyIntent(state, { type: 'player/moveStack', playerId: 'a', from, to }).state).toBe(state);
      expect(applyIntent(state, { type: 'player/splitStack', playerId: 'a', from, to }).state).toBe(state);
    }
  });

  it('halves a stack into an empty slot', () => {
    const state = join(createFarmState(), 'a');

    const after = applyIntent(state, {
      type: 'player/splitStack',
      playerId: 'a',
      from: SLOT.turnipSeeds,
      to: 12,
    }).state;

    expect(after.players.a.inventory[SLOT.turnipSeeds]?.count).toBe(4);
    expect(after.players.a.inventory[12]?.count).toBe(4);
  });
});

describe('a full satchel', () => {
  it('refuses the harvest and leaves the crop standing', () => {
    const cell = FIELD[0];
    let state = join(createFarmState(), 'a');
    state = faceTileFromBelow(state, 'a', cell.x, cell.y);
    state = ripen(state, cell.x, cell.y);

    // Every slot taken by something that is not a turnip, the basket included.
    const packed: Inventory = Array.from({ length: INVENTORY_SIZE }, () => newStack('wood', 1));
    packed[SLOT.basket] = newStack('basket');
    state = { ...state, players: { ...state.players, a: { ...state.players.a, inventory: packed } } };
    state = holding(state, 'a', SLOT.basket);

    const result = applyIntent(state, { type: 'player/act', playerId: 'a' });

    expect(result.state).toBe(state);
    expect(result.state.plots[plotKey(START_AREA, cell.x, cell.y)].stage).toBe('mature');
    expect(result.events).toContainEqual({
      kind: 'message',
      playerId: 'a',
      text: 'Không còn chỗ cho Củ cải. Nó nằm chờ dưới đất.',
    });
  });
});

describe('the season turning', () => {
  /** A farm on the last night of a season, with `crop` in the first plot. */
  function nightBeforeSpringEnds(crop: CropId): { state: FarmState; key: string } {
    const cell = FIELD[0];
    const key = plotKey(START_AREA, cell.x, cell.y);
    const base = join(createFarmState(), 'a');
    const day = SEASON_DAYS;
    return {
      key,
      state: {
        ...base,
        time: createTimeState(day),
        season: seasonForDay(day),
        plots: {
          ...base.plots,
          [key]: {
            ...base.plots[key],
            stage: 'mature',
            crop,
            daysWatered: CROP_DEFINITIONS[crop].growDays,
            wateredToday: false,
          },
        },
      },
    };
  }

  /** Sleeps everybody through to the next morning. */
  function sleepThroughTheNight(state: FarmState) {
    return applyIntent(standAtBed(state, 'a'), { type: 'player/sleep', playerId: 'a' });
  }

  it('clears a crop the incoming season will not grow, and says which', () => {
    const { state, key } = nightBeforeSpringEnds('turnip');

    const morning = sleepThroughTheNight(state);

    expect(morning.state.season).toBe('Summer');
    expect(morning.state.plots[key].crop).toBeNull();
    expect(morning.state.plots[key].stage).toBe('tilled');
    expect(morning.events).toContainEqual({
      kind: 'cropsWithered',
      count: 1,
      season: 'Summer',
      crops: ['turnip'],
    });
    // The renderer has to be told, or the sprite stays in a plot that is bare.
    expect(morning.events).toContainEqual({ kind: 'plotChanged', key });
  });

  it('leaves a crop that lists the incoming season exactly where it was', () => {
    // Wheat runs summer into autumn, so it is the crop that survives a turn.
    const cell = FIELD[0];
    const key = plotKey(START_AREA, cell.x, cell.y);
    const base = join(createFarmState(), 'a');
    const day = SEASON_DAYS * 2;
    const state: FarmState = {
      ...base,
      time: createTimeState(day),
      season: seasonForDay(day),
      plots: {
        ...base.plots,
        [key]: { ...base.plots[key], stage: 'mature', crop: 'wheat', daysWatered: 3, wateredToday: false },
      },
    };

    const morning = sleepThroughTheNight(state);

    expect(morning.state.season).toBe('Autumn');
    expect(morning.state.plots[key].crop).toBe('wheat');
    expect(morning.state.plots[key].stage).toBe('mature');
    expect(morning.events.filter((event) => event.kind === 'cropsWithered')).toEqual([]);
  });

  it('kills an established regrowing crop at the boundary like any other', () => {
    const { state, key } = nightBeforeSpringEnds('strawberry');

    const morning = sleepThroughTheNight(state);

    expect(morning.state.plots[key].crop).toBeNull();
    expect(morning.events).toContainEqual({
      kind: 'cropsWithered',
      count: 1,
      season: 'Summer',
      crops: ['strawberry'],
    });
  });

  it('says nothing about withering on an ordinary morning', () => {
    const morning = sleepThroughTheNight(ripen(join(createFarmState(), 'a'), FIELD[0].x, FIELD[0].y));

    expect(morning.state.season).toBe('Spring');
    expect(morning.events.filter((event) => event.kind === 'cropsWithered')).toEqual([]);
  });

  it('refuses to plant out of season through the act intent', () => {
    const cell = FIELD[0];
    const key = plotKey(START_AREA, cell.x, cell.y);
    let state = join(createFarmState(), 'a');
    const day = SEASON_DAYS + 1;
    state = { ...state, time: createTimeState(day), season: seasonForDay(day) };
    state = faceTileFromBelow(state, 'a', cell.x, cell.y);
    state = { ...state, plots: { ...state.plots, [key]: { ...state.plots[key], stage: 'tilled' } } };
    state = holding(state, 'a', SLOT.turnipSeeds);

    const after = applyIntent(state, { type: 'player/act', playerId: 'a' });

    expect(after.state.season).toBe('Summer');
    expect(after.state.plots[key].crop).toBeNull();
    expect(countItem(after.state.players.a.inventory, 'turnip-seeds')).toBe(8);
    expect(after.state).toBe(state);
  });
});

describe('the market stall', () => {
  /** Players standing at the stall, with the first one's panel open. */
  function atStall(...ids: PlayerId[]): FarmState {
    const market = propCentreOf('market');
    const state = ids.reduce(
      (acc, id) => place(acc, id, market.x, market.y, propArea('market')),
      join(createFarmState(), ...ids),
    );
    return applyIntent(state, { type: 'player/act', playerId: ids[0] }).state;
  }

  const SEED_PRICE = ITEMS['turnip-seeds'].buyPrice!;

  it('opens the stall when a player acts at it, selling the basket on the way', () => {
    const market = propCentreOf('market');
    let state = give(join(createFarmState(), 'a'), 'a', 'turnip', 2);
    state = place(state, 'a', market.x, market.y, propArea('market'));
    const walletBefore = state.coins;

    const after = applyIntent(state, { type: 'player/act', playerId: 'a' });

    expect(after.state.players.a.panel).toBe('market');
    expect(after.state.coins).toBe(walletBefore + 2 * ITEMS.turnip.sellPrice);
    expect(after.events).toContainEqual({ kind: 'panelChanged', playerId: 'a', panel: 'market' });
  });

  it('opens for an empty basket too, so seed can be bought with nothing to sell', () => {
    expect(atStall('a').players.a.panel).toBe('market');
  });

  it('buys seed with the shared wallet and hands it to the buyer alone', () => {
    const state = atStall('a', 'b');
    const walletBefore = state.coins;

    const after = applyIntent(state, {
      type: 'shop/buy',
      playerId: 'a',
      item: 'turnip-seeds',
      count: 2,
    });

    expect(after.state.coins).toBe(walletBefore - SEED_PRICE * 2);
    expect(countItem(after.state.players.a.inventory, 'turnip-seeds')).toBe(10);
    expect(countItem(after.state.players.b.inventory, 'turnip-seeds')).toBe(8);
    expect(after.events).toContainEqual({
      kind: 'bought',
      playerId: 'a',
      item: 'turnip-seeds',
      count: 2,
      coins: SEED_PRICE * 2,
    });
  });

  it('refuses when the wallet is short and takes no coins', () => {
    const state = { ...atStall('a'), coins: 1 };

    const after = applyIntent(state, {
      type: 'shop/buy',
      playerId: 'a',
      item: 'turnip-seeds',
      count: 1,
    });

    expect(after.state).toBe(state);
    expect(after.state.coins).toBe(1);
    expect(countItem(after.state.players.a.inventory, 'turnip-seeds')).toBe(8);
  });

  // The rule the client must not be trusted about: a modified client can send
  // `shop/buy` whenever it likes, so being at the stall is checked here.
  it('refuses to sell to a player who is not at the stall, whatever they sent', () => {
    let state = atStall('a');
    state = place(state, 'a', TILE_SIZE * 2, TILE_SIZE * 2, START_AREA);
    const walletBefore = state.coins;

    const after = applyIntent(state, {
      type: 'shop/buy',
      playerId: 'a',
      item: 'turnip-seeds',
      count: 1,
    });

    expect(after.state).toBe(state);
    expect(after.state.coins).toBe(walletBefore);
    expect(after.events).toContainEqual({
      kind: 'message',
      playerId: 'a',
      text: 'Bạn không đứng ở sạp chợ.',
    });
  });

  it('refuses seed that is not in stock this season', () => {
    const state = atStall('a');

    const after = applyIntent(state, {
      type: 'shop/buy',
      playerId: 'a',
      item: 'pumpkin-seeds',
      count: 1,
    });

    expect(after.state).toBe(state);
    expect(countItem(after.state.players.a.inventory, 'pumpkin-seeds')).toBe(0);
  });

  it('shuts the stall when the player walks out of range', () => {
    const state = place(atStall('a'), 'a', TILE_SIZE * 2, TILE_SIZE * 2, START_AREA);

    const away = applyIntent(state, {
      type: 'player/move',
      playerId: 'a',
      dx: 0,
      dy: 1,
      deltaMs: 16,
    });

    expect(away.state.players.a.panel).toBeNull();
    expect(away.events).toContainEqual({ kind: 'panelChanged', playerId: 'a', panel: null });
  });

  it('closes on request, and closing an already-closed stall changes nothing', () => {
    const state = atStall('a');

    const closed = applyIntent(state, { type: 'panel/close', playerId: 'a' });
    expect(closed.state.players.a.panel).toBeNull();

    const again = applyIntent(closed.state, { type: 'panel/close', playerId: 'a' });
    expect(again.state).toBe(closed.state);
    expect(again.events).toEqual([]);
  });

  it('shuts the stall overnight', () => {
    const state = standAtBed(atStall('a'), 'a');

    const morning = applyIntent(state, { type: 'player/sleep', playerId: 'a' });

    expect(morning.state.time.day).toBe(2);
    expect(morning.state.players.a.panel).toBeNull();
  });
});

/**
 * Bà Xoan's cart, spec 15.
 *
 * The market's own rules — sell on the keypress, open the panel, check the
 * counter on every purchase — with the two things that make it her cart: it
 * only trades while she is keeping it, and it only buys the phố's dishes.
 */
describe('the xôi cart', () => {
  const CART = (() => {
    const prop = areaMap('plaza').props.find((candidate) => candidate.interact === 'xoi-stall');
    if (!prop) throw new Error('the phố has no xôi cart');
    // In front of the counter, which is where a player walks up to it from.
    return { x: prop.x + prop.width / 2, y: prop.y + prop.height + TILE_SIZE / 2 };
  })();

  /** A summer morning, or whatever hour is asked for, with a player at the cart. */
  function atCart(hour = 9): FarmState {
    const state = join(createFarmState(), 'a');
    const summer = { ...state, coins: 1000, season: 'Summer' as const, time: createTimeState(1, hour * 60) };
    return place(summer, 'a', CART.x, CART.y, 'plaza');
  }

  it('sells the dishes in the basket, keeps the rest, and opens the stall', () => {
    let state = give(give(atCart(), 'a', 'banh-chung', 2), 'a', 'melon', 1);
    const walletBefore = state.coins;
    state = applyIntent(state, { type: 'player/act', playerId: 'a' }).state;

    expect(state.players.a.panel).toBe('market');
    expect(state.coins).toBe(walletBefore + 2 * ITEMS['banh-chung'].sellPrice);
    expect(countItem(state.players.a.inventory, 'banh-chung')).toBe(0);
    expect(countItem(state.players.a.inventory, 'melon')).toBe(1);
  });

  it('sells her seed and not the market\'s', () => {
    const open = applyIntent(atCart(), { type: 'player/act', playerId: 'a' }).state;
    const walletBefore = open.coins;

    const nep = applyIntent(open, { type: 'shop/buy', playerId: 'a', item: 'nep-seeds', count: 1 });
    expect(countItem(nep.state.players.a.inventory, 'nep-seeds')).toBe(1);
    expect(nep.state.coins).toBe(walletBefore - ITEMS['nep-seeds'].buyPrice!);

    const melon = applyIntent(open, { type: 'shop/buy', playerId: 'a', item: 'melon-seeds', count: 1 });
    expect(melon.state).toBe(open);
  });

  it('is shut outside her hours: nothing sold, nothing opened, and it says when to come back', () => {
    for (const hour of [6, 12, 13, 18]) {
      const state = give(atCart(hour), 'a', 'xoi-dau', 1);
      const after = applyIntent(state, { type: 'player/act', playerId: 'a' });
      expect(after.state, `${hour}:00`).toBe(state);
      expect(after.events.some((event) => event.kind === 'message' && event.text.includes('dọn hàng'))).toBe(true);
    }
  });

  it('refuses a purchase once she has gone, even with the panel still open', () => {
    // A panel opened at 11:58 is still open at noon; the server asks the clock.
    const open = applyIntent(atCart(11), { type: 'player/act', playerId: 'a' }).state;
    const noon = { ...open, time: createTimeState(1, 12 * 60) };
    const after = applyIntent(noon, { type: 'shop/buy', playerId: 'a', item: 'nep-seeds', count: 1 });
    expect(after.state).toBe(noon);
    expect(countItem(after.state.players.a.inventory, 'nep-seeds')).toBe(0);
  });

  it('is somewhere Bà Xoan actually is while it is open', () => {
    const morning = atCart(9);
    const entry = scheduleEntryAt(NPCS.xoan, morning.season, morning.weather, 9)!;
    expect(entry.area).toBe('plaza');
    expect(entry.activity).toBe('xoi-stall');
  });
});

/**
 * Acting on a tile the mouse named.
 *
 * The client greys out what is out of range, and none of these tests care:
 * range is a rule, and a rule only enforced by the client is a rule anyone
 * with devtools can farm the whole map through.
 */
describe('acting on a named tile', () => {
  const faced = FIELD[0];

  /** Where `faceTileFromBelow` leaves a player aimed at `faced`. */
  const standing = { x: faced.x * TILE_SIZE + 16, y: (faced.y + 1) * TILE_SIZE + 16 };

  /** Another plot the player could turn and touch, and one they could not. */
  function plotWithin(reach: boolean) {
    const tile = FIELD.find(
      (candidate) => candidate !== faced && isWithinReach(standing, candidate.x, candidate.y) === reach,
    );
    if (!tile) throw new Error(`the field has no plot ${reach ? 'in' : 'out of'} reach of the first`);
    return tile;
  }

  /** A player standing below the first plot with a hoe in hand. */
  function withHoe(): FarmState {
    const state = faceTileFromBelow(join(createFarmState(), 'a'), 'a', faced.x, faced.y);
    return holding(state, 'a', SLOT.hoe);
  }

  function stageAt(state: FarmState, tile: { x: number; y: number }) {
    return state.plots[plotKey(START_AREA, tile.x, tile.y)].stage;
  }

  it('tills the faced tile when no target is named', () => {
    const state = withHoe();
    const other = plotWithin(true);

    const after = applyIntent(state, { type: 'player/act', playerId: 'a' }).state;

    expect(stageAt(after, faced)).toBe('tilled');
    expect(stageAt(after, other)).toBe('wild');
  });

  it('tills the named tile instead when one is in reach', () => {
    const state = withHoe();
    const other = plotWithin(true);

    const after = applyIntent(state, { type: 'player/act', playerId: 'a', target: other }).state;

    expect(stageAt(after, other)).toBe('tilled');
    // The tile they happen to be facing is untouched: the mouse aimed, not the body.
    expect(stageAt(after, faced)).toBe('wild');
  });

  it('refuses a well-formed target across the map, and changes nothing', () => {
    const state = withHoe();
    const distant = plotWithin(false);

    const result = applyIntent(state, { type: 'player/act', playerId: 'a', target: distant });

    expect(result.state).toBe(state);
    expect(stageAt(result.state, distant)).toBe('wild');
    expect(result.state.players.a.energy).toBe(STARTING_MAX_ENERGY);
    expect(result.events).toContainEqual({
      kind: 'message',
      playerId: 'a',
      text: 'Chỗ đó ngoài tầm với.',
    });
  });

  it('still greets Rowan when the tile named beside him is not soil', () => {
    // Standing next to somebody is enough to talk to them, which is what keeps
    // the keyboard path one key — and clicking the ground at his feet, where
    // there is nothing to farm, should not silently become a description.
    let state = join(createFarmState(), 'a');
    const rowan = npcAt(state, 'rowan');
    state = ripen(state, FIELD[0].x, FIELD[0].y);
    state = { ...state, quest: { ...state.quest, progress: state.quest.target, completed: true } };
    state = place(state, 'a', rowan.x, rowan.y + 24, rowan.area);

    const here = { x: Math.floor(rowan.x / TILE_SIZE), y: Math.floor((rowan.y + 24) / TILE_SIZE) };
    const result = applyIntent(state, { type: 'player/act', playerId: 'a', target: here });

    expect(result.state.quest.rewarded).toBe(true);
  });
});

/** Stands a player at the blacksmith's counter, which is in the village. */
function standAtForge(state: FarmState, id: PlayerId): FarmState {
  const area = propArea('blacksmith');
  const forge = areaMap(area).props.find((prop) => prop.interact === 'blacksmith')!;
  return place(state, id, forge.x + forge.width / 2, forge.y + forge.height + 8, area);
}

/**
 * Rolls the farm to the next morning by putting the only player to bed.
 *
 * Sleeping rather than running the clock round to 2am, because a collapse
 * costs coins and these tests are counting them.
 */
function sleepUntilMorning(state: FarmState, id: PlayerId): { state: FarmState; events: GameEvent[] } {
  return applyIntent(standAtBed(state, id), { type: 'player/sleep', playerId: id });
}

/** A farm with money in it, so the wallet is not what a test is measuring. */
function funded(state: FarmState, coins: number): FarmState {
  return { ...state, coins };
}

describe('the blacksmith', () => {
  it('takes the tool and the money, and gives nothing back on the day it was handed over', () => {
    let state = funded(join(createFarmState(), 'a'), 1000);
    state = standAtForge(state, 'a');
    const cost = ITEMS.hoe.upgradeCost!;

    const ordered = applyIntent(state, { type: 'player/upgradeTool', playerId: 'a', item: 'hoe' });

    // Gone. This is the whole mechanic: you give up tilling at scale for two
    // days, and you choose to do it in the week before you need it.
    expect(countItem(ordered.state.players.a.inventory, 'hoe')).toBe(0);
    expect(ordered.state.coins).toBe(1000 - cost);
    expect(ordered.state.players.a.pendingUpgrade).toEqual({
      item: 'copper-hoe',
      readyOnDay: state.time.day + UPGRADE_DAYS,
    });
    expect(ordered.events).toContainEqual({
      kind: 'upgradeOrdered',
      playerId: 'a',
      item: 'hoe',
      into: 'copper-hoe',
      readyOnDay: state.time.day + UPGRADE_DAYS,
    });

    // Not before. Collecting early changes nothing, and says why.
    const early = applyIntent(ordered.state, { type: 'player/collectTool', playerId: 'a' });
    expect(countItem(early.state.players.a.inventory, 'copper-hoe')).toBe(0);
    expect(early.state.players.a.pendingUpgrade).not.toBeNull();
    expect(early.events).toContainEqual({
      kind: 'message',
      playerId: 'a',
      text: expect.stringContaining('Chưa xong'),
    });
  });

  it('hands the better tool over on the right morning, and says so overnight', () => {
    let state = funded(join(createFarmState(), 'a'), 1000);
    state = standAtForge(state, 'a');
    state = applyIntent(state, { type: 'player/upgradeTool', playerId: 'a', item: 'hoe' }).state;

    let woken: GameEvent[] = [];
    for (let day = 0; day < UPGRADE_DAYS; day += 1) {
      const morning = sleepUntilMorning(state, 'a');
      state = morning.state;
      woken = morning.events;
    }

    // Announced on the morning the work finishes, so the day summary can
    // mention it — the tool itself is still on the bench in the village.
    expect(woken).toContainEqual({ kind: 'upgradeReady', playerId: 'a', item: 'copper-hoe' });
    expect(state.players.a.pendingUpgrade).not.toBeNull();

    state = standAtForge(state, 'a');
    const collected = applyIntent(state, { type: 'player/collectTool', playerId: 'a' });

    expect(countItem(collected.state.players.a.inventory, 'copper-hoe')).toBe(1);
    expect(collected.state.players.a.pendingUpgrade).toBeNull();
    expect(collected.events).toContainEqual({
      kind: 'upgradeCollected',
      playerId: 'a',
      item: 'copper-hoe',
    });
  });

  it('refuses a second job while the anvil is busy', () => {
    let state = funded(join(createFarmState(), 'a'), 10_000);
    state = standAtForge(state, 'a');
    state = applyIntent(state, { type: 'player/upgradeTool', playerId: 'a', item: 'hoe' }).state;

    const second = applyIntent(state, { type: 'player/upgradeTool', playerId: 'a', item: 'basket' });

    expect(second.state.players.a.pendingUpgrade).toEqual(state.players.a.pendingUpgrade);
    expect(countItem(second.state.players.a.inventory, 'basket')).toBe(1);
    expect(second.state.coins).toBe(state.coins);
  });

  it('refuses the work from anywhere but the anvil, however much money is on the farm', () => {
    let state = funded(join(createFarmState(), 'a'), 10_000);
    state = place(state, 'a', FIELD[0].x * TILE_SIZE + 16, FIELD[0].y * TILE_SIZE + 16, START_AREA);

    const result = applyIntent(state, { type: 'player/upgradeTool', playerId: 'a', item: 'hoe' });

    expect(result.state.players.a.pendingUpgrade).toBeNull();
    expect(countItem(result.state.players.a.inventory, 'hoe')).toBe(1);
    expect(result.state.coins).toBe(10_000);
  });

  it('refuses work the farm cannot pay for, and keeps the tool', () => {
    const cost = ITEMS.hoe.upgradeCost!;
    let state = funded(join(createFarmState(), 'a'), cost - 1);
    state = standAtForge(state, 'a');

    const result = applyIntent(state, { type: 'player/upgradeTool', playerId: 'a', item: 'hoe' });

    expect(result.state.players.a.pendingUpgrade).toBeNull();
    expect(countItem(result.state.players.a.inventory, 'hoe')).toBe(1);
    expect(result.state.coins).toBe(cost - 1);
  });

  it('will not take a tool that is already the best one he makes', () => {
    let state = funded(join(createFarmState(), 'a'), 100_000);
    state = standAtForge(state, 'a');
    state = setSlot(state, 'a', SLOT.hoe, newStack('gold-hoe'));

    const result = applyIntent(state, { type: 'player/upgradeTool', playerId: 'a', item: 'gold-hoe' });

    expect(result.state.players.a.pendingUpgrade).toBeNull();
    expect(result.state.coins).toBe(100_000);
  });
});

describe('a tool that works more than one tile', () => {
  /**
   * The top-left of a rectangle of field lying wholly inside the plots.
   *
   * Taken off the map rather than off `FIELD`, and paired with `bareGround`
   * below: these tests are about how far a swing reaches, and a fresh world
   * has brambles standing on a third of the field, which a sweep skips. Two
   * rules at once in one test is one test proving neither.
   */
  function fieldBlock(width: number, height: number): { x: number; y: number } {
    const all = areaMap(START_AREA).plotTiles;
    const plots = new Set(all.map((tile) => `${tile.x},${tile.y}`));
    for (const tile of all) {
      let whole = true;
      for (let dy = 0; dy < height && whole; dy += 1) {
        for (let dx = 0; dx < width && whole; dx += 1) {
          whole = plots.has(`${tile.x + dx},${tile.y + dy}`);
        }
      }
      if (whole) return tile;
    }
    throw new Error(`No ${width}x${height} block of field on the farm.`);
  }

  /** Puts a tool in hand and stands the player on the tile they will aim at. */
  function wielding(id: PlayerId, tool: ItemId, tile: { x: number; y: number }): FarmState {
    let state = join(bareGround(createFarmState()), id);
    state = setSlot(state, id, SLOT.hoe, newStack(tool));
    state = holding(state, id, SLOT.hoe);
    return place(state, id, tile.x * TILE_SIZE + 16, tile.y * TILE_SIZE + 16, START_AREA);
  }

  it('tills every tile of its rectangle in one swing', () => {
    // Steel is 3x3, centred on the tile that was aimed at.
    const block = fieldBlock(3, 3);
    const centre = { x: block.x + 1, y: block.y + 1 };
    const state = wielding('a', 'steel-hoe', centre);

    const result = applyIntent(state, { type: 'player/act', playerId: 'a', target: centre });

    for (let dy = 0; dy < 3; dy += 1) {
      for (let dx = 0; dx < 3; dx += 1) {
        const key = plotKey(START_AREA, block.x + dx, block.y + dy);
        expect(result.state.plots[key].stage, `plot ${key}`).toBe('tilled');
      }
    }
    expect(result.events.filter((event) => event.kind === 'plotChanged')).toHaveLength(9);
  });

  it('charges energy once per tile worked, with the tier factor on the whole sweep', () => {
    const block = fieldBlock(3, 3);
    const centre = { x: block.x + 1, y: block.y + 1 };
    let state = wielding('a', 'steel-hoe', centre);
    const factor = ITEMS['steel-hoe'].energyFactor!;

    const nine = applyIntent(state, { type: 'player/act', playerId: 'a', target: centre });
    expect(STARTING_MAX_ENERGY - nine.state.players.a.energy).toBe(
      Math.round(9 * ACTION_ENERGY_COST.till * factor),
    );

    // One of the nine is already worked: it is skipped, and not charged for.
    const already = plotKey(START_AREA, block.x, block.y);
    state = {
      ...state,
      plots: { ...state.plots, [already]: { ...state.plots[already], stage: 'tilled' } },
    };
    const eight = applyIntent(state, { type: 'player/act', playerId: 'a', target: centre });

    expect(STARTING_MAX_ENERGY - eight.state.players.a.energy).toBe(
      Math.round(8 * ACTION_ENERGY_COST.till * factor),
    );
  });

  it('skips the tiles of its rectangle that are not field at all', () => {
    // Aimed at the very corner of the field, so most of a 3x3 hangs off it.
    // Those tiles are not plots, so there is nothing there to till.
    const corner = FIELD[0];
    const state = wielding('a', 'steel-hoe', corner);

    const result = applyIntent(state, { type: 'player/act', playerId: 'a', target: corner });

    const worked = result.events.filter((event) => event.kind === 'plotChanged').length;
    expect(worked).toBeGreaterThan(0);
    expect(worked).toBeLessThan(9);
    expect(STARTING_MAX_ENERGY - result.state.players.a.energy).toBe(
      Math.round(worked * ACTION_ENERGY_COST.till * ITEMS['steel-hoe'].energyFactor!),
    );
  });

  it('spends one pour per tile watered, and stops when the can runs dry', () => {
    const block = fieldBlock(3, 3);
    const centre = { x: block.x + 1, y: block.y + 1 };
    let state = wielding('a', 'steel-hoe', centre);

    // Nine seeded plots, and a can with only four pours left in it.
    const seeded = { ...state.plots };
    for (let dy = 0; dy < 3; dy += 1) {
      for (let dx = 0; dx < 3; dx += 1) {
        const key = plotKey(START_AREA, block.x + dx, block.y + dy);
        seeded[key] = { ...seeded[key], stage: 'seeded', crop: 'turnip' };
      }
    }
    state = { ...state, plots: seeded };
    state = setSlot(state, 'a', SLOT.can, { item: 'steel-watering-can', count: 1, charges: 4 });
    state = holding(state, 'a', SLOT.can);

    const result = applyIntent(state, { type: 'player/act', playerId: 'a', target: centre });

    const watered = Object.values(result.state.plots).filter((plot) => plot.wateredToday).length;
    expect(watered).toBe(4);
    expect(result.state.players.a.inventory[SLOT.can]?.charges).toBe(0);
  });

  it('leaves a basic tool working exactly one tile, message and all', () => {
    const tile = FIELD[0];
    const state = wielding('a', 'hoe', tile);

    const result = applyIntent(state, { type: 'player/act', playerId: 'a', target: tile });

    expect(result.events.filter((event) => event.kind === 'plotChanged')).toHaveLength(1);
    expect(result.events).toContainEqual({
      kind: 'message',
      playerId: 'a',
      text: 'Đất tơi ra, sẵn sàng cho hạt giống.',
    });
    expect(STARTING_MAX_ENERGY - result.state.players.a.energy).toBe(ACTION_ENERGY_COST.till);
  });
});

describe('putting a building up', () => {
  /** The first spot on the farm that would actually take a shed. */
  function shedSpot(state: FarmState): { x: number; y: number } {
    const map = areaMap(START_AREA);
    for (let y = 0; y < map.height; y += 1) {
      for (let x = 0; x < map.width; x += 1) {
        if (checkPlacement(START_AREA, state.buildings, state.plots, 'shed', x, y).ok) return { x, y };
      }
    }
    throw new Error('Nowhere on the farm will take a shed.');
  }

  function onFarmWith(coins: number): FarmState {
    const state = funded(join(createFarmState(), 'a'), coins);
    return place(state, 'a', FIELD[0].x * TILE_SIZE + 16, FIELD[0].y * TILE_SIZE + 16, START_AREA);
  }

  it('breaks ground, charges the wallet, and leaves a scaffold until its day', () => {
    const cost = BUILDING_DEFS.shed.cost;
    const state = onFarmWith(cost + 10);
    const spot = shedSpot(state);

    const placed = applyIntent(state, {
      type: 'player/placeBuilding',
      playerId: 'a',
      kind: 'shed',
      x: spot.x,
      y: spot.y,
    });

    expect(placed.state.coins).toBe(10);
    expect(placed.state.buildings).toHaveLength(1);
    const [building] = placed.state.buildings;
    expect(building).toMatchObject({ kind: 'shed', x: spot.x, y: spot.y });
    expect(building.readyOnDay).toBe(state.time.day + BUILDING_DEFS.shed.days);
    expect(isComplete(building)).toBe(false);
    expect(placed.events).toContainEqual({
      kind: 'buildingPlaced',
      playerId: 'a',
      id: building.id,
      building: 'shed',
      readyOnDay: building.readyOnDay,
    });
  });

  it('finishes it on the morning its day arrives, and not a morning before', () => {
    const state = onFarmWith(BUILDING_DEFS.shed.cost);
    const spot = shedSpot(state);
    let farm = applyIntent(state, {
      type: 'player/placeBuilding',
      playerId: 'a',
      kind: 'shed',
      x: spot.x,
      y: spot.y,
    }).state;

    let events: GameEvent[] = [];
    for (let day = 0; day < BUILDING_DEFS.shed.days; day += 1) {
      expect(isComplete(farm.buildings[0]), `still a scaffold on day ${farm.time.day}`).toBe(false);
      const morning = sleepUntilMorning(farm, 'a');
      farm = morning.state;
      events = morning.events;
    }

    expect(isComplete(farm.buildings[0])).toBe(true);
    expect(events).toContainEqual({
      kind: 'buildingFinished',
      id: farm.buildings[0].id,
      building: 'shed',
    });
  });

  it('refuses a building the farm cannot pay for, and spends nothing', () => {
    const state = onFarmWith(BUILDING_DEFS.shed.cost - 1);
    const spot = shedSpot(state);

    const result = applyIntent(state, {
      type: 'player/placeBuilding',
      playerId: 'a',
      kind: 'shed',
      x: spot.x,
      y: spot.y,
    });

    expect(result.state.buildings).toHaveLength(0);
    expect(result.state.coins).toBe(BUILDING_DEFS.shed.cost - 1);
    expect(result.events).toContainEqual({
      kind: 'message',
      playerId: 'a',
      text: expect.stringContaining('mà nông trại chỉ có'),
    });
  });

  it('refuses a client that asks to build on the farm while standing in the village', () => {
    const state = onFarmWith(100_000);
    const spot = shedSpot(state);
    const market = propCentreOf('market');
    const away = place(state, 'a', market.x, market.y, propArea('market'));

    const result = applyIntent(away, {
      type: 'player/placeBuilding',
      playerId: 'a',
      kind: 'shed',
      x: spot.x,
      y: spot.y,
    });

    expect(result.state.buildings).toHaveLength(0);
    expect(result.state.coins).toBe(100_000);
    expect(result.events).toContainEqual({
      kind: 'message',
      playerId: 'a',
      text: 'Bạn phải đứng trên nông trại mới xây được.',
    });
  });

  it('will not let a player walk through what they built', () => {
    const state = onFarmWith(BUILDING_DEFS.shed.cost);
    const spot = shedSpot(state);
    const built = applyIntent(state, {
      type: 'player/placeBuilding',
      playerId: 'a',
      kind: 'shed',
      x: spot.x,
      y: spot.y,
    }).state;

    // Stood one tile west of the footprint, walking east into it.
    const outside = place(built, 'a', (spot.x - 1) * TILE_SIZE + 16, spot.y * TILE_SIZE + 16, START_AREA);
    const walked = applyIntent(outside, {
      type: 'player/move',
      playerId: 'a',
      dx: 1,
      dy: 0,
      deltaMs: 500,
    });

    // Movement is clamped by the scaffold, so the player never reaches the
    // first column of the footprint.
    expect(walked.state.players.a.x).toBeLessThan(spot.x * TILE_SIZE);
  });
});

describe('the village, and the people in it', () => {
  /** Stands a player within arm's reach of a villager, wherever they are. */
  function beside(state: FarmState, id: PlayerId, npc: NpcId): FarmState {
    const actor = npcAt(state, npc);
    return place(state, id, actor.x, actor.y + 26, actor.area);
  }

  /** A player holding one of something, in a slot that is theirs alone. */
  function carrying(state: FarmState, id: PlayerId, item: ItemId, count = 1): FarmState {
    const next = setSlot(state, id, SLOT.turnipSeeds, newStack(item, count));
    return holding(next, id, SLOT.turnipSeeds);
  }

  function pointsFor(state: FarmState, id: PlayerId, npc: NpcId): number {
    return state.players[id].relationships[npc]?.points ?? 0;
  }

  it('says something back when you walk up and press a key', () => {
    let state = join(createFarmState(), 'a');
    state = beside(state, 'a', 'rowan');

    const result = applyIntent(state, { type: 'player/act', playerId: 'a' });
    const spoke = result.events.find((event) => event.kind === 'npcSpoke');

    expect(spoke).toBeDefined();
    expect(spoke).toMatchObject({ npc: 'rowan', playerId: 'a' });
    expect(spoke && 'line' in spoke && spoke.line.length).toBeGreaterThan(0);
  });

  it('takes the gift out of the satchel and puts the points on the player', () => {
    let state = join(createFarmState(), 'a');
    state = beside(state, 'a', 'rowan');
    state = carrying(state, 'a', 'turnip', 3);

    const result = applyIntent(state, { type: 'player/act', playerId: 'a' });

    expect(countItem(result.state.players.a.inventory, 'turnip')).toBe(2);
    expect(pointsFor(result.state, 'a', 'rowan')).toBe(REACTION_POINTS.liked);
    expect(result.events).toContainEqual(
      expect.objectContaining({ kind: 'giftGiven', npc: 'rowan', playerId: 'a', reaction: 'liked' }),
    );
  });

  it('says hello with a face for the dialogue box to draw', () => {
    let state = join(createFarmState(), 'a');
    state = beside(state, 'a', 'rowan');

    const spoke = applyIntent(state, { type: 'player/act', playerId: 'a' }).events.find(
      (event) => event.kind === 'npcSpoke',
    );

    expect(spoke).toMatchObject({ mood: expect.stringMatching(/^(neutral|happy|sad|angry)$/) });
  });

  it('puts the line and the reaction’s face on a gift, since a gift does not also speak', () => {
    let state = join(createFarmState(), 'a');
    state = beside(state, 'a', 'rowan');
    state = carrying(state, 'a', 'wood', 1);

    const result = applyIntent(state, { type: 'player/act', playerId: 'a' });
    const gift = result.events.find((event) => event.kind === 'giftGiven');

    expect(gift).toMatchObject({ reaction: 'hated', mood: 'angry' });
    expect(gift && 'line' in gift && gift.line.length).toBeGreaterThan(0);
    expect(result.events.some((event) => event.kind === 'npcSpoke')).toBe(false);
  });

  it('keeps the friendships of two players entirely separate', () => {
    // The one place the shared-world model is deliberately broken. Everything
    // else on this farm is common property; this is not.
    let state = join(createFarmState(), 'a', 'b');
    state = beside(state, 'a', 'rowan');
    state = beside(state, 'b', 'rowan');
    state = carrying(state, 'a', 'rhubarb', 2);
    state = carrying(state, 'b', 'wood', 2);

    state = applyIntent(state, { type: 'player/act', playerId: 'a' }).state;
    state = applyIntent(state, { type: 'player/act', playerId: 'b' }).state;

    expect(pointsFor(state, 'a', 'rowan')).toBe(REACTION_POINTS.loved);
    expect(pointsFor(state, 'b', 'rowan')).toBe(REACTION_POINTS.hated);
    // And one player spending their gift does not spend the other one.
    expect(state.players.a.relationships.rowan?.giftsThisWeek).toBe(1);
    expect(state.players.b.relationships.rowan?.giftsThisWeek).toBe(1);
  });

  it('refuses a second gift the same day, and keeps the item', () => {
    let state = join(createFarmState(), 'a');
    state = beside(state, 'a', 'rowan');
    state = carrying(state, 'a', 'turnip', 3);

    state = applyIntent(state, { type: 'player/act', playerId: 'a' }).state;
    const after = pointsFor(state, 'a', 'rowan');
    const second = applyIntent(state, { type: 'player/act', playerId: 'a' });

    expect(countItem(second.state.players.a.inventory, 'turnip')).toBe(2);
    expect(pointsFor(second.state, 'a', 'rowan')).toBe(after);
    expect(second.events.some((event) => event.kind === 'giftGiven')).toBe(false);
    // Refused, but not silent: he still has something to say.
    expect(second.events.some((event) => event.kind === 'npcSpoke')).toBe(true);
  });

  it('gives the daily gift back in the morning, and keeps the points', () => {
    let state = join(createFarmState(), 'a');
    state = beside(state, 'a', 'rowan');
    state = carrying(state, 'a', 'turnip', 3);
    state = applyIntent(state, { type: 'player/act', playerId: 'a' }).state;

    expect(state.players.a.relationships.rowan?.giftedToday).toBe(true);

    state = sleepUntilMorning(state, 'a').state;

    expect(state.players.a.relationships.rowan?.giftedToday).toBe(false);
    // Day two is not the first day of a week, so that allowance still stands.
    expect(state.players.a.relationships.rowan?.giftsThisWeek).toBe(1);
    expect(pointsFor(state, 'a', 'rowan')).toBe(REACTION_POINTS.liked);
  });

  it('talks rather than gifts when the thing in hand is a tool', () => {
    let state = join(createFarmState(), 'a');
    state = beside(state, 'a', 'rowan');
    state = holding(state, 'a', SLOT.hoe);

    const result = applyIntent(state, { type: 'player/act', playerId: 'a' });

    expect(result.events.some((event) => event.kind === 'npcSpoke')).toBe(true);
    expect(result.events.some((event) => event.kind === 'giftGiven')).toBe(false);
    expect(countItem(result.state.players.a.inventory, 'hoe')).toBe(1);
  });

  it('pays the quest out when you talk to the villager holding it', () => {
    let state = join(createFarmState(), 'a');
    state = { ...state, quest: { ...state.quest, progress: state.quest.target, completed: true } };
    state = beside(state, 'a', 'rowan');
    const before = state.coins;

    const result = applyIntent(state, { type: 'player/act', playerId: 'a' });

    expect(result.state.quest.rewarded).toBe(true);
    expect(result.state.coins).toBe(before + QUEST_REWARD_COINS);
  });

  it('does not reach a villager standing across the village', () => {
    let state = join(createFarmState(), 'a');
    const rowan = npcAt(state, 'rowan');
    state = place(state, 'a', rowan.x + 400, rowan.y, rowan.area);
    state = carrying(state, 'a', 'turnip', 3);

    const result = applyIntent(state, { type: 'player/act', playerId: 'a' });

    expect(result.events.some((event) => event.kind === 'giftGiven')).toBe(false);
    expect(result.events.some((event) => event.kind === 'npcSpoke')).toBe(false);
  });

  it('walks the village on as the clock does', () => {
    let state = join(createFarmState(), 'a');
    const dawn = npcAt(state, 'maeve');

    // Enough clock steps to carry 6am into her working day.
    for (let tick = 0; tick < 400; tick += 1) {
      state = applyIntent(state, { type: 'world/tick', deltaMs: 1200 }).state;
    }

    const later = npcAt(state, 'maeve');
    expect({ x: later.x, y: later.y }).not.toEqual({ x: dawn.x, y: dawn.y });
  });

  it('puts everybody back on their own doorstep at dawn', () => {
    let state = join(createFarmState(), 'a');

    for (let tick = 0; tick < 400; tick += 1) {
      state = applyIntent(state, { type: 'world/tick', deltaMs: 1200 }).state;
    }
    const scattered = state.npcs.map(({ id, x, y }) => ({ id, x, y }));
    state = sleepUntilMorning(state, 'a').state;

    // Dawn is a reset, not a continuation: everybody is at the post their
    // schedule gives them for six in the morning, whatever the night did.
    expect(state.npcs.map(({ id, x, y }) => ({ id, x, y }))).not.toEqual(scattered);
    for (const actor of state.npcs) {
      const entry = scheduleEntryAt(NPCS[actor.id], state.season, state.weather, 6)!;
      expect(entryPosition(entry)).toEqual({ area: actor.area, x: actor.x, y: actor.y });
    }
  });
});

describe('clearing the ground', () => {
  /** Stands one node on a tile and puts the player in front of it. */
  function facing(
    kind: NodeKind,
    tool: ItemId,
    extra: Partial<ResourceNode> = {},
  ): { state: FarmState; tile: { x: number; y: number }; node: ResourceNode } {
    const tile = FIELD[0];
    const node: ResourceNode = {
      id: 'n1',
      kind,
      area: START_AREA,
      x: tile.x,
      y: tile.y,
      health: nodeDef(kind).health,
      requires: nodeDef(kind).requires,
      stage: kind === 'tree' ? 4 : null,
      item: null,
      ...extra,
    };

    let state = join(bareGround(createFarmState()), 'a');
    state = { ...state, nodes: [node] };
    state = setSlot(state, 'a', SLOT.hoe, newStack(tool));
    state = holding(state, 'a', SLOT.hoe);
    state = faceTileFromBelow(state, 'a', tile.x, tile.y);
    return { state, tile, node };
  }

  it('takes the thing standing on a tile before the soil under it', () => {
    // The whole ordering rule. A hoe at a bramble is not a bed to till.
    const { state, tile } = facing('weed', 'scythe');
    const result = applyIntent(state, { type: 'player/act', playerId: 'a' });

    expect(result.state.nodes).toEqual([]);
    expect(result.state.plots[plotKey(START_AREA, tile.x, tile.y)].stage).toBe('wild');
    expect(countItem(result.state.players.a.inventory, 'fiber')).toBe(1);
  });

  it('never tills the soil under a bramble, even in the middle of a sweep', () => {
    const tile = FIELD[0];
    const neighbour = FIELD.find((spot) => spot.x === tile.x + 1 && spot.y === tile.y);
    expect(neighbour).toBeDefined();

    let state = join(bareGround(createFarmState()), 'a');
    state = {
      ...state,
      nodes: [
        {
          id: 'n1',
          kind: 'weed',
          area: START_AREA,
          x: neighbour!.x,
          y: neighbour!.y,
          health: 1,
          requires: 'basic',
          stage: null,
          item: null,
        },
      ],
    };
    // A copper hoe is 1x3, so the swing reaches the tile the weed is on.
    state = setSlot(state, 'a', SLOT.hoe, newStack('steel-hoe'));
    state = holding(state, 'a', SLOT.hoe);
    state = place(state, 'a', tile.x * TILE_SIZE + 16, tile.y * TILE_SIZE + 16, START_AREA);

    const result = applyIntent(state, { type: 'player/act', playerId: 'a', target: tile });

    expect(result.state.plots[plotKey(START_AREA, tile.x, tile.y)].stage).toBe('tilled');
    expect(result.state.plots[plotKey(START_AREA, neighbour!.x, neighbour!.y)].stage).toBe('wild');
    // And the weed is still standing, untouched: a hoe does not clear it either.
    expect(result.state.nodes).toHaveLength(1);
  });

  it('spends energy on a swing that landed and nothing on one that bounced', () => {
    const { state } = facing('tree', 'axe');
    const hit = applyIntent(state, { type: 'player/act', playerId: 'a' });
    expect(STARTING_MAX_ENERGY - hit.state.players.a.energy).toBe(nodeDef('tree').energy);
    expect(hit.events.some((event) => event.kind === 'nodeHit')).toBe(true);

    // A stump wants copper. The swing costs nothing, changes nothing, and says
    // which rung it wanted — the event the spec calls the important one.
    const stump = facing('stump', 'axe');
    const bounced = applyIntent(stump.state, { type: 'player/act', playerId: 'a' });
    expect(bounced.state.players.a.energy).toBe(STARTING_MAX_ENERGY);
    expect(bounced.state.nodes[0].health).toBe(nodeDef('stump').health);
    const refusal = bounced.events.find((event) => event.kind === 'toolTooWeak');
    expect(refusal && refusal.kind === 'toolTooWeak' && refusal.requires).toBe('copper');
  });

  it('lets a copper axe do what an ordinary one could not', () => {
    const { state } = facing('stump', 'copper-axe', { health: 1 });
    const result = applyIntent(state, { type: 'player/act', playerId: 'a' });

    expect(result.state.nodes).toEqual([]);
    expect(countItem(result.state.players.a.inventory, 'hardwood')).toBe(20);
    expect(result.events.some((event) => event.kind === 'nodeCleared')).toBe(true);
  });

  it('refuses the felling blow into a full satchel and leaves it at one health', () => {
    const { state } = facing('tree', 'axe', { health: 1 });
    const full = {
      ...state,
      players: {
        ...state.players,
        a: {
          ...state.players.a,
          inventory: Array.from({ length: INVENTORY_SIZE }, () => newStack('stone', 99)),
          // The axe still has to be in hand, so one slot holds the tool.
        },
      },
    };
    const holdingAxe = setSlot(full, 'a', SLOT.hoe, newStack('axe'));

    const result = applyIntent(holdingAxe, { type: 'player/act', playerId: 'a' });

    expect(result.state.nodes[0].health).toBe(1);
    expect(result.state.players.a.energy).toBe(STARTING_MAX_ENERGY);
    expect(result.events.some((event) => event.kind === 'nodeCleared')).toBe(false);
  });

  it('puts cut grass in the silo, and nothing at all in the satchel', () => {
    const { state } = facing('grass', 'scythe');
    const withSilo: FarmState = {
      ...state,
      buildings: [{ id: 'b1', kind: 'silo', x: 25, y: 3, readyOnDay: null, doorOpen: false }],
    };

    const result = applyIntent(withSilo, { type: 'player/act', playerId: 'a' });

    expect(result.state.hay).toBe(1);
    expect(result.state.nodes).toEqual([]);
    // Free, like harvesting: a chore that has to be done cannot also be taxed.
    expect(result.state.players.a.energy).toBe(STARTING_MAX_ENERGY);
  });

  it('loses cut grass when there is no silo, and says why', () => {
    const { state } = facing('grass', 'scythe');
    const result = applyIntent(state, { type: 'player/act', playerId: 'a' });

    expect(result.state.hay).toBe(0);
    expect(result.state.nodes).toEqual([]);
    const said = result.events.find((event) => event.kind === 'message');
    expect(said && said.kind === 'message' && said.text).toMatch(/kho cỏ đã đầy/i);
  });

  it('picks forage up with nothing in hand at all', () => {
    const { state } = facing('forage', 'hoe', { item: 'daffodil' });
    const empty = setSlot(state, 'a', SLOT.hoe, null);

    const result = applyIntent(empty, { type: 'player/act', playerId: 'a' });

    expect(countItem(result.state.players.a.inventory, 'daffodil')).toBe(1);
    expect(result.state.nodes).toEqual([]);
  });

  it('will not let a client swing at something out of reach', () => {
    const { state, tile } = facing('tree', 'axe');
    const far = place(state, 'a', tile.x * TILE_SIZE + 16, (tile.y + 6) * TILE_SIZE + 16, START_AREA);

    const result = applyIntent(far, { type: 'player/act', playerId: 'a', target: tile });

    expect(result.state).toBe(far);
    expect(result.state.nodes[0].health).toBe(nodeDef('tree').health);
  });

  it('stops a player walking through a tree, and lets them past once it is down', () => {
    const tile = FIELD[0];
    let state = join(bareGround(createFarmState()), 'a');
    state = {
      ...state,
      nodes: [
        {
          id: 'n1',
          kind: 'tree',
          area: START_AREA,
          x: tile.x,
          y: tile.y,
          health: 1,
          requires: 'basic',
          stage: 4,
          item: null,
        },
      ],
    };
    // Standing two tiles west, walking east into the trunk. A frame at a time,
    // as the game actually moves: collision is a point test, so a single step
    // large enough to clear a whole tile would step straight over it.
    const start = { x: (tile.x - 2) * TILE_SIZE + 16, y: tile.y * TILE_SIZE + 16 };
    state = place(state, 'a', start.x, start.y, START_AREA);

    const walkEast = (from: FarmState, frames: number) => {
      let next = from;
      for (let i = 0; i < frames; i += 1) {
        next = applyIntent(next, { type: 'player/move', playerId: 'a', dx: 1, dy: 0, deltaMs: 16 }).state;
      }
      return next;
    };

    const blocked = walkEast(state, 60);
    expect(blocked.players.a.x).toBeGreaterThan(start.x);
    expect(blocked.players.a.x).toBeLessThan(tile.x * TILE_SIZE);

    // Down it comes, and the tile opens.
    const through = walkEast({ ...blocked, nodes: [] }, 60);
    expect(through.players.a.x).toBeGreaterThan((tile.x + 1) * TILE_SIZE);
  });
});

describe('the night, on the ground', () => {
  /** Rolls one whole night by putting the only player to bed. */
  function sleepThrough(state: FarmState): ApplyResult {
    return applyIntent(standAtBed(state, 'a'), { type: 'player/sleep', playerId: 'a' });
  }

  it('grows things overnight and says how many in one event', () => {
    const state = join(createFarmState(), 'a');
    const result = sleepThrough(state);

    const grew = result.events.find((event) => event.kind === 'nodesGrew');
    expect(grew && grew.kind === 'nodesGrew' && grew.spawned).toBeGreaterThan(0);
    expect(result.state.nodes.length).toBeGreaterThan(state.nodes.length);
  });

  it('wakes two farms started from the same seed to the same morning', () => {
    // The reason `spawnSeed` is on the farm rather than in a module constant:
    // two clients simulating the same world have to agree about what grew,
    // with nothing sent over the wire to say so.
    const first = sleepThrough(join(createFarmState(), 'a')).state;
    const second = sleepThrough(join(createFarmState(), 'a')).state;
    expect(first.nodes).toEqual(second.nodes);

    const elsewhere = sleepThrough(join(createFarmState(12345), 'a')).state;
    expect(elsewhere.nodes).not.toEqual(first.nodes);
  });

  it('never grows anything onto a crop somebody is looking after', () => {
    let state = join(createFarmState(), 'a');
    // The whole field, tilled and planted, which is the state a night of
    // growth must never drop a boulder into the middle of.
    const plots = { ...state.plots };
    for (const tile of areaMap(START_AREA).plotTiles) {
      const key = plotKey(START_AREA, tile.x, tile.y);
      plots[key] = { ...plots[key], stage: 'seeded', crop: 'turnip', daysWatered: 0, wateredToday: true };
    }
    state = { ...bareGround(state), plots };

    for (let night = 0; night < 8; night += 1) state = sleepThrough(state).state;

    for (const tile of areaMap(START_AREA).plotTiles) {
      expect(nodeAt(state.nodes, START_AREA, tile.x, tile.y)).toBeNull();
    }
  });
});

describe('the herd', () => {
  const RANCHER = propCentreOf('rancher');

  /** A finished house on the farm, put up without waiting three days for it. */
  function withHouse(
    state: FarmState,
    kind: 'coop' | 'barn' | 'silo',
    id: string,
    at: { x: number; y: number },
    overrides: Partial<FarmState['buildings'][number]> = {},
  ): FarmState {
    const placement = checkPlacement(START_AREA, state.buildings, state.plots, kind, at.x, at.y);
    // Fails loudly rather than silently testing an empty farm: the spot is
    // chosen by hand against a map that gets edited.
    if (!placement.ok) throw new Error(`cannot put a ${kind} at ${at.x},${at.y}: ${placement.reason}`);
    return {
      ...state,
      buildings: [
        ...state.buildings,
        { id, kind, x: at.x, y: at.y, readyOnDay: null, doorOpen: false, ...overrides },
      ],
    };
  }

  /**
   * The first spot on the farm this building actually fits.
   *
   * Searched rather than written down, because the farm map is generated and
   * gets edited: a hard-coded corner is a test that fails the day somebody
   * moves a tree, for a reason that has nothing to do with animals.
   */
  function spotFor(state: FarmState, kind: 'coop' | 'barn' | 'silo'): { x: number; y: number } {
    const map = areaMap(START_AREA);
    for (let y = 0; y < map.height; y += 1) {
      for (let x = 0; x < map.width; x += 1) {
        if (!checkPlacement(START_AREA, state.buildings, state.plots, kind, x, y).ok) continue;
        // Away from anything interactive, and deliberately. A press at a coop
        // built against a counter is a press at the counter — the nearest
        // thing wins, which is the rule everywhere else too — and a test that
        // happened to build there would be testing that instead.
        const clear = buildingTiles({ kind, x, y }).every(
          (tile) =>
            !interactableAt(START_AREA, {
              x: tile.x * TILE_SIZE + TILE_SIZE / 2,
              y: tile.y * TILE_SIZE + TILE_SIZE / 2,
            }),
        );
        if (clear) return { x, y };
      }
    }
    throw new Error(`nowhere on the farm fits a ${kind}`);
  }

  /** Walks the player to their own bed and turns in, which rolls the morning. */
  function sleepThrough(state: FarmState): ApplyResult {
    return applyIntent(standAtBed(state, 'a'), { type: 'player/sleep', playerId: 'a' });
  }

  /** A farm with one player, a finished coop, and money. */
  function ranchFarm(coins = 5000): FarmState {
    const base = join(createFarmState(), 'a');
    return { ...withHouse(base, 'coop', 'b1', spotFor(base, 'coop')), coins };
  }

  /** The same farm with a finished silo on it, so hay has somewhere to go. */
  function withSilo(state: FarmState): FarmState {
    return withHouse(state, 'silo', 'b2', spotFor(state, 'silo'));
  }

  /** Stands a player at the rancher's pen, which is the only place he sells from. */
  function atRancher(state: FarmState, id: PlayerId = 'a'): FarmState {
    return place(state, id, RANCHER.x, RANCHER.y, 'village');
  }

  function buy(state: FarmState, name = 'Mun', kind: 'chicken' | 'cow' = 'chicken', home = 'b1') {
    return applyIntent(state, { type: 'player/buyAnimal', playerId: 'a', kind, home, name });
  }

  it('buys an animal into a finished house, and takes the price off the farm', () => {
    const state = atRancher(ranchFarm());
    const bought = buy(state);

    expect(bought.state.animals).toHaveLength(1);
    expect(bought.state.animals[0].name).toBe('Mun');
    expect(bought.state.animals[0].home).toBe('b1');
    expect(bought.state.coins).toBe(state.coins - ANIMAL_DEFS.chicken.price);
    expect(bought.events).toContainEqual(
      expect.objectContaining({ kind: 'animalBought', animal: 'chicken' }),
    );
  });

  it('refuses to sell to somebody who is not standing at the pen', () => {
    // The check this whole path exists for: a client that only sends `buyAnimal`
    // while its panel is open is a client we have decided to believe.
    const far = ranchFarm();
    const refused = buy(far);

    expect(refused.state.animals).toHaveLength(0);
    expect(refused.state.coins).toBe(far.coins);
  });

  it('refuses when the wallet is short, and changes nothing at all', () => {
    const state = atRancher(ranchFarm(ANIMAL_DEFS.chicken.price - 1));
    const refused = buy(state);

    expect(refused.state.animals).toHaveLength(0);
    expect(refused.state.coins).toBe(state.coins);
    expect(refused.state.revision).toBe(state.revision);
  });

  it('refuses a house that is still a scaffold, and one of the wrong sort', () => {
    const scaffold = atRancher({
      ...(() => {
        const base = join(createFarmState(), 'a');
        return withHouse(base, 'coop', 'b1', spotFor(base, 'coop'), { readyOnDay: 9 });
      })(),
      coins: 5000,
    });
    expect(buy(scaffold).state.animals).toHaveLength(0);

    // A cow in a coop. The reducer asks the same question the panel greys out.
    expect(buy(atRancher(ranchFarm()), 'Sữa', 'cow').state.animals).toHaveLength(0);
  });

  it('refuses once the coop is full', () => {
    let state = atRancher(ranchFarm(50_000));
    for (let index = 0; index < capacityOf('coop'); index += 1) {
      state = buy(state, `Gà ${index}`).state;
    }
    expect(state.animals).toHaveLength(capacityOf('coop'));

    const overflow = buy(state, 'Một con nữa');
    expect(overflow.state.animals).toHaveLength(capacityOf('coop'));
  });

  it('sells one back for half, at the pen and nowhere else', () => {
    const bought = buy(atRancher(ranchFarm())).state;
    const away = applyIntent(place(bought, 'a', 100, 100), {
      type: 'player/sellAnimal',
      playerId: 'a',
      animalId: 'a1',
    });
    expect(away.state.animals).toHaveLength(1);

    const sold = applyIntent(bought, { type: 'player/sellAnimal', playerId: 'a', animalId: 'a1' });
    expect(sold.state.animals).toHaveLength(0);
    expect(sold.state.coins).toBe(bought.coins + resalePrice('chicken'));
  });

  describe('hay', () => {
    it('cannot be bought at all without a silo to put it in', () => {
      const state = atRancher(ranchFarm());
      const refused = applyIntent(state, { type: 'player/buyHay', playerId: 'a', count: 10 });

      expect(refused.state.hay).toBe(0);
      expect(refused.state.coins).toBe(state.coins);
    });

    it('is bought into the silo, and never past what the silo holds', () => {
      const state = atRancher({ ...withSilo(ranchFarm()) });
      const bought = applyIntent(state, { type: 'player/buyHay', playerId: 'a', count: 10 });

      expect(bought.state.hay).toBe(10);
      expect(bought.state.coins).toBe(state.coins - HAY_PRICE * 10);

      const overflow = applyIntent(bought.state, {
        type: 'player/buyHay',
        playerId: 'a',
        count: SILO_CAPACITY,
      });
      expect(overflow.state.hay).toBe(10);
      expect(overflow.state.coins).toBe(bought.state.coins);
    });
  });

  describe('the daily round', () => {
    /** A farm with a silo, hay in it, and one hen that has been fed. */
    function fedFarm(hay = 20): FarmState {
      const state = atRancher({ ...withSilo(ranchFarm()) });
      return { ...buy(state).state, hay };
    }

    it('gives produce the morning after a fed night, and none after a hungry one', () => {
      const fed = fedFarm();
      const morning = sleepThrough(fed).state;
      expect(hasProduce(morning.animals[0], morning.time.day)).toBe(true);

      const starved = sleepThrough({ ...fed, hay: 0 }).state;
      const second = sleepThrough(starved).state;
      expect(second.animals[0].fedToday).toBe(false);
      expect(hasProduce(second.animals[0], second.time.day)).toBe(false);
    });

    it('says how many went hungry, once, for the morning panel', () => {
      const empty = fedFarm(0);
      const hungry = sleepThrough({
        ...empty,
        animals: empty.animals.map((each) => ({ ...each, fedToday: false })),
      });
      expect(hungry.events).toContainEqual({ kind: 'animalsHungry', count: 1 });
    });

    it('draws a bale per animal out of the silo every morning', () => {
      const morning = sleepThrough(fedFarm(20)).state;
      expect(morning.hay).toBe(19);
    });

    it('collects produce when a player acts on the animal, and pets it when there is none', () => {
      const morning = sleepThrough(fedFarm()).state;
      // Out of the door, so there is something standing on a tile to act on.
      const open = {
        ...morning,
        buildings: morning.buildings.map((b) => (b.id === 'b1' ? { ...b, doorOpen: true } : b)),
        time: createTimeState(morning.time.day, 12 * 60),
      };
      const outside = applyIntent(open, { type: 'world/tick', deltaMs: 5000 }).state;
      const at = outside.animals[0].position!;
      const tile = { x: Math.floor(at.x / TILE_SIZE), y: Math.floor(at.y / TILE_SIZE) };
      const beside = place(outside, 'a', at.x, at.y);

      const collected = applyIntent(beside, { type: 'player/act', playerId: 'a', target: tile });
      expect(collected.events).toContainEqual(
        expect.objectContaining({ kind: 'produceCollected', item: 'egg' }),
      );
      expect(countItem(collected.state.players.a.inventory, 'egg')).toBe(1);

      // Nothing left to pick up, so the same key is a stroke instead.
      const petted = applyIntent(collected.state, { type: 'player/act', playerId: 'a', target: tile });
      expect(petted.events).toContainEqual(expect.objectContaining({ kind: 'animalPetted' }));
      expect(petted.state.animals[0].affection).toBeGreaterThan(collected.state.animals[0].affection);
    });

    it('gives the egg to whichever of two farmhands reaches it first', () => {
      const morning = sleepThrough(fedFarm()).state;
      const both = join(morning, 'b');
      const home = both.buildings.find((building) => building.id === 'b1')!;
      const at = { x: (home.x + 1) * TILE_SIZE, y: (home.y + 1) * TILE_SIZE };
      const beside = place(place(both, 'a', at.x, at.y), 'b', at.x, at.y);

      const first = applyIntent(beside, { type: 'player/collectProduce', playerId: 'a', animalId: 'a1' });
      const second = applyIntent(first.state, {
        type: 'player/collectProduce',
        playerId: 'b',
        animalId: 'a1',
      });

      expect(countItem(first.state.players.a.inventory, 'egg')).toBe(1);
      expect(countItem(second.state.players.b.inventory, 'egg')).toBe(0);
      expect(second.state.animals[0].produceOnDay).toBe(first.state.animals[0].produceOnDay);
    });

    it('refuses a chore aimed at an animal on the other side of the valley', () => {
      const morning = sleepThrough(fedFarm()).state;
      const far = place(morning, 'a', RANCHER.x, RANCHER.y, 'village');

      const refused = applyIntent(far, { type: 'player/petAnimal', playerId: 'a', animalId: 'a1' });
      expect(refused.state.animals[0].pettedToday).toBe(false);
    });

    it('does the whole round in one press at the coop door', () => {
      const fed = fedFarm();
      const morning = sleepThrough({ ...fed, hay: 0 }).state;
      // Hay arrives after the trough was filled, which is the only time
      // feeding by hand is a thing anybody has to do.
      const stocked = { ...morning, hay: 5 };
      const home = stocked.buildings.find((building) => building.id === 'b1')!;
      const beside = place(stocked, 'a', (home.x + 1) * TILE_SIZE, (home.y + 1) * TILE_SIZE);

      const done = applyIntent(beside, { type: 'player/act', playerId: 'a' });
      expect(done.state.animals[0].fedToday).toBe(true);
      expect(done.state.hay).toBe(4);
    });
  });

  describe('the coop door', () => {
    function coopFarm() {
      const state = ranchFarm();
      const home = state.buildings[0];
      return place(state, 'a', (home.x + 1) * TILE_SIZE, (home.y + 1) * TILE_SIZE);
    }

    it('swings when a player standing at it asks, and is shared by everybody', () => {
      const opened = applyIntent(coopFarm(), {
        type: 'animals/toggleDoor',
        playerId: 'a',
        buildingId: 'b1',
      });
      expect(opened.state.buildings[0].doorOpen).toBe(true);
      expect(opened.events).toContainEqual({ kind: 'doorToggled', buildingId: 'b1', open: true });

      const shut = applyIntent(opened.state, {
        type: 'animals/toggleDoor',
        playerId: 'a',
        buildingId: 'b1',
      });
      expect(shut.state.buildings[0].doorOpen).toBe(false);
    });

    it('will not swing from across the valley', () => {
      const away = place(ranchFarm(), 'a', RANCHER.x, RANCHER.y, 'village');
      const refused = applyIntent(away, { type: 'animals/toggleDoor', playerId: 'a', buildingId: 'b1' });
      expect(refused.state.buildings[0].doorOpen).toBe(false);
    });

    it('is not a thing a shed has', () => {
      const shed = withSilo(coopFarm());
      const refused = applyIntent(shed, { type: 'animals/toggleDoor', playerId: 'a', buildingId: 'b2' });
      expect(refused.state.buildings[1].doorOpen).toBe(false);
    });

    it('opens the coop when a press has no chores left to do', () => {
      // The third rung of the ladder at a coop door: eggs, then troughs, then
      // the door. An empty-handed press on a coop with nothing to do opens it.
      const bought = buy(atRancher(ranchFarm())).state;
      const home = bought.buildings[0];
      const beside = place(bought, 'a', (home.x + 1) * TILE_SIZE, (home.y + 1) * TILE_SIZE);

      const pressed = applyIntent(beside, { type: 'player/act', playerId: 'a' });
      expect(pressed.state.buildings[0].doorOpen).toBe(true);
    });
  });
});

// --- spec 11: crafting, chests, machines and sprinklers ----------------------

/** A farm with two players seated, nothing standing on it, and a clear field. */
function craftingFarm(): FarmState {
  return bareGround(join(createFarmState(), 'a', 'b'));
}

/** Puts something down at a tile without going through the intent. */
function drop(state: FarmState, placeable: Placeable): FarmState {
  return { ...state, placeables: [...state.placeables, placeable] };
}

/** The placeable with an id, or a loud failure. */
function thing(state: FarmState, id: string): Placeable {
  const found = state.placeables.find((placeable) => placeable.id === id);
  if (!found) throw new Error(`no placeable ${id}`);
  return found;
}

/** Stands a player on the tile next to one, so everything is within reach. */
function standBeside(state: FarmState, id: PlayerId, x: number, y: number): FarmState {
  return place(state, id, x * TILE_SIZE + 16, (y + 1) * TILE_SIZE + 16, START_AREA);
}

/** The slot a given item is sitting in, so a test can put it in hand. */
function slotOf(state: FarmState, id: PlayerId, item: ItemId): number {
  const slot = state.players[id].inventory.findIndex((stack) => stack?.item === item);
  if (slot < 0) throw new Error(`${id} is not carrying ${item}`);
  return slot;
}

/** Puts an item in a player's hand, giving them one if they have none. */
function hold(state: FarmState, id: PlayerId, item: ItemId, count = 1): FarmState {
  const stocked = countItem(state.players[id].inventory, item) > 0 ? state : give(state, id, item, count);
  return holding(stocked, id, slotOf(stocked, id, item));
}

describe('crafting', () => {
  it('takes the ingredients and hands over what was made', () => {
    const farm = give(craftingFarm(), 'a', 'wood', 60);
    const result = applyIntent(farm, { type: 'player/craft', playerId: 'a', recipe: 'chest', count: 1 });

    expect(countItem(result.state.players.a.inventory, 'wood')).toBe(10);
    expect(countItem(result.state.players.a.inventory, 'chest')).toBe(1);
    expect(result.events).toContainEqual({ kind: 'crafted', playerId: 'a', item: 'chest', made: 1 });
  });

  it('refuses when the ingredients are short, and spends nothing', () => {
    const farm = give(craftingFarm(), 'a', 'wood', 10);
    const result = applyIntent(farm, { type: 'player/craft', playerId: 'a', recipe: 'chest', count: 1 });

    expect(result.state).toBe(farm);
    expect(countItem(result.state.players.a.inventory, 'wood')).toBe(10);
    expect(result.events.some((event) => event.kind === 'crafted')).toBe(false);
  });

  it('refuses when the satchel has nowhere to put the result', () => {
    // Every slot occupied by something the chest cannot merge into, and the
    // wood in a stack big enough that spending fifty does not empty a slot.
    let farm = craftingFarm();
    const packed = farm.players.a.inventory.map((_, index) =>
      index === 0 ? newStack('wood', 99) : newStack('stone', 99),
    );
    farm = { ...farm, players: { ...farm.players, a: { ...farm.players.a, inventory: packed } } };

    const result = applyIntent(farm, { type: 'player/craft', playerId: 'a', recipe: 'chest', count: 1 });
    expect(result.state).toBe(farm);
    expect(countItem(result.state.players.a.inventory, 'wood')).toBe(99);
  });

  it('refuses a recipe this player has not learned', () => {
    const farm = give(craftingFarm(), 'a', 'wood', 99);
    // `big-chest` unlocks on a day well past the first.
    expect(farm.players.a.knownRecipes).not.toContain('big-chest');
    const result = applyIntent(farm, {
      type: 'player/craft',
      playerId: 'a',
      recipe: 'big-chest',
      count: 1,
    });
    expect(result.state).toBe(farm);
  });
});

describe('learning recipes', () => {
  /** How many gifts it takes to reach a heart threshold, done the long way. */
  function befriend(state: FarmState, id: PlayerId, npc: NpcId, points: number): FarmState {
    const player = state.players[id];
    return {
      ...state,
      players: {
        ...state.players,
        [id]: {
          ...player,
          relationships: {
            ...player.relationships,
            [npc]: { points, giftsThisWeek: 0, giftedToday: false },
          },
        },
      },
    };
  }

  /** The hearted recipe this test suite works against, read off the table. */
  const HEARTED = ALL_RECIPES.find(
    (recipe): recipe is typeof recipe & { unlock: { by: 'hearts'; npc: NpcId; hearts: number } } =>
      recipe.unlock.by === 'hearts',
  )!;

  it('hands over a recipe once the hearts are there, on the next morning', () => {
    const start = craftingFarm();
    const friendly = befriend(start, 'a', HEARTED.unlock.npc, POINTS_PER_HEART * HEARTED.unlock.hearts);
    expect(friendly.players.a.knownRecipes).not.toContain(HEARTED.id);

    const morning = sleepThrough(friendly);
    expect(morning.state.players.a.knownRecipes).toContain(HEARTED.id);
    expect(
      morning.events.some(
        (event) => event.kind === 'recipeLearned' && event.recipe === HEARTED.id,
      ),
    ).toBe(true);
  });

  it('learns it exactly once, however many mornings go by', () => {
    let farm = befriend(craftingFarm(), 'a', HEARTED.unlock.npc, POINTS_PER_HEART * HEARTED.unlock.hearts);
    farm = sleepThrough(farm).state;

    const second = sleepThrough(farm);
    expect(
      second.events.filter((event) => event.kind === 'recipeLearned' && event.recipe === HEARTED.id),
    ).toEqual([]);
    expect(
      second.state.players.a.knownRecipes.filter((recipe) => recipe === HEARTED.id),
    ).toHaveLength(1);
  });

  it('keeps a learned recipe to the player who earned it', () => {
    // The one place spec 11 deliberately breaks the shared world, because
    // hearts are between two people and a recipe Maeve gave *you* cannot be
    // something the other farmhand woke up knowing.
    const friendly = befriend(
      craftingFarm(),
      'a',
      HEARTED.unlock.npc,
      POINTS_PER_HEART * HEARTED.unlock.hearts,
    );
    const morning = sleepThrough(friendly).state;

    expect(morning.players.a.knownRecipes).toContain(HEARTED.id);
    expect(morning.players.b.knownRecipes).not.toContain(HEARTED.id);
  });

  it('opens a dated recipe on the morning its day arrives', () => {
    const dated = ALL_RECIPES.find((recipe) => recipe.unlock.by === 'day')!;
    if (dated.unlock.by !== 'day') return;

    let farm = craftingFarm();
    expect(farm.players.a.knownRecipes).not.toContain(dated.id);
    while (farm.time.day < dated.unlock.day) farm = sleepThrough(farm).state;
    expect(farm.players.a.knownRecipes).toContain(dated.id);
  });
});

describe('putting things down and taking them back up', () => {
  const spot = FIELD[0];

  it('places what is in hand on the tile that was aimed at', () => {
    let farm = hold(craftingFarm(), 'a', 'chest');
    farm = standBeside(farm, 'a', spot.x, spot.y);

    const result = applyIntent(farm, { type: 'player/act', playerId: 'a', target: spot });
    expect(result.state.placeables).toHaveLength(1);
    expect(result.state.placeables[0]).toMatchObject({ kind: 'chest', x: spot.x, y: spot.y });
    // And it came out of the satchel rather than being conjured.
    expect(countItem(result.state.players.a.inventory, 'chest')).toBe(0);
  });

  it('refuses a tile out of reach, however the command was formed', () => {
    let farm = hold(craftingFarm(), 'a', 'chest');
    farm = place(farm, 'a', 4 * TILE_SIZE, 4 * TILE_SIZE, START_AREA);
    const far = FIELD[FIELD.length - 1];

    const result = applyIntent(farm, {
      type: 'player/placeItem',
      playerId: 'a',
      item: 'chest',
      x: far.x,
      y: far.y,
    });
    expect(result.state.placeables).toEqual([]);
  });

  it('refuses to put down something the satchel does not hold', () => {
    const farm = standBeside(craftingFarm(), 'a', spot.x, spot.y);
    const result = applyIntent(farm, {
      type: 'player/placeItem',
      playerId: 'a',
      item: 'keg',
      x: spot.x,
      y: spot.y,
    });
    expect(result.state.placeables).toEqual([]);
  });

  it('refuses two things on one tile', () => {
    let farm = give(craftingFarm(), 'a', 'chest', 2);
    farm = standBeside(farm, 'a', spot.x, spot.y);
    farm = applyIntent(farm, {
      type: 'player/placeItem',
      playerId: 'a',
      item: 'chest',
      x: spot.x,
      y: spot.y,
    }).state;

    const second = applyIntent(farm, {
      type: 'player/placeItem',
      playerId: 'a',
      item: 'chest',
      x: spot.x,
      y: spot.y,
    });
    expect(second.state.placeables).toHaveLength(1);
    expect(countItem(second.state.players.a.inventory, 'chest')).toBe(1);
  });

  it('takes one back up for somebody holding a pickaxe', () => {
    let farm = drop(craftingFarm(), createPlaceable('p1', 'chest', START_AREA, spot.x, spot.y));
    farm = standBeside(farm, 'a', spot.x, spot.y);
    farm = holding(farm, 'a', SLOT.pickaxe);

    const result = applyIntent(farm, { type: 'player/act', playerId: 'a', target: spot });
    expect(result.state.placeables).toEqual([]);
    expect(countItem(result.state.players.a.inventory, 'chest')).toBe(1);
  });

  it('refuses to take up a chest with anything in it', () => {
    const chest = createPlaceable('p1', 'chest', START_AREA, spot.x, spot.y) as Chest;
    chest.contents[0] = newStack('wood', 4);
    let farm = drop(craftingFarm(), chest);
    farm = standBeside(farm, 'a', spot.x, spot.y);

    const result = applyIntent(farm, { type: 'player/pickUpItem', playerId: 'a', x: spot.x, y: spot.y });
    expect(result.state.placeables).toHaveLength(1);
    expect(countItem(result.state.players.a.inventory, 'chest')).toBe(0);
  });

  it('stops a walker with a fence and lets one over a path', () => {
    const fence = createPlaceable('p1', 'wood-fence', START_AREA, spot.x, spot.y);
    // Collision is handed to the mover as a third list, so a fence is in the
    // way exactly as a building and a boulder already are.
    expect(
      isWalkable(START_AREA, spot.x * TILE_SIZE + 16, spot.y * TILE_SIZE + 16, {
        buildings: [],
        nodes: [],
        placeables: solidPlaceableRects([fence], START_AREA),
      }),
    ).toBe(false);
  });
});

describe('chests', () => {
  const spot = FIELD[0];

  /** A farm with one empty chest on `spot` and both players beside it. */
  function withChest(contents?: (chest: Chest) => void): FarmState {
    const chest = createPlaceable('p1', 'chest', START_AREA, spot.x, spot.y) as Chest;
    contents?.(chest);
    let farm = drop(craftingFarm(), chest);
    farm = standBeside(farm, 'a', spot.x, spot.y);
    farm = standBeside(farm, 'b', spot.x, spot.y);
    return farm;
  }

  it('opens when it is acted on, and names which one', () => {
    const farm = withChest();
    const result = applyIntent(farm, { type: 'player/act', playerId: 'a', target: spot });
    expect(result.state.players.a.panel).toBe('chest');
    expect(result.state.players.a.openChest).toBe('p1');
  });

  it('closes when the player walks away from it', () => {
    let farm = withChest();
    farm = applyIntent(farm, { type: 'player/act', playerId: 'a', target: spot }).state;
    expect(farm.players.a.panel).toBe('chest');

    // Far enough that reach can no longer cover it.
    const walked = place(farm, 'a', spot.x * TILE_SIZE + 400, spot.y * TILE_SIZE, START_AREA);
    const stepped = applyIntent(walked, {
      type: 'player/move',
      playerId: 'a',
      dx: 1,
      dy: 0,
      deltaMs: 16,
    });
    expect(stepped.state.players.a.panel).toBeNull();
    expect(stepped.state.players.a.openChest).toBeNull();
  });

  it('moves a stack from the satchel into the chest', () => {
    let farm = give(withChest(), 'a', 'wood', 12);
    const from = slotOf(farm, 'a', 'wood');
    farm = applyIntent(farm, {
      type: 'chest/moveStack',
      playerId: 'a',
      chestId: 'p1',
      from: { side: 'player', slot: from },
      to: { side: 'chest', slot: 0 },
    }).state;

    const chest = thing(farm, 'p1') as Chest;
    expect(countItem(chest.contents, 'wood')).toBe(12);
    expect(countItem(farm.players.a.inventory, 'wood')).toBe(0);
  });

  it('refuses a chest the player is nowhere near', () => {
    let farm = give(withChest(), 'a', 'wood', 12);
    farm = place(farm, 'a', 4 * TILE_SIZE, 4 * TILE_SIZE, START_AREA);
    const from = slotOf(farm, 'a', 'wood');

    const result = applyIntent(farm, {
      type: 'chest/moveStack',
      playerId: 'a',
      chestId: 'p1',
      from: { side: 'player', slot: from },
      to: { side: 'chest', slot: 0 },
    });
    expect(countItem((thing(result.state, 'p1') as Chest).contents, 'wood')).toBe(0);
  });

  it('does not double a stack two people reach for at the same moment', () => {
    // The concurrency this spec actually creates. Both players ask for the
    // same stack; the first gets it and the second finds an empty slot, and
    // the total across the world is what it was before either asked.
    const farm = withChest((chest) => {
      chest.contents[0] = newStack('wood', 20);
    });

    const take = (state: FarmState, who: PlayerId) =>
      applyIntent(state, {
        type: 'chest/moveStack',
        playerId: who,
        chestId: 'p1',
        from: { side: 'chest', slot: 0 },
        to: { side: 'player', slot: 20 },
      }).state;

    const after = take(take(farm, 'a'), 'b');
    const total =
      countItem((thing(after, 'p1') as Chest).contents, 'wood') +
      countItem(after.players.a.inventory, 'wood') +
      countItem(after.players.b.inventory, 'wood');

    expect(total).toBe(20);
    // And exactly one of them actually got it.
    expect(countItem(after.players.a.inventory, 'wood')).toBe(20);
    expect(countItem(after.players.b.inventory, 'wood')).toBe(0);
  });

  it('tops up only the stacks the chest already has, so it cannot eat a tool', () => {
    const farm = give(
      withChest((chest) => {
        chest.contents[0] = newStack('wood', 5);
      }),
      'a',
      'wood',
      9,
    );

    const after = applyIntent(farm, { type: 'chest/stow', playerId: 'a', chestId: 'p1' }).state;
    expect(countItem((thing(after, 'p1') as Chest).contents, 'wood')).toBe(14);
    expect(countItem(after.players.a.inventory, 'wood')).toBe(0);
    // The hoe is still where it was, because the chest has no hoe in it.
    expect(countItem(after.players.a.inventory, 'hoe')).toBe(1);
  });
});

describe('machines', () => {
  const spot = FIELD[0];

  function withMachine(kind: Machine['kind'], job: Machine['job'] = null): FarmState {
    const built = createPlaceable('p1', kind, START_AREA, spot.x, spot.y) as Machine;
    let farm = drop(craftingFarm(), { ...built, job });
    farm = standBeside(farm, 'a', spot.x, spot.y);
    return farm;
  }

  it('takes what is in hand and starts counting days', () => {
    let farm = withMachine('keg');
    farm = hold(farm, 'a', 'melon');

    const result = applyIntent(farm, { type: 'player/act', playerId: 'a', target: spot });
    const loaded = thing(result.state, 'p1') as Machine;

    expect(loaded.job).toEqual({
      input: 'melon',
      output: 'wine-melon',
      readyOnDay: farm.time.day + MACHINE_DEFS.keg.days,
    });
    expect(countItem(result.state.players.a.inventory, 'melon')).toBe(0);
  });

  it('refuses an input it does not take, and keeps the item', () => {
    let farm = withMachine('jar');
    farm = hold(farm, 'a', 'wheat');

    const result = applyIntent(farm, { type: 'machine/load', playerId: 'a', machineId: 'p1' });
    expect((thing(result.state, 'p1') as Machine).job).toBeNull();
    expect(countItem(result.state.players.a.inventory, 'wheat')).toBe(1);
  });

  it('refuses while it is already running', () => {
    let farm = withMachine('keg', { input: 'melon', output: 'wine-melon', readyOnDay: 99 });
    farm = hold(farm, 'a', 'melon');

    const result = applyIntent(farm, { type: 'machine/load', playerId: 'a', machineId: 'p1' });
    expect((thing(result.state, 'p1') as Machine).job?.input).toBe('melon');
    expect(countItem(result.state.players.a.inventory, 'melon')).toBe(1);
  });

  it('eats ten planks a batch in the kiln, and refuses on nine', () => {
    let farm = withMachine('kiln');
    farm = hold(farm, 'a', 'wood', 9);
    expect(
      (thing(applyIntent(farm, { type: 'machine/load', playerId: 'a', machineId: 'p1' }).state, 'p1') as Machine)
        .job,
    ).toBeNull();

    farm = give(farm, 'a', 'wood', 1);
    const loaded = applyIntent(farm, { type: 'machine/load', playerId: 'a', machineId: 'p1' }).state;
    expect((thing(loaded, 'p1') as Machine).job?.output).toBe('coal');
    expect(countItem(loaded.players.a.inventory, 'wood')).toBe(0);
  });

  it('eats five ore and one coal in the furnace, and gives a bar the next morning', () => {
    let farm = withMachine('furnace');
    farm = give(hold(farm, 'a', 'copper-ore', 5), 'a', 'coal', 1);

    const loaded = applyIntent(farm, { type: 'machine/load', playerId: 'a', machineId: 'p1' }).state;
    expect((thing(loaded, 'p1') as Machine).job?.output).toBe('copper-bar');
    expect(countItem(loaded.players.a.inventory, 'copper-ore')).toBe(0);
    expect(countItem(loaded.players.a.inventory, 'coal')).toBe(0);

    const morning = standBeside(sleepThrough(loaded).state, 'a', spot.x, spot.y);
    const collected = applyIntent(morning, { type: 'machine/collect', playerId: 'a', machineId: 'p1' });
    expect(countItem(collected.state.players.a.inventory, 'copper-bar')).toBe(1);
  });

  it('refuses the furnace without coal, and keeps every ore', () => {
    let farm = withMachine('furnace');
    farm = hold(farm, 'a', 'copper-ore', 5);

    const result = applyIntent(farm, { type: 'machine/load', playerId: 'a', machineId: 'p1' });
    expect((thing(result.state, 'p1') as Machine).job).toBeNull();
    expect(countItem(result.state.players.a.inventory, 'copper-ore')).toBe(5);
    expect(result.events).toContainEqual({
      kind: 'message',
      playerId: 'a',
      text: 'Lò nấu cần thêm 1 than làm nhiên liệu.',
    });
  });

  it('knows how to build a furnace from the first morning', () => {
    const farm = give(give(craftingFarm(), 'a', 'stone', 25), 'a', 'copper-ore', 10);
    const made = applyIntent(farm, { type: 'player/craft', playerId: 'a', recipe: 'furnace', count: 1 });
    expect(countItem(made.state.players.a.inventory, 'furnace')).toBe(1);
  });

  it('announces itself on the morning it finishes, once', () => {
    const farm = withMachine('keg', {
      input: 'melon',
      output: 'wine-melon',
      readyOnDay: createFarmState().time.day + 1,
    });

    const morning = sleepThrough(farm);
    expect(morning.events).toContainEqual({
      kind: 'machineReady',
      machineId: 'p1',
      machine: 'keg',
      output: 'wine-melon',
    });
    // And not again the next day, because it is news rather than a state.
    const after = sleepThrough(morning.state);
    expect(after.events.some((event) => event.kind === 'machineReady')).toBe(false);
  });

  it('hands over what it made, and is empty afterwards', () => {
    let farm = withMachine('keg', { input: 'melon', output: 'wine-melon', readyOnDay: 1 });
    farm = { ...farm, time: { ...farm.time, day: 9 } };

    const result = applyIntent(farm, { type: 'player/act', playerId: 'a', target: spot });
    expect(countItem(result.state.players.a.inventory, 'wine-melon')).toBe(1);
    expect((thing(result.state, 'p1') as Machine).job).toBeNull();
  });

  it('keeps what it made when the satchel is full', () => {
    let farm = withMachine('keg', { input: 'melon', output: 'wine-melon', readyOnDay: 1 });
    farm = { ...farm, time: { ...farm.time, day: 9 } };
    const packed = farm.players.a.inventory.map(() => newStack('stone', 99));
    farm = { ...farm, players: { ...farm.players, a: { ...farm.players.a, inventory: packed } } };

    const result = applyIntent(farm, { type: 'machine/collect', playerId: 'a', machineId: 'p1' });
    expect((thing(result.state, 'p1') as Machine).job?.output).toBe('wine-melon');
  });
});

describe('sprinklers', () => {
  /** A tilled, seeded bed, which is the only thing a sprinkler waters. */
  function seedBed(state: FarmState, x: number, y: number): FarmState {
    const key = plotKey(START_AREA, x, y);
    return {
      ...state,
      plots: {
        ...state.plots,
        [key]: { ...state.plots[key], stage: 'seeded', crop: 'turnip', daysWatered: 0, wateredToday: false },
      },
    };
  }

  /**
   * A tile with all eight neighbours farmable, so both patterns land on soil.
   *
   * Taken off the map's own plot list rather than off `FIELD`, which excludes
   * whatever the first morning happened to scatter brambles on: these tests
   * run on `bareGround`, so every farmable cell is available and what is
   * wanted is a spot in the middle of the field rather than a clear one.
   */
  const PLOTS = areaMap(START_AREA).plotTiles;
  const CENTRE = PLOTS.find((tile) =>
    [-1, 0, 1].every((dy) =>
      [-1, 0, 1].every(
        (dx) =>
          (dx === 0 && dy === 0) ||
          PLOTS.some((other) => other.x === tile.x + dx && other.y === tile.y + dy),
      ),
    ),
  )!;

  it('waters its own shape overnight, and nothing outside it', () => {
    let farm = craftingFarm();
    for (const offset of [
      { x: 0, y: -1 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ]) {
      farm = seedBed(farm, CENTRE.x + offset.x, CENTRE.y + offset.y);
    }
    farm = drop(farm, createPlaceable('p1', 'sprinkler', START_AREA, CENTRE.x, CENTRE.y));

    const morning = sleepThrough(farm);
    const grew = (x: number, y: number) =>
      morning.state.plots[plotKey(START_AREA, x, y)].daysWatered;

    // The four it reaches took on a day of water overnight.
    expect(grew(CENTRE.x, CENTRE.y - 1)).toBe(1);
    expect(grew(CENTRE.x + 1, CENTRE.y)).toBe(1);
    // The diagonal is outside a plain sprinkler's shape.
    expect(grew(CENTRE.x + 1, CENTRE.y + 1)).toBe(0);
  });

  it('waters before the growth step, so the water counts tonight', () => {
    // The whole point of the sprinkler, and the one ordering decision in
    // `startNewDay`. Watering afterwards would set a flag the *next* roll-over
    // consumed, which is a day of lag nobody would call a feature.
    let farm = craftingFarm();
    farm = seedBed(farm, CENTRE.x, CENTRE.y - 1);
    farm = drop(farm, createPlaceable('p1', 'sprinkler', START_AREA, CENTRE.x, CENTRE.y));

    const morning = sleepThrough(farm);
    const plot = morning.state.plots[plotKey(START_AREA, CENTRE.x, CENTRE.y - 1)];
    expect(plot.daysWatered).toBe(1);
    // And the flag is spent rather than left set, or the next night would
    // count the same watering twice.
    expect(plot.wateredToday).toBe(false);
    expect(morning.events).toContainEqual({ kind: 'sprinklersRan', watered: 1 });
  });

  it('leaves wild ground alone, because a sprinkler does not till', () => {
    let farm = craftingFarm();
    farm = drop(farm, createPlaceable('p1', 'sprinkler', START_AREA, CENTRE.x, CENTRE.y));
    const morning = sleepThrough(farm);

    expect(morning.state.plots[plotKey(START_AREA, CENTRE.x, CENTRE.y - 1)].daysWatered).toBe(0);
    expect(morning.events.some((event) => event.kind === 'sprinklersRan')).toBe(false);
  });

  it('never reaches across onto another map', () => {
    // One standing at the same coordinates in the village must not water the
    // farm's beds, which is what carrying the area on every tile buys.
    let farm = craftingFarm();
    farm = seedBed(farm, CENTRE.x, CENTRE.y - 1);
    farm = drop(farm, createPlaceable('p1', 'sprinkler', 'village', CENTRE.x, CENTRE.y));

    const morning = sleepThrough(farm);
    expect(morning.state.plots[plotKey(START_AREA, CENTRE.x, CENTRE.y - 1)].daysWatered).toBe(0);
  });

  it('gives the quality one the diagonals as well', () => {
    let farm = craftingFarm();
    farm = seedBed(farm, CENTRE.x + 1, CENTRE.y + 1);
    farm = drop(farm, createPlaceable('p1', 'quality-sprinkler', START_AREA, CENTRE.x, CENTRE.y));

    const morning = sleepThrough(farm);
    expect(morning.state.plots[plotKey(START_AREA, CENTRE.x + 1, CENTRE.y + 1)].daysWatered).toBe(1);
  });
});

/**
 * A stretch of water with somewhere to stand beside it.
 *
 * Read off the maps rather than written down, for the reason every other
 * fixture here is: moving the pond in Tiled should move these tests rather
 * than break them. The shore tile is where a player stands; the water tile is
 * what they throw at.
 */
const BANK = (() => {
  for (const area of ['farm', 'village', 'forest'] as const) {
    const map = areaMap(area);
    for (let y = 0; y < map.height; y += 1) {
      for (let x = 0; x < map.width; x += 1) {
        if (tileAt(area, x, y)?.kind !== 'water') continue;
        for (const [dx, dy] of [
          [0, 1],
          [0, -1],
          [1, 0],
          [-1, 0],
        ]) {
          const shore = tileAt(area, x + dx, y + dy);
          if (!shore || shore.solid || shore.kind === 'water') continue;
          return { area, water: { x, y }, shore: { x: x + dx, y: y + dy } };
        }
      }
    }
  }
  throw new Error('no map has water with a bank beside it');
})();

/** The slot a rod goes in, past everything a farmhand wakes up carrying. */
const ROD_SLOT = 10;

/** Stands a player on the bank with a rod in hand, ready to throw. */
function onTheBank(state: FarmState, id: PlayerId, rod: ItemId = 'fishing-rod'): FarmState {
  const armed = setSlot(state, id, ROD_SLOT, { item: rod, count: 1 });
  const standing = place(
    armed,
    id,
    BANK.shore.x * TILE_SIZE + 16,
    BANK.shore.y * TILE_SIZE + 16,
    BANK.area,
  );
  return holding(standing, id, ROD_SLOT);
}

/** Runs the simulation forward in frames, collecting what happened. */
function runFrames(
  state: FarmState,
  frames: number,
  deltaMs = 50,
): { state: FarmState; events: GameEvent[] } {
  let next = state;
  const events: GameEvent[] = [];
  for (let i = 0; i < frames; i += 1) {
    const result = applyIntent(next, { type: 'world/tick', deltaMs });
    next = result.state;
    events.push(...result.events);
  }
  return { state: next, events };
}

/** Casts, then runs on until something takes the line. */
function castAndWaitForBite(state: FarmState, id: PlayerId): FarmState {
  let next = applyIntent(onTheBank(state, id), {
    type: 'player/cast',
    playerId: id,
    target: BANK.water,
  }).state;
  for (let i = 0; i < 400; i += 1) {
    next = applyIntent(next, { type: 'world/tick', deltaMs: 50 }).state;
    if (next.players[id].fishing?.phase === 'biting') return next;
  }
  throw new Error('nothing bit');
}

describe('fishing', () => {
  const farm = () => join(createFarmState(), 'ana');

  it('refuses a cast at anything that is not water', () => {
    const state = onTheBank(farm(), 'ana');
    const result = applyIntent(state, { type: 'player/cast', playerId: 'ana', target: BANK.shore });
    expect(result.state.players.ana.fishing).toBeNull();
    expect(result.events).toContainEqual({
      kind: 'message',
      playerId: 'ana',
      text: 'Phải ném xuống nước.',
    });
  });

  it('refuses a cast past the same reach every other action is held to', () => {
    const far = { x: BANK.water.x + 4, y: BANK.water.y };
    const result = applyIntent(onTheBank(farm(), 'ana'), {
      type: 'player/cast',
      playerId: 'ana',
      target: far,
    });
    expect(result.state.players.ana.fishing).toBeNull();
    expect(result.events).toContainEqual({
      kind: 'message',
      playerId: 'ana',
      text: 'Chỗ đó ngoài tầm với.',
    });
  });

  it('refuses a cast from somebody holding anything but a rod', () => {
    const state = holding(onTheBank(farm(), 'ana'), 'ana', SLOT.hoe);
    const result = applyIntent(state, { type: 'player/cast', playerId: 'ana', target: BANK.water });
    expect(result.state.players.ana.fishing).toBeNull();
  });

  it('spends the energy on the throw and keeps it on a miss', () => {
    const state = onTheBank(farm(), 'ana');
    const before = state.players.ana.energy;
    const cast = applyIntent(state, { type: 'player/cast', playerId: 'ana', target: BANK.water }).state;
    expect(cast.players.ana.energy).toBe(before - CAST_ENERGY);

    // Run past the bite window without striking. The fish is gone and the
    // energy is gone with it, which is what stops casting being free.
    const missed = runFrames(cast, 400).state;
    expect(missed.players.ana.fishing).toBeNull();
    expect(missed.players.ana.energy).toBe(before - CAST_ENERGY);
  });

  it('spends exactly one bait per cast, and casts fine without any', () => {
    const baited = give(onTheBank(farm(), 'ana'), 'ana', 'bait', 3);
    const cast = applyIntent(baited, { type: 'player/cast', playerId: 'ana', target: BANK.water }).state;
    expect(countItem(cast.players.ana.inventory, 'bait')).toBe(2);

    const plain = onTheBank(farm(), 'ana');
    const unbaited = applyIntent(plain, { type: 'player/cast', playerId: 'ana', target: BANK.water }).state;
    expect(unbaited.players.ana.fishing).not.toBeNull();
    expect(countItem(unbaited.players.ana.inventory, 'bait')).toBe(0);
  });

  it('pins the player to the bank without losing the fish to a stray key', () => {
    const cast = applyIntent(onTheBank(farm(), 'ana'), {
      type: 'player/cast',
      playerId: 'ana',
      target: BANK.water,
    }).state;
    const before = { x: cast.players.ana.x, y: cast.players.ana.y };

    const walked = applyIntent(cast, {
      type: 'player/move',
      playerId: 'ana',
      dx: 1,
      dy: 0,
      deltaMs: 200,
    }).state;
    expect({ x: walked.players.ana.x, y: walked.players.ana.y }).toEqual(before);
    // And the cast is still there: a refused step must not be a cancelled cast.
    expect(walked.players.ana.fishing).not.toBeNull();
  });

  it('winds the line in when asked, and refunds nothing', () => {
    const cast = applyIntent(onTheBank(farm(), 'ana'), {
      type: 'player/cast',
      playerId: 'ana',
      target: BANK.water,
    }).state;
    const wound = applyIntent(cast, { type: 'player/cancelCast', playerId: 'ana' });
    expect(wound.state.players.ana.fishing).toBeNull();
    expect(wound.state.players.ana.energy).toBe(cast.players.ana.energy);
  });

  it('ignores a reel that arrives before anything has bitten', () => {
    const cast = applyIntent(onTheBank(farm(), 'ana'), {
      type: 'player/cast',
      playerId: 'ana',
      target: BANK.water,
    }).state;
    expect(cast.players.ana.fishing?.phase).toBe('casting');

    const hammered = applyIntent(cast, { type: 'player/reel', playerId: 'ana', down: true });
    // Silently: no new state, no revision bump, and above all no sentence
    // telling somebody off for pressing a key at the wrong moment.
    expect(hammered.state).toBe(cast);
    expect(hammered.events).toEqual([]);
  });

  it('hooks the fish when the reel arrives inside the bite window', () => {
    const biting = castAndWaitForBite(farm(), 'ana');
    const struck = applyIntent(biting, { type: 'player/reel', playerId: 'ana', down: true }).state;
    expect(struck.players.ana.fishing?.phase).toBe('reeling');
    expect(struck.players.ana.fishing?.reeling).toBe(true);
  });

  it('says a fish bit exactly once, to the person holding the rod', () => {
    const cast = applyIntent(onTheBank(farm(), 'ana'), {
      type: 'player/cast',
      playerId: 'ana',
      target: BANK.water,
    }).state;
    const { events } = runFrames(cast, 200);
    const bites = events.filter((event) => event.kind === 'bite');
    expect(bites).toHaveLength(1);
    expect(bites[0]).toEqual({ kind: 'bite', playerId: 'ana' });
  });

  it('holds a landed fish on the line when the satchel is full, and hands it over when a slot frees', () => {
    let state = onTheBank(farm(), 'ana');
    // Every slot but the rod taken, so there is genuinely nowhere for it to go.
    const inventory = state.players.ana.inventory.map((stack, index) =>
      index === ROD_SLOT ? stack : { item: 'stone' as ItemId, count: 99 },
    );
    state = { ...state, players: { ...state.players, ana: { ...state.players.ana, inventory } } };

    const cast = applyIntent(state, { type: 'player/cast', playerId: 'ana', target: BANK.water }).state;
    // Reached into the cast to put the fish on the bank. Playing the bar out
    // frame by frame would be testing the physics, which has its own file.
    const landed: FarmState = {
      ...cast,
      players: {
        ...cast.players,
        ana: {
          ...cast.players.ana,
          fishing: { ...cast.players.ana.fishing!, phase: 'reeling' as const, progress: 0.999 },
        },
      },
    };

    const full = runFrames(landed, 4);
    expect(full.state.players.ana.fishing).not.toBeNull();
    expect(full.state.players.ana.fishing?.landed).toBe(true);
    expect(full.events.some((event) => event.kind === 'fishCaught')).toBe(false);
    expect(
      full.events.some((event) => event.kind === 'message' && event.text.includes('đầy')),
    ).toBe(true);

    // Now make room. The next tick finishes the catch — no second cast, and
    // nothing quietly lost in between.
    const fish = full.state.players.ana.fishing!.fish;
    const cleared = setSlot(full.state, 'ana', 0, null);
    const delivered = runFrames(cleared, 1);
    expect(delivered.state.players.ana.fishing).toBeNull();
    expect(countItem(delivered.state.players.ana.inventory, fish)).toBe(1);
    expect(delivered.events.some((event) => event.kind === 'fishCaught')).toBe(true);
  });

  it('clears the cast when the person holding the rod disconnects', () => {
    const biting = castAndWaitForBite(farm(), 'ana');
    expect(biting.players.ana.fishing).not.toBeNull();
    const gone = applyIntent(biting, { type: 'player/leave', playerId: 'ana' }).state;
    expect(gone.players.ana.fishing).toBeNull();
    // The rest of them is still there: leaving is not moving out.
    expect(gone.players.ana.online).toBe(false);
    expect(gone.players.ana.inventory[ROD_SLOT]?.item).toBe('fishing-rod');
  });

  it('clears the cast overnight, so nobody wakes up mid-bite', () => {
    const biting = castAndWaitForBite(join(createFarmState(), 'ana'), 'ana');
    const morning = sleepThrough(biting).state;
    expect(morning.players.ana.fishing).toBeNull();
  });

  it('gives two people on two banks two independent casts', () => {
    let state = join(createFarmState(), 'ana', 'bo');
    state = onTheBank(state, 'ana');
    state = onTheBank(state, 'bo');
    state = applyIntent(state, { type: 'player/cast', playerId: 'ana', target: BANK.water }).state;
    state = applyIntent(state, { type: 'player/cast', playerId: 'bo', target: BANK.water }).state;

    expect(state.players.ana.fishing).not.toBeNull();
    expect(state.players.bo.fishing).not.toBeNull();

    // Winding one in leaves the other exactly as it was.
    const before = state.players.bo.fishing;
    const wound = applyIntent(state, { type: 'player/cancelCast', playerId: 'ana' }).state;
    expect(wound.players.ana.fishing).toBeNull();
    expect(wound.players.bo.fishing).toBe(before);
  });

  it('refuses to swing a tool at anything while a line is in the water', () => {
    const cast = applyIntent(onTheBank(farm(), 'ana'), {
      type: 'player/cast',
      playerId: 'ana',
      target: BANK.water,
    }).state;
    const swung = applyIntent(cast, { type: 'player/act', playerId: 'ana' });
    expect(swung.state).toBe(cast);
    expect(swung.events).toEqual([]);
  });
});

describe('an evening on the bank, start to finish', () => {
  /**
   * The whole loop through the reducer, with a player driving it.
   *
   * Every other test here takes one rule at a time. This one asks the question
   * that matters: cast, wait, strike, fight, and is there a fish in the
   * satchel at the end of it. It drives the same three intents a client sends
   * and reads nothing it would not be shown.
   */
  it('puts a fish in the satchel', () => {
    let state = onTheBank(join(createFarmState(), 'ana'), 'ana');
    const before = state.players.ana.inventory.filter((slot) => slot !== null).length;

    state = applyIntent(state, { type: 'player/cast', playerId: 'ana', target: BANK.water }).state;

    let holding = false;
    let caught = false;
    for (let frame = 0; frame < 2000 && !caught; frame += 1) {
      const fishing = state.players.ana.fishing;
      if (!fishing) break;

      if (fishing.phase === 'biting' && !holding) {
        // Strike. The client sends the same press it would send to reel.
        state = applyIntent(state, { type: 'player/reel', playerId: 'ana', down: true }).state;
        holding = true;
      } else if (fishing.phase === 'reeling') {
        // Chase the fish with the square, the way a person would.
        const wants = fishing.fishAt > fishing.barAt + fishing.barWidth / 2;
        if (wants !== fishing.reeling) {
          state = applyIntent(state, { type: 'player/reel', playerId: 'ana', down: wants }).state;
        }
      }

      const ticked = applyIntent(state, { type: 'world/tick', deltaMs: 32 });
      state = ticked.state;
      caught = ticked.events.some((event) => event.kind === 'fishCaught');
    }

    expect(caught).toBe(true);
    expect(state.players.ana.fishing).toBeNull();
    // One new stack: the catch. Carp at difficulty 1 or a boot at difficulty 1,
    // both of which are a thing in a slot that was empty a minute ago.
    const after = state.players.ana.inventory.filter((slot) => slot !== null).length;
    expect(after).toBe(before + 1);
  });
});
