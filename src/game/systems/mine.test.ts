import { describe, expect, it } from 'vitest';
import { applyIntent, CLOCK_STEP_MS, createFarmState } from '../state/reducer';
import { decodeSave, encodeSave, SAVE_VERSION } from '../state/persistence';
import { blockersFor } from '../state/rules/common';
import { startNewDay } from '../state/rules/day';
import type { GameEvent } from '../state/intents';
import {
  COLLAPSE_COIN_CAP,
  COLLAPSE_COIN_SHARE,
  STARTING_MAX_ENERGY,
  STARTING_MAX_HEALTH,
  type FarmState,
  type PlayerId,
  type PlayerState,
} from '../state/types';
import {
  START_AREA,
  TILE_SIZE,
  interactableAt,
  isWalkable,
  mineArea,
  spawnPoints,
  type Point,
} from '../world/areas';
import { addItem, countItem, newStack } from './inventory';
import { ITEMS } from './items';
import { createNode, oreRequires } from './resources';
import {
  ELEVATOR_EVERY,
  MAX_DEPTH,
  MONSTER_ATTACK,
  MONSTER_SIGHT_TILES,
  generateFloor,
  mineSeedFor,
  monsterTable,
  oreTable,
  rollLoot,
  strikeDamage,
  type Monster,
} from './mine';

const SEED = 0x6d6f6f6e;

describe('generateFloor', () => {
  it('is deterministic: same seed and depth give the same floor', () => {
    const a = generateFloor(SEED, 5);
    const b = generateFloor(SEED, 5);
    expect(a).toEqual(b);
  });

  it('grows wider and taller with depth, from 24 up to 40', () => {
    const shallow = generateFloor(SEED, 1);
    const deep = generateFloor(SEED, 40);
    expect(shallow.width).toBeGreaterThanOrEqual(24);
    expect(shallow.width).toBeLessThanOrEqual(40);
    expect(deep.width).toBeGreaterThanOrEqual(shallow.width);
    expect(deep.height).toBeGreaterThanOrEqual(shallow.height);
  });

  it('always has a ladder far from the entrance', () => {
    const floor = generateFloor(SEED, 12);
    expect(floor.ladder).not.toBeNull();
    const dx = Math.abs((floor.ladder?.x ?? 0) - floor.entrance.x);
    const dy = Math.abs((floor.ladder?.y ?? 0) - floor.entrance.y);
    expect(dx + dy).toBeGreaterThan(8);
  });

  it('marks an elevator floor every 5 depths', () => {
    expect(generateFloor(SEED, 5).hasElevator).toBe(true);
    expect(generateFloor(SEED, 10).hasElevator).toBe(true);
    expect(generateFloor(SEED, 6).hasElevator).toBe(false);
    expect(ELEVATOR_EVERY).toBe(5);
    expect(MAX_DEPTH).toBe(40);
  });
});

describe('depth tables', () => {
  it('gives copper early and gold plus gem at the bottom', () => {
    expect(oreTable(3)).toContain('copper-ore');
    expect(oreTable(3)).not.toContain('gold-ore');
    expect(oreTable(40)).toContain('gold-ore');
    expect(oreTable(40)).toContain('gem');
  });

  it('sends green slimes first and the floor boss last', () => {
    expect(monsterTable(2)).toContain('green-slime');
    expect(monsterTable(40)).toContain('floor-boss');
    expect(monsterTable(40)).not.toContain('green-slime');
  });
});

describe('combat and loot', () => {
  it('never deals less than 1 after defense', () => {
    expect(strikeDamage(10, 0)).toBe(10);
    expect(strikeDamage(3, 10)).toBe(1);
  });

  it('rolls the same loot for the same kill', () => {
    const a = rollLoot(SEED, 'm1', 12);
    const b = rollLoot(SEED, 'm1', 12);
    expect(a).toEqual(b);
  });
});

// --- slice 2: reducer + state ------------------------------------------------

const SWORD = 'rusty-sword';

function farmWith(...ids: PlayerId[]): FarmState {
  let state = createFarmState();
  for (const id of ids) state = applyIntent(state, { type: 'player/join', playerId: id, name: id }).state;
  return state;
}

function centre(tile: Point): Point {
  return { x: tile.x * TILE_SIZE + TILE_SIZE / 2, y: tile.y * TILE_SIZE + TILE_SIZE / 2 };
}

function patch(state: FarmState, id: PlayerId, fields: Partial<PlayerState>): FarmState {
  return { ...state, players: { ...state.players, [id]: { ...state.players[id], ...fields } } };
}

