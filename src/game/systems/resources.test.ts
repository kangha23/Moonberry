import { describe, expect, it } from 'vitest';
import { BUILDING_AREA, BUILDING_DEFS, type Building } from './buildings';
import { createPlot, tillPlot, type PlotState } from './farming';
import { countItem, createInventory, emptyInventory, newStack, type Inventory } from './inventory';
import { FORAGE_BY_SEASON, ITEMS } from './items';
import type { Placeable } from './placeables';
import {
  FORAGE_IDS,
  MAX_GRASS_CLUMPS,
  NODE_DEFS,
  TREE_MATURE_STAGE,
  TREE_STAGES,
  canHoldNode,
  checkTool,
  createNode,
  healthOf,
  nextNodeId,
  nodeAt,
  nodesOn,
  seedNodes,
  solidNodeRects,
  startNodeDay,
  workNodes,
  type NodeKind,
  type ResourceNode,
} from './resources';
import { SEASON_DAYS, type Season } from './time';
import {
  AREA_IDS,
  TILE_SIZE,
  areaMap,
  isWalkable,
  plotKey,
  plotTiles,
  type AreaId,
} from '../world/areas';

const SEED = 0x6d6f6f6e;

/** A fresh set of plots, exactly as the reducer seeds them. */
function emptyPlots(): Record<string, PlotState> {
  const plots: Record<string, PlotState> = {};
  for (const area of AREA_IDS) {
    for (const tile of plotTiles(area)) {
      plots[plotKey(area, tile.x, tile.y)] = createPlot(tile.x, tile.y);
    }
  }
  return plots;
}

function world(
  overrides: Partial<{
    plots: Record<string, PlotState>;
    buildings: Building[];
    placeables: Placeable[];
  }> = {},
) {
  return {
    plots: overrides.plots ?? emptyPlots(),
    buildings: overrides.buildings ?? [],
    placeables: overrides.placeables ?? [],
  };
}

/** One node, standing on a tile nothing else cares about. */
function node(kind: NodeKind, extra: Partial<ResourceNode> = {}): ResourceNode {
  return { ...createNode('n1', kind, BUILDING_AREA, 1, 1, { item: extra.item ?? null }), ...extra };
}

/** A satchel with no room at all, for the refusal paths. */
function fullSatchel(): Inventory {
  return Array.from({ length: 24 }, () => newStack('stone', 99));
}

/** The first day of a season, counting from day 1 being the first of spring. */
function firstDayOf(season: Season): number {
  return ['Spring', 'Summer', 'Autumn', 'Winter'].indexOf(season) * SEASON_DAYS + 1;
}

describe('the ground a world starts with', () => {
  const nodes = seedNodes(world(), 'Spring', SEED);

  it('puts something on the farm to clear, which is half the point of the spec', () => {
    const farm = nodesOn(nodes, BUILDING_AREA);
    // Weeds to cut, rocks to break, and stumps that will want a copper axe:
    // a field that started swept clean gave the first week nothing to reclaim.
    for (const kind of ['weed', 'grass', 'rock', 'stump'] as const) {
      expect(farm.filter((row) => row.kind === kind).length).toBeGreaterThan(0);
    }
  });

  it('puts the wood in the wood, which is why walking there is worth it', () => {
    const forest = nodesOn(nodes, 'forest');
    expect(forest.filter((row) => row.kind === 'tree').length).toBeGreaterThan(50);
    expect(forest.filter((row) => row.kind === 'forage').length).toBeGreaterThan(0);
  });

  it('grows no stone in the wood or trees in the village, so each map reads as itself', () => {
    expect(nodesOn(nodes, 'village').every((row) => row.kind === 'forage')).toBe(true);
  });

  it('never stands two things on one tile', () => {
    const tiles = nodes.map((row) => `${row.area}:${row.x},${row.y}`);
    expect(new Set(tiles).size).toBe(tiles.length);
  });

  it('never stands anything on a doorway, a spawn point or a solid tile', () => {
    for (const area of AREA_IDS) {
      const map = areaMap(area);
      for (const row of nodesOn(nodes, area)) {
        expect(map.tiles[row.y * map.width + row.x]?.solid).toBe(false);
        for (const portal of map.portals) {
          const gap = Math.max(
            Math.abs(portal.x / TILE_SIZE - row.x),
            Math.abs(portal.y / TILE_SIZE - row.y),
          );
          expect(gap).toBeGreaterThan(0);
        }
        for (const spawn of map.spawns) {
          const gap = Math.max(
            Math.abs(spawn.x / TILE_SIZE - 0.5 - row.x),
            Math.abs(spawn.y / TILE_SIZE - 0.5 - row.y),
          );
          expect(gap).toBeGreaterThan(1);
        }
      }
    }
  });

  it('is the same world twice, and a different one from a different seed', () => {
    expect(seedNodes(world(), 'Spring', SEED)).toEqual(nodes);
    expect(seedNodes(world(), 'Spring', SEED + 1)).not.toEqual(nodes);
  });

  it('puts out the season it was made in', () => {
    for (const row of nodes) {
      if (row.kind !== 'forage') continue;
      expect(FORAGE_BY_SEASON.Spring).toContain(row.item);
    }
  });
});

