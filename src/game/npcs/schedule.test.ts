import { describe, expect, it } from 'vitest';
import { NPCS } from './definitions';
import {
  NPC_SPEED_PER_MINUTE,
  advanceNpcs,
  entryPosition,
  npcsOn,
  scheduleEntryAt,
  scheduleIndexAt,
  spawnNpcs,
  type NpcActor,
} from './schedule';
import { scheduleHour } from './types';
import { createTimeState } from '../systems/time';
import { TILE_SIZE } from '../world/areas';

/** The clock at a given hour of the day. */
function at(hour: number) {
  return createTimeState(1, hour * 60);
}

describe('the hour a schedule is read against', () => {
  it('counts on past midnight instead of wrapping back to zero', () => {
    // The day runs to 02:00. `time.hour` is a wall clock and reads 1 at
    // 25:00, which would make an evening entry stop matching exactly when the
    // village should be indoors. This is the whole reason the helper exists.
    expect(scheduleHour(at(22))).toBe(22);
    expect(scheduleHour(at(25))).toBe(25);
    expect(at(25).hour).toBe(1);
  });
});

describe('picking the entry in force', () => {
  it('puts a villager where their schedule says for the hour', () => {
    const maeve = NPCS.maeve;
    const morning = scheduleEntryAt(maeve, 'Summer', 'Sunny', 7);
    const working = scheduleEntryAt(maeve, 'Summer', 'Sunny', 12);

    expect(morning?.activity).toBe('home');
    expect(working?.activity).toBe('forge');
  });

  it('lets a weather override win, because it is listed first', () => {
    // First match wins, and the wet-weather rows are at the top. Maeve does
    // not work an open yard in the rain.
    const wet = scheduleEntryAt(NPCS.maeve, 'Summer', 'Drizzle', 12);
    const dry = scheduleEntryAt(NPCS.maeve, 'Summer', 'Sunny', 12);

    expect(wet?.activity).toBe('home');
    expect(dry?.activity).toBe('forge');
  });

  it('lets a season override win the same way', () => {
    const winter = scheduleEntryAt(NPCS.rowan, 'Winter', 'Sunny', 18);
    const summer = scheduleEntryAt(NPCS.rowan, 'Summer', 'Sunny', 18);

    expect(winter?.activity).toBe('home');
    expect(summer?.activity).toBe('well');
  });

  it('sends the same villager to different places for different weather', () => {
    // Juniper is indoors in the drizzle and at the pond in a firefly shower,
    // which is the pair that proves weather is read and not merely accepted.
    const wet = scheduleEntryAt(NPCS.juniper, 'Summer', 'Drizzle', 12);
    const lit = scheduleEntryAt(NPCS.juniper, 'Summer', 'Firefly Shower', 12);

    expect(wet?.activity).toBe('home');
    expect(lit?.activity).toBe('pond');
    expect(wet).not.toEqual(lit);
  });

  it('reports no entry for an hour nobody is awake for', () => {
    expect(scheduleIndexAt(NPCS.rowan, 'Summer', 'Sunny', 3)).toBe(-1);
  });

  it('puts a villager at the middle of the tile, not its corner', () => {
    const entry = NPCS.rowan.schedule[0];
    const place = entryPosition(entry);
    expect(place.x).toBe(entry.x * TILE_SIZE + TILE_SIZE / 2);
    expect(place.y).toBe(entry.y * TILE_SIZE + TILE_SIZE / 2);
  });
});

