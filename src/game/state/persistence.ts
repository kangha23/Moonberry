import type { PlotStage, PlotState } from '../systems/farming';
import type { CropId, Satchel } from '../systems/satchel';
import type { Season, Weather } from '../systems/time';
import { isAreaId } from '../world/areas';
import type { Direction } from '../world/areas';
import type { FarmState, PlayerState, Tool } from './types';

/**
 * Bumped whenever the shape of FarmState changes in a way an older save
 * cannot satisfy. `migrate` is where upgrades from earlier versions go.
 */
export const SAVE_VERSION = 1;

export const SAVE_KEY = 'moonberry:farm';

export interface SaveEnvelope {
  version: number;
  savedAt: string;
  farm: FarmState;
}

/**
 * Where a save lives. localStorage today; the server will supply a database
 * adapter with the same three methods and nothing else needs to change.
 */
export interface SaveStorage {
  read(key: string): string | null;
  write(key: string, value: string): void;
  remove(key: string): void;
}

/**
 * localStorage. It can throw on every method (private windows, blocked site
 * data, exceeded quota); the public helpers below absorb that, so adapters
 * are free to be written in the obvious way.
 */
export const localSaveStorage: SaveStorage = {
  read: (key) => globalThis.localStorage?.getItem(key) ?? null,
  write: (key, value) => globalThis.localStorage?.setItem(key, value),
  remove: (key) => globalThis.localStorage?.removeItem(key),
};

// --- validation -------------------------------------------------------------
//
// A save is untrusted input: anyone can edit localStorage by hand, and a save
// written by an older build may be missing fields. Every value is checked
// before it becomes game state, and anything unexpected discards the whole
// save rather than booting a half-valid farm.

const PLOT_STAGES: readonly PlotStage[] = ['wild', 'tilled', 'seeded', 'sprout', 'mature'];
const CROP_IDS: readonly CropId[] = ['turnip', 'strawberry'];
const SEASONS: readonly Season[] = ['Spring', 'Summer', 'Autumn', 'Winter'];
const WEATHERS: readonly Weather[] = ['Sunny', 'Drizzle', 'Breezy', 'Firefly Shower'];
const TOOLS: readonly Tool[] = ['hoe', 'seed', 'water', 'harvest', 'inspect'];
const DIRECTIONS: readonly Direction[] = ['up', 'down', 'left', 'right'];

type Unknown = Record<string, unknown>;