/** Puts a player on a floor without walking there, so no monsters are woken for it. */
function inMine(state: FarmState, id: PlayerId, depth: number, tile?: Point): FarmState {
  const floor = generateFloor(state.mineSeed, depth);
  return patch(state, id, { area: mineArea(depth), ...centre(tile ?? floor.entrance) });
}

function onLadder(state: FarmState, id: PlayerId, depth: number): FarmState {
  return inMine(state, id, depth, generateFloor(state.mineSeed, depth).ladder!);
}

function slime(depth: number, at: Point, fields: Partial<Monster> = {}): Monster {
  return {
    id: 't-slime',
    kind: 'green-slime',
    area: mineArea(depth),
    x: at.x,
    y: at.y,
    health: 30,
    nextAttackAt: 0,
    invulnerableUntil: 0,
    ...fields,
  };
}

function withMonsters(state: FarmState, monsters: Monster[]): FarmState {
  return { ...state, monsters };
}

function wield(state: FarmState, id: PlayerId): FarmState {
  const inventory = [...state.players[id].inventory];
  inventory[0] = newStack(SWORD);
  return patch(state, id, { inventory, selectedSlot: 0 });
}

function tick(state: FarmState): { state: FarmState; events: GameEvent[] } {
  return applyIntent(state, { type: 'world/tick', deltaMs: CLOCK_STEP_MS });
}

function ofKind<K extends GameEvent['kind']>(events: GameEvent[], kind: K) {
  return events.filter((event): event is Extract<GameEvent, { kind: K }> => event.kind === kind);
}

type Floor = ReturnType<typeof generateFloor>;

function reachable(floor: Floor, from: Point, to: Point): boolean {
  const seen = new Set([`${from.x},${from.y}`]);
  const queue = [from];
  const steps = [
    [0, -1],
    [-1, 0],
    [1, 0],
    [0, 1],
  ];
  for (let head = 0; head < queue.length; head += 1) {
    const at = queue[head];
    if (at.x === to.x && at.y === to.y) return true;
    for (const [dx, dy] of steps) {
      const next = { x: at.x + dx, y: at.y + dy };
      const key = `${next.x},${next.y}`;
      if (floor.tiles[next.y]?.[next.x] !== 'floor' || seen.has(key)) continue;
      seen.add(key);
      queue.push(next);
    }
  }
  return false;
}

/** Four floor tiles in a row, so a straight-line chase has somewhere to go. */
function openRun(floor: Floor): Point {
  for (let y = 1; y < floor.height - 1; y += 1) {
    for (let x = 1; x < floor.width - 4; x += 1) {
      if ([0, 1, 2, 3].every((i) => floor.tiles[y][x + i] === 'floor')) return { x, y };
    }
  }
  throw new Error('no open run');
}

describe('generated floors', () => {
  it('carries a tile grid with a walkable way from entrance to ladder on every floor', () => {
    for (const seed of [SEED, 12345]) {
      for (let depth = 1; depth <= MAX_DEPTH; depth += 1) {
        const floor = generateFloor(seed, depth);
        expect(floor.tiles).toHaveLength(floor.height);
        expect(floor.tiles[0]).toHaveLength(floor.width);
        expect(floor.tiles[floor.entrance.y][floor.entrance.x]).toBe('floor');
        expect(reachable(floor, floor.entrance, floor.ladder!), `seed ${seed} depth ${depth}`).toBe(true);
      }
    }
  });

  it('puts ores and monsters on floor tiles, drawn from their depth band', () => {
    for (const depth of [3, 14, 25, 33, 40]) {
      const floor = generateFloor(SEED, depth);
      for (const ore of floor.ores) {
        expect(floor.tiles[ore.y][ore.x]).toBe('floor');
        expect(oreTable(depth)).toContain(ore.ore);
      }
      expect(floor.monsters.length).toBeGreaterThan(0);
      for (const monster of floor.monsters) {
        expect(floor.tiles[monster.y][monster.x]).toBe('floor');
        expect(monsterTable(depth)).toContain(monster.kind);
      }
    }
  });

  it('blocks walls and lets floors through, via the Blockers object', () => {
    const state = farmWith('p1');
    const area = mineArea(3);
    const floor = generateFloor(state.mineSeed, 3);
    const blockers = blockersFor(state, area);
    const open = centre(floor.entrance);
    const wall = centre({ x: 0, y: 0 });
    expect(isWalkable(area, open.x, open.y, blockers)).toBe(true);
    expect(isWalkable(area, wall.x, wall.y, blockers)).toBe(false);
  });
});

