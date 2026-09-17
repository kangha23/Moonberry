import { describe, expect, it } from 'vitest';
import { START_AREA, areaMap, isWalkable, plotKey } from '../world/areas';
import { NPC_IDS } from '../npcs/definitions';
import { heartsWith } from '../npcs/relationships';
import {
  SAVE_KEY,
  SAVE_VERSION,
  clearSave,
  decodeSave,
  encodeSave,
  loadFarm,
  saveFarm,
  type SaveStorage,
} from './persistence';
import { applyIntent, createFarmState } from './reducer';
import { HOTBAR_SIZE, INVENTORY_SIZE, countItem, newStack } from '../systems/inventory';
import { STARTING_RECIPES } from '../systems/crafting';
import { createPlaceable, type Chest, type Machine } from '../systems/placeables';
import { CROP_ORDER, STARTING_TOOLS, WATERING_CAN_CHARGES, seedIdFor } from '../systems/items';
import { STARTING_MAX_ENERGY, type FarmState } from './types';

/** An in-memory stand-in for localStorage. */
function memoryStorage(seed: Record<string, string> = {}): SaveStorage & { data: Record<string, string> } {
  const data = { ...seed };
  return {
    data,
    read: (key) => data[key] ?? null,
    write: (key, value) => {
      data[key] = value;
    },
    remove: (key) => {
      delete data[key];
    },
  };
}

/** Storage that fails the way a private window or a full quota does. */
const hostileStorage: SaveStorage = {
  read() {
    throw new Error('denied');
  },
  write() {
    throw new Error('quota exceeded');
  },
  remove() {
    throw new Error('denied');
  },
};

function playedFarm(): FarmState {
  let farm = applyIntent(createFarmState(), { type: 'player/join', playerId: 'a', name: 'A' }).state;
  farm = applyIntent(farm, { type: 'player/selectSlot', playerId: 'a', slot: 1 }).state;
  farm = applyIntent(farm, { type: 'world/tick', deltaMs: 3600 }).state;
  return farm;
}

describe('save round trip', () => {
  it('restores the farm exactly, except that nobody is connected to it', () => {
    const farm = playedFarm();
    const storage = memoryStorage();

    saveFarm(farm, storage);
    const restored = loadFarm(storage);

    // A world read off a disk has no live connections, so restoring anyone as
    // online would leave a player standing there who is not actually playing.
    expect(restored?.players.a.online).toBe(false);
    expect(restored).toEqual({
      ...farm,
      players: { ...farm.players, a: { ...farm.players.a, online: false } },
    });
  });

  it('preserves per-player inventories and the shared wallet separately', () => {
    let farm = playedFarm();
    farm = applyIntent(farm, { type: 'player/join', playerId: 'b', name: 'B' }).state;
    const withCan = (charges: number) => (player: FarmState['players'][string]) => ({
      ...player,
      inventory: player.inventory.map((slot, i) =>
        i === 1 ? { item: 'watering-can', count: 1, charges } : slot,
      ),
    });
    farm = {
      ...farm,
      coins: 412,
      players: {
        ...farm.players,
        a: withCan(2)(farm.players.a),
        b: withCan(9)(farm.players.b),
      },
    };
    const storage = memoryStorage();

    saveFarm(farm, storage);
    const restored = loadFarm(storage);

    expect(restored?.coins).toBe(412);
    expect(restored?.players.a.inventory[1]?.charges).toBe(2);
    expect(restored?.players.b.inventory[1]?.charges).toBe(9);
  });

  it('preserves crop growth on individual plots', () => {
    const farm = createFarmState();
    const cell = areaMap(START_AREA).plotTiles[0];
    const key = plotKey(START_AREA, cell.x, cell.y);
    const grown: FarmState = {
      ...farm,
      plots: {
        ...farm.plots,
        [key]: { ...cell, stage: 'sprout', crop: 'strawberry', daysWatered: 2, wateredToday: true },
      },
    };
    const storage = memoryStorage();

    saveFarm(grown, storage);

    expect(loadFarm(storage)?.plots[key]).toEqual(grown.plots[key]);
  });

  it('writes the current schema version', () => {
    const envelope = JSON.parse(encodeSave(createFarmState())) as { version: number; savedAt: string };

    expect(envelope.version).toBe(SAVE_VERSION);
    expect(Date.parse(envelope.savedAt)).not.toBeNaN();
  });
});

describe('rejecting bad saves', () => {
  it('returns null for missing, empty, or non-JSON data', () => {
    expect(decodeSave(null)).toBeNull();
    expect(decodeSave('')).toBeNull();
    expect(decodeSave('not json at all')).toBeNull();
    expect(decodeSave('[]')).toBeNull();
    expect(decodeSave('"a string"')).toBeNull();
  });

  it('refuses a save written by a future schema version', () => {
    const envelope = JSON.parse(encodeSave(createFarmState()));
    envelope.version = SAVE_VERSION + 1;

    expect(decodeSave(JSON.stringify(envelope))).toBeNull();
  });

  it('refuses a farm with a hand-edited invalid field', () => {
    const cases: Array<(farm: Record<string, unknown>) => void> = [
      (farm) => delete farm.coins,
      (farm) => {
        farm.coins = 'lots';
      },
      (farm) => {
        farm.coins = -5;
      },
      (farm) => {
        farm.season = 'Harvest';
      },
      (farm) => {
        farm.weather = null;
      },
      (farm) => {
        farm.plots = 'none';
      },
      (farm) => {
        const cell = areaMap(START_AREA).plotTiles[0];
        (farm.plots as Record<string, unknown>)[plotKey(START_AREA, cell.x, cell.y)] = {
          x: cell.x,
          y: cell.y,
          stage: 'ablaze',
        };
      },
      (farm) => {
        farm.quest = { id: 'some-other-quest' };
      },
      (farm) => delete farm.time,
    ];

    for (const corrupt of cases) {
      const envelope = JSON.parse(encodeSave(playedFarm()));
      corrupt(envelope.farm);
      expect(decodeSave(JSON.stringify(envelope))).toBeNull();
    }
  });

  it('refuses a player stored under a mismatched key', () => {
    const envelope = JSON.parse(encodeSave(playedFarm()));
    envelope.farm.players.impostor = envelope.farm.players.a;
    delete envelope.farm.players.a;

    expect(decodeSave(JSON.stringify(envelope))).toBeNull();
  });

  it('refuses a player standing on an area this build does not have', () => {
    const envelope = JSON.parse(encodeSave(playedFarm()));
    envelope.farm.players.a.area = 'atlantis';

    expect(decodeSave(JSON.stringify(envelope))).toBeNull();
  });

  it('refuses an inventory that is not the size this build carries', () => {
    for (const size of [INVENTORY_SIZE - 1, INVENTORY_SIZE + 1]) {
      const envelope = JSON.parse(encodeSave(playedFarm()));
      envelope.farm.players.a.inventory.length = size;
      if (size > INVENTORY_SIZE) envelope.farm.players.a.inventory[size - 1] = null;

      expect(decodeSave(JSON.stringify(envelope))).toBeNull();
    }
  });

  it('refuses a stack this build cannot make sense of', () => {
    const cases: Array<(stack: Record<string, unknown>) => void> = [
      (stack) => {
        stack.item = 'plutonium';
      },
      (stack) => {
        stack.count = 0;
      },
      (stack) => {
        stack.count = -3;
      },
      (stack) => {
        stack.count = 1.5;
      },
      (stack) => {
        // A hoe does not stack, so two in one slot is a hand-edited save.
        stack.count = 2;
      },
      (stack) => {
        // Nor does a hoe hold anything.
        stack.charges = 5;
      },
    ];

    for (const corrupt of cases) {
      const envelope = JSON.parse(encodeSave(playedFarm()));
      corrupt(envelope.farm.players.a.inventory[0]);
      expect(decodeSave(JSON.stringify(envelope))).toBeNull();
    }
  });

  it('refuses a can carrying more than it holds, or a negative amount', () => {
    for (const charges of [WATERING_CAN_CHARGES + 1, -1, 'full']) {
      const envelope = JSON.parse(encodeSave(playedFarm()));
      envelope.farm.players.a.inventory[1].charges = charges;
      expect(decodeSave(JSON.stringify(envelope))).toBeNull();
    }
  });

  it('refuses a selected slot that is not a slot in reach', () => {
    for (const slot of [-1, HOTBAR_SIZE, INVENTORY_SIZE, 1.5, 'first']) {
      const envelope = JSON.parse(encodeSave(playedFarm()));
      envelope.farm.players.a.selectedSlot = slot;
      expect(decodeSave(JSON.stringify(envelope))).toBeNull();
    }
  });
});

