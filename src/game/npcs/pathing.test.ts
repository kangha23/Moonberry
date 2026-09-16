import { describe, expect, it } from 'vitest';
import { SEASONS, WEATHERS } from '../systems/time';
import { AREAS, TILE_SIZE, isWalkable } from '../world/areas';
import { NPCS, NPC_IDS } from './definitions';
import { waypointToward, walkToward } from './pathing';
import { NPC_SPEED_PER_MINUTE, entryPosition, scheduleIndexAt } from './schedule';

/** What one clock step walks a villager: two in-game minutes. */
const STEP = NPC_SPEED_PER_MINUTE * 2;

const centre = (x: number, y: number) => ({ x: x * TILE_SIZE + TILE_SIZE / 2, y: y * TILE_SIZE + TILE_SIZE / 2 });

/** Every point along a straight line, a few pixels apart, is somewhere feet can be. */
function lineIsWalkable(from: { x: number; y: number }, to: { x: number; y: number }): boolean {
  const samples = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 4));
  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples;
    if (!isWalkable('village', from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t)) return false;
  }
  return true;
}

/** Every change of post in every villager's day, in every season and weather, once each. */
function everyLeg() {
  const legs = new Map<string, { id: string; from: { x: number; y: number }; to: { x: number; y: number } }>();
  for (const id of NPC_IDS) {
    for (const season of SEASONS) {
      for (const weather of WEATHERS) {
        let previous = -1;
        for (let hour = 6; hour < 26; hour += 1) {
          const index = scheduleIndexAt(NPCS[id], season, weather, hour);
          if (index >= 0 && previous >= 0 && index !== previous) {
            const from = entryPosition(NPCS[id].schedule[previous]);
            const to = entryPosition(NPCS[id].schedule[index]);
            legs.set(`${id} ${from.x},${from.y} ${to.x},${to.y}`, { id, from, to });
          }
          if (index >= 0) previous = index;
        }
      }
    }
  }
  return [...legs.values()];
}

describe('walking round things instead of through them', () => {
  it('never draws a villager crossing anything solid, on any leg of anybody\'s day', () => {
    // The renderer draws each clock step as one straight line, so it is the
    // line between consecutive positions that has to stay clear — not only
    // the positions themselves. Before this, thirteen legs went through the
    // well, the forge or somebody's own house.
    const legs = everyLeg();
    expect(legs.length).toBeGreaterThan(10);

    for (const leg of legs) {
      let at = leg.from;
      let steps = 0;
      while ((at.x !== leg.to.x || at.y !== leg.to.y) && steps < 200) {
        const next = walkToward('village', at, leg.to, STEP);
        expect(
          lineIsWalkable(at, next),
          `${leg.id} walks through something between ${Math.round(at.x)},${Math.round(at.y)} and ${Math.round(next.x)},${Math.round(next.y)}`,
        ).toBe(true);
        at = next;
        steps += 1;
      }
      expect({ x: at.x, y: at.y }, `${leg.id} never reaches ${leg.to.x},${leg.to.y}`).toEqual({ x: leg.to.x, y: leg.to.y });
    }
  });

  it('still takes the diagonal across open ground', () => {
    // Ash's walk from the green to the well has nothing in the way, and should
    // not be sent round a staircase of tiles to get there.
    const from = centre(6, 17);
    const to = centre(13, 11);
    expect(lineIsWalkable(from, to)).toBe(true);
    expect(waypointToward('village', from, to)).toEqual(to);

    const moved = walkToward('village', from, to, STEP);
    expect(Math.hypot(moved.x - from.x, moved.y - from.y)).toBeCloseTo(STEP, 6);
  });

  it('goes round the well rather than through it', () => {
    const well = AREAS.village.props.find((prop) => prop.name === 'well')!;
    const north = { x: well.x + well.width / 2, y: well.y - TILE_SIZE / 2 };
    const south = { x: well.x + well.width / 2, y: well.y + well.height + TILE_SIZE / 2 };

    const waypoint = waypointToward('village', north, south);
    expect(waypoint).not.toEqual(south);
    expect(lineIsWalkable(north, waypoint)).toBe(true);
  });

  it('keeps the old straight walk when there is no route at all', () => {
    // Standing inside the forge is not somewhere the schedules ever put
    // anybody, but an old save could. Freezing them there would be worse.
    const forge = AREAS.village.props.find((prop) => prop.name === 'blacksmith')!;
    const inside = { x: forge.x + TILE_SIZE / 2, y: forge.y + TILE_SIZE / 2 };
    const to = centre(10, 13);
    expect(waypointToward('village', inside, to)).toEqual(to);
  });

  it('is the same walk every time', () => {
    const from = centre(12, 7);
    const to = centre(13, 11);
    expect(walkToward('village', from, to, STEP)).toEqual(walkToward('village', from, to, STEP));
  });
});
