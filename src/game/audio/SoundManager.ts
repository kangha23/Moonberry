/**
 * The only part of the game that talks to Phaser's sound manager.
 *
 * It owns three things the rest of the code should not have to think about:
 * the buses (so a volume is set in one place), the browser's autoplay lock
 * (so nothing warns about a thing that is not wrong), and the crossfades
 * between music beds.
 *
 * Every public method is safe to call when the audio never loaded. A missing
 * file makes the game quieter, never broken — the same bargain the art
 * already makes with `createPixelArtTextures`.
 */
// Type-only: importing Phaser for real pulls in its WebGL and canvas probes,
// which cannot run under jsdom, and this module has nothing else to gain from
// it at runtime. See UNLOCKED below.
import type Phaser from 'phaser';
import type { GameEvent } from '../state/intents';
import type { PlayerId } from '../state/types';
import type { AreaId } from '../world/areas';
import { mixerStore, type MixerState } from './settings';
import {
  MUSIC_CROSSFADE_MS,
  SOUND_IDS,
  allMusic,
  isLocalOnly,
  musicUrls,
  soundForEvent,
  soundUrls,
  type MusicId,
  type SoundId,
} from './soundtrack';

/** Phaser's concrete sounds carry a settable `volume`; `BaseSound` does not. */
type Playable = Phaser.Sound.BaseSound & { volume: number };

/**
 * `Phaser.Sound.Events.UNLOCKED`, spelled out because the import above is
 * type-only. The test asserts the manager waits for it; that the string is
 * the one Phaser emits is pinned by Phaser's own public event name.
 */
const UNLOCKED = 'unlocked';

/**
 * How close together the same effect may fire.
 *
 * One intent can produce several events, and four players working one field
 * can land on the same tick. Without this the result is not four hoe sounds,
 * it is one loud clipped one.
 */
const RETRIGGER_MS = 55;

/** Loader keys are prefixed so an effect and a bed can share a name safely. */
function sfxKey(id: SoundId): string {
  return `sfx:${id}`;
}

function musicKey(id: MusicId): string {
  return `music:${id}`;
}

export class SoundManager {
  private readonly scene: Phaser.Scene;

  /** Which bed is playing, and the one fading out under it. */
  private current: Playable | null = null;
  private currentId: MusicId | null = null;
  private previous: Playable | null = null;

  /** Held so a bed that was asked for while locked still starts on unlock. */
  private wanted: MusicId | null = null;

  private readonly lastPlayedAt = new Map<SoundId, number>();
  private unsubscribeMixer: (() => void) | null = null;
  private destroyed = false;

  /**
   * Queues every audio file. Call from the scene's `preload`.
   *
   * Static because it runs before there is a manager: the scene is still
   * loading, and nothing here needs instance state.
   */
  static preload(scene: Phaser.Scene, areas: readonly AreaId[]): void {
    for (const id of SOUND_IDS) scene.load.audio(sfxKey(id), soundUrls(id));
    for (const id of allMusic(areas)) scene.load.audio(musicKey(id), musicUrls(id));
  }

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.applyMixer(mixerStore.getState());
    this.unsubscribeMixer = mixerStore.subscribe((mixer) => this.applyMixer(mixer));

    // Browsers will not play anything before a gesture, and Phaser starts
    // locked because of it. That is the normal first second of every page, so
    // it is waited on rather than reported.
    if (scene.sound.locked) {
      scene.sound.once(UNLOCKED, () => {
        if (this.destroyed || !this.wanted) return;
        this.playMusic(this.wanted);
      });
    }
  }

  // --- buses ----------------------------------------------------------------

  /**
   * Master is the Phaser sound manager's own volume, so it applies to
   * everything already playing without walking a list. The music bus is
   * applied to the one bed; the effects bus is applied per `play` call.
   */
  private applyMixer(mixer: MixerState): void {
    this.scene.sound.volume = mixer.master;
    this.scene.sound.mute = mixer.muted;
    if (this.current) {
      // Setting it outright rather than tweening: a slider is a direct
      // manipulation and should answer immediately.
      this.scene.tweens.killTweensOf(this.current);
      this.current.volume = mixer.music;
    }
  }

  // --- effects --------------------------------------------------------------

  /** Plays one effect, if it loaded and it is not already sounding. */
  play(id: SoundId): void {
    if (this.destroyed || this.scene.sound.locked) return;
    if (!this.scene.cache.audio.exists(sfxKey(id))) return;

    const now = this.scene.time.now;
    const last = this.lastPlayedAt.get(id);
    if (last !== undefined && now - last < RETRIGGER_MS) return;
    this.lastPlayedAt.set(id, now);

    this.scene.sound.play(sfxKey(id), { volume: mixerStore.getState().effects });
  }

  /**
   * Turns one simulation event into a sound.
   *
   * `localPlayerId` is what keeps somebody else's doorway out of your ears:
   * without positional audio the only honest filter is whether it happened to
   * you. See `isLocalOnly`.
   */
  handleEvent(event: GameEvent, localPlayerId: PlayerId | null): void {
    if (isLocalOnly(event) && 'playerId' in event && event.playerId !== localPlayerId) return;
    const sound = soundForEvent(event);
    if (sound) this.play(sound);
  }

  // --- music ----------------------------------------------------------------

  /**
   * Brings up a bed, crossfading out whatever was playing.
   *
   * Asking for the bed that is already on is a no-op, so this is safe to call
   * every frame — which is how the scene uses it, because the answer depends
   * on the area, the weather and the clock all at once.
   */
  playMusic(id: MusicId): void {
    if (this.destroyed || id === this.currentId) return;

    // Nothing can start before the first gesture, so remember the ask and let
    // the unlock handler make good on it.
    this.wanted = id;
    if (this.scene.sound.locked) return;
    if (!this.scene.cache.audio.exists(musicKey(id))) {
      // A bed a map named but nobody shipped: fade out to silence rather than
      // leaving the previous area's music playing over the new one.
      this.fadeOutCurrent();
      this.currentId = id;
      return;
    }

    const next = this.scene.sound.add(musicKey(id), { loop: true, volume: 0 }) as Playable;
    this.fadeOutCurrent();
    next.play();
    this.current = next;
    this.currentId = id;
    this.scene.tweens.add({
      targets: next,
      volume: mixerStore.getState().music,
      duration: MUSIC_CROSSFADE_MS,
      ease: 'Sine.easeInOut',
    });
  }

  /**
   * Fades the playing bed out and forgets it.
   *
   * Only one outgoing bed is kept: a player walking a doorway back and forth
   * would otherwise stack a fade per crossing, and they would all be audible.
   */
  private fadeOutCurrent(): void {
    this.previous?.destroy();
    this.previous = this.current;
    this.current = null;
    this.currentId = null;

    const fading = this.previous;
    if (!fading) return;
    this.scene.tweens.killTweensOf(fading);
    this.scene.tweens.add({
      targets: fading,
      volume: 0,
      duration: MUSIC_CROSSFADE_MS,
      ease: 'Sine.easeInOut',
      onComplete: () => {
        fading.destroy();
        if (this.previous === fading) this.previous = null;
      },
    });
  }

  // --- teardown -------------------------------------------------------------

  destroy(): void {
    this.destroyed = true;
    this.unsubscribeMixer?.();
    this.unsubscribeMixer = null;
    this.current?.destroy();
    this.previous?.destroy();
    this.current = null;
    this.previous = null;
    this.currentId = null;
    this.wanted = null;
  }
}