describe('older saves', () => {
  /**
   * A save as version 2 wrote it: a satchel of named counts, a tool enum, and
   * a separately chosen seed. Built by hand because this build can no longer
   * produce one.
   */
  function version2Envelope(satchel?: Record<string, unknown>, extra?: Record<string, unknown>) {
    const envelope = JSON.parse(encodeSave(playedFarm()));
    envelope.version = 2;
    for (const player of Object.values(envelope.farm.players) as Array<Record<string, unknown>>) {
      delete player.inventory;
      delete player.selectedSlot;
      player.satchel = satchel ?? {
        seeds: { turnip: 8, strawberry: 2 },
        crops: { turnip: 3, strawberry: 0 },
        water: 12,
        wood: 5,
      };
      player.tool = 'hoe';
      player.seed = 'turnip';
      Object.assign(player, extra ?? {});
    }
    return envelope;
  }

  /** A version 1 save: the version 2 shape, minus energy. */
  function version1Envelope() {
    const envelope = version2Envelope();
    envelope.version = 1;
    for (const player of Object.values(envelope.farm.players) as Array<Record<string, unknown>>) {
      delete player.energy;
      delete player.maxEnergy;
    }
    return envelope;
  }

  it('turns a version 2 satchel into stacks in stable slots', () => {
    const restored = decodeSave(JSON.stringify(version2Envelope()));
    const inventory = restored!.players.a.inventory;

    // Tools first, in reach, then seeds, then crops, then materials. The tool
    // block grew from three to six in spec 10, and the migration follows it
    // rather than naming slots: a returning player gets the axe and the
    // pickaxe everybody else starts with.
    expect(inventory[0]).toEqual({ item: 'hoe', count: 1 });
    expect(inventory[1]).toEqual({ item: 'watering-can', count: 1, charges: 12 });
    expect(inventory[2]).toEqual({ item: 'basket', count: 1 });
    expect(inventory[3]).toEqual({ item: 'axe', count: 1 });
    expect(inventory[4]).toEqual({ item: 'pickaxe', count: 1 });
    expect(inventory[5]).toEqual({ item: 'scythe', count: 1 });
    expect(inventory[6]).toEqual({ item: 'turnip-seeds', count: 8 });
    expect(inventory[7]).toEqual({ item: 'strawberry-seeds', count: 2 });
    expect(inventory[8]).toEqual({ item: 'turnip', count: 3 });
    expect(inventory[9]).toEqual({ item: 'wood', count: 5 });
    expect(inventory.slice(10).every((slot) => slot === null)).toBe(true);
    expect(inventory).toHaveLength(INVENTORY_SIZE);
  });

  it('lands the same save in the same slots every time', () => {
    const once = decodeSave(JSON.stringify(version2Envelope()));
    const twice = decodeSave(JSON.stringify(version2Envelope()));

    expect(once?.players.a.inventory).toEqual(twice?.players.a.inventory);
  });

  it('round-trips an upgraded save through the current format', () => {
    const upgraded = decodeSave(JSON.stringify(version2Envelope()))!;
    const storage = memoryStorage();

    saveFarm(upgraded, storage);

    expect(loadFarm(storage)).toEqual(upgraded);
  });

  it('brings a half-empty watering can back half empty', () => {
    const restored = decodeSave(
      JSON.stringify(
        version2Envelope({
          seeds: { turnip: 0, strawberry: 0 },
          crops: { turnip: 0, strawberry: 0 },
          water: 4,
          wood: 0,
        }),
      ),
    );

    expect(restored?.players.a.inventory[1]?.charges).toBe(4);
    // Nothing to carry: the tools are there and the rest of the grid is empty.
    expect(
      restored?.players.a.inventory.slice(STARTING_TOOLS.length).every((slot) => slot === null),
    ).toBe(true);
  });

  it('leaves the player holding what they had equipped', () => {
    const onSeeds = decodeSave(
      JSON.stringify(version2Envelope(undefined, { tool: 'seed', seed: 'strawberry' })),
    );
    const onCan = decodeSave(JSON.stringify(version2Envelope(undefined, { tool: 'water' })));

    // The old Seeds tool becomes the packet itself, which is the same thing now.
    expect(onSeeds?.players.a.inventory[onSeeds.players.a.selectedSlot]?.item).toBe(
      'strawberry-seeds',
    );
    expect(onCan?.players.a.inventory[onCan.players.a.selectedSlot]?.item).toBe('watering-can');
  });

  it('spills a hoard bigger than one stack instead of clipping it', () => {
    const restored = decodeSave(
      JSON.stringify(
        version2Envelope({
          seeds: { turnip: 0, strawberry: 0 },
          crops: { turnip: 150, strawberry: 0 },
          water: 12,
          wood: 0,
        }),
      ),
    );

    expect(countItem(restored!.players.a.inventory, 'turnip')).toBe(150);
  });

  it('refuses a version 2 save with no satchel to upgrade', () => {
    const envelope = version2Envelope();
    delete envelope.farm.players.a.satchel;

    expect(decodeSave(JSON.stringify(envelope))).toBeNull();
  });

  it('loads a version 1 save through both upgrades at once', () => {
    const restored = decodeSave(JSON.stringify(version1Envelope()));

    expect(restored).not.toBeNull();
    expect(restored?.players.a.energy).toBe(STARTING_MAX_ENERGY);
    expect(restored?.players.a.maxEnergy).toBe(STARTING_MAX_ENERGY);
    expect(countItem(restored!.players.a.inventory, 'turnip-seeds')).toBe(8);
  });

  it('still validates the rest of an upgraded save', () => {
    // Migration fills in what is missing; it does not excuse what is wrong.
    const envelope = version1Envelope();
    envelope.farm.players.a.facing = 'sideways';

    expect(decodeSave(JSON.stringify(envelope))).toBeNull();
  });

  it('refuses a version this build has never heard of', () => {
    for (const version of [0, -1, 1.5, Number.NaN]) {
      const envelope = version2Envelope();
      envelope.version = version;
      expect(decodeSave(JSON.stringify(envelope))).toBeNull();
    }
  });

  it('round-trips energy exactly on a current save', () => {
    let farm = playedFarm();
    farm = {
      ...farm,
      players: { ...farm.players, a: { ...farm.players.a, energy: 137, maxEnergy: 300 } },
    };
    const storage = memoryStorage();

    saveFarm(farm, storage);
    const restored = loadFarm(storage);

    expect(restored?.players.a.energy).toBe(137);
    expect(restored?.players.a.maxEnergy).toBe(300);
  });

  it('refuses a player whose energy is not a number', () => {
    const envelope = JSON.parse(encodeSave(playedFarm()));
    envelope.farm.players.a.energy = 'plenty';

    expect(decodeSave(JSON.stringify(envelope))).toBeNull();
  });
});

