/**
 * The clock: how long a step is, how many minutes it is worth, and the tick
 * that walks the village, the herd and the day forward on it.
 */
import { advanceAnimals } from '../../systems/animals';
import { advanceNpcs } from '../../npcs/schedule';
import { advanceTime } from '../../systems/time';
import type { ApplyResult, GameEvent } from '../intents';
import type { FarmState } from '../types';
import { stillAwake, startNewDay, collapse, rollIfEveryoneAsleep } from './day';
import { advanceFishing } from './fishing';

/**
 * Real milliseconds per in-game clock step.
 *
 * Exported because the renderer has to know it: everything the reducer walks —
 * the herd, the villagers — moves a whole step at a time on this beat, and the
 * frames in between are drawn by interpolating across exactly this long. See
 * `view/tickChase.ts`. Two copies of this number would drift into a walk that
 * finishes early and stutters.
 */
export const CLOCK_STEP_MS = 1200;
/**
 * In-game minutes added per clock step, and therefore how long a day lasts.
 *
 * Two minutes every 1.2 seconds is ten minutes every six, which puts 6am to 2am
 * at twelve real minutes — Stardew's own day is fourteen. It was ten minutes a
 * step once, and that made a whole day two and a half minutes long: not enough
 * to walk to the village, talk to two people and walk back, let alone farm.
 *
 * The beat stays at `CLOCK_STEP_MS` and only the minutes shrink, because the
 * beat is what the renderer interpolates the herd and the villagers across.
 * Their speeds are per in-game minute, so they were raised by the same factor
 * of five and still cover exactly the pixels per beat they always did.
 */
export const CLOCK_STEP_MINUTES = 2;

/** Guards against a long stall replaying hundreds of clock steps at once. */
const MAX_TICK_MS = 5000;

export function applyTick(state: FarmState, deltaMs: number): ApplyResult {
  const elapsed = Math.min(deltaMs, MAX_TICK_MS);

  // The casts move first, and on the frame delta rather than the clock step.
  // This is the one simulation in the game that does not wait for the ten
  // minute hand: everything else here happens on the hour, and a bite window
  // that could only open on the hour would be a metronome.
  const fished = advanceFishing(state, elapsed);
  const fishEvents = fished.events;

  const clockMs = fished.state.clockMs + elapsed;
  if (clockMs < CLOCK_STEP_MS) {
    return { state: { ...fished.state, clockMs }, events: fishEvents };
  }

  const steps = Math.floor(clockMs / CLOCK_STEP_MS);
  let next: FarmState = {
    ...fished.state,
    clockMs: clockMs % CLOCK_STEP_MS,
    revision: fished.state.revision + 1,
  };
  const events: GameEvent[] = [...fishEvents];

  for (let i = 0; i < steps; i += 1) {
    const advanced = advanceTime(next.time, CLOCK_STEP_MINUTES);
    if (advanced.newDay) {
      // 02:00. Anybody still standing collapses; a farm nobody is awake on
      // simply turns over, because nobody stayed up to be charged for it.
      const rolled = stillAwake(next).length > 0 ? collapse(next) : startNewDay(next);
      // The roll resets clockMs; keep the remainder we already banked.
      next = { ...rolled.state, clockMs: next.clockMs };
      events.push(...rolled.events);
      continue;
    }

    next = { ...next, time: advanced.time };

    // The village moves on the clock step rather than the frame. Ten in-game
    // minutes of walking is a short hop, and the renderer smooths between the
    // hops — which keeps six villagers out of the state on every frame and
    // off the wire on every tick.
    const walked = advanceNpcs(next.npcs, next.season, next.weather, next.time, CLOCK_STEP_MINUTES);
    if (walked !== next.npcs) next = { ...next, npcs: walked };

    // The herd grazes on the same step and for the same reasons. Fourteen
    // animals is smaller than the six villagers already cost, and the walk
    // is a pure function of the clock, so two clients simulating the same
    // farm draw the same herd in the same places with nothing sent to say so.
    const grazed = advanceAnimals(
      next.animals,
      next.buildings,
      next.nodes,
      next.placeables,
      next.weather,
      next.time,
      CLOCK_STEP_MINUTES,
    );
    if (grazed !== next.animals) next = { ...next, animals: grazed };

    const slept = rollIfEveryoneAsleep(next);
    if (slept) {
      next = { ...slept.state, clockMs: next.clockMs };
      events.push(...slept.events);
    }
  }

  return { state: next, events };
}
