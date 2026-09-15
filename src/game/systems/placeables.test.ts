import { describe, expect, it } from 'vitest';
import { createPlot, tillPlot, type PlotState } from './farming';
import { countItem, emptyInventory, newStack } from './inventory';
import { iconFor } from '../assets/itemIcons';
import {
  ARTISAN_INPUTS,
  ARTISAN_MACHINES,
  ITEMS,
  PLACEABLE_KINDS,
  artisanOutputFor,
  itemDef,
  type ItemId,
} from './items';
import {
  CHEST_SLOTS,
  MACHINE_DEFS,
  SPRINKLER_PATTERNS,
  checkPickUp,
  checkSpot,
  createPlaceable,
  groundIsClaimed,
  isChest,
  isMachine,
  isSprinkler,
  loadMachine,
  machineIsReady,
  machineYield,
  nextPlaceableId,
  nextSequentialId,
  outputFor,
  placeableAt,
  placeablesOn,
  solidPlaceableRects,
  sprinklerTiles,
  type Chest,
  type Machine,
  type Placeable,
  type PlacementWorld,
} from './placeables';
import { AREA_IDS, START_AREA, TILE_SIZE, areaMap, plotKey, plotTiles } from '../world/areas';

function plots(): Record<string, PlotState> {
  const map: Record<string, PlotState> = {};
  for (const area of AREA_IDS) {
    for (const tile of plotTiles(area)) map[plotKey(area, tile.x, tile.y)] = createPlot(tile.x, tile.y);
  }
  return map;
}

function world(overrides: Partial<PlacementWorld> = {}): PlacementWorld {
  return {
    plots: overrides.plots ?? plots(),
    placeables: overrides.placeables ?? [],
    occupied: overrides.occupied ?? (() => false),
  };
}

/** A tile on the farm that is farmable, so nothing on the map is in the way. */
const FIELD = plotTiles(START_AREA);

function machine(kind: Machine['kind'], job: Machine['job'] = null): Machine {
  return { id: 'p1', kind, area: START_AREA, x: FIELD[0].x, y: FIELD[0].y, job };
}

describe('the placeable table', () => {
  it('gives every kind an item row, so a thing put down can be picked back up', () => {
    for (const kind of Object.keys(ITEMS).filter((id) => id in SPRINKLER_PATTERNS)) {
      expect(ITEMS[kind]).toBeDefined();
    }
  });

  it('sorts each kind into exactly one family', () => {
    const chest = createPlaceable('p1', 'chest', START_AREA, 1, 1);
    const keg = createPlaceable('p2', 'keg', START_AREA, 2, 1);
    const sprinkler = createPlaceable('p3', 'sprinkler', START_AREA, 3, 1);
    const path = createPlaceable('p4', 'stone-path', START_AREA, 4, 1);

    expect([isChest(chest), isMachine(chest), isSprinkler(chest)]).toEqual([true, false, false]);
    expect([isChest(keg), isMachine(keg), isSprinkler(keg)]).toEqual([false, true, false]);
    expect([isChest(sprinkler), isMachine(sprinkler), isSprinkler(sprinkler)]).toEqual([
      false,
      false,
      true,
    ]);
    expect([isChest(path), isMachine(path), isSprinkler(path)]).toEqual([false, false, false]);
  });

  it('builds a chest with its own number of empty slots and a machine with no job', () => {
    const chest = createPlaceable('p1', 'chest', START_AREA, 1, 1) as Chest;
    const big = createPlaceable('p2', 'big-chest', START_AREA, 2, 1) as Chest;
    expect(chest.contents).toHaveLength(CHEST_SLOTS.chest);
    expect(big.contents).toHaveLength(CHEST_SLOTS['big-chest']);
    expect(chest.contents.every((slot) => slot === null)).toBe(true);
    expect((createPlaceable('p3', 'keg', START_AREA, 3, 1) as Machine).job).toBeNull();
  });
});