describe('storage failures', () => {
  it('treats an unreadable store as having no save', () => {
    expect(() => loadFarm(hostileStorage)).not.toThrow();
    expect(loadFarm(hostileStorage)).toBeNull();
  });

  it('does not throw when the store refuses a write', () => {
    expect(() => saveFarm(createFarmState(), hostileStorage)).not.toThrow();
    expect(() => clearSave(hostileStorage)).not.toThrow();
  });
});

describe('clearing', () => {
  it('removes the save so the next load starts fresh', () => {
    const storage = memoryStorage();
    saveFarm(playedFarm(), storage);
    expect(storage.data[SAVE_KEY]).toBeDefined();

    clearSave(storage);

    expect(loadFarm(storage)).toBeNull();
  });
});

describe('version 3 saves, from before seasons had teeth', () => {
  /** A save as version 3 wrote it: today's shape, minus the market panel. */
  function version3Envelope(extra?: Record<string, unknown>) {
    const envelope = JSON.parse(encodeSave(playedFarm()));
    envelope.version = 3;
    for (const player of Object.values(envelope.farm.players) as Array<Record<string, unknown>>) {
      delete player.panel;
      Object.assign(player, extra ?? {});
    }
    return envelope;
  }

  it('loads, with the stall shut', () => {
    const restored = decodeSave(JSON.stringify(version3Envelope()));

    expect(restored).not.toBeNull();
    expect(restored?.players.a.panel).toBeNull();
    // Everything else came through untouched.
    expect(restored?.players.a.energy).toBe(STARTING_MAX_ENERGY);
    expect(countItem(restored!.players.a.inventory, 'turnip-seeds')).toBe(8);
  });

  it('keeps a version 3 crop that is still in the ground', () => {
    const envelope = version3Envelope();
    const key = plotKey(START_AREA, areaMap(START_AREA).plotTiles[0].x, areaMap(START_AREA).plotTiles[0].y);
    envelope.farm.plots[key] = {
      ...envelope.farm.plots[key],
      stage: 'mature',
      crop: 'strawberry',
      daysWatered: 3,
      wateredToday: false,
    };

    const restored = decodeSave(JSON.stringify(envelope));

    // No cull on load: a crop dies at a season boundary, and restoring a farm
    // is not one. It goes at the next turn like anything else in the ground.
    expect(restored?.plots[key].crop).toBe('strawberry');
  });

  it('round-trips an upgraded version 3 save through the current format', () => {
    const upgraded = decodeSave(JSON.stringify(version3Envelope()))!;
    const storage = memoryStorage();

    saveFarm(upgraded, storage);

    expect(loadFarm(storage)).toEqual(upgraded);
  });

  it('still validates the rest of an upgraded version 3 save', () => {
    const envelope = version3Envelope({ energy: -5 });

    expect(decodeSave(JSON.stringify(envelope))).toBeNull();
  });
});

describe('saves carrying the new crops', () => {
  it('accepts every crop in the catalogue in the ground', () => {
    const tiles = areaMap(START_AREA).plotTiles;
    const envelope = JSON.parse(encodeSave(playedFarm()));

    CROP_ORDER.forEach((crop, index) => {
      const tile = tiles[index % tiles.length];
      envelope.farm.plots[plotKey(START_AREA, tile.x, tile.y)] = {
        x: tile.x,
        y: tile.y,
        stage: 'sprout',
        crop,
        daysWatered: 1,
        wateredToday: false,
      };
    });

    const restored = decodeSave(JSON.stringify(envelope));

    expect(restored).not.toBeNull();
    const growing = new Set(Object.values(restored!.plots).map((plot) => plot.crop));
    for (const crop of CROP_ORDER.slice(0, tiles.length)) expect(growing).toContain(crop);
  });

  it('accepts every seed packet in a satchel', () => {
    const envelope = JSON.parse(encodeSave(playedFarm()));
    envelope.farm.players.a.inventory = envelope.farm.players.a.inventory.map(
      (slot: unknown, index: number) =>
        index < CROP_ORDER.length ? { item: seedIdFor(CROP_ORDER[index]), count: 1 } : null,
    );

    const restored = decodeSave(JSON.stringify(envelope));

    expect(restored).not.toBeNull();
    for (const crop of CROP_ORDER) {
      expect(countItem(restored!.players.a.inventory, seedIdFor(crop))).toBe(1);
    }
  });

  it('still refuses a crop this build has never heard of', () => {
    const tile = areaMap(START_AREA).plotTiles[0];
    const envelope = JSON.parse(encodeSave(playedFarm()));
    envelope.farm.plots[plotKey(START_AREA, tile.x, tile.y)].crop = 'moonfruit';

    expect(decodeSave(JSON.stringify(envelope))).toBeNull();
  });
});

