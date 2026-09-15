import { beforeEach, describe, expect, it } from 'vitest';
import type { SaveStorage } from '../state/persistence';
import {
  BUSES,
  DEFAULT_MIXER,
  MIXER_KEY,
  initMixer,
  loadMixer,
  mixerStore,
  parseMixer,
  saveMixer,
  setBusLevel,
  setMuted,
  toggleMuted,
} from './settings';

function memoryStorage(seed: Record<string, string> = {}): SaveStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(seed));
  return {
    data,
    read: (key) => data.get(key) ?? null,
    write: (key, value) => void data.set(key, value),
    remove: (key) => void data.delete(key),
  };
}

/** A private window, blocked site data, or a full quota: every method throws. */
function blockedStorage(): SaveStorage {
  const fail = () => {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  };
  return { read: fail, write: fail, remove: fail };
}

describe('the mixer, round-tripped', () => {
  beforeEach(() => initMixer(memoryStorage()));

  it('comes back as it went in', () => {
    const storage = memoryStorage();
    const mixer = { master: 0.42, music: 0.1, effects: 0.77, muted: true };
    expect(saveMixer(mixer, storage)).toBe(true);
    expect(loadMixer(storage)).toEqual(mixer);
  });

  it('keeps a player muted across a reload', () => {
    const storage = memoryStorage();
    initMixer(storage);
    setMuted(true);
    // A fresh read is what the next page load does.
    expect(loadMixer(storage).muted).toBe(true);
    toggleMuted();
    expect(loadMixer(storage).muted).toBe(false);
  });

  it('writes every bus the HUD can move', () => {
    const storage = memoryStorage();
    initMixer(storage);
    for (const bus of BUSES) setBusLevel(bus, 0.25);
    expect(loadMixer(storage)).toEqual({ master: 0.25, music: 0.25, effects: 0.25, muted: false });
    expect(mixerStore.getState().master).toBe(0.25);
  });
});

describe('a mixer that cannot be trusted', () => {
  beforeEach(() => initMixer(memoryStorage()));

  it('falls back to defaults rather than throwing when storage is blocked', () => {
    expect(() => loadMixer(blockedStorage())).not.toThrow();
    expect(loadMixer(blockedStorage())).toEqual(DEFAULT_MIXER);
  });

  it('reports a failed write instead of taking the game down with it', () => {
    expect(saveMixer(DEFAULT_MIXER, blockedStorage())).toBe(false);
  });

  it('still plays at default volume when a write cannot be kept', () => {
    initMixer(blockedStorage());
    expect(mixerStore.getState()).toEqual(DEFAULT_MIXER);
    expect(() => setBusLevel('music', 0.3)).not.toThrow();
    // The level applies to this session even though nothing could be stored.
    expect(mixerStore.getState().music).toBe(0.3);
  });

  it('ignores hand-edited nonsense one field at a time', () => {
    expect(parseMixer({ master: 'loud', music: 0.3, effects: null, muted: 'yes' })).toEqual({
      master: DEFAULT_MIXER.master,
      music: 0.3,
      effects: DEFAULT_MIXER.effects,
      // Anything but a real `true` is not muted: a stray string should not
      // silence the game with no obvious way to undo it.
      muted: false,
    });
  });

  it('clamps levels into range rather than letting them distort or invert', () => {
    const wild = parseMixer({ master: 4, music: -2, effects: Number.NaN, muted: false });
    expect(wild.master).toBe(1);
    expect(wild.music).toBe(0);
    expect(wild.effects).toBe(DEFAULT_MIXER.effects);
  });

  it('shrugs off a save that is not JSON at all', () => {
    expect(loadMixer(memoryStorage({ [MIXER_KEY]: 'not json' }))).toEqual(DEFAULT_MIXER);
    expect(loadMixer(memoryStorage({ [MIXER_KEY]: '[1,2,3]' }))).toEqual(DEFAULT_MIXER);
    expect(loadMixer(memoryStorage())).toEqual(DEFAULT_MIXER);
  });
});

describe('muting', () => {
  it('keeps the levels behind the mute, so unmuting restores them', () => {
    const storage = memoryStorage();
    initMixer(storage);
    setBusLevel('music', 0.33);

    setMuted(true);
    // Mute is a flag, not a slider slammed to zero: the stored level survives.
    expect(loadMixer(storage)).toEqual({ ...DEFAULT_MIXER, music: 0.33, muted: true });

    setMuted(false);
    expect(mixerStore.getState().music).toBe(0.33);
  });
});