describe('farm seeds and records', () => {
  it('starts with a world seed, a mine seed hashed from it and the day, and no floor reached', () => {
    const state = farmWith('p1');
    expect(state.deepestFloor).toBe(0);
    expect(state.mineSeed).toBe(mineSeedFor(state.worldSeed, 1));
    expect(state.monsters).toEqual([]);
    const player = state.players.p1;
    expect(player.health).toBe(STARTING_MAX_HEALTH);
    expect(player.maxHealth).toBe(100);
    expect(player.invulnerableUntil).toBe(0);
  });

  it('has a sword that is a sword', () => {
    expect(ITEMS[SWORD]?.tool).toBe('sword');
    expect(ITEMS[SWORD]?.damage).toBeGreaterThan(0);
  });

  it('has a sword for every band, each harder-hitting than the last', () => {
    const swords = ['rusty-sword', 'copper-sword', 'steel-sword', 'gold-sword'];
    const damage = swords.map((id) => ITEMS[id]?.damage ?? 0);
    expect(damage).toEqual([10, 20, 35, 60]);
    for (const id of swords) {
      expect(ITEMS[id].tool).toBe('sword');
      expect(ITEMS[id].sellPrice).toBe(0);
      expect(ITEMS[id].stackSize).toBe(1);
    }
  });

  it('prices the bars above what went into them, and never sweeps them into a sale', () => {
    expect(['copper-bar', 'iron-bar', 'gold-bar'].map((id) => ITEMS[id]?.sellPrice)).toEqual([90, 150, 300]);
    for (const id of ['copper-bar', 'iron-bar', 'gold-bar']) expect(ITEMS[id].produce).toBeUndefined();
  });
});

describe('combat in the reducer', () => {
  it('a monster hit takes exactly its attack, and invulnerability stops a second in the same moment', () => {
    let state = inMine(farmWith('p1'), 'p1', 3);
    const at = state.players.p1;
    state = withMonsters(state, [slime(3, at, { id: 'a' }), slime(3, at, { id: 'b' })]);

    const hit = tick(state);
    expect(hit.state.players.p1.health).toBe(STARTING_MAX_HEALTH - MONSTER_ATTACK['green-slime']);
    expect(ofKind(hit.events, 'damaged')).toEqual([
      { kind: 'damaged', playerId: 'p1', amount: MONSTER_ATTACK['green-slime'] },
    ]);
    expect(hit.state.players.p1.invulnerableUntil).toBeGreaterThan(hit.state.time.totalMinutes);

    let later = hit.state;
    for (let i = 0; i < 4; i += 1) later = tick(later).state;
    expect(later.players.p1.health).toBeLessThan(hit.state.players.p1.health);
  });

  it('monsters chase straight at the nearest player in sight, and ignore one out of it', () => {
    const base = farmWith('p1');
    const run = openRun(generateFloor(base.mineSeed, 3));
    const state = inMine(base, 'p1', 3, run);

    const near = centre({ x: run.x + 3, y: run.y });
    const chased = tick(withMonsters(state, [slime(3, near)])).state.monsters[0];
    expect(chased.x).toBeLessThan(near.x);

    const distant = { x: near.x + (MONSTER_SIGHT_TILES + 6) * TILE_SIZE, y: near.y };
    const idle = tick(withMonsters(state, [slime(3, distant)])).state.monsters[0];
    expect(idle).toMatchObject({ x: distant.x, y: distant.y });
  });

  it('a sword swing damages a monster once per moment, and a kill pays out seeded loot', () => {
    let state = wield(inMine(farmWith('p1'), 'p1', 3), 'p1');
    const at = state.players.p1;
    state = withMonsters(state, [slime(3, at, { health: 30 })]);

    const swung = applyIntent(state, { type: 'player/attack', playerId: 'p1' });
    const damage = ITEMS[SWORD].damage!;
    expect(swung.state.monsters[0].health).toBe(30 - damage);
    const again = applyIntent(swung.state, { type: 'player/attack', playerId: 'p1' });
    expect(again.state.monsters[0].health).toBe(30 - damage);

    const dying = withMonsters(state, [slime(3, at, { health: 1 })]);
    const killed = applyIntent(dying, { type: 'player/attack', playerId: 'p1' });
    const loot = rollLoot(dying.mineSeed, 't-slime', 3);
    expect(killed.state.monsters).toEqual([]);
    expect(ofKind(killed.events, 'monsterKilled')).toEqual([
      { kind: 'monsterKilled', playerId: 'p1', id: 't-slime', monster: 'green-slime', drops: loot.drops },
    ]);
    expect(killed.state.coins).toBe(dying.coins + loot.coins);
    for (const drop of loot.drops) {
      expect(countItem(killed.state.players.p1.inventory, drop.item)).toBe(drop.count);
    }
  });

  it('acting with a sword in hand in the mine swings it', () => {
    let state = wield(inMine(farmWith('p1'), 'p1', 3), 'p1');
    state = withMonsters(state, [slime(3, state.players.p1, { health: 30 })]);
    const acted = applyIntent(state, { type: 'player/act', playerId: 'p1' });
    expect(acted.state.monsters[0].health).toBeLessThan(30);
  });

  it('ignores an attack when what is in hand is not a sword', () => {
    let state = inMine(farmWith('p1'), 'p1', 3);
    state = withMonsters(state, [slime(3, state.players.p1)]);
    const result = applyIntent(state, { type: 'player/attack', playerId: 'p1' });
    expect(result.state).toBe(state);
    expect(result.events).toEqual([]);
  });
});