describe('tools at the blacksmith and buildings on the farm', () => {
  /** A farm with a hoe in for work and a shed half up. */
  function ratchetingFarm(): FarmState {
    const farm = playedFarm();
    return {
      ...farm,
      buildings: [
        { id: 'b1', kind: 'shed', x: 25, y: 9, readyOnDay: null , doorOpen: false },
        { id: 'b2', kind: 'silo', x: 25, y: 13, readyOnDay: 7 , doorOpen: false },
      ],
      players: {
        ...farm.players,
        a: { ...farm.players.a, pendingUpgrade: { item: 'copper-hoe', readyOnDay: 6 } },
      },
    };
  }

  it('brings both back through a save, scaffold and all', () => {
    const storage = memoryStorage();
    saveFarm(ratchetingFarm(), storage);

    const restored = loadFarm(storage);

    // Two days at the forge is two days whether or not anybody was logged in
    // for them, so unlike the open shop panel this survives the round trip.
    expect(restored?.players.a.pendingUpgrade).toEqual({ item: 'copper-hoe', readyOnDay: 6 });
    expect(restored?.buildings).toEqual([
      { id: 'b1', kind: 'shed', x: 25, y: 9, readyOnDay: null , doorOpen: false },
      { id: 'b2', kind: 'silo', x: 25, y: 13, readyOnDay: 7 , doorOpen: false },
    ]);
  });

  it('refuses a save whose building hangs off the edge of the map', () => {
    const farm = ratchetingFarm();
    const map = areaMap(START_AREA);
    const overhanging: FarmState = {
      ...farm,
      buildings: [{ id: 'b1', kind: 'shed', x: map.width - 1, y: 0, readyOnDay: null , doorOpen: false }],
    };

    // A hand-edited save could otherwise put a solid rectangle somewhere
    // nobody can walk round, which is worse than refusing to load it.
    expect(decodeSave(encodeSave(overhanging))).toBeNull();
  });

  it('refuses a save with two buildings sharing an id', () => {
    const farm = ratchetingFarm();
    const twins: FarmState = {
      ...farm,
      buildings: [
        { id: 'b1', kind: 'shed', x: 25, y: 9, readyOnDay: null , doorOpen: false },
        { id: 'b1', kind: 'silo', x: 25, y: 13, readyOnDay: null , doorOpen: false },
      ],
    };

    expect(decodeSave(encodeSave(twins))).toBeNull();
  });

  it('refuses a save naming a tool this build has never heard of', () => {
    const farm = ratchetingFarm();
    const envelope = JSON.parse(encodeSave(farm));
    envelope.farm.players.a.pendingUpgrade = { item: 'mithril-hoe', readyOnDay: 6 };

    expect(decodeSave(JSON.stringify(envelope))).toBeNull();
  });

  it('refuses a save whose pending item is not a tool at all', () => {
    const farm = ratchetingFarm();
    const envelope = JSON.parse(encodeSave(farm));
    envelope.farm.players.a.pendingUpgrade = { item: 'turnip', readyOnDay: 6 };

    expect(decodeSave(JSON.stringify(envelope))).toBeNull();
  });
});

describe('version 4 saves, from before there was anything to build', () => {
  /** A save as version 4 wrote it: no buildings, and the old shop boolean. */
  function version4Envelope() {
    const envelope = JSON.parse(encodeSave(playedFarm()));
    envelope.version = 4;
    delete envelope.farm.buildings;
    for (const player of Object.values(envelope.farm.players) as Array<Record<string, unknown>>) {
      delete player.panel;
      delete player.pendingUpgrade;
      player.shopOpen = false;
    }
    return envelope;
  }

  it('loads, with an empty farm and empty hands', () => {
    const restored = decodeSave(JSON.stringify(version4Envelope()));

    expect(restored).not.toBeNull();
    expect(restored?.buildings).toEqual([]);
    expect(restored?.players.a.pendingUpgrade).toBeNull();
    expect(restored?.players.a.panel).toBeNull();
  });

  it('leaves everything a version 4 save did have alone', () => {
    const restored = decodeSave(JSON.stringify(version4Envelope()));

    expect(restored?.players.a.energy).toBe(STARTING_MAX_ENERGY);
    expect(restored?.players.a.selectedSlot).toBe(1);
    expect(countItem(restored!.players.a.inventory, 'turnip-seeds')).toBe(8);
  });

  it('drops the old shopOpen flag rather than carrying it alongside the new one', () => {
    const upgraded = decodeSave(JSON.stringify(version4Envelope()));

    expect(upgraded).not.toBeNull();
    expect(Object.hasOwn(upgraded!.players.a, 'shopOpen')).toBe(false);
  });
});

describe('the village, saved and restored', () => {
  /** A farm where somebody has made a friend and spent a gift on it. */
  function friendlyFarm(): FarmState {
    const farm = playedFarm();
    return {
      ...farm,
      players: {
        ...farm.players,
        a: {
          ...farm.players.a,
          relationships: {
            rowan: { points: 640, giftsThisWeek: 2, giftedToday: true },
            ash: { points: -40, giftsThisWeek: 1, giftedToday: false },
          },
        },
      },
    };
  }

  it('brings a friendship back through a save, hearts and allowance and all', () => {
    const storage = memoryStorage();
    saveFarm(friendlyFarm(), storage);

    const restored = loadFarm(storage);

    expect(restored?.players.a.relationships.rowan).toEqual({
      points: 640,
      giftsThisWeek: 2,
      giftedToday: true,
    });
    // Points can be negative, and a save is not the place to quietly fix that.
    expect(restored?.players.a.relationships.ash?.points).toBe(-40);
  });

  it('brings the villagers back standing somewhere real', () => {
    const storage = memoryStorage();
    saveFarm(friendlyFarm(), storage);

    const restored = loadFarm(storage);

    expect(restored?.npcs.map((actor) => actor.id).sort()).toEqual([...NPC_IDS].sort());
    for (const actor of restored!.npcs) expect(isWalkable(actor.area, actor.x, actor.y)).toBe(true);
  });

  it('rebuilds the villagers rather than refusing a save whose positions are nonsense', () => {
    // Where somebody is standing is derived from the schedule and the clock,
    // so it can always be recomputed. Discarding a whole world over Maeve's
    // coordinates would be the wrong trade by a wide margin.
    const envelope = JSON.parse(encodeSave(friendlyFarm()));
    envelope.farm.npcs = [{ id: 'maeve', area: 'atlantis', x: 'yes', y: null, entry: 1.5 }];

    const restored = decodeSave(JSON.stringify(envelope));

    expect(restored).not.toBeNull();
    expect(restored?.npcs).toHaveLength(NPC_IDS.length);
  });

  it('refuses a save whose friendship is not a friendship', () => {
    const envelope = JSON.parse(encodeSave(friendlyFarm()));
    envelope.farm.players.a.relationships.rowan = { points: 'lots', giftsThisWeek: 1, giftedToday: false };

    expect(decodeSave(JSON.stringify(envelope))).toBeNull();
  });

  it('forgets a villager this build has never heard of, rather than refusing the save', () => {
    // A renamed or retired villager should cost somebody their history with
    // that one person, not their entire farm.
    const envelope = JSON.parse(encodeSave(friendlyFarm()));
    envelope.farm.players.a.relationships.mayor = { points: 500, giftsThisWeek: 0, giftedToday: false };

    const restored = decodeSave(JSON.stringify(envelope));

    expect(restored).not.toBeNull();
    expect(Object.hasOwn(restored!.players.a.relationships, 'mayor')).toBe(false);
    expect(restored?.players.a.relationships.rowan?.points).toBe(640);
  });
});