describe('spawning the village', () => {
  it('stands everybody at the post their schedule gives them', () => {
    const npcs = spawnNpcs('Summer', 'Sunny', at(12));
    expect(npcs).toHaveLength(Object.keys(NPCS).length);

    for (const actor of npcs) {
      const entry = scheduleEntryAt(NPCS[actor.id], 'Summer', 'Sunny', 12)!;
      expect(entryPosition(entry)).toEqual({ area: actor.area, x: actor.x, y: actor.y });
    }
  });

  it('puts a different village on the map at a different hour', () => {
    const morning = spawnNpcs('Summer', 'Sunny', at(7));
    const midday = spawnNpcs('Summer', 'Sunny', at(12));
    expect(morning).not.toEqual(midday);
  });

  it('keeps everybody in the village, which is the only place anybody lives', () => {
    for (const actor of spawnNpcs('Spring', 'Sunny', at(12))) {
      expect(actor.area).toBe('village');
    }
    expect(npcsOn(spawnNpcs('Spring', 'Sunny', at(12)), 'farm')).toEqual([]);
  });
});

describe('walking a villager toward where they should be', () => {
  it('moves them the distance their speed allows, and no further', () => {
    const npcs = spawnNpcs('Summer', 'Sunny', at(7));
    // Ten in-game minutes later, and now at an hour whose post is elsewhere.
    const walked = advanceNpcs(npcs, 'Summer', 'Sunny', at(12), 10);

    const before = npcs.find((actor) => actor.id === 'maeve')!;
    const after = walked.find((actor) => actor.id === 'maeve')!;
    const moved = Math.hypot(after.x - before.x, after.y - before.y);

    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeCloseTo(NPC_SPEED_PER_MINUTE * 10, 6);
  });

  it('arrives rather than overshooting, and then stops dead', () => {
    let npcs = spawnNpcs('Summer', 'Sunny', at(7));
    const target = entryPosition(scheduleEntryAt(NPCS.maeve, 'Summer', 'Sunny', 12)!);

    // Long enough to cross the village several times over.
    for (let step = 0; step < 60; step += 1) {
      npcs = advanceNpcs(npcs, 'Summer', 'Sunny', at(12), 10);
    }

    const maeve = npcs.find((actor) => actor.id === 'maeve')!;
    expect(maeve.x).toBe(target.x);
    expect(maeve.y).toBe(target.y);

    // Standing still is the same array, so nothing downstream re-renders.
    expect(advanceNpcs(npcs, 'Summer', 'Sunny', at(12), 10)).toBe(npcs);
  });

  it('records which entry they are walking to', () => {
    const npcs = advanceNpcs(spawnNpcs('Summer', 'Sunny', at(7)), 'Summer', 'Sunny', at(12), 10);
    const maeve = npcs.find((actor) => actor.id === 'maeve')!;
    expect(maeve.entry).toBe(scheduleIndexAt(NPCS.maeve, 'Summer', 'Sunny', 12));
  });

  it('leaves somebody with nowhere to be exactly where they stand', () => {
    const npcs = spawnNpcs('Summer', 'Sunny', at(12));
    // 3am: everybody is off-schedule, so nobody moves and nothing is rebuilt.
    expect(advanceNpcs(npcs, 'Summer', 'Sunny', at(3), 10)).toBe(npcs);
  });

  it('is the same walk every time, given the same state', () => {
    // The reducer is pure, and the server and an offline browser have to put
    // the village in the same place from the same inputs.
    const start = spawnNpcs('Autumn', 'Breezy', at(9));
    const once = advanceNpcs(start, 'Autumn', 'Breezy', at(16), 10);
    const twice = advanceNpcs(start, 'Autumn', 'Breezy', at(16), 10);
    expect(once).toEqual(twice);
  });

  it('simply arrives when the entry is on another map', () => {
    // Nobody crosses areas today, so this is built by hand: walking there in
    // a straight line would take them through the fence.
    const stray: NpcActor = { id: 'rowan', area: 'farm', x: 40, y: 40, entry: 0 };
    const walked = advanceNpcs([stray], 'Summer', 'Sunny', at(12), 10);
    const entry = scheduleEntryAt(NPCS.rowan, 'Summer', 'Sunny', 12)!;

    expect(walked[0].area).toBe(entry.area);
    expect({ x: walked[0].x, y: walked[0].y }).toEqual({
      x: entryPosition(entry).x,
      y: entryPosition(entry).y,
    });
  });
});
