import type Phaser from 'phaser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameEvent } from '../state/intents';
import { SoundManager } from './SoundManager';
import { DEFAULT_MIXER, initMixer, setBusLevel, setMuted } from './settings';
import { MUSIC_CROSSFADE_MS } from './soundtrack';

/**
 * A stand-in for Phaser's scene.
 *
 * Only the handful of members `SoundManager` touches, which is the point:
 * whether a browser actually made a noise is not something a test can know,
 * but which sounds were asked for, at what volume, and whether a missing file
 * took the scene down with it, all are.
 */
function fakeScene(options: { loaded?: string[]; locked?: boolean } = {}) {
  const loaded = new Set(options.loaded ?? []);
  const played: Array<{ key: string; volume: number }> = [];
  const added: Array<{ key: string; volume: number; playing: boolean; destroyed: boolean }> = [];
  const fades: Array<{ target: unknown; volume: number; onComplete?: () => void }> = [];
  const unlockHandlers: Array<() => void> = [];

  const scene = {
    played,
    added,
    /** Every volume tween the manager started, newest last. */
    fades,
    /** Runs whatever the manager registered for the first user gesture. */
    unlock() {
      scene.sound.locked = false;
      for (const handler of unlockHandlers.splice(0)) handler();
    },
    /** Finishes every pending fade, the way the tween manager eventually would. */
    settleTweens() {
      for (const fade of fades.splice(0)) {
        (fade.target as { volume: number }).volume = fade.volume;
        fade.onComplete?.();
      }
    },
    time: { now: 0 },
    cache: { audio: { exists: (key: string) => loaded.has(key) } },
    load: { audio: vi.fn() },
    tweens: {
      add: (config: { targets: unknown; volume: number; onComplete?: () => void }) => {
        fades.push({ target: config.targets, volume: config.volume, onComplete: config.onComplete });
      },
      killTweensOf: (target: unknown) => {
        for (let i = fades.length - 1; i >= 0; i -= 1) {
          if (fades[i].target === target) fades.splice(i, 1);
        }
      },
    },
    sound: {
      locked: options.locked ?? false,
      volume: 1,
      mute: false,
      play: (key: string, config?: { volume?: number }) => {
        played.push({ key, volume: config?.volume ?? 1 });
        return true;
      },
      add: (key: string, config?: { volume?: number }) => {
        const sound = { key, volume: config?.volume ?? 1, playing: false, destroyed: false };
        added.push(sound);
        return {
          ...sound,
          play() {
            sound.playing = true;
            return true;
          },
          destroy() {
            sound.destroyed = true;
          },
          get volume() {
            return sound.volume;
          },
          set volume(value: number) {
            sound.volume = value;
          },
        };
      },
      once: (_event: string, handler: () => void) => void unlockHandlers.push(handler),
    },
  };
  return scene;
}

type FakeScene = ReturnType<typeof fakeScene>;

function manager(scene: FakeScene): SoundManager {
  return new SoundManager(scene as unknown as Phaser.Scene);
}

/** A storage that keeps nothing, so each test starts from the defaults. */
const throwaway = () => ({ read: () => null, write: () => undefined, remove: () => undefined });

beforeEach(() => initMixer(throwaway()));

describe('a game with no audio files at all', () => {
  it('starts, plays, and asks for music without throwing', () => {
    const scene = fakeScene({ loaded: [] });
    const audio = manager(scene);

    expect(() => audio.play('tool-hoe')).not.toThrow();
    expect(() => audio.playMusic('day-farm-loop')).not.toThrow();
    expect(() => audio.handleEvent({ kind: 'dayStarted', day: 2, grown: 1 }, 'me')).not.toThrow();
    expect(() => audio.destroy()).not.toThrow();

    // Silence, not a half-played sound: nothing was in the cache to play.
    expect(scene.played).toEqual([]);
    expect(scene.added).toEqual([]);
  });

  it('does not leave the last area’s bed playing when the next one is missing', () => {
    const scene = fakeScene({ loaded: ['music:day-farm-loop'] });
    const audio = manager(scene);

    audio.playMusic('day-farm-loop');
    scene.settleTweens();
    expect(scene.added[0].playing).toBe(true);

    audio.playMusic('day-forest-loop'); // a map named a bed nobody shipped
    scene.settleTweens();
    expect(scene.added[0].destroyed).toBe(true);
  });
});

describe('the autoplay lock', () => {
  it('plays nothing before the first gesture, and says nothing about it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const scene = fakeScene({ loaded: ['sfx:tool-hoe', 'music:day-farm-loop'], locked: true });
    const audio = manager(scene);

    audio.play('tool-hoe');
    audio.playMusic('day-farm-loop');

    expect(scene.played).toEqual([]);
    expect(scene.added).toEqual([]);
    // A locked sound manager is the ordinary first second of every page load,
    // not a fault worth printing something that looks like one.
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    warn.mockRestore();
    error.mockRestore();
  });

  it('starts the bed that was asked for once the gesture arrives', () => {
    const scene = fakeScene({ loaded: ['music:day-farm-loop'], locked: true });
    const audio = manager(scene);

    audio.playMusic('day-farm-loop');
    expect(scene.added).toEqual([]);

    scene.unlock();
    expect(scene.added).toHaveLength(1);
    expect(scene.added[0].key).toBe('music:day-farm-loop');
    expect(scene.added[0].playing).toBe(true);
  });
});