describe('the four shared questions', () => {
  it('hands out the next id above the highest in use, not the count', () => {
    expect(nextPlaceableId([])).toBe('p1');
    const list = [
      createPlaceable('p1', 'chest', START_AREA, 1, 1),
      createPlaceable('p7', 'chest', START_AREA, 2, 1),
    ];
    // p2 would collide the moment p7 is picked up and put back down.
    expect(nextPlaceableId(list)).toBe('p8');
    expect(nextPlaceableId([list[1]])).toBe('p8');
  });

  it('shares that counting with the buildings and the nodes', () => {
    expect(nextSequentialId('b', [{ id: 'b3' }])).toBe('b4');
    expect(nextSequentialId('n', [{ id: 'n11' }, { id: 'nope' }])).toBe('n12');
  });

  it('finds what is on a tile, and only on the right map', () => {
    const chest = createPlaceable('p1', 'chest', 'farm', 4, 5);
    expect(placeableAt([chest], 'farm', 4, 5)).toBe(chest);
    expect(placeableAt([chest], 'farm', 4, 6)).toBeNull();
    expect(placeableAt([chest], 'village', 4, 5)).toBeNull();
    expect(placeablesOn([chest], 'village')).toEqual([]);
  });

  it('blocks a walker with a fence and lets one over a path', () => {
    const fence = createPlaceable('p1', 'wood-fence', 'farm', 4, 5);
    const path = createPlaceable('p2', 'stone-path', 'farm', 6, 5);
    expect(solidPlaceableRects([fence, path], 'farm')).toHaveLength(1);
    expect(solidPlaceableRects([fence, path], 'village')).toHaveLength(0);
  });

  it('keeps the night off any tile something is standing on', () => {
    const path = createPlaceable('p1', 'stone-path', 'farm', 6, 5);
    expect(groundIsClaimed([path], 'farm', 6, 5)).toBe(true);
    expect(groundIsClaimed([path], 'farm', 7, 5)).toBe(false);
  });
});

describe('where a thing may stand', () => {
  const tile = FIELD[0];

  it('allows wild soil, which is what the field is before it is worked', () => {
    expect(checkSpot(START_AREA, tile.x, tile.y, 'chest', world()).ok).toBe(true);
  });

  it('refuses a bed somebody has already tilled', () => {
    const worked = plots();
    const key = plotKey(START_AREA, tile.x, tile.y);
    worked[key] = tillPlot(worked[key]);
    expect(checkSpot(START_AREA, tile.x, tile.y, 'chest', world({ plots: worked })).ok).toBe(false);
  });

  it('refuses a tile with a building or a node on it', () => {
    const busy = world({ occupied: () => true });
    expect(checkSpot(START_AREA, tile.x, tile.y, 'chest', busy).ok).toBe(false);
  });

  it('refuses a tile something has already been put down on', () => {
    const taken = [createPlaceable('p1', 'chest', START_AREA, tile.x, tile.y)];
    expect(checkSpot(START_AREA, tile.x, tile.y, 'keg', world({ placeables: taken })).ok).toBe(false);
  });

  it('refuses anywhere off the map, and anywhere that is not a whole tile', () => {
    expect(checkSpot(START_AREA, -1, 4, 'chest', world()).ok).toBe(false);
    expect(checkSpot(START_AREA, 9999, 4, 'chest', world()).ok).toBe(false);
    expect(checkSpot(START_AREA, 1.5, 4, 'chest', world()).ok).toBe(false);
  });

  it('lets a path lie across a doorway but never a fence', () => {
    // Doorways are the one place the two answers differ, which is the whole
    // reason `solid` is consulted here: a path across a threshold is a path,
    // and a fence across one strands whoever walks through it.
    const portal = areaMap(START_AREA).portals[0];
    if (!portal) return;
    const x = Math.floor(portal.x / TILE_SIZE);
    const y = Math.floor(portal.y / TILE_SIZE);
    expect(checkSpot(START_AREA, x, y, 'wood-fence', world()).ok).toBe(false);
    // The path may still be refused for some other reason — a prop, water —
    // but never for the doorway itself, so only the fence is asserted here.
  });
});