describe('fainting', () => {
  it('costs the wallet share and some ore, sends the player home, and ends only their day', () => {
    let state = farmWith('p1', 'p2');
    state = inMine({ ...state, coins: 1000 }, 'p1', 3);
    const inventory = addItem(addItem(state.players.p1.inventory, 'copper-ore', 10)!, 'wood', 5)!;
    state = patch(state, 'p1', { health: 3, inventory });
    state = withMonsters(state, [slime(3, state.players.p1)]);

    const result = tick(state);
    const coinsLost = Math.min(Math.floor(1000 * COLLAPSE_COIN_SHARE), COLLAPSE_COIN_CAP);
    expect(ofKind(result.events, 'faint')).toEqual([{ kind: 'faint', playerId: 'p1', coinsLost }]);
    expect(result.state.coins).toBe(1000 - coinsLost);

    const p1 = result.state.players.p1;
    expect(p1.area).toBe(START_AREA);
    expect(p1.asleep).toBe(true);
    const ore = countItem(p1.inventory, 'copper-ore');
    expect(ore).toBeGreaterThan(0);
    expect(ore).toBeLessThan(10);
    expect(countItem(p1.inventory, 'wood')).toBe(5);

    expect(result.state.players.p2.asleep).toBe(false);
    expect(result.state.time.day).toBe(state.time.day);
    expect(ofKind(result.events, 'dayStarted')).toEqual([]);
    // Nobody is left on the floor, so its monsters are forgotten.
    expect(result.state.monsters).toEqual([]);

    // And a fainted player cannot simply get back up.
    const up = applyIntent(result.state, { type: 'player/sleep', playerId: 'p1' });
    expect(up.state.players.p1.asleep).toBe(true);
  });
});

