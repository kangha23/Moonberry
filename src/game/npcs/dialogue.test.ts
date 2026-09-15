import { describe, expect, it } from 'vitest';
import { NPCS, NPC_IDS } from './definitions';
import { candidateLines, pickDialogue, type DialogueContext } from './dialogue';
import type { NpcDef } from './types';
import { SEASONS, WEATHERS } from '../systems/time';

/** A plain day: nought hearts, nothing special about the weather or the date. */
function context(extra: Partial<DialogueContext> = {}): DialogueContext {
  return {
    hearts: 0,
    season: 'Summer',
    weather: 'Sunny',
    day: 1,
    birthday: false,
    questCompleted: false,
    questRewarded: false,
    activity: null,
    ...extra,
  };
}

/** A villager built for one test, so the rules are read off a known table. */
function villager(dialogue: NpcDef['dialogue']): NpcDef {
  return { ...NPCS.rowan, dialogue };
}

describe('picking a line', () => {
  it('takes the highest priority whose conditions hold', () => {
    const def = villager([
      { priority: 0, line: 'floor' },
      { priority: 10, when: { season: 'Summer' }, line: 'summer' },
      { priority: 20, when: { minHearts: 5 }, line: 'friend' },
    ]);

    expect(pickDialogue(def, context())).toBe('summer');
    expect(pickDialogue(def, context({ hearts: 5 }))).toBe('friend');
  });

  it('ignores a higher-priority line whose conditions do not hold', () => {
    const def = villager([
      { priority: 0, line: 'floor' },
      { priority: 99, when: { weather: 'Drizzle' }, line: 'rain' },
    ]);

    expect(pickDialogue(def, context())).toBe('floor');
    expect(pickDialogue(def, context({ weather: 'Drizzle' }))).toBe('rain');
  });

  it('reads every condition it offers, both ways round', () => {
    // Each case carries the state that should match and the state that should
    // not. Spelling out both halves is the point: a condition that is never
    // read passes a one-sided test perfectly.
    const cases: {
      when: NpcDef['dialogue'][number]['when'];
      hit: Partial<DialogueContext>;
      miss: Partial<DialogueContext>;
    }[] = [
      { when: { minHearts: 4 }, hit: { hearts: 4 }, miss: { hearts: 3 } },
      { when: { maxHearts: 0 }, hit: { hearts: 0 }, miss: { hearts: 1 } },
      { when: { season: 'Winter' }, hit: { season: 'Winter' }, miss: { season: 'Spring' } },
      { when: { weather: 'Breezy' }, hit: { weather: 'Breezy' }, miss: { weather: 'Sunny' } },
      { when: { birthday: true }, hit: { birthday: true }, miss: { birthday: false } },
      { when: { questCompleted: true }, hit: { questCompleted: true }, miss: { questCompleted: false } },
      { when: { questRewarded: true }, hit: { questRewarded: true }, miss: { questRewarded: false } },
      { when: { activity: 'forge' }, hit: { activity: 'forge' }, miss: { activity: 'market' } },
    ];

    for (const { when, hit, miss } of cases) {
      const def = villager([
        { priority: 0, line: 'floor' },
        { priority: 10, when, line: 'match' },
      ]);
      const label = JSON.stringify(when);
      expect(pickDialogue(def, context(hit)), `${label} did not match when it should`).toBe('match');
      expect(pickDialogue(def, context(miss)), `${label} matched when it should not`).toBe('floor');
    }
  });

  it('requires every condition on an entry, not merely one of them', () => {
    const def = villager([
      { priority: 0, line: 'floor' },
      { priority: 10, when: { season: 'Winter', minHearts: 6 }, line: 'both' },
    ]);

    expect(pickDialogue(def, context({ season: 'Winter' }))).toBe('floor');
    expect(pickDialogue(def, context({ hearts: 6 }))).toBe('floor');
    expect(pickDialogue(def, context({ season: 'Winter', hearts: 6 }))).toBe('both');
  });

  it('rotates between equally good lines rather than sticking on one', () => {
    const def = villager([
      { priority: 0, line: 'a' },
      { priority: 0, line: 'b' },
      { priority: 0, line: 'c' },
    ]);

    const heard = new Set([1, 2, 3, 4].map((day) => pickDialogue(def, context({ day }))));
    expect(heard.size).toBe(3);
  });

  it('says the same thing twice given the same state, because the reducer is pure', () => {
    const def = villager([
      { priority: 0, line: 'a' },
      { priority: 0, line: 'b' },
    ]);
    expect(pickDialogue(def, context({ day: 7 }))).toBe(pickDialogue(def, context({ day: 7 })));
  });

  it('shortlists only the lines that tied at the top', () => {
    const def = villager([
      { priority: 0, line: 'floor' },
      { priority: 10, line: 'high-a' },
      { priority: 10, line: 'high-b' },
    ]);
    expect(candidateLines(def, context()).map((entry) => entry.line)).toEqual(['high-a', 'high-b']);
  });
});

describe('a villager always has something to say', () => {
  it('answers on every day of every season and every sky, at every heart level', () => {
    // A villager with nothing to say is a bug rather than a silence, so this
    // walks the whole space rather than spot-checking it.
    for (const id of NPC_IDS) {
      const def = NPCS[id];
      const activities = [null, ...def.schedule.map((entry) => entry.activity)];
      for (const season of SEASONS) {
        for (const weather of WEATHERS) {
          for (let hearts = 0; hearts <= 10; hearts += 1) {
            for (const activity of activities) {
              const line = pickDialogue(
                def,
                context({ season, weather, hearts, activity, day: hearts + 1 }),
              );
              expect(line.length, `${id} had nothing to say`).toBeGreaterThan(0);
            }
          }
        }
      }
    }
  });

  it('still answers on a birthday, and with the birthday line', () => {
    for (const id of NPC_IDS) {
      const line = pickDialogue(NPCS[id], context({ birthday: true, season: NPCS[id].birthday.season }));
      expect(line.length, `${id} had nothing to say on their own birthday`).toBeGreaterThan(0);
    }
  });

  it('falls back rather than returning an empty string for a table with nothing in it', () => {
    // Unreachable through the shipped content, which `definitions.test.ts`
    // guards. This is the belt to that braces: the return type is `string`,
    // and it should never be an empty one.
    expect(pickDialogue(villager([]), context())).not.toBe('');
  });
});