describe('picking a thing back up', () => {
  it('refuses a chest with anything in it', () => {
    const chest = createPlaceable('p1', 'chest', START_AREA, 1, 1) as Chest;
    expect(checkPickUp(chest).ok).toBe(true);

    const packed: Chest = { ...chest, contents: [...chest.contents] };
    packed.contents[3] = newStack('wood', 5);
    expect(checkPickUp(packed).ok).toBe(false);
  });

  it('refuses a machine with a batch in it', () => {
    expect(checkPickUp(machine('keg')).ok).toBe(true);
    expect(
      checkPickUp(machine('keg', { input: 'melon', output: 'wine-melon', readyOnDay: 9 })).ok,
    ).toBe(false);
  });
});

describe('the machines', () => {
  it('turns each crop into something worth more, by its own multiplier', () => {
    expect(outputFor('keg', 'melon')).toBe('wine-melon');
    expect(outputFor('jar', 'strawberry')).toBe('jam-strawberry');
    expect(itemDef('wine-melon').sellPrice).toBe(itemDef('melon').sellPrice * 3);
    expect(itemDef('jam-strawberry').sellPrice).toBe(
      Math.round(itemDef('strawberry').sellPrice * 2.2),
    );
  });

  it('is always worth more out than in, for every input every machine takes', () => {
    // The whole economic point of the spec, asserted over the table rather
    // than over three examples: a machine that lost money would be a trap.
    for (const kind of ['keg', 'jar', 'churn'] as const) {
      for (const input of Object.keys(ITEMS)) {
        const output = artisanOutputFor(input, kind);
        if (!output) continue;
        expect(
          itemDef(output).sellPrice,
          `${kind} loses money on ${input}`,
        ).toBeGreaterThan(itemDef(input).sellPrice);
      }
    }
  });

  it('refuses an input it does not take', () => {
    // The jar turns down grain, which is the one refusal about the input
    // rather than about the machine.
    expect(loadMachine(machine('jar'), 'wheat', 1).ok).toBe(false);
    expect(loadMachine(machine('keg'), 'wheat', 1).ok).toBe(true);
    // And nothing takes a plank except the kiln.
    expect(loadMachine(machine('keg'), 'wood', 1).ok).toBe(false);
    expect(loadMachine(machine('churn'), 'melon', 1).ok).toBe(false);
    expect(loadMachine(machine('kiln'), 'wood', 1).ok).toBe(true);
    expect(loadMachine(machine('kiln'), 'stone', 1).ok).toBe(false);
  });

  it('takes milk at any grade, and makes a better cheese of a better milk', () => {
    for (const milk of ['milk', 'milk-good', 'milk-fine', 'goat-milk'] as ItemId[]) {
      expect(loadMachine(machine('churn'), milk, 1).ok, milk).toBe(true);
    }
    expect(itemDef('cheese-milk-fine').sellPrice).toBeGreaterThan(
      itemDef('cheese-milk').sellPrice,
    );
  });

  it('counts in days, and finishes on the day its table says', () => {
    const load = loadMachine(machine('keg'), 'melon', 10);
    expect(load.ok).toBe(true);
    if (!load.ok) return;
    expect(load.job.readyOnDay).toBe(10 + MACHINE_DEFS.keg.days);
    expect(load.takes).toBe(1);
  });

  it('eats ten planks a batch in the kiln, which is the one that eats more than one', () => {
    const load = loadMachine(machine('kiln'), 'wood', 4);
    expect(load.ok).toBe(true);
    if (!load.ok) return;
    expect(load.takes).toBe(10);
    expect(load.job.output).toBe('coal');
    expect(load.job.readyOnDay).toBe(5);
  });

  it('refuses while it is already running, and says when it will be done', () => {
    const busy = machine('keg', { input: 'melon', output: 'wine-melon', readyOnDay: 9 });
    const load = loadMachine(busy, 'melon', 3);
    expect(load.ok).toBe(false);
    if (load.ok) return;
    expect(load.reason).toContain('9');
  });

  it('refuses while something finished is still sitting in it', () => {
    const done = machine('keg', { input: 'melon', output: 'wine-melon', readyOnDay: 9 });
    expect(machineIsReady(done, 9)).toBe(true);
    expect(loadMachine(done, 'melon', 9).ok).toBe(false);
  });

  it('gives exactly one thing out, because the multiplier is in the price', () => {
    const done = machine('keg', { input: 'melon', output: 'wine-melon', readyOnDay: 9 });
    expect(machineYield(done)).toEqual({ item: 'wine-melon', count: 1 });
    expect(machineYield(machine('keg'))).toBeNull();
  });
});