describe('ladders, elevators and floors', () => {
  it('descending takes only the player who pressed it, and records the depth', () => {
    const state = onLadder(onLadder(farmWith('p1', 'p2'), 'p1', 3), 'p2', 3);
    const result = applyIntent(state, { type: 'player/descend', playerId: 'p1' });
    const floor4 = generateFloor(state.mineSeed, 4);
    expect(result.state.players.p1).toMatchObject({ area: mineArea(4), ...centre(floor4.entrance) });
    expect(result.state.players.p2.area).toBe(mineArea(3));
    expect(result.state.deepestFloor).toBe(4);
    expect(ofKind(result.events, 'descended')).toEqual([{ kind: 'descended', playerId: 'p1', depth: 4 }]);
    expect(ofKind(result.events, 'newDepthRecord')).toEqual([{ kind: 'newDepthRecord', depth: 4 }]);
    // Arriving on an empty floor wakes its monsters.
    expect(result.state.monsters.filter((m) => m.area === mineArea(4)).length).toBeGreaterThan(0);
  });

  it('refuses to descend from anywhere but the ladder', () => {
    const state = inMine(farmWith('p1'), 'p1', 3);
    const refused = applyIntent(state, { type: 'player/descend', playerId: 'p1' });
    expect(refused.state.players.p1.area).toBe(mineArea(3));
    expect(refused.state.revision).toBe(state.revision);
  });

  it('acting while standing on the ladder goes down it', () => {
    const state = onLadder(farmWith('p1'), 'p1', 2);
    const result = applyIntent(state, { type: 'player/act', playerId: 'p1' });
    expect(result.state.players.p1.area).toBe(mineArea(3));
  });

  it('forgets an empty floor, and the same day brings it back exactly as it was', () => {
    const start = onLadder(farmWith('p1'), 'p1', 1);
    const first = applyIntent(start, { type: 'player/descend', playerId: 'p1' }).state;
    const spawned = first.monsters.filter((m) => m.area === mineArea(2));
    expect(spawned.length).toBeGreaterThan(0);

    let wandered = first;
    for (let i = 0; i < 3; i += 1) wandered = tick(wandered).state;
    const left = applyIntent(wandered, { type: 'player/exitMine', playerId: 'p1' });
    expect(left.state.players.p1.area).toBe('forest');
    expect(left.state.monsters).toEqual([]);

    const back = applyIntent(onLadder(left.state, 'p1', 1), { type: 'player/descend', playerId: 'p1' }).state;
    expect(back.monsters.filter((m) => m.area === mineArea(2))).toEqual(spawned);
  });

  it('climbing out puts the player at the mouth of the mine, not back on the farm', () => {
    const state = inMine(farmWith('p1'), 'p1', 4);
    const result = applyIntent(state, { type: 'player/exitMine', playerId: 'p1' });
    const player = result.state.players.p1;
    // Where the mine is: the forest, standing in front of the entrance, on
    // ground that can be stood on, and close enough that the key goes back down.
    expect(player.area).toBe('forest');
    expect(isWalkable(player.area, player.x, player.y)).toBe(true);
    expect(interactableAt(player.area, player)?.interact).toBe('mine');
    expect(result.events).toContainEqual({ kind: 'areaChanged', playerId: 'p1', area: 'forest' });

    const again = applyIntent(result.state, { type: 'player/descend', playerId: 'p1' });
    expect(again.state.players.p1.area).toBe(mineArea(1));
  });

  it('the elevator goes to an opened floor and refuses one deeper than the record', () => {
    const state = inMine({ ...farmWith('p1'), deepestFloor: 10 }, 'p1', 5);
    const refused = applyIntent(state, { type: 'player/useElevator', playerId: 'p1', depth: 15 });
    expect(refused.state.players.p1.area).toBe(mineArea(5));
    expect(refused.state.revision).toBe(state.revision);

    const ridden = applyIntent(state, { type: 'player/useElevator', playerId: 'p1', depth: 10 });
    expect(ridden.state.players.p1.area).toBe(mineArea(10));
  });
});

describe('the day and the save', () => {
  it('a new day brings everyone out of the mine rested, and changes the mine seed but not the world seed', () => {
    let state = farmWith('p1', 'p2');
    state = inMine(state, 'p1', 3);
    state = patch(state, 'p1', { health: 40, energy: 10, invulnerableUntil: 999 });
    state = withMonsters(state, [slime(3, state.players.p1)]);

    const next = startNewDay(state).state;
    expect(next.players.p1).toMatchObject({
      area: START_AREA,
      health: STARTING_MAX_HEALTH,
      energy: STARTING_MAX_ENERGY,
      invulnerableUntil: 0,
    });
    expect(next.worldSeed).toBe(state.worldSeed);
    expect(next.mineSeed).toBe(mineSeedFor(state.worldSeed, state.time.day + 1));
    expect(next.mineSeed).not.toBe(state.mineSeed);
    expect(next.monsters).toEqual([]);
  });

  it('loads a player saved on mine:7 back onto a farm spawn', () => {
    expect(SAVE_VERSION).toBe(11);
    let state = inMine({ ...farmWith('p1'), deepestFloor: 7 }, 'p1', 7);
    state = withMonsters(state, [slime(7, state.players.p1)]);
    const loaded = decodeSave(encodeSave(state));
    expect(loaded).not.toBeNull();
    expect(loaded!.players.p1.area).toBe(START_AREA);
    expect(spawnPoints()).toContainEqual({ x: loaded!.players.p1.x, y: loaded!.players.p1.y });
    expect(loaded!.worldSeed).toBe(state.worldSeed);
    expect(loaded!.deepestFloor).toBe(7);
    expect(loaded!.mineSeed).toBe(state.mineSeed);
    expect(loaded!.monsters).toEqual([]);
  });

  it('never saves a vein of ore, which is rebuilt from the seed on the next visit', () => {
    let state = farmWith('p1');
    const ore = createNode('mine:7:ore:0', 'ore', mineArea(7), 3, 3, { item: 'iron-ore', requires: oreRequires('iron-ore') });
    state = { ...state, nodes: [...state.nodes, ore] };
    const loaded = decodeSave(encodeSave(state));
    expect(loaded).not.toBeNull();
    expect(loaded!.nodes.some((node) => node.area === mineArea(7))).toBe(false);
    expect(loaded!.nodes).toHaveLength(state.nodes.length - 1);
  });
});