describe('version 5 saves, from before the village had anybody in it', () => {
  /** A save as version 5 wrote it: no relationships, and nobody walking. */
  function version5Envelope() {
    const envelope = JSON.parse(encodeSave(playedFarm()));
    envelope.version = 5;
    delete envelope.farm.npcs;
    for (const player of Object.values(envelope.farm.players) as Array<Record<string, unknown>>) {
      delete player.relationships;
    }
    return envelope;
  }

  it('loads, with everybody a stranger', () => {
    const restored = decodeSave(JSON.stringify(version5Envelope()));

    expect(restored).not.toBeNull();
    expect(restored?.players.a.relationships).toEqual({});
    // Which reads as nought hearts with everyone, the right answer for a
    // farmhand coming back to a village they have never actually met.
    expect(heartsWith(restored!.players.a.relationships, 'rowan')).toBe(0);
  });

  it('puts the villagers on the map the save never knew about', () => {
    const restored = decodeSave(JSON.stringify(version5Envelope()));

    expect(restored?.npcs).toHaveLength(NPC_IDS.length);
    for (const actor of restored!.npcs) expect(isWalkable(actor.area, actor.x, actor.y)).toBe(true);
  });

  it('leaves everything a version 5 save did have alone', () => {
    const restored = decodeSave(JSON.stringify(version5Envelope()));

    expect(restored?.players.a.energy).toBe(STARTING_MAX_ENERGY);
    expect(countItem(restored!.players.a.inventory, 'turnip-seeds')).toBe(8);
    expect(restored?.players.a.pendingUpgrade).toBeNull();
  });
});

describe('the herd, saved and restored', () => {
  /** A farm with a coop, a silo, hay in it, and two animals in the coop. */
  function stockedFarm(): FarmState {
    const farm = playedFarm();
    return {
      ...farm,
      buildings: [
        { id: 'b1', kind: 'coop', x: 25, y: 9, readyOnDay: null, doorOpen: true },
        { id: 'b2', kind: 'silo', x: 25, y: 13, readyOnDay: null, doorOpen: false },
      ],
      hay: 40,
      animals: [
        {
          id: 'a1',
          kind: 'chicken',
          name: 'Mun',
          home: 'b1',
          bornOnDay: 2,
          affection: 730,
          pettedToday: true,
          fedToday: true,
          outsideToday: true,
          produceOnDay: 6,
          position: { x: 830, y: 400 },
        },
        {
          id: 'a2',
          kind: 'duck',
          name: 'Bé Út',
          home: 'b1',
          bornOnDay: 4,
          affection: 210,
          pettedToday: false,
          fedToday: false,
          outsideToday: false,
          produceOnDay: 7,
          position: null,
        },
      ],
    };
  }

  it('brings the herd back whole, hay and open door and all', () => {
    const storage = memoryStorage();
    saveFarm(stockedFarm(), storage);

    const restored = loadFarm(storage);

    expect(restored?.animals).toEqual(stockedFarm().animals);
    expect(restored?.hay).toBe(40);
    // The door is the building's, so it rides back with the building.
    expect(restored?.buildings[0].doorOpen).toBe(true);
  });

  it('refuses a herd with two animals sharing an id', () => {
    const farm = stockedFarm();
    const twins: FarmState = {
      ...farm,
      animals: [farm.animals[0], { ...farm.animals[1], id: 'a1' }],
    };

    // Two animals on one id would make `nextAnimalId` hand out a third copy.
    expect(decodeSave(encodeSave(twins))).toBeNull();
  });

  it('refuses an animal living in a building the save does not have', () => {
    const farm = stockedFarm();
    const homeless: FarmState = {
      ...farm,
      animals: [{ ...farm.animals[0], home: 'b9' }],
    };

    // Nowhere to be fed from and no door to come out of: a cow in a building
    // that is not there would misbehave every morning rather than once.
    expect(decodeSave(encodeSave(homeless))).toBeNull();
  });

  it('refuses an animal this build has never heard of', () => {
    const farm = stockedFarm();
    const serialized = JSON.parse(encodeSave(farm));
    serialized.farm.animals[0].kind = 'llama';

    expect(decodeSave(JSON.stringify(serialized))).toBeNull();
  });

  it('clamps affection rather than refusing a save that disagrees about the range', () => {
    const farm = stockedFarm();
    const serialized = JSON.parse(encodeSave(farm));
    serialized.farm.animals[0].affection = 99_999;

    // The same bargain a friendship's points get: the range is a balance
    // decision that may well move, and a save written before it moved is not
    // corrupt. Anything structural still refuses.
    expect(decodeSave(JSON.stringify(serialized))?.animals[0].affection).toBe(1000);
  });

  it('never restores more hay than the silos could hold', () => {
    const farm = stockedFarm();
    const overflowing: FarmState = { ...farm, hay: 10_000 };

    expect(decodeSave(encodeSave(overflowing))?.hay).toBe(240);
  });
});

describe('the ground, saved and restored', () => {
  it('brings every node back exactly as it stood', () => {
    const farm = playedFarm();
    const restored = decodeSave(encodeSave(farm));

    expect(restored?.nodes).toEqual(farm.nodes);
    expect(restored?.nodes.length).toBeGreaterThan(0);
    // The seed with them, or the restored farm would grow a different night
    // from the one it was saved out of.
    expect(restored?.spawnSeed).toBe(farm.spawnSeed);
  });

  it('refuses a node standing off the edge of its own map', () => {
    const farm = playedFarm();
    const map = areaMap(START_AREA);
    const envelope = JSON.parse(encodeSave(farm));
    envelope.farm.nodes = [
      { id: 'n1', kind: 'tree', area: START_AREA, x: map.width + 4, y: 2, health: 5, requires: 'basic', stage: 4, item: null },
    ];

    // A solid rectangle nobody can see and nobody can walk round.
    expect(decodeSave(JSON.stringify(envelope))).toBeNull();
  });

  it('refuses two things standing on one tile', () => {
    const farm = playedFarm();
    const envelope = JSON.parse(encodeSave(farm));
    const one = { id: 'n1', kind: 'rock', area: START_AREA, x: 30, y: 4, health: 2, requires: 'basic', stage: null, item: null };
    envelope.farm.nodes = [one, { ...one, id: 'n2' }];

    // `nodeAt` would hand out whichever came first, and the other would be a
    // collision rectangle with no sprite over it.
    expect(decodeSave(JSON.stringify(envelope))).toBeNull();
  });

  it('refuses a map, a kind, a bad forage item, or a bad ore this build has never heard of', () => {
    const farm = playedFarm();
    const good = { id: 'n1', kind: 'rock', area: START_AREA, x: 30, y: 4, health: 2, requires: 'basic', stage: null, item: null };

    for (const bad of [
      { ...good, area: 'atlantis' },
      { ...good, kind: 'obelisk' },
      { ...good, requires: 'mithril' },
      { ...good, kind: 'forage', item: 'moonfruit' },
      // A vein missing its item outright — mine-area nodes are never saved
      // (spec 16: they are rebuilt from the seed), but a static-area `ore`
      // node is still parsed, and a missing item is refused the same way a
      // missing forage item is.
      { ...good, kind: 'ore', item: null },
      // `wood` is a real item id, just never one the mine actually drops —
      // only what `MINED_ITEMS` lists belongs on a vein (spec 16's F7 fix).
      { ...good, kind: 'ore', item: 'wood' },
      // A rock with a growth stage, or a tree without one, is a hand-edited
      // save: both halves are checked because both halves would misbehave.
      { ...good, stage: 2 },
      { id: 'n1', kind: 'tree', area: START_AREA, x: 30, y: 4, health: 5, requires: 'basic', stage: null, item: null },
    ]) {
      const envelope = JSON.parse(encodeSave(farm));
      envelope.farm.nodes = [bad];
      expect(decodeSave(JSON.stringify(envelope)), JSON.stringify(bad)).toBeNull();
    }
  });

  it('clamps a health the balance has since moved, rather than refusing the save', () => {
    const farm = playedFarm();
    const envelope = JSON.parse(encodeSave(farm));
    envelope.farm.nodes = [
      { id: 'n1', kind: 'rock', area: START_AREA, x: 30, y: 4, health: 40, requires: 'basic', stage: null, item: null },
    ];

    // How many swings a rock takes is a tuning decision that may well move,
    // and a save written before it moved is not corrupt.
    const restored = decodeSave(JSON.stringify(envelope));
    expect(restored?.nodes[0].health).toBe(2);
  });
});

