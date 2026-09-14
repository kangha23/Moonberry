import { describe, expect, it } from 'vitest';
import { CROP_DEFINITIONS } from '../systems/farming';
import { QUEST_REWARD_COINS } from '../systems/quest';
import { START_AREA, TILE_SIZE, areaMap, plotKey } from '../world/areas';
import { applyIntent, createFarmState } from './reducer';
import { MAX_PLAYERS, type FarmState, type PlayerId } from './types';

function join(state: FarmState, ...ids: PlayerId[]): FarmState {
  return ids.reduce((acc, id) => applyIntent(acc, { type: 'player/join', playerId: id, name: id }).state, state);
}

/** Places a player at a world position without going through movement. */
function place(state: FarmState, id: PlayerId, x: number, y: number, area = START_AREA): FarmState {
  return { ...state, players: { ...state.players, [id]: { ...state.players[id], area, x, y } } };
}

/** The first farmable tiles on the starting map, whatever the map looks like. */
const FIELD = areaMap(START_AREA).plotTiles;

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

  it('frees the seat on leave', () => {
    const state = join(createFarmState(), 'a', 'b');
    const after = applyIntent(state, { type: 'player/leave', playerId: 'a' }).state;

    expect(after.players.a).toBeUndefined();
    expect(after.players.b).toBeDefined();
  });
});

describe('shared wallet, private satchel', () => {
  it('credits the farm wallet but empties only the selling player satchel', () => {
    let state = join(createFarmState(), 'a', 'b');
    state = {
      ...state,
      players: {
        ...state.players,
        a: { ...state.players.a, satchel: { ...state.players.a.satchel, crops: { turnip: 3, strawberry: 0 } } },
        b: { ...state.players.b, satchel: { ...state.players.b.satchel, crops: { turnip: 2, strawberry: 0 } } },
      },
    };
    const market = propCentreOf('market');
    state = place(state, 'a', market.x, market.y, propArea('market'));
    const walletBefore = state.coins;

    const result = applyIntent(state, { type: 'player/act', playerId: 'a' });

    expect(result.state.coins).toBe(walletBefore + 3 * CROP_DEFINITIONS.turnip.sellPrice);
    expect(result.state.players.a.satchel.crops.turnip).toBe(0);
    expect(result.state.players.b.satchel.crops.turnip).toBe(2);
  });

  it('spends seeds from the acting player satchel only', () => {
    let state = join(createFarmState(), 'a', 'b');
    const cell = FIELD[0];
    const cellKey = plotKey(START_AREA, cell.x, cell.y);
    state = faceTileFromBelow(state, 'a', cell.x, cell.y);
    state = { ...state, plots: { ...state.plots, [cellKey]: { ...state.plots[cellKey], stage: 'tilled' } } };
    state = { ...state, players: { ...state.players, a: { ...state.players.a, tool: 'seed' } } };

    const after = applyIntent(state, { type: 'player/act', playerId: 'a' }).state;

    expect(after.players.a.satchel.seeds.turnip).toBe(7);
    expect(after.players.b.satchel.seeds.turnip).toBe(8);
  });
});

describe('farm-wide quest', () => {
  it('lets one player harvest and another claim the reward, once', () => {
    let state = join(createFarmState(), 'a', 'b');
    state = { ...state, players: { ...state.players, a: { ...state.players.a, tool: 'harvest' } } };

    // Player A harvests the three turnips the quest asks for.
    for (const { x, y } of FIELD.slice(0, 3)) {
      state = ripen(state, x, y);
      state = faceTileFromBelow(state, 'a', x, y);
      state = applyIntent(state, { type: 'player/act', playerId: 'a' }).state;
    }

    expect(state.quest.progress).toBe(3);
    expect(state.quest.completed).toBe(true);

    // Player B, who harvested nothing, can still collect for the farm.
    const rowan = propCentreOf('rowan');
    state = place(state, 'b', rowan.x, rowan.y + 28, propArea('rowan'));
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
    const after = applyIntent(state, { type: 'world/tick', deltaMs: 1200 }).state;

    expect(after.time.totalMinutes).toBe(state.time.totalMinutes + 10);
  });

  it('rolls the day over and refills every player watering can', () => {
    let state = join(createFarmState(), 'a', 'b');
    state = {
      ...state,
      players: {
        ...state.players,
        a: { ...state.players.a, satchel: { ...state.players.a.satchel, water: 0 } },
        b: { ...state.players.b, satchel: { ...state.players.b.satchel, water: 3 } },
      },
    };

    // 6am to 11pm is 17 in-game hours, i.e. 102 ten-minute steps.
    let events: Array<{ kind: string }> = [];
    for (let i = 0; i < 103; i += 1) {
      const result = applyIntent(state, { type: 'world/tick', deltaMs: 1200 });
      state = result.state;
      events = events.concat(result.events);
    }

    expect(state.time.day).toBe(2);
    expect(state.players.a.satchel.water).toBe(12);
    expect(state.players.b.satchel.water).toBe(12);
    expect(events.some((event) => event.kind === 'dayStarted')).toBe(true);
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
    const noop = applyIntent(state, { type: 'player/selectTool', playerId: 'a', tool: 'hoe' });
    const real = applyIntent(state, { type: 'player/selectTool', playerId: 'a', tool: 'water' });

    expect(noop.state.revision).toBe(state.revision);
    expect(real.state.revision).toBe(state.revision + 1);
  });
});