function isObject(value: unknown): value is Unknown {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isCount(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

function parseCropCounts(value: unknown): Record<CropId, number> | null {
  if (!isObject(value)) return null;
  const counts = {} as Record<CropId, number>;
  for (const crop of CROP_IDS) {
    if (!isCount(value[crop])) return null;
    counts[crop] = value[crop];
  }
  return counts;
}

function parseSatchel(value: unknown): Satchel | null {
  if (!isObject(value)) return null;
  const seeds = parseCropCounts(value.seeds);
  const crops = parseCropCounts(value.crops);
  if (!seeds || !crops) return null;
  if (!isCount(value.water) || !isCount(value.wood)) return null;
  return { seeds, crops, water: value.water, wood: value.wood };
}

function parsePlot(value: unknown): PlotState | null {
  if (!isObject(value)) return null;
  if (!isFiniteNumber(value.x) || !isFiniteNumber(value.y)) return null;
  if (!oneOf(value.stage, PLOT_STAGES)) return null;
  if (value.crop !== null && !oneOf(value.crop, CROP_IDS)) return null;
  if (!isCount(value.daysWatered) || typeof value.wateredToday !== 'boolean') return null;
  return {
    x: value.x,
    y: value.y,
    stage: value.stage,
    crop: value.crop as CropId | null,
    daysWatered: value.daysWatered,
    wateredToday: value.wateredToday,
  };
}

function parsePlayer(value: unknown): PlayerState | null {
  if (!isObject(value)) return null;
  if (typeof value.id !== 'string' || typeof value.name !== 'string') return null;
  if (!isFiniteNumber(value.x) || !isFiniteNumber(value.y)) return null;
  if (!oneOf(value.facing, DIRECTIONS)) return null;
  // An area that no longer exists would strand the player on a missing map,
  // so a save naming one is discarded rather than silently relocated.
  if (!isAreaId(value.area)) return null;
  if (!oneOf(value.tool, TOOLS)) return null;
  if (!oneOf(value.seed, CROP_IDS)) return null;
  if (typeof value.asleep !== 'boolean') return null;
  const satchel = parseSatchel(value.satchel);
  if (!satchel) return null;
  return {
    id: value.id,
    name: value.name,
    area: value.area,
    x: value.x,
    y: value.y,
    facing: value.facing,
    tool: value.tool,
    seed: value.seed,
    satchel,
    asleep: value.asleep,
  };
}

function parseTime(value: unknown): FarmState['time'] | null {
  if (!isObject(value)) return null;
  const { day, hour, minute, totalMinutes } = value;
  if (!isCount(day) || !isCount(hour) || !isCount(minute) || !isCount(totalMinutes)) return null;
  return { day, hour, minute, totalMinutes };
}

function parseQuest(value: unknown): FarmState['quest'] | null {
  if (!isObject(value)) return null;
  if (value.id !== 'first-harvest') return null;
  if (typeof value.title !== 'string' || typeof value.description !== 'string') return null;
  if (!oneOf(value.targetCrop, CROP_IDS)) return null;
  if (!isCount(value.target) || !isCount(value.progress)) return null;
  if (typeof value.completed !== 'boolean' || typeof value.rewarded !== 'boolean') return null;
  return {
    id: 'first-harvest',
    title: value.title,
    description: value.description,
    targetCrop: value.targetCrop,
    target: value.target,
    progress: value.progress,
    completed: value.completed,
    rewarded: value.rewarded,
  };
}

function parseFarm(value: unknown): FarmState | null {
  if (!isObject(value)) return null;
  if (!isCount(value.revision) || !isCount(value.coins) || !isCount(value.clockMs)) return null;
  if (!oneOf(value.season, SEASONS) || !oneOf(value.weather, WEATHERS)) return null;

  const time = parseTime(value.time);
  const quest = parseQuest(value.quest);
  if (!time || !quest) return null;

  if (!isObject(value.plots) || !isObject(value.players)) return null;

  const plots: Record<string, PlotState> = {};
  for (const [key, raw] of Object.entries(value.plots)) {
    const plot = parsePlot(raw);
    if (!plot) return null;
    plots[key] = plot;
  }

  const players: Record<string, PlayerState> = {};
  for (const [key, raw] of Object.entries(value.players)) {
    const player = parsePlayer(raw);
    if (!player || player.id !== key) return null;
    players[key] = player;
  }

  return {
    revision: value.revision,
    time,
    season: value.season,
    weather: value.weather,
    plots,
    coins: value.coins,
    quest,
    players,
    clockMs: value.clockMs,
  };
}

/** Upgrades a save written by an older build. No older versions exist yet. */
function migrate(envelope: SaveEnvelope): SaveEnvelope | null {
  return envelope.version === SAVE_VERSION ? envelope : null;
}

// --- public API -------------------------------------------------------------

export function encodeSave(farm: FarmState, now = new Date()): string {
  const envelope: SaveEnvelope = { version: SAVE_VERSION, savedAt: now.toISOString(), farm };
  return JSON.stringify(envelope);
}

/** Parses a serialized save, returning null for anything unusable. */
export function decodeSave(serialized: string | null): FarmState | null {
  if (!serialized) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return null;
  }

  if (!isObject(parsed) || !isFiniteNumber(parsed.version)) return null;

  const farm = parseFarm(parsed.farm);
  if (!farm) return null;

  const migrated = migrate({ version: parsed.version, savedAt: String(parsed.savedAt ?? ''), farm });
  return migrated ? migrated.farm : null;
}

// Storage is allowed to fail, and a failed save must never take the game
// down with it. Losing a save is bad; crashing the render loop is worse.

export function saveFarm(farm: FarmState, storage: SaveStorage = localSaveStorage): boolean {
  try {
    storage.write(SAVE_KEY, encodeSave(farm));
    return true;
  } catch {
    return false;
  }
}

export function loadFarm(storage: SaveStorage = localSaveStorage): FarmState | null {
  try {
    return decodeSave(storage.read(SAVE_KEY));
  } catch {
    return null;
  }
}

export function clearSave(storage: SaveStorage = localSaveStorage): boolean {
  try {
    storage.remove(SAVE_KEY);
    return true;
  } catch {
    return false;
  }
}
