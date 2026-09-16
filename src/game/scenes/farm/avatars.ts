/**
 * The players, as they are drawn.
 *
 * One sprite and one shadow per person standing on the built area, walking
 * when their position moved since the last frame and standing when it did
 * not. The camera follows whichever of them is this client's.
 */
import type Phaser from 'phaser';
import { tint } from '../../assets/palette.generated';
import { farmStore } from '../../state/store';
import type { PlayerId, PlayerState } from '../../state/types';
import { TILE_SIZE, type Direction } from '../../world/areas';
import { AVATAR_DEPTH_BASE, WALK_FRAMES, WALK_ROW, standFrame, type SceneContext } from './shared';

export interface Avatar {
  sprite: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Image;
  lastX: number;
  lastY: number;
  /** `scene.time.now` until which the swing owns the sprite, and walking waits. */
  swingingUntil: number;
}

/**
 * How big the player's sheet is drawn.
 *
 * 1, because the sheet is the Emberfield swordsman now, drawn at this game's
 * own scale: about a tile and a bit tall in a 64px frame. The LPC people are
 * drawn in the same size of frame at nearly twice the height, which is why
 * the villagers keep their own 0.62.
 */
const PLAYER_SHEET_SCALE = 1;

/** The swing's eight frames, played once. */
const SWING_FRAME_RATE = 24;
const SWING_FRAMES = 8;

/** The players standing on the built area, drawn. */
export class AvatarView {
  private avatars = new Map<PlayerId, Avatar>();

  private readonly context: Pick<SceneContext, 'scene' | 'builtArea' | 'areaLayer'>;
  private readonly scene: Phaser.Scene;

  constructor(context: Pick<SceneContext, 'scene' | 'builtArea' | 'areaLayer'>) {
    this.context = context;
    this.scene = context.scene;
  }

  /** Forgets every avatar, whose sprites went with the layer they were drawn in. */
  forgetArea() {
    this.avatars.clear();
  }

  /** The avatar drawn for this player, if they are standing on the built area. */
  avatarFor(id: PlayerId): Avatar | undefined {
    return this.avatars.get(id);
  }

  createWalkAnimations() {
    this.createSwingAnimations();
    if (!this.scene.textures.exists('player-sheet')) return;
    (['up', 'left', 'down', 'right'] as Direction[]).forEach((dir) => {
      const key = `player-walk-${dir}`;
      if (this.scene.anims.exists(key)) return;
      this.scene.anims.create({
        key,
        frames: this.scene.anims.generateFrameNumbers('player-sheet', {
          start: standFrame(dir),
          end: standFrame(dir) + WALK_FRAMES - 1,
        }),
        frameRate: 10,
        repeat: -1,
      });
    });
  }

  /** The sword swing, one row a direction, in the same row order as the walk. */
  private createSwingAnimations() {
    if (!this.scene.textures.exists('attack-player-sheet')) return;
    (['up', 'left', 'down', 'right'] as Direction[]).forEach((dir) => {
      const key = `player-swing-${dir}`;
      if (this.scene.anims.exists(key)) return;
      const start = WALK_ROW[dir] * SWING_FRAMES;
      this.scene.anims.create({
        key,
        frames: this.scene.anims.generateFrameNumbers('attack-player-sheet', { start, end: start + SWING_FRAMES - 1 }),
        frameRate: SWING_FRAME_RATE,
        repeat: 0,
      });
    });
  }

  /**
   * Plays the swing on this player's avatar, facing the way they face.
   *
   * A picture of the key press, like the fan: whether the blow landed is the
   * server's answer. Walking takes the sprite back when the swing is done.
   */
  swing(id: PlayerId, facing: Direction) {
    const avatar = this.avatars.get(id);
    const key = `player-swing-${facing}`;
    if (!avatar || !this.scene.anims.exists(key)) return;
    avatar.sprite.anims.play(key, true);
    avatar.swingingUntil = this.scene.time.now + (SWING_FRAMES / SWING_FRAME_RATE) * 1000;
  }

  private createAvatar(player: PlayerState): Avatar {
    const hasSheet = this.scene.textures.exists('player-sheet');
    const shadow = this.scene.add.image(player.x, player.y + 16, 'shadow');
    const sprite = this.scene.add
      .sprite(player.x, player.y, hasSheet ? 'player-sheet' : 'player', hasSheet ? standFrame('down') : undefined)
      .setScale(hasSheet ? PLAYER_SHEET_SCALE : 1.2);
    // Remote players are tinted so they read as somebody else at a glance.
    // Was the source literal `bfd8ff`, a pale blue this palette has no match for at all (every
    // blue it owns is dark and saturated - `water.0-3`). Between the two
    // near-tied mechanical candidates, `light.6` (#acbfb0, d=0.1177) sits 84°
    // from the original hue and keeps the original's near-white lightness;
    // `light.7` (#f8dbbd, d=0.1154) is nominally closer but 174° away in hue
    // *and* a warm cream, which would read as "everyone else's UI colour"
    // rather than "a different player". `setTint` multiplies onto the sprite,
    // so a dark blue (water.0-3, d>=0.26) would visibly darken the sprite
    // rather than lightly recolour it - the wrong trade for a legibility tint.
    if (player.id !== farmStore.getState().localPlayerId) sprite.setTint(tint('light.6'));
    this.context.areaLayer?.addMultiple([shadow, sprite]);
    return { sprite, shadow, lastX: player.x, lastY: player.y, swingingUntil: 0 };
  }

  /**
   * Draws the players standing on the built area, adding and removing avatars
   * as people arrive, leave, or walk through a doorway to somewhere else.
   */
  syncAvatars() {
    const { farm, localPlayerId } = farmStore.getState();
    // Members who are logged out keep their place in the world but are not
    // standing in it, so they are not drawn.
    const here = Object.values(farm.players).filter(
      (player) => player.online && player.area === this.context.builtArea,
    );
    const present = new Set(here.map((player) => player.id));

    for (const player of here) {
      let avatar = this.avatars.get(player.id);
      if (!avatar) {
        avatar = this.createAvatar(player);
        this.avatars.set(player.id, avatar);
        if (player.id === localPlayerId) this.scene.cameras.main.startFollow(avatar.sprite, true, 0.12, 0.12);
      }

      const moved = Math.abs(player.x - avatar.lastX) > 0.01 || Math.abs(player.y - avatar.lastY) > 0.01;
      avatar.sprite.setPosition(player.x, player.y);
      avatar.sprite.setDepth(Math.floor(player.y / TILE_SIZE) + AVATAR_DEPTH_BASE);
      avatar.shadow.setPosition(player.x, player.y + 16);
      avatar.shadow.setDepth(avatar.sprite.depth - 1);

      const walkKey = `player-walk-${player.facing}`;
      if (this.scene.time.now < avatar.swingingUntil) {
        // Mid-swing: the swing plays out, whatever the feet are doing.
      } else if (this.scene.anims.exists(walkKey)) {
        if (moved) avatar.sprite.anims.play(walkKey, true);
        else {
          avatar.sprite.anims.stop();
          avatar.sprite.setFrame(standFrame(player.facing));
        }
      }

      avatar.lastX = player.x;
      avatar.lastY = player.y;
    }

    for (const [id, avatar] of this.avatars) {
      if (present.has(id)) continue;
      avatar.sprite.destroy();
      avatar.shadow.destroy();
      this.avatars.delete(id);
    }
  }
}