describe('where a node may stand', () => {
  it('refuses a tile somebody has already worked', () => {
    const plots = emptyPlots();
    const tile = plotTiles(BUILDING_AREA)[0];
    const key = plotKey(BUILDING_AREA, tile.x, tile.y);
    // Wild soil is fair game: that is the field waiting to be reclaimed.
    expect(canHoldNode(BUILDING_AREA, tile.x, tile.y, 'weed', { plots, buildings: [], placeables: [] }, new Set())).toBe(
      true,
    );

    const worked = { ...plots, [key]: tillPlot(plots[key]) };
    expect(
      canHoldNode(BUILDING_AREA, tile.x, tile.y, 'weed', { plots: worked, buildings: [], placeables: [] }, new Set()),
    ).toBe(false);
  });

  it('refuses a tile with a building on it, scaffold or not', () => {
    const plots = emptyPlots();
    const shed: Building = { id: 'b1', kind: 'shed', x: 25, y: 10, readyOnDay: 3, doorOpen: false };
    const inside = { x: shed.x + 1, y: shed.y + 1 };
    expect(canHoldNode(BUILDING_AREA, inside.x, inside.y, 'weed', { plots, buildings: [], placeables: [] }, new Set())).toBe(
      true,
    );
    expect(
      canHoldNode(BUILDING_AREA, inside.x, inside.y, 'weed', { plots, buildings: [shed], placeables: [] }, new Set()),
    ).toBe(false);
    expect(BUILDING_DEFS.shed.width).toBeGreaterThan(1);
  });

  it('never puts anything solid on a path, so a route across a map stays a route', () => {
    const map = areaMap(BUILDING_AREA);
    let checked = 0;
    for (let y = 0; y < map.height; y += 1) {
      for (let x = 0; x < map.width; x += 1) {
        if (map.tiles[y * map.width + x]?.kind !== 'path') continue;
        checked += 1;
        expect(canHoldNode(BUILDING_AREA, x, y, 'boulder', world(), new Set())).toBe(false);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('refuses a tile something is already standing on', () => {
    const taken = new Set([`${BUILDING_AREA}:12,3`]);
    expect(canHoldNode(BUILDING_AREA, 12, 3, 'weed', world(), new Set())).toBe(true);
    expect(canHoldNode(BUILDING_AREA, 12, 3, 'weed', world(), taken)).toBe(false);
  });
});

describe('what a tool may touch', () => {
  it('turns an ordinary axe away from a stump and lets a copper one through', () => {
    const stump = node('stump');
    const basic = checkTool(stump, 'axe');
    expect(basic.ok).toBe(false);
    // The distinction this whole event exists for: this is "go to the
    // blacksmith", not "you have the wrong slot selected".
    expect(basic.ok === false && basic.tooWeak).toBe('copper');

    expect(checkTool(stump, 'copper-axe').ok).toBe(true);
    expect(checkTool(stump, 'steel-axe').ok).toBe(true);
  });

  it('wants a steel pick for a boulder and nothing at all for forage', () => {
    const boulder = node('boulder');
    expect(checkTool(boulder, 'copper-pickaxe').ok).toBe(false);
    expect(checkTool(boulder, 'steel-pickaxe').ok).toBe(true);
    // Picked up by hand, which is what `tool: null` means and why it is a
    // separate case from "your tool is not good enough".
    expect(checkTool(node('forage', { item: 'daffodil' }), null).ok).toBe(true);
  });

  it('separates the wrong tool from a tool that is not good enough', () => {
    const wrong = checkTool(node('tree'), 'hoe');
    expect(wrong.ok).toBe(false);
    expect(wrong.ok === false && wrong.tooWeak).toBeNull();
    expect(wrong.ok === false && wrong.reason).toMatch(/rìu/i);
  });
});

describe('swinging at something', () => {
  it('takes a mature tree in five and gives a stack of planks', () => {
    let standing: ResourceNode | null = node('tree');
    let inventory = createInventory();
    let swings = 0;

    while (standing) {
      const result = workNodes([standing], 'axe', inventory, 0, 0, 4, SEED);
      inventory = result.inventory;
      standing = result.changed[0].node;
      swings += 1;
      expect(result.energyCost).toBe(NODE_DEFS.tree.energy);
    }

    expect(swings).toBe(NODE_DEFS.tree.health);
    expect(countItem(inventory, 'wood')).toBeGreaterThanOrEqual(8);
    expect(countItem(inventory, 'wood')).toBeLessThanOrEqual(12);
  });

  it('takes a seedling in one, so clearing a sapling is not a morning', () => {
    const sapling = node('tree', { stage: 0, health: healthOf('tree', 0) });
    const result = workNodes([sapling], 'axe', createInventory(), 0, 0, 4, SEED);
    expect(result.changed[0].node).toBeNull();
    expect(countItem(result.inventory, 'wood')).toBe(1);
  });

  it('refuses the felling blow when the satchel is full, and leaves it standing', () => {
    // Health 1: the very next swing would bring it down.
    const nearlyDown = node('tree', { health: 1 });
    const result = workNodes([nearlyDown], 'axe', fullSatchel(), 0, 0, 4, SEED);

    expect(result.changed).toEqual([]);
    expect(result.cleared).toEqual([]);
    // And it cost nothing, because a refused swing never happened.
    expect(result.energyCost).toBe(0);
    expect(result.message).toMatch(/không còn chỗ/i);
    // The node itself is untouched: still one swing from falling.
    expect(nearlyDown.health).toBe(1);
  });

  it('puts cut grass in the silo and nothing whatever in the satchel', () => {
    const inventory = createInventory();
    const result = workNodes([node('grass')], 'scythe', inventory, 0, 240, 4, SEED);

    expect(result.hay).toBe(1);
    // A permanent stack of grass would hold one of twenty-four slots for ever.
    expect(result.inventory).toBe(inventory);
    expect(result.energyCost).toBe(0);
  });

  it('loses the grass when the silo is full, and says so', () => {
    const result = workNodes([node('grass')], 'scythe', createInventory(), 240, 240, 4, SEED);

    expect(result.hay).toBe(240);
    // The clump is still gone. Refusing the swing would mean a farm with a
    // full silo could never mow, which is worse than losing a bale.
    expect(result.cleared).toHaveLength(1);
    expect(result.message).toMatch(/kho cỏ đã đầy/i);
  });

  it('charges the sweep per node struck, with the tier factor on the total', () => {
    const trees = [
      node('tree', { id: 'n1' }),
      node('tree', { id: 'n2', x: 2 }),
      node('tree', { id: 'n3', x: 3 }),
    ];
    const plain = workNodes(trees, 'axe', createInventory(), 0, 0, 4, SEED);
    expect(plain.energyCost).toBe(3 * NODE_DEFS.tree.energy);

    // A steel axe is 0.8, applied to the whole sweep rather than to each tree:
    // per tree it would round 4 to 3 three times over and the saving would be
    // a different number from the one the blurb promises.
    const steel = workNodes(trees, 'steel-axe', createInventory(), 0, 0, 4, SEED, 0.8);
    expect(steel.energyCost).toBe(Math.round(3 * NODE_DEFS.tree.energy * 0.8));
  });

  it('reports the tier a swing needed rather than swallowing it', () => {
    const result = workNodes([node('stump')], 'axe', createInventory(), 0, 0, 4, SEED);
    expect(result.tooWeak).toBe('copper');
    expect(result.changed).toEqual([]);
    expect(result.energyCost).toBe(0);
  });

  it('gives the same tree the same planks twice, and a different tree different ones', () => {
    const first = workNodes([node('tree', { health: 1 })], 'axe', createInventory(), 0, 0, 4, SEED);
    const again = workNodes([node('tree', { health: 1 })], 'axe', createInventory(), 0, 0, 4, SEED);
    expect(countItem(first.inventory, 'wood')).toBe(countItem(again.inventory, 'wood'));

    // Different seeds are different mornings, which is what `spawnSeed` is for.
    const elsewhere = workNodes(
      [node('tree', { id: 'n9', health: 1 })],
      'axe',
      createInventory(),
      0,
      0,
      4,
      SEED,
    );
    expect(elsewhere.cleared).toHaveLength(1);
  });
});

describe('the night', () => {
  const nodes = seedNodes(world(), 'Spring', SEED);

  it('is the same morning twice, given the same seed and the same ground', () => {
    const once = startNodeDay(nodes, world(), 'Spring', 2, SEED);
    const twice = startNodeDay(nodes, world(), 'Spring', 2, SEED);
    expect(once.nodes).toEqual(twice.nodes);

    // And a different morning tomorrow, or every night would be the same night.
    const next = startNodeDay(once.nodes, world(), 'Spring', 3, SEED);
    expect(next.nodes).not.toEqual(once.nodes);
  });

  it('grows trees a stage at a time, and hardens them as they go', () => {
    const sapling = node('tree', { id: 'n1', stage: 0, health: 1 });
    let grown = [sapling];
    for (let day = 2; day < 200 && grown[0].stage !== TREE_MATURE_STAGE; day += 1) {
      grown = startNodeDay(grown, world(), 'Spring', day, SEED).nodes.filter((row) => row.id === 'n1');
    }
    expect(grown[0].stage).toBe(TREE_MATURE_STAGE);
    expect(grown[0].health).toBe(NODE_DEFS.tree.health);
    expect(TREE_STAGES).toBe(TREE_MATURE_STAGE + 1);
  });

  it('lets grass creep across the farm and then stops it', () => {
    let current = nodes;
    for (let day = 2; day <= 90; day += 1) {
      // Held in spring so the winter cull below is not what stops it.
      current = startNodeDay(current, world(), 'Spring', day, SEED).nodes;
    }
    const before = nodesOn(nodes, BUILDING_AREA).filter((row) => row.kind === 'grass').length;
    const clumps = nodesOn(current, BUILDING_AREA).filter((row) => row.kind === 'grass').length;
    expect(clumps).toBeGreaterThan(before);
    expect(clumps).toBeLessThanOrEqual(MAX_GRASS_CLUMPS);
  });

  it('grows no stone on the farm, ever, because that is what the mine is for', () => {
    let current = nodes;
    const before = current.filter((row) => row.kind === 'rock' || row.kind === 'boulder').length;
    for (let day = 2; day <= 120; day += 1) {
      current = startNodeDay(current, world(), 'Spring', day, SEED).nodes;
    }
    const after = current.filter((row) => row.kind === 'rock' || row.kind === 'boulder').length;
    expect(after).toBe(before);
  });

  it('kills every blade of grass on the first morning of winter', () => {
    const winter = firstDayOf('Winter');
    const result = startNodeDay(nodes, world(), 'Winter', winter, SEED);
    expect(result.nodes.some((row) => row.kind === 'grass')).toBe(false);
    expect(result.cleared).toBeGreaterThan(0);

    // And leaves it alone on any other morning, or there would be no point
    // filling a silo in autumn.
    const autumn = startNodeDay(nodes, world(), 'Autumn', firstDayOf('Autumn') + 1, SEED);
    expect(autumn.nodes.some((row) => row.kind === 'grass')).toBe(true);
  });

  it('sweeps the forage out at a season boundary and puts the new season out', () => {
    const summer = firstDayOf('Summer');
    const turned = startNodeDay(nodes, world(), 'Summer', summer, SEED);
    const forage = turned.nodes.filter((row) => row.kind === 'forage');

    expect(forage.length).toBeGreaterThan(0);
    for (const row of forage) expect(FORAGE_BY_SEASON.Summer).toContain(row.item);
  });

  it('never grows anything onto worked ground, however many nights pass', () => {
    // A field somebody has tilled and planted: the thing a night of growth
    // must never put a boulder in the middle of.
    const plots = emptyPlots();
    const worked: Record<string, PlotState> = { ...plots };
    for (const tile of plotTiles(BUILDING_AREA)) {
      worked[plotKey(BUILDING_AREA, tile.x, tile.y)] = tillPlot(plots[plotKey(BUILDING_AREA, tile.x, tile.y)]);
    }

    let current = nodes.filter((row) => row.area !== BUILDING_AREA);
    for (let day = 2; day <= 60; day += 1) {
      current = startNodeDay(current, { plots: worked, buildings: [], placeables: [] }, 'Spring', day, SEED).nodes;
    }
    for (const tile of plotTiles(BUILDING_AREA)) {
      expect(nodeAt(current, BUILDING_AREA, tile.x, tile.y)).toBeNull();
    }
  });

  it('slows to a crawl on the farm in winter, which is what makes winter lean', () => {
    // Spring is the season that takes a field back; winter barely touches it.
    // Measured from bare ground on both sides, so the only difference between
    // the two runs is the season the weeds were drawn against.
    const grow = (season: Season, from: number) => {
      let current: ResourceNode[] = [];
      for (let day = from + 1; day < from + 14; day += 1) {
        current = startNodeDay(current, world(), season, day, SEED).nodes;
      }
      return nodesOn(current, BUILDING_AREA).length;
    };

    const spring = grow('Spring', firstDayOf('Spring'));
    const winter = grow('Winter', firstDayOf('Winter'));
    expect(winter).toBeLessThan(spring / 4);
  });
});

describe('standing in the way', () => {
  it('blocks a walker where a tree is and nowhere else', () => {
    const tree = node('tree', { x: 30, y: 10 });
    const centre = { x: 30 * TILE_SIZE + 16, y: 10 * TILE_SIZE + 16 };
    const blockers = { buildings: [], nodes: solidNodeRects([tree], BUILDING_AREA), placeables: [] };

    expect(isWalkable(BUILDING_AREA, centre.x, centre.y)).toBe(true);
    expect(isWalkable(BUILDING_AREA, centre.x, centre.y, blockers)).toBe(false);
    // One tile, not the whole drawing: you walk behind a canopy.
    expect(isWalkable(BUILDING_AREA, centre.x, centre.y - TILE_SIZE, blockers)).toBe(true);
  });

  it('lets a walker through grass, weeds and forage', () => {
    for (const kind of ['grass', 'weed', 'forage'] as const) {
      expect(solidNodeRects([node(kind)], BUILDING_AREA)).toEqual([]);
      expect(NODE_DEFS[kind].solid).toBe(false);
    }
  });

  it('only reports the map it was asked about', () => {
    const tree = node('tree');
    expect(solidNodeRects([tree], BUILDING_AREA)).toHaveLength(1);
    expect(solidNodeRects([tree], 'village' as AreaId)).toEqual([]);
  });
});

describe('the tables themselves', () => {
  it('prices and names every forage item the seasons put out', () => {
    expect(FORAGE_IDS).toHaveLength(12);
    for (const id of FORAGE_IDS) {
      const def = ITEMS[id];
      expect(def).toBeDefined();
      // Sellable at the stall, unlike the materials: a basket of mushrooms is
      // exactly what the market counter is for.
      expect(def.produce).toBe(true);
      expect(def.sellPrice).toBeGreaterThan(0);
    }
  });

  it('gives every node kind a tool, a cost and a reason to exist', () => {
    for (const [kind, def] of Object.entries(NODE_DEFS)) {
      expect(def.kind).toBe(kind);
      expect(def.health).toBeGreaterThan(0);
      expect(def.blurb.length).toBeGreaterThan(0);
      // The scythe's work is free, like harvesting. Everything an axe or a
      // pick touches costs something, or the energy budget means nothing.
      if (def.tool === 'axe' || def.tool === 'pickaxe') expect(def.energy).toBeGreaterThan(0);
      else expect(def.energy).toBe(0);
    }
  });

  it('hands out ids nothing standing is already using', () => {
    expect(nextNodeId([])).toBe('n1');
    // The maximum rather than the count, because nodes are removed all the
    // time: counting would hand out an id that is still in the ground.
    expect(nextNodeId([node('tree', { id: 'n7' }), node('rock', { id: 'n2' })])).toBe('n8');
  });

  it('holds nothing in an empty satchel it cannot put somewhere', () => {
    expect(workNodes([], 'axe', emptyInventory(), 0, 0, 1, SEED).changed).toEqual([]);
  });
});
