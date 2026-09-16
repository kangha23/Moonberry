import { describe, expect, it } from 'vitest';
import { NPCS, NPC_IDS, isNpcId, npcDef } from './definitions';
import { entryPosition, scheduleIndexAt } from './schedule';
import { isGiftable, reactionTo } from './relationships';
import { SEASONS, SEASON_DAYS, WEATHERS } from '../systems/time';
import { INTERACT_RADIUS, isWalkable } from '../world/areas';

/** Every hour the day actually runs for: 6am through to the 2am cutoff. */
const HOURS = Array.from({ length: 20 }, (_, index) => index + 6);

describe('the cast', () => {
  it('has enough people in it for the village to read as populated', () => {
    // Four is the floor in the spec and five is what shipped. The test is
    // here so that trimming the cast is a decision rather than an accident.
    expect(NPC_IDS.length).toBeGreaterThanOrEqual(4);
  });

  it('keys every villager by their own id', () => {
    for (const id of NPC_IDS) expect(NPCS[id].id).toBe(id);
  });

  it('recognises its own ids and nothing else', () => {
    for (const id of NPC_IDS) expect(isNpcId(id)).toBe(true);
    expect(isNpcId('mayor')).toBe(false);
    expect(isNpcId(7)).toBe(false);
    // `Object.hasOwn` rather than `in`, so the prototype is not a villager.
    expect(isNpcId('toString')).toBe(false);
  });

  it('gives everybody a birthday on a day that exists', () => {
    for (const id of NPC_IDS) {
      const { birthday } = NPCS[id];
      expect(SEASONS).toContain(birthday.season);
      expect(birthday.day).toBeGreaterThanOrEqual(1);
      expect(birthday.day).toBeLessThanOrEqual(SEASON_DAYS);
    }
  });

  it('spreads the birthdays out, so the calendar is worth reading all year', () => {
    const seasons = new Set(NPC_IDS.map((id) => NPCS[id].birthday.season));
    expect(seasons.size).toBeGreaterThanOrEqual(3);
  });

  it('only names gifts that are items, and items that can actually be given', () => {
    for (const id of NPC_IDS) {
      for (const item of Object.keys(NPCS[id].gifts)) {
        expect(isGiftable(item), `${id} reacts to "${item}", which cannot be given`).toBe(true);
      }
    }
  });
});

describe('every schedule', () => {
  it('covers every hour of every day, in every season and weather', () => {
    // A villager with a gap in their day would stop where they were and the
    // hole would only show up as somebody standing in a field at midnight.
    for (const id of NPC_IDS) {
      for (const season of SEASONS) {
        for (const weather of WEATHERS) {
          for (const hour of HOURS) {
            const index = scheduleIndexAt(NPCS[id], season, weather, hour);
            expect(index, `${id} has nowhere to be at ${hour}:00, ${season}, ${weather}`).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
  });

  it('sends everybody somewhere they could actually stand', () => {
    // These coordinates are chosen by hand against a map that gets edited.
    // A stop inside the pond or under a cottage would put a villager
    // somewhere unreachable, which is a bug nobody sees until they go looking.
    for (const id of NPC_IDS) {
      for (const entry of NPCS[id].schedule) {
        const spot = entryPosition(entry);
        expect(
          isWalkable(entry.area, spot.x, spot.y),
          `${id} is sent to ${entry.x},${entry.y} on ${entry.area}, where nobody can stand`,
        ).toBe(true);
      }
    }
  });

  it('leaves room to walk up to everybody at every stop', () => {
    // Standing on a tile is not the same as being reachable: a stop wedged
    // against a wall would be a villager you can see and never greet.
    for (const id of NPC_IDS) {
      for (const entry of NPCS[id].schedule) {
        const spot = entryPosition(entry);
        const neighbours = [
          { x: spot.x, y: spot.y + 24 },
          { x: spot.x, y: spot.y - 24 },
          { x: spot.x + 24, y: spot.y },
          { x: spot.x - 24, y: spot.y },
        ];
        const reachable = neighbours.some(
          (near) =>
            isWalkable(entry.area, near.x, near.y) &&
            Math.hypot(near.x - spot.x, near.y - spot.y) < INTERACT_RADIUS,
        );
        expect(reachable, `nowhere to stand to greet ${id} at ${entry.x},${entry.y}`).toBe(true);
      }
    }
  });

  it('runs its hours forwards', () => {
    for (const id of NPC_IDS) {
      for (const entry of NPCS[id].schedule) {
        expect(entry.toHour, `${id} has a stop that ends before it starts`).toBeGreaterThan(entry.fromHour);
      }
    }
  });
});

describe('every dialogue table', () => {
  it('carries a line with no conditions on it, so nobody can run out of things to say', () => {
    for (const id of NPC_IDS) {
      const unconditional = NPCS[id].dialogue.filter((entry) => entry.when === undefined);
      expect(unconditional.length, `${id} could be asked something and have no answer`).toBeGreaterThan(0);
    }
  });

  it('is long enough to bear repeating', () => {
    for (const id of NPC_IDS) {
      expect(NPCS[id].dialogue.length, `${id} has too little to say`).toBeGreaterThanOrEqual(20);
    }
  });

  it('never repeats a line within one villager', () => {
    for (const id of NPC_IDS) {
      const lines = NPCS[id].dialogue.map((entry) => entry.line);
      expect(new Set(lines).size, `${id} says the same thing twice`).toBe(lines.length);
    }
  });

  it('only keys activities that the villager actually has', () => {
    // A condition on an activity nobody is ever doing is a line that can never
    // be said, which is the quietest possible way to lose written content.
    for (const id of NPC_IDS) {
      const activities = new Set(NPCS[id].schedule.map((entry) => entry.activity));
      for (const entry of NPCS[id].dialogue) {
        if (entry.when?.activity === undefined) continue;
        expect(
          activities.has(entry.when.activity),
          `${id} has a line for "${entry.when.activity}", which is not on their schedule`,
        ).toBe(true);
      }
    }
  });

  it('gives exactly one villager the quest, since there is one quest', () => {
    const givers = NPC_IDS.filter((id) => npcDef(id).questGiver);
    expect(givers).toEqual(['rowan']);
  });
});

describe('the phố’s dishes as gifts, spec 15', () => {
  const RANK = ['hated', 'disliked', 'neutral', 'liked', 'loved'];

  it('has every villager at least like a bánh chưng', () => {
    for (const id of NPC_IDS) {
      const reaction = reactionTo(NPCS[id], 'banh-chung');
      expect(RANK.indexOf(reaction), `${id} is ${reaction} about a bánh chưng`).toBeGreaterThanOrEqual(RANK.indexOf('liked'));
    }
  });

  it('has Bà Xoan love her own xôi and a bánh chưng, and Juniper and Ash love chè', () => {
    expect(reactionTo(NPCS.xoan, 'xoi-dau')).toBe('loved');
    expect(reactionTo(NPCS.xoan, 'banh-chung')).toBe('loved');
    expect(reactionTo(NPCS.juniper, 'che-dau')).toBe('loved');
    expect(reactionTo(NPCS.ash, 'che-dau')).toBe('loved');
  });

  it('can give all three', () => {
    for (const dish of ['banh-chung', 'xoi-dau', 'che-dau']) expect(isGiftable(dish)).toBe(true);
  });
});
