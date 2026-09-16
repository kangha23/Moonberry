import type { Season, TimeState, Weather } from '../systems/time';
import { TILE_SIZE, type AreaId } from '../world/areas';
import { NPCS, NPC_IDS } from './definitions';
import { scheduleHour, type NpcDef, type NpcId, type ScheduleEntry } from './types';

/**
 * Where a villager is right now.
 *
 * Deliberately four fields. NPC positions are world state — the server
 * simulates them once and everybody sees the same village — so they travel on
 * the wire and into the database on every change, and every field here is one
 * that has to earn its place.
 */
export interface NpcActor {
  id: NpcId;
  area: AreaId;
  /** World pixels, like a player's. */
  x: number;
  y: number;
  /** Which schedule entry they are walking to, or -1 when none matches. */
  entry: number;
}

/**
 * How fast a villager walks, in world pixels per in-game minute.
 *
 * A shade under the player's pace on purpose: you should be able to catch
 * somebody up, because a villager you can never reach is a schedule that reads
 * as a taunt. Positions only move on a clock step, which is every 1.2 real
 * seconds — the renderer smooths between them rather than the state carrying a
 * position per frame. A step is two in-game minutes, so this is 120 world
 * pixels a step, or a hundred a real second.
 */
export const NPC_SPEED_PER_MINUTE = 60;

/** The middle of a tile, which is where a schedule entry actually puts somebody. */
export function entryPosition(entry: ScheduleEntry): { area: AreaId; x: number; y: number } {
  return {
    area: entry.area,
    x: entry.x * TILE_SIZE + TILE_SIZE / 2,
    y: entry.y * TILE_SIZE + TILE_SIZE / 2,
  };
}

/**
 * Which schedule entry is in force, as an index into the villager's own list.
 *
 * First match wins. That is the entire rule: entries that name a season or a
 * weather are listed first and so take precedence, and the everyday rows are
 * the fallback underneath. No scoring, nothing to tie-break, and a schedule
 * that reads top to bottom the way it behaves.
 */
export function scheduleIndexAt(
  def: NpcDef,
  season: Season,
  weather: Weather,
  hour: number,
): number {
  return def.schedule.findIndex(
    (entry) =>
      hour >= entry.fromHour &&
      hour < entry.toHour &&
      (entry.season === undefined || entry.season === season) &&
      (entry.weather === undefined || entry.weather === weather),
  );
}

/** The entry in force, or null if the villager has nowhere to be. */
export function scheduleEntryAt(
  def: NpcDef,
  season: Season,
  weather: Weather,
  hour: number,
): ScheduleEntry | null {
  const index = scheduleIndexAt(def, season, weather, hour);
  return index < 0 ? null : def.schedule[index];
}

/** What a villager is doing right now, for dialogue and the hover label. */
export function activityAt(
  def: NpcDef,
  season: Season,
  weather: Weather,
  time: TimeState,
): string | null {
  return scheduleEntryAt(def, season, weather, scheduleHour(time))?.activity ?? null;
}

/**
 * What each activity is called when a villager's own name is not enough.
 *
 * The `activity` strings in a schedule are identifiers: dialogue conditions
 * key on them, so they stay English and only this table is translated. An
 * activity with no row here simply has nothing said about it, which is how a
 * new one behaves until somebody writes its line.
 */
const ACTIVITY_LABELS: Record<string, string> = {
  home: 'đang ở nhà',
  well: 'đang ở bên giếng',
  market: 'đang ở ngoài chợ',
  forge: 'đang bên lò rèn',
  lane: 'đang đi dạo ngoài đường',
  stocking: 'đang dỡ hàng',
  foraging: 'đang đi hái lượm',
  pond: 'đang ở bên ao',
  ranch: 'đang ở bãi quây gia súc',
  green: 'đang ngoài bãi cỏ',
  'stuck-in': 'đang bị nhốt trong nhà',
};

/** What a villager is doing right now, in words the prompt bar can use. */
export function activityLabel(activity: string | null): string | null {
  return activity ? (ACTIVITY_LABELS[activity] ?? null) : null;
}

/**
 * Everybody, standing where the schedule says they should be.
 *
 * Used to start a farm and to start a morning: at dawn a villager is at their
 * 6am post rather than wherever last night left them, which saves the valley
 * from waking up with Ash stranded halfway across it.
 */
export function spawnNpcs(season: Season, weather: Weather, time: TimeState): NpcActor[] {
  const hour = scheduleHour(time);
  return NPC_IDS.map((id) => {
    const def = NPCS[id];
    const entry = scheduleIndexAt(def, season, weather, hour);
    const place = entry < 0 ? entryPosition(def.schedule[0]) : entryPosition(def.schedule[entry]);
    return { id, entry, ...place };
  });
}

/**
 * Walk everybody a little way toward wherever they are supposed to be.
 *
 * A straight line, which is all the village needs: it is open ground and the
 * only solid things in it are wide enough to walk around by accident. The seam
 * for A* is right here and nowhere else — the day there is an indoor area with
 * a doorway, this function is the one that has to get cleverer, and nothing
 * that calls it has to change.
 *
 * Returns the same array when nobody moved, so the renderer and the store can
 * compare by identity instead of diffing six villagers every frame.
 */
export function advanceNpcs(
  npcs: readonly NpcActor[],
  season: Season,
  weather: Weather,
  time: TimeState,
  minutes: number,
): NpcActor[] {
  const hour = scheduleHour(time);
  const step = NPC_SPEED_PER_MINUTE * minutes;
  let changed = false;

  const next = npcs.map((actor) => {
    const def = NPCS[actor.id];
    const entry = scheduleIndexAt(def, season, weather, hour);
    if (entry < 0) return actor;

    const target = entryPosition(def.schedule[entry]);

    // A different map means they went through a door while nobody was
    // watching. Walking there in a straight line would take them across the
    // valley and through the fence, so they simply arrive.
    if (target.area !== actor.area) {
      changed = true;
      return { ...actor, entry, ...target };
    }

    const dx = target.x - actor.x;
    const dy = target.y - actor.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= step) {
      if (actor.x === target.x && actor.y === target.y && actor.entry === entry) return actor;
      changed = true;
      return { ...actor, entry, ...target };
    }

    changed = true;
    return {
      ...actor,
      entry,
      x: actor.x + (dx / distance) * step,
      y: actor.y + (dy / distance) * step,
    };
  });

  return changed ? next : (npcs as NpcActor[]);
}

/** The villagers standing on one map, which is all the renderer ever wants. */
export function npcsOn(npcs: readonly NpcActor[], area: AreaId): NpcActor[] {
  return npcs.filter((actor) => actor.area === area);
}
