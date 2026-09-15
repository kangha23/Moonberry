/**
 * The mixer: three buses, a mute, and somewhere to keep them.
 *
 * It lives beside the save rather than inside it. A player who muted the game
 * muted this browser, not this farm — carrying the setting into a save would
 * mean an invite link could arrive with the sound turned off.
 */
import { createStore } from 'zustand/vanilla';
import { localSaveStorage, type SaveStorage } from '../state/persistence';

export const MIXER_KEY = 'moonberry:audio';

/** The buses, in the order the HUD shows them. */
export const BUSES = ['master', 'music', 'effects'] as const;
export type Bus = (typeof BUSES)[number];

export interface MixerState {
  master: number;
  music: number;
  effects: number;
  muted: boolean;
}

/**
 * Music sits under the effects because the effects are the feedback — the
 * thing that tells you the hoe landed — and the bed is the room it happens in.
 */
export const DEFAULT_MIXER: MixerState = { master: 0.8, music: 0.55, effects: 0.9, muted: false };

export const BUS_LABELS: Record<Bus, string> = {
  master: 'Tổng',
  music: 'Nhạc nền',
  effects: 'Hiệu ứng',
};

function clampLevel(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

/**
 * Reads a stored mixer, filling in anything missing or nonsensical from the
 * defaults. Unlike a save, a half-valid mixer is worth keeping: the worst a
 * wrong level can do is be the wrong loudness, and throwing away somebody's
 * mute because one number went bad would be the ruder failure.
 */
export function parseMixer(value: unknown): MixerState {
  if (typeof value !== 'object' || value === null) return { ...DEFAULT_MIXER };
  const raw = value as Record<string, unknown>;
  return {
    master: clampLevel(raw.master, DEFAULT_MIXER.master),
    music: clampLevel(raw.music, DEFAULT_MIXER.music),
    effects: clampLevel(raw.effects, DEFAULT_MIXER.effects),
    muted: raw.muted === true,
  };
}

/** Storage is allowed to fail; a blocked one just means defaults every time. */
export function loadMixer(storage: SaveStorage = localSaveStorage): MixerState {
  try {
    const serialized = storage.read(MIXER_KEY);
    if (!serialized) return { ...DEFAULT_MIXER };
    return parseMixer(JSON.parse(serialized));
  } catch {
    return { ...DEFAULT_MIXER };
  }
}

export function saveMixer(mixer: MixerState, storage: SaveStorage = localSaveStorage): boolean {
  try {
    storage.write(MIXER_KEY, JSON.stringify(mixer));
    return true;
  } catch {
    return false;
  }
}

/**
 * The live mixer.
 *
 * A store rather than a field on `SoundManager` because the sliders are React
 * and the playback is Phaser: this is the one thing both of them hold.
 */
export const mixerStore = createStore<MixerState>(() => loadMixer());

/** Where writes go. Swapped in tests so they do not touch the real browser. */
let mixerStorage: SaveStorage = localSaveStorage;

/** Re-reads the mixer from `storage` and sends later writes back to it. */
export function initMixer(storage: SaveStorage = localSaveStorage): void {
  mixerStorage = storage;
  mixerStore.setState(loadMixer(storage), true);
}

export function setBusLevel(bus: Bus, level: number): void {
  const next = { ...mixerStore.getState(), [bus]: clampLevel(level, DEFAULT_MIXER[bus]) };
  mixerStore.setState(next, true);
  saveMixer(next, mixerStorage);
}

export function setMuted(muted: boolean): void {
  const next = { ...mixerStore.getState(), muted };
  mixerStore.setState(next, true);
  saveMixer(next, mixerStorage);
}

export function toggleMuted(): void {
  setMuted(!mixerStore.getState().muted);
}

// There is deliberately no `effectiveVolume` helper here. `SoundManager` puts
// the master bus on Phaser's own sound manager and the mute on its `mute`
// flag, so Phaser does that multiplication; a second copy of the arithmetic
// would only be a second thing that could disagree about what 50% means.