describe('version 7 saves, from before anything stood on the ground', () => {
  /** A save as version 7 wrote it: no nodes, and no seed to grow them from. */
  function version7Envelope() {
    const envelope = JSON.parse(encodeSave(playedFarm()));
    envelope.version = 7;
    delete envelope.farm.nodes;
    delete envelope.farm.spawnSeed;
    return envelope;
  }

  it('loads, on bare ground rather than under a fresh scattering of rocks', () => {
    const restored = decodeSave(JSON.stringify(version7Envelope()));

    expect(restored).not.toBeNull();
    // The one migration where doing the obvious thing would be destructive:
    // seeding a returning player's world would drop boulders into a field
    // they have spent a season clearing.
    expect(restored?.nodes).toEqual([]);
  });

  it('gives it the same seed a new farm gets, so both see the same nights', () => {
    const restored = decodeSave(JSON.stringify(version7Envelope()));
    expect(restored?.spawnSeed).toBe(createFarmState().spawnSeed);
  });

  it('fills in from the edges over the following fortnight', () => {
    const restored = decodeSave(JSON.stringify(version7Envelope()))!;
    // Stood at the bed, because that is the only place the reducer will let
    // anybody turn in, and a night is what this test is about.
    const bed = areaMap('farmhouse').props.find((prop) => prop.interact === 'bed')!;
    let farm: FarmState = {
      ...restored,
      players: {
        a: {
          ...restored.players.a,
          online: true,
          x: bed.x + bed.width / 2,
          y: bed.y + bed.height + 8,
          area: 'farmhouse',
        },
      },
    };

    // Grass spreads, weeds come up, and within a couple of weeks the farm
    // looks like everybody else's without anything having been dropped on it.
    for (let night = 0; night < 14; night += 1) {
      farm = applyIntent(farm, { type: 'player/sleep', playerId: 'a' }).state;
    }
    expect(farm.nodes.length).toBeGreaterThan(0);
  });

  it('leaves everything a version 7 save did have alone', () => {
    const restored = decodeSave(JSON.stringify(version7Envelope()));

    expect(restored?.players.a.energy).toBe(STARTING_MAX_ENERGY);
    expect(countItem(restored!.players.a.inventory, 'turnip-seeds')).toBe(8);
  });

  it('round-trips an upgraded version 7 save through the current format', () => {
    const upgraded = decodeSave(JSON.stringify(version7Envelope()));

    expect(upgraded).not.toBeNull();
    expect(decodeSave(encodeSave(upgraded!))).toEqual(upgraded);
  });
});

describe('version 6 saves, from before the coop had anything in it', () => {
  /** A save as version 6 wrote it: no herd, no hay, and no doors. */
  function version6Envelope() {
    const envelope = JSON.parse(encodeSave(playedFarm()));
    envelope.version = 6;
    envelope.farm.buildings = [{ id: 'b1', kind: 'coop', x: 25, y: 9, readyOnDay: null }];
    delete envelope.farm.animals;
    delete envelope.farm.hay;
    return envelope;
  }

  it('loads, with an empty coop and an empty silo', () => {
    const restored = decodeSave(JSON.stringify(version6Envelope()));

    expect(restored).not.toBeNull();
    expect(restored?.animals).toEqual([]);
    expect(restored?.hay).toBe(0);
  });

  it('brings the buildings back with their doors shut', () => {
    const restored = decodeSave(JSON.stringify(version6Envelope()));

    expect(restored?.buildings).toEqual([
      { id: 'b1', kind: 'coop', x: 25, y: 9, readyOnDay: null, doorOpen: false },
    ]);
  });

  it('leaves everything a version 6 save did have alone', () => {
    const restored = decodeSave(JSON.stringify(version6Envelope()));

    expect(restored?.players.a.energy).toBe(STARTING_MAX_ENERGY);
    expect(countItem(restored!.players.a.inventory, 'turnip-seeds')).toBe(8);
  });

  it('round-trips an upgraded version 6 save through the current format', () => {
    const upgraded = decodeSave(JSON.stringify(version6Envelope()));

    expect(upgraded).not.toBeNull();
    expect(decodeSave(encodeSave(upgraded!))).toEqual(upgraded);
  });
});

