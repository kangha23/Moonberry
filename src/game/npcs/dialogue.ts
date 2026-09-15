import type { Season, Weather } from '../systems/time';
import type { DialogueCondition, DialogueEntry, NpcDef } from './types';

/**
 * Everything a line is allowed to know about.
 *
 * Assembled by the reducer rather than read from `FarmState` here, which keeps
 * this module — and the whole `npcs/` folder — free of any dependency on the
 * shape of the farm. Content should not have to know what a `FarmState` is.
 */
export interface DialogueContext {
  hearts: number;
  season: Season;
  weather: Weather;
  /** The absolute day, used only to rotate between equally good lines. */
  day: number;
  birthday: boolean;
  questCompleted: boolean;
  questRewarded: boolean;
  /** What their schedule has them doing, or null if it has them nowhere. */
  activity: string | null;
}

function matches(when: DialogueCondition | undefined, context: DialogueContext): boolean {
  if (!when) return true;
  if (when.minHearts !== undefined && context.hearts < when.minHearts) return false;
  if (when.maxHearts !== undefined && context.hearts > when.maxHearts) return false;
  if (when.season !== undefined && when.season !== context.season) return false;
  if (when.weather !== undefined && when.weather !== context.weather) return false;
  if (when.birthday !== undefined && when.birthday !== context.birthday) return false;
  if (when.questCompleted !== undefined && when.questCompleted !== context.questCompleted) return false;
  if (when.questRewarded !== undefined && when.questRewarded !== context.questRewarded) return false;
  if (when.activity !== undefined && when.activity !== context.activity) return false;
  return true;
}

/**
 * Every line this villager could say right now, best first.
 *
 * Exported because the tests want to see the shortlist rather than only the
 * winner: "the highest-priority line whose conditions hold" is much easier to
 * believe when you can look at what it was choosing between.
 */
export function candidateLines(def: NpcDef, context: DialogueContext): DialogueEntry[] {
  const allowed = def.dialogue.filter((entry) => matches(entry.when, context));
  if (allowed.length === 0) return [];
  const best = Math.max(...allowed.map((entry) => entry.priority));
  return allowed.filter((entry) => entry.priority === best);
}

/**
 * What they say.
 *
 * The highest-priority line whose conditions hold, and where several tie, one
 * chosen by the day so a villager standing in the same place all season is not
 * a recording. Derived from state rather than random, because the reducer is
 * pure and the server and an offline browser have to agree on what was said.
 *
 * Never empty. A villager with nothing to say is a bug rather than a silence,
 * so every definition carries an unconditional line and `definitions.test.ts`
 * refuses to let one ship without it; the last resort below exists only so
 * that this function's type can be `string`.
 */
export function pickDialogue(def: NpcDef, context: DialogueContext): string {
  const shortlist = candidateLines(def, context);
  if (shortlist.length === 0) return `${def.name} gật đầu, và không nói gì.`;
  const index = ((context.day % shortlist.length) + shortlist.length) % shortlist.length;
  return shortlist[index].line;
}
