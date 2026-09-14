import { describe, expect, it } from 'vitest';
import { START_AREA, areaMap, plotKey } from '../world/areas';
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
import type { FarmState } from './types';

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
  farm = applyIntent(farm, { type: 'player/selectTool', playerId: 'a', tool: 'water' }).state;
  farm = applyIntent(farm, { type: 'world/tick', deltaMs: 3600 }).state;
  return farm;
}

describe('save round trip', () => {
  it('restores an identical farm', () => {
    const farm = playedFarm();
    const storage = memoryStorage();

    saveFarm(farm, storage);

    expect(loadFarm(storage)).toEqual(farm);
  });

  it('preserves per-player satchels and the shared wallet separately', () => {
    let farm = playedFarm();
    farm = applyIntent(farm, { type: 'player/join', playerId: 'b', name: 'B' }).state;
    farm = {
      ...farm,
      coins: 412,
      players: {
        ...farm.players,
        a: { ...farm.players.a, satchel: { ...farm.players.a.satchel, water: 2 } },
        b: { ...farm.players.b, satchel: { ...farm.players.b.satchel, water: 9 } },
      },
    };
    const storage = memoryStorage();

    saveFarm(farm, storage);
    const restored = loadFarm(storage);

    expect(restored?.coins).toBe(412);
    expect(restored?.players.a.satchel.water).toBe(2);
    expect(restored?.players.b.satchel.water).toBe(9);
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

  it('refuses a player whose satchel counts are negative', () => {
    const envelope = JSON.parse(encodeSave(playedFarm()));
    envelope.farm.players.a.satchel.water = -1;

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