describe('chests and machines across a save', () => {
  /** A farm with a stocked chest, a running keg and a laid path on it. */
  function furnishedFarm(): FarmState {
    const farm = playedFarm();
    const chest = createPlaceable('p1', 'chest', START_AREA, 20, 12) as Chest;
    chest.contents[0] = newStack('wood', 40);
    chest.contents[5] = newStack('melon', 3);

    const keg = createPlaceable('p2', 'keg', START_AREA, 21, 12) as Machine;
    keg.job = { input: 'melon', output: 'wine-melon', readyOnDay: farm.time.day + 7 };

    return {
      ...farm,
      placeables: [chest, keg, createPlaceable('p3', 'stone-path', START_AREA, 22, 12)],
    };
  }

  it('survives being written out and read back, contents and all', () => {
    const farm = furnishedFarm();
    const storage = memoryStorage();
    saveFarm(farm, storage);

    const restored = loadFarm(storage);
    expect(restored?.placeables).toEqual(farm.placeables);

    const chest = restored?.placeables.find((placeable) => placeable.id === 'p1') as Chest;
    expect(countItem(chest.contents, 'wood')).toBe(40);
    expect(countItem(chest.contents, 'melon')).toBe(3);
  });

  it('keeps a machine counting to the same morning it was counting to', () => {
    const farm = furnishedFarm();
    const restored = decodeSave(encodeSave(farm))!;
    const keg = restored.placeables.find((placeable) => placeable.id === 'p2') as Machine;
    expect(keg.job).toEqual({ input: 'melon', output: 'wine-melon', readyOnDay: farm.time.day + 7 });
  });

  it('keeps each player their own recipe book', () => {
    let farm = playedFarm();
    farm = {
      ...farm,
      players: {
        ...farm.players,
        a: { ...farm.players.a, knownRecipes: [...farm.players.a.knownRecipes, 'keg'] },
      },
    };

    const restored = decodeSave(encodeSave(farm))!;
    expect(restored.players.a.knownRecipes).toContain('keg');
  });

  it('opens no chest for a farm that has just been read off a disk', () => {
    const farm = furnishedFarm();
    const withPanel: FarmState = {
      ...farm,
      players: {
        ...farm.players,
        a: { ...farm.players.a, panel: 'chest', openChest: 'p1' },
      },
    };
    const restored = decodeSave(encodeSave(withPanel))!;
    expect(restored.players.a.panel).toBeNull();
    expect(restored.players.a.openChest).toBeNull();
  });

  it('drops one bad chest slot rather than the whole farm', () => {
    // The one place in this file where a malformed row is repaired instead of
    // refused, and spec 11 asks for it in as many words: four full chests are
    // 144 slots of JSON, by a distance the largest thing in the save and so
    // the likeliest to be truncated or hand-edited. Losing one stack is a far
    // better trade for the player than losing the world.
    const envelope = JSON.parse(encodeSave(furnishedFarm()));
    envelope.farm.placeables[0].contents[5] = { item: 'not-a-real-item', count: 3 };

    const restored = decodeSave(JSON.stringify(envelope));
    expect(restored).not.toBeNull();

    const chest = restored?.placeables.find((placeable) => placeable.id === 'p1') as Chest;
    expect(chest.contents[5]).toBeNull();
    // Everything either side of it is untouched.
    expect(countItem(chest.contents, 'wood')).toBe(40);
    expect(restored?.placeables).toHaveLength(3);
  });

  it('drops a chest slot whose count is nonsense, too', () => {
    const envelope = JSON.parse(encodeSave(furnishedFarm()));
    envelope.farm.placeables[0].contents[0] = { item: 'wood', count: -4 };

    const chest = decodeSave(JSON.stringify(envelope))?.placeables.find(
      (placeable) => placeable.id === 'p1',
    ) as Chest;
    expect(chest.contents[0]).toBeNull();
    expect(countItem(chest.contents, 'melon')).toBe(3);
  });

  it('refuses a placeable that is structurally wrong, which is not a slot', () => {
    // A chest standing off the edge of a map is a solid rectangle nobody can
    // reach; a kind this build has never heard of would draw nothing. Neither
    // is a stack of turnips, so neither is repaired.
    for (const damage of [
      (farm: Record<string, unknown>) => {
        (farm.placeables as Array<Record<string, unknown>>)[0].x = -5;
      },
      (farm: Record<string, unknown>) => {
        (farm.placeables as Array<Record<string, unknown>>)[0].kind = 'teleporter';
      },
      (farm: Record<string, unknown>) => {
        (farm.placeables as Array<Record<string, unknown>>)[0].id = '';
      },
      (farm: Record<string, unknown>) => {
        (farm.placeables as Array<Record<string, unknown>>)[1].id = 'p1';
      },
      (farm: Record<string, unknown>) => {
        // Two things standing on one tile: `placeableAt` would hand out
        // whichever came first and the other would be an invisible wall.
        const list = farm.placeables as Array<Record<string, unknown>>;
        list[1].x = list[0].x;
        list[1].y = list[0].y;
      },
      (farm: Record<string, unknown>) => {
        (farm.placeables as Array<Record<string, unknown>>)[1].job = { input: 'melon' };
      },
      (farm: Record<string, unknown>) => {
        (farm.placeables as Array<Record<string, unknown>>)[1].job = {
          input: 'ghost-fruit',
          output: 'wine-melon',
          readyOnDay: 3,
        };
      },
    ]) {
      const envelope = JSON.parse(encodeSave(furnishedFarm()));
      damage(envelope.farm);
      expect(decodeSave(JSON.stringify(envelope))).toBeNull();
    }
  });
});

describe('version 8 saves, from before anything was crafted', () => {
  /** A save as version 8 wrote it: no placeables, and nobody knowing a recipe. */
  function version8Envelope() {
    const envelope = JSON.parse(encodeSave(playedFarm()));
    envelope.version = 8;
    delete envelope.farm.placeables;
    delete envelope.farm.players.a.knownRecipes;
    delete envelope.farm.players.a.openChest;
    return envelope;
  }

  it('loads, with bare ground and nothing put down on it', () => {
    const restored = decodeSave(JSON.stringify(version8Envelope()));
    expect(restored).not.toBeNull();
    expect(restored?.placeables).toEqual([]);
  });

  it('gives a returning player the recipes everybody starts with', () => {
    // The one thing this migration must not leave out: a farm that could not
    // make the first chest in the game is a farm the upgrade had broken.
    const restored = decodeSave(JSON.stringify(version8Envelope()));
    expect([...(restored?.players.a.knownRecipes ?? [])].sort()).toEqual([...STARTING_RECIPES].sort());
    expect(restored?.players.a.openChest).toBeNull();
  });

  it('keeps an unknown recipe out of the book rather than refusing the save', () => {
    // A catalogue is expected to change between builds, so a recipe that has
    // since been renamed costs the player that recipe and not their farm.
    const envelope = version8Envelope();
    envelope.farm.players.a.knownRecipes = ['chest', 'recipe-that-was-removed'];

    const restored = decodeSave(JSON.stringify(envelope));
    expect(restored).not.toBeNull();
    expect(restored?.players.a.knownRecipes).toContain('chest');
    expect(restored?.players.a.knownRecipes).not.toContain('recipe-that-was-removed');
  });

  it('still refuses a recipe book that is not a list at all', () => {
    const envelope = version8Envelope();
    envelope.version = SAVE_VERSION;
    envelope.farm.players.a.knownRecipes = 'everything';
    expect(decodeSave(JSON.stringify(envelope))).toBeNull();
  });
});

describe('version 9 saves, from before the water did anything but block the way', () => {
  /** A save as version 9 wrote it: nobody had a line in the water. */
  function version9Envelope() {
    const envelope = JSON.parse(encodeSave(playedFarm()));
    envelope.version = 9;
    for (const player of Object.values(envelope.farm.players) as Array<Record<string, unknown>>) {
      delete player.fishing;
    }
    return envelope;
  }

  it('loads, with an empty line', () => {
    const restored = decodeSave(JSON.stringify(version9Envelope()));
    expect(restored).not.toBeNull();
    expect(restored?.players.a.fishing).toBeNull();
  });

  it('leaves everything a version 9 save did have alone', () => {
    const restored = decodeSave(JSON.stringify(version9Envelope()));
    expect(restored?.players.a.energy).toBe(STARTING_MAX_ENERGY);
    expect(countItem(restored!.players.a.inventory, 'turnip-seeds')).toBe(8);
  });

  it('hands over no rod, because a rod is something you buy', () => {
    const restored = decodeSave(JSON.stringify(version9Envelope()));
    expect(countItem(restored!.players.a.inventory, 'fishing-rod')).toBe(0);
  });

  it('round-trips an upgraded version 9 save through the current format', () => {
    const upgraded = decodeSave(JSON.stringify(version9Envelope()));
    expect(upgraded).not.toBeNull();
    expect(decodeSave(encodeSave(upgraded!))).toEqual(upgraded);
  });
});

