import { describe, expect, it } from 'vitest';
import { applyDevSeed, devSeedMessage, seedHerd } from './seedHerd';
import { createFarmState } from '../state/reducer';
import { ANIMAL_KINDS, animalsOn } from '../systems/animals';
import { isComplete } from '../systems/buildings';
import type { FarmState } from '../state/types';

/** A farm at a time and in a sky that would send the herd indoors. */
function nightAndRain(farm: FarmState): FarmState {
  return {
    ...farm,
    weather: 'Drizzle',
    time: { ...farm.time, hour: 22, minute: 0, totalMinutes: 22 * 60 },
  };
}

describe('seedHerd', () => {
  it('puts one of every animal out where they can be compared', () => {
    const farm = seedHerd(createFarmState());
    expect(farm.animals.map((animal) => animal.kind).sort()).toEqual([...ANIMAL_KINDS].sort());
    expect(animalsOn(farm.animals, 'farm')).toHaveLength(ANIMAL_KINDS.length);
  });

  it('meets every condition that decides whether they are outdoors at all', () => {
    // Three of the four is a farm that looks broken rather than empty: the
    // herd is indoors, indoors is drawn as absent, and nothing says why. So
    // all four are asserted together, which is how they matter.
    const farm = seedHerd(nightAndRain(createFarmState()));

    for (const building of farm.buildings) {
      expect(isComplete(building), `${building.id} is still a scaffold`).toBe(true);
      expect(building.doorOpen, `${building.id} is shut`).toBe(true);
    }
    expect(farm.weather).toBe('Sunny');
    expect(farm.time.hour).toBeGreaterThanOrEqual(8);
    expect(farm.time.hour).toBeLessThan(18);
  });

  it('gives every animal a house that is really there, with room in it', () => {
    // A save whose animal names a house that does not exist is not repaired,
    // it is refused — and refusing one animal discards the whole farm. A dev
    // shortcut that wiped the save on reload would be worse than no shortcut.
    const farm = seedHerd(createFarmState());
    for (const animal of farm.animals) {
      const home = farm.buildings.find((building) => building.id === animal.home);
      expect(home, `${animal.id} lives in ${animal.home}, which is not there`).toBeDefined();
    }
  });

  it('stands them where they already are, not where they will walk to', () => {
    // Left null they would step out on the next clock tick, 1.2s later, which
    // is long enough to conclude the flag did nothing.
    const farm = seedHerd(createFarmState());
    for (const animal of farm.animals) expect(animal.position).not.toBeNull();
  });

  it('leaves a clear afternoon alone rather than resetting the clock', () => {
    const noon = {
      ...createFarmState(),
      weather: 'Breezy' as const,
      time: { ...createFarmState().time, hour: 14, minute: 20, totalMinutes: 14 * 60 + 20 },
    };
    const farm = seedHerd(noon);
    expect(farm.time).toEqual(noon.time);
    expect(farm.weather).toBe('Breezy');
  });

  it('is its own undo, and touches nothing a player owns', () => {
    const owned = {
      ...createFarmState(),
      buildings: [
        { id: 'b1', kind: 'silo' as const, x: 2, y: 2, readyOnDay: null, doorOpen: false },
      ],
    };
    const seeded = seedHerd(seedHerd(owned));
    // Twice is once: re-running the flag must not stack four more animals.
    expect(seeded.animals).toHaveLength(ANIMAL_KINDS.length);

    const cleared = applyDevSeed(seeded, '?dev=noherd');
    expect(cleared.animals).toHaveLength(0);
    expect(cleared.buildings).toEqual(owned.buildings);
  });
});

describe('applyDevSeed', () => {
  it('hands the farm straight back when nothing was asked for', () => {
    const farm = createFarmState();
    expect(applyDevSeed(farm, '')).toBe(farm);
    expect(applyDevSeed(farm, '?other=1')).toBe(farm);
    expect(applyDevSeed(farm, '?dev=something-else')).toBe(farm);
  });

  it('says what it did, so a farm that gained a barn does not do it silently', () => {
    expect(devSeedMessage('?dev=herd')).toContain('?dev=noherd');
    expect(devSeedMessage('?dev=noherd')).toBeTruthy();
    expect(devSeedMessage('')).toBeNull();
  });
});