describe('effects', () => {
  it('plays at the effects bus level', () => {
    const scene = fakeScene({ loaded: ['sfx:coins'] });
    const audio = manager(scene);
    audio.play('coins');
    expect(scene.played).toEqual([{ key: 'sfx:coins', volume: DEFAULT_MIXER.effects }]);
  });

  it('does not stack the same sound when one tick emits it several times', () => {
    const scene = fakeScene({ loaded: ['sfx:tool-hoe'] });
    const audio = manager(scene);

    audio.play('tool-hoe');
    audio.play('tool-hoe');
    audio.play('tool-hoe');
    expect(scene.played).toHaveLength(1);

    // Far enough apart to be two swings rather than one clipped one.
    scene.time.now = 500;
    audio.play('tool-hoe');
    expect(scene.played).toHaveLength(2);
  });

  it('keeps a remote player’s footsteps and exhaustion to themselves', () => {
    const scene = fakeScene({ loaded: ['sfx:footstep-path', 'sfx:slump', 'sfx:coins'] });
    const audio = manager(scene);

    const elsewhere: GameEvent = { kind: 'areaChanged', playerId: 'them', area: 'village' };
    audio.handleEvent(elsewhere, 'me');
    audio.handleEvent({ kind: 'exhausted', playerId: 'them' }, 'me');
    expect(scene.played).toEqual([]);

    // The shared wallet is everybody's business, wherever it was earned.
    audio.handleEvent({ kind: 'sold', playerId: 'them', coins: 30, count: 2 }, 'me');
    expect(scene.played.map((entry) => entry.key)).toEqual(['sfx:coins']);
  });
});

describe('music', () => {
  it('fades the old bed out while the new one comes up', () => {
    const scene = fakeScene({ loaded: ['music:day-farm-loop', 'music:night-loop'] });
    const audio = manager(scene);

    audio.playMusic('day-farm-loop');
    scene.settleTweens();

    audio.playMusic('night-loop');
    // One tween down to silence, one up to the music bus level.
    const targets = scene.fades.map((fade) => fade.volume);
    expect(targets).toContain(0);
    expect(targets).toContain(DEFAULT_MIXER.music);

    scene.settleTweens();
    expect(scene.added[0].destroyed).toBe(true);
    expect(scene.added[1].playing).toBe(true);
    expect(scene.added[1].volume).toBe(DEFAULT_MIXER.music);
  });

  it('crossfades rather than cutting', () => {
    expect(MUSIC_CROSSFADE_MS).toBeGreaterThanOrEqual(1000);
  });

  it('ignores being asked for the bed that is already playing', () => {
    const scene = fakeScene({ loaded: ['music:day-farm-loop'] });
    const audio = manager(scene);

    // The scene asks every frame, because area, weather and clock all move it.
    for (let frame = 0; frame < 60; frame += 1) audio.playMusic('day-farm-loop');
    expect(scene.added).toHaveLength(1);
  });

  it('answers a slider immediately instead of easing to it', () => {
    const scene = fakeScene({ loaded: ['music:day-farm-loop'] });
    const audio = manager(scene);
    audio.playMusic('day-farm-loop');
    scene.settleTweens();

    setBusLevel('music', 0.2);
    expect(scene.added[0].volume).toBe(0.2);

    setMuted(true);
    expect(scene.sound.mute).toBe(true);
    audio.destroy();
  });

  it('puts the master bus on the sound manager, so it reaches everything at once', () => {
    const scene = fakeScene({ loaded: [] });
    manager(scene);
    expect(scene.sound.volume).toBe(DEFAULT_MIXER.master);
    setBusLevel('master', 0.15);
    expect(scene.sound.volume).toBe(0.15);
  });
});

describe('teardown', () => {
  it('stops listening to the mixer once the scene is gone', () => {
    const scene = fakeScene({ loaded: ['music:day-farm-loop'] });
    const audio = manager(scene);
    audio.playMusic('day-farm-loop');
    scene.settleTweens();
    audio.destroy();

    const volumeAfterDestroy = scene.sound.volume;
    setBusLevel('master', 0.05);
    expect(scene.sound.volume).toBe(volumeAfterDestroy);
    expect(scene.added[0].destroyed).toBe(true);
  });

  it('plays nothing after being destroyed', () => {
    const scene = fakeScene({ loaded: ['sfx:coins'] });
    const audio = manager(scene);
    audio.destroy();
    audio.play('coins');
    expect(scene.played).toEqual([]);
  });
});