describe('a cast never survives a reload', () => {
  it('is dropped even from a save written in the middle of one', () => {
    const farm = playedFarm();
    const mid: FarmState = {
      ...farm,
      players: {
        ...farm.players,
        a: {
          ...farm.players.a,
          fishing: {
            phase: 'reeling',
            target: { x: 3, y: 4 },
            fish: 'carp',
            endsInMs: 0,
            waitMs: 2000,
            fishAt: 0.5,
            fishVelocity: 0,
            barAt: 0.4,
            barVelocity: 0,
            progress: 0.8,
            barWidth: 0.2,
            reeling: true,
            reelMs: 1200,
            landed: false,
            size: 42,
          },
        },
      },
    };

    // Written at the current version, so this is the rule rather than a
    // migration: a bite window that closed while the process was down must
    // not be the first thing a returning player is handed.
    const restored = decodeSave(encodeSave(mid));
    expect(restored?.players.a.fishing).toBeNull();
  });
});

describe('version 11 saves, from when winter still grew two crops', () => {
  /** Puts a stack in the first empty slot of a serialised satchel or chest. */
  function stash(slots: unknown[], stack: { item: string; count: number }) {
    const empty = slots.indexOf(null);
    if (empty < 0) throw new Error('no empty slot to stash into');
    slots[empty] = stack;
  }

  /**
   * A save as version 11 wrote it, with winter's two crops in every place one
   * could be: a satchel, the satchel of somebody else on the farm, a chest, a
   * keg, and the ground. Written into the JSON by hand, because once spec 17
   * is in, this build's types have no name for any of it.
   *
   * Worth, by the refund table: 2 jam (168) + 5 frostcap (260) + 3 winterberry
   * seeds (240) + 4 winterberry in the chest (152) + the winterberry in the keg
   * (38) = 858g.
   */
  function version11Envelope() {
    let farm = playedFarm();
    farm = applyIntent(farm, { type: 'player/join', playerId: 'b', name: 'B' }).state;

    const chest = createPlaceable('p1', 'chest', START_AREA, 20, 12) as Chest;
    chest.contents[0] = newStack('wood', 40);
    const winterKeg = createPlaceable('p2', 'keg', START_AREA, 21, 12) as Machine;
    const melonKeg = createPlaceable('p3', 'keg', START_AREA, 22, 12) as Machine;
    melonKeg.job = { input: 'melon', output: 'wine-melon', readyOnDay: farm.time.day + 7 };

    const cells = areaMap(START_AREA).plotTiles.slice(0, 3);
    const keys = cells.map((cell) => plotKey(START_AREA, cell.x, cell.y));
    farm = {
      ...farm,
      coins: 100,
      placeables: [chest, winterKeg, melonKeg],
      plots: {
        ...farm.plots,
        [keys[2]]: { ...cells[2], stage: 'sprout', crop: 'strawberry', daysWatered: 2, wateredToday: false },
      },
    };

    const envelope = JSON.parse(encodeSave(farm));
    envelope.version = 11;
    stash(envelope.farm.players.a.inventory, { item: 'jam-winterberry', count: 2 });
    stash(envelope.farm.players.b.inventory, { item: 'frostcap', count: 5 });
    stash(envelope.farm.players.b.inventory, { item: 'winterberry-seeds', count: 3 });
    envelope.farm.placeables[0].contents[3] = { item: 'winterberry', count: 4 };
    envelope.farm.placeables[1].job = { input: 'winterberry', output: 'wine-winterberry', readyOnDay: 9 };
    for (const i of [0, 1]) {
      envelope.farm.plots[keys[i]] = { ...cells[i], stage: 'sprout', crop: 'frostcap', daysWatered: 2, wateredToday: true };
    }
    return { envelope, keys };
  }

  const WINTER_IDS = [
    'frostcap-seeds',
    'winterberry-seeds',
    'frostcap',
    'winterberry',
    'juice-frostcap',
    'pickle-frostcap',
    'wine-winterberry',
    'jam-winterberry',
  ];

  it('loads, and pays for every winter item it held into the shared wallet', () => {
    const restored = decodeSave(JSON.stringify(version11Envelope().envelope));
    expect(restored).not.toBeNull();
    expect(restored!.coins).toBe(100 + 858);
  });

  it('leaves no winter item in any satchel or chest, and everything else where it was', () => {
    const restored = decodeSave(JSON.stringify(version11Envelope().envelope))!;
    const chest = restored.placeables.find((placeable) => placeable.id === 'p1') as Chest;
    for (const id of WINTER_IDS) {
      expect(countItem(restored.players.a.inventory, id)).toBe(0);
      expect(countItem(restored.players.b.inventory, id)).toBe(0);
      expect(countItem(chest.contents, id)).toBe(0);
    }
    expect(countItem(restored.players.a.inventory, 'turnip-seeds')).toBe(8);
    expect(chest.contents[0]).toEqual({ item: 'wood', count: 40 });
    expect(chest.contents[3]).toBeNull();
  });

  it('empties a machine that was working on a winter crop, and leaves any other job alone', () => {
    const restored = decodeSave(JSON.stringify(version11Envelope().envelope))!;
    const winterKeg = restored.placeables.find((placeable) => placeable.id === 'p2') as Machine;
    const melonKeg = restored.placeables.find((placeable) => placeable.id === 'p3') as Machine;
    expect(winterKeg.job).toBeNull();
    expect(melonKeg.job?.input).toBe('melon');
  });

  it('turns winter crops in the ground back into bare tilled soil, and leaves other crops growing', () => {
    const { envelope, keys } = version11Envelope();
    const restored = decodeSave(JSON.stringify(envelope))!;
    for (const key of keys.slice(0, 2)) {
      expect(restored.plots[key]).toMatchObject({ stage: 'tilled', crop: null, daysWatered: 0, wateredToday: false });
    }
    expect(restored.plots[keys[2]]).toMatchObject({ stage: 'sprout', crop: 'strawberry', daysWatered: 2 });
  });

  it('leaves the wallet alone for a version 11 save that never grew anything in winter', () => {
    const farm = { ...playedFarm(), coins: 321 };
    const envelope = JSON.parse(encodeSave(farm));
    envelope.version = 11;
    expect(decodeSave(JSON.stringify(envelope))?.coins).toBe(321);
  });

  it('round-trips an upgraded version 11 save through the current format', () => {
    const upgraded = decodeSave(JSON.stringify(version11Envelope().envelope));
    expect(upgraded).not.toBeNull();
    expect(decodeSave(encodeSave(upgraded!))).toEqual(upgraded);
  });
});