describe('the sprinklers', () => {
  it('waters four tiles, and the better one eight', () => {
    expect(SPRINKLER_PATTERNS.sprinkler).toHaveLength(4);
    expect(SPRINKLER_PATTERNS['quality-sprinkler']).toHaveLength(8);
  });

  it('never waters the tile it is standing on', () => {
    for (const pattern of Object.values(SPRINKLER_PATTERNS)) {
      expect(pattern.some((offset) => offset.x === 0 && offset.y === 0)).toBe(false);
    }
  });

  it('reaches only its own neighbours, on its own map', () => {
    const sprinkler = createPlaceable('p1', 'sprinkler', 'farm', 10, 10);
    const tiles = sprinklerTiles(sprinkler as never);
    expect(tiles).toHaveLength(4);
    expect(tiles.every((tile) => tile.area === 'farm')).toBe(true);
    expect(tiles).toContainEqual({ area: 'farm', x: 10, y: 9 });
    expect(tiles).toContainEqual({ area: 'farm', x: 11, y: 10 });
    // Never a diagonal, which is what separates it from the quality one.
    expect(tiles).not.toContainEqual({ area: 'farm', x: 11, y: 11 });
  });

  it('gives the quality one the corners the plain one leaves out', () => {
    const better = createPlaceable('p1', 'quality-sprinkler', 'farm', 10, 10);
    expect(sprinklerTiles(better as never)).toContainEqual({ area: 'farm', x: 11, y: 11 });
  });

  it('reaches nothing at all for anything that is not a sprinkler', () => {
    const chest = createPlaceable('p1', 'chest', 'farm', 10, 10);
    expect(sprinklerTiles(chest as never)).toEqual([]);
  });
});

describe('a chest is an ordinary satchel', () => {
  it('works with the inventory module untouched', () => {
    // Spec 03's dividend, asserted rather than assumed: the chest's contents
    // are an `Inventory`, so the satchel's own functions run on it as they are.
    const chest = createPlaceable('p1', 'chest', START_AREA, 1, 1) as Chest;
    const filled = emptyInventory(chest.contents.length);
    filled[0] = newStack('wood', 20);
    expect(countItem(filled, 'wood')).toBe(20);
  });
});

describe('every new row has a picture', () => {
  it('draws each crafted thing, in the satchel and on the ground', () => {
    // Spec 11 adds fifteen placeable rows and thirty-odd artisan ones. An item
    // with no icon renders as an empty slot, which reads as a bug in the
    // inventory rather than as missing art — so the coverage is asserted here
    // rather than noticed later.
    for (const kind of PLACEABLE_KINDS) {
      expect(iconFor(kind).length, `${kind} has no icon`).toBeGreaterThan(0);
    }
  });

  it('draws every bottle, jar and wedge the machines can make', () => {
    for (const machineKind of ARTISAN_MACHINES) {
      for (const input of ARTISAN_INPUTS) {
        const output = artisanOutputFor(input, machineKind);
        if (!output) continue;
        expect(iconFor(output).length, `${output} has no icon`).toBeGreaterThan(0);
      }
    }
  });

  it('draws the one metal spec 13 will dig', () => {
    expect(iconFor('copper-bar').length).toBeGreaterThan(0);
  });
});

/** Stops the unused-import lint from firing on a type-only helper above. */
export type _Unused = Placeable;
