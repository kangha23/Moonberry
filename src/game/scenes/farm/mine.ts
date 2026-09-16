/**
 * The mine, as it is drawn: the monsters, the sword, the dark, and the
 * elevator's buttons.
 *
 * Spec 13's client half, and none of the rules. The reducer decides who hits
 * whom and for how much; this only makes it *feel* like something happened —
 * a fan of steel on the key press, a few frames of stillness when the server
 * says the blow landed, a flash on the monster, a flash on you, and a slime
 * that comes apart into motes rather than blinking out.
 *
 * Nothing here is game state. The only memory kept is presentational: which
 * sprite belongs to which monster, the health it was last drawn at (so a drop
 * can flash it), and when this client last swung (so a landed blow can stop
 * time for a moment).
 */
import Phaser from 'phaser';
import { PALETTE, tint } from '../../assets/palette.generated';
import { MINE_LIGHT_EDGE, MINE_LIGHT_SIZE } from '../../assets/createPixelArtTextures';
import type { GameEvent } from '../../state/intents';
import { elevatorStops } from '../../state/selectors';
import { sendAction } from '../../state/store';
import type { PlayerState } from '../../state/types';
import { slotAt } from '../../systems/inventory';
import { ITEMS } from '../../systems/items';
import { SWORD_FAN_COS, SWORD_REACH_PX, type Monster, type MonsterKind } from '../../systems/mine';
import { placeablesOn } from '../../systems/placeables';
import { advanceChase, chaseFacing, createChase, type TickChase } from '../../view/tickChase';
import { PLACED_TORCH_RADIUS, flicker, lightRadius, mineDarkness } from '../../view/mineLight';
import { TILE_SIZE, mineDepth, type Direction, type Point } from '../../world/areas';
import type { AvatarView } from './avatars';
import type { ScreenLayer } from './screen';
import { AVATAR_DEPTH_BASE, DEPTH, PROSE_FONT, WALK_ROW, type SceneContext } from './shared';

/** Above everything in the world, below the cursor and the glass. */
const DARKNESS_DEPTH = DEPTH.weather - 40;
const TORCH_GLOW_DEPTH = DARKNESS_DEPTH + 1;
/** The swing is drawn over the monsters it is hitting. */
const SWING_DEPTH = DARKNESS_DEPTH - 1;

/** How long the fan takes to sweep, and how long it lingers fading. */
const SWING_SWEEP_MS = 90;
const SWING_FADE_MS = 110;
/** How long the world holds still when a blow lands. Long enough to feel, short enough not to read as lag. */
const HITSTOP_MS = 70;
const KILL_HITSTOP_MS = 110;
/** A landed blow is credited to this client's swing if it arrives within this long of it. */
const SWING_CREDIT_MS = 600;
/** How long a monster stays white after being hit. */
const FLASH_MS = 90;

/** How far past its own edge the dark reaches, so no screen is ever big enough to see round it. */
const DARK_REACH = 4096;

/**
 * Which sheet each monster is drawn from, and how.
 *
 * Every kind has real art now. The slimes, the bat, the ghost and the worm
 * (standing in for the rock bug) are [LPC] Monsters, in the same 64px frames
 * as the rest of the LPC world; the floor-40 boss is the Emberfield skeleton,
 * drawn big and red. A sheet that did not load falls back to the generated
 * still, so a missing file is a plainer monster rather than a hole.
 *
 * `shadow` is off for the ghost, which carries its own under it, and the bat,
 * which is in the air. `lift` is how far above its position the sprite is
 * drawn so its feet, not its middle, stand on the tile.
 */
interface MonsterArt {
  sheet: string;
  scale: number;
  tint: number | null;
  alpha: number;
  shadow: boolean;
  lift: number;
}

const MONSTER_ART: Record<MonsterKind, MonsterArt> = {
  'green-slime': { sheet: 'slime', scale: 0.8, tint: null, alpha: 1, shadow: true, lift: 10 },
  slime: { sheet: 'blue-slime', scale: 0.9, tint: null, alpha: 1, shadow: true, lift: 10 },
  bat: { sheet: 'bat', scale: 0.8, tint: null, alpha: 1, shadow: false, lift: 18 },
  'rock-bug': { sheet: 'worm', scale: 0.8, tint: null, alpha: 1, shadow: true, lift: 12 },
  ghost: { sheet: 'ghost', scale: 0.8, tint: null, alpha: 0.9, shadow: false, lift: 10 },
  'floor-boss': { sheet: 'skeleton', scale: 0.9, tint: tint('building.1'), alpha: 1, shadow: true, lift: 24 },
};

/** Eight frames an action, in the order the sheets are cut. */
const ACTION_FRAMES = 8;
const MONSTER_ACTIONS = [
  { action: 'walk', frameRate: 10, repeat: -1 },
  { action: 'attack', frameRate: 16, repeat: 0 },
  { action: 'death', frameRate: 12, repeat: 0 },
] as const;

interface MonsterSprite {
  sprite: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Image;
  chase: TickChase;
  /** The health it was last drawn at, so a drop can be seen. */
  health: number;
  /** A per-monster phase for the idle bob, so a room of slimes does not breathe in step. */
  phase: number;
  /** The animated art it is drawn from, or null for a generated still. */
  art: MonsterArt | null;
  facing: Direction;
  /** `scene.time.now` until which its attack plays out over its walk. */
  attackingUntil: number;
}

export class MineView {
  private monsters = new Map<string, MonsterSprite>();

  private darkness: Phaser.GameObjects.Image | null = null;
  private darkBands: Phaser.GameObjects.Rectangle[] = [];
  private torchGlows: Phaser.GameObjects.Image[] = [];
  /** What `torchGlows` was drawn from, so a torch set down on this floor lights up at once. */
  private drawnPlaceables: unknown = null;
  private handGlow: Phaser.GameObjects.Image | null = null;

  private elevatorPanel!: Phaser.GameObjects.Container;
  private elevatorBackdrop!: Phaser.GameObjects.NineSlice;
  private elevatorTitle!: Phaser.GameObjects.Text;
  private elevatorButtons: Phaser.GameObjects.Text[] = [];
  private elevatorBounds = new Phaser.Geom.Rectangle(0, 0, 0, 0);
  /** Where the panel was opened from, so walking off the elevator closes it. */
  private elevatorOpenedAt: { area: string; x: number; y: number } | null = null;

  /** `scene.time.now` of this client's last swing. */
  private lastSwingAt = -Infinity;
  /** While the world is held still, monster chases do not advance. */
  private frozenUntil = 0;
  private hurtFlash!: Phaser.GameObjects.Rectangle;

  private readonly context: Pick<SceneContext, 'scene' | 'farm' | 'localPlayer' | 'builtArea' | 'areaLayer' | 'audio'>;
  private readonly scene: Phaser.Scene;
  private readonly screen: ScreenLayer;
  private readonly avatars: Pick<AvatarView, 'avatarFor'>;

  constructor(
    context: Pick<SceneContext, 'scene' | 'farm' | 'localPlayer' | 'builtArea' | 'areaLayer' | 'audio'>,
    screen: ScreenLayer,
    avatars: Pick<AvatarView, 'avatarFor'>,
  ) {
    this.context = context;
    this.scene = context.scene;
    this.screen = screen;
    this.avatars = avatars;
  }

  // --- lifecycle ------------------------------------------------------------

  /** The screen-space parts: the red wash when you are hit, and the elevator's panel. */
  createUi() {
    this.hurtFlash = this.scene.add.rectangle(0, 0, 1, 1, tint('building.3'), 0).setDepth(DEPTH.overlay + 2);
    this.screen.add(this.hurtFlash);

    this.elevatorBackdrop = this.screen.frame('panel', 0, 0, 220, 80);
    this.elevatorTitle = this.screen.pixelText(16, 12, 20, PALETTE['light.7']).setText('Thang máy');
    this.elevatorPanel = this.scene.add
      .container(0, 0, [this.elevatorBackdrop, this.elevatorTitle])
      .setDepth(DEPTH.modal)
      .setVisible(false);
    this.screen.add(this.elevatorPanel);
  }

  layout(width: number, height: number) {
    this.hurtFlash.setPosition(width / 2, height / 2).setSize(width, height);
    this.placeElevatorPanel(width, height);
  }

  /** Forgets every monster sprite and the dark, which went with the area's layer. */
  forgetArea() {
    this.monsters.clear();
    this.darkness = null;
    this.darkBands = [];
    this.torchGlows = [];
    this.drawnPlaceables = null;
    this.handGlow = null;
    this.closeElevator();
  }

  /**
   * Lays the dark over a floor that has just been built.
   *
   * In the area's layer, so it goes when the floor does. A picture with a hole
   * in it for the light, and four bands of the same colour round it reaching
   * far past any screen, rather than a render texture with holes cut in it
   * every frame: four rectangles and an image are the cheapest possible dark,
   * and they cannot fail on a renderer that does not like render textures.
   */
  buildDarkness() {
    const depth = this.context.builtArea ? mineDepth(this.context.builtArea) : null;
    if (depth === null) return;
    const colour = tint('outline.2');
    const alpha = mineDarkness(depth);
    this.darkness = this.scene.add.image(0, 0, 'mine-light').setDepth(DARKNESS_DEPTH).setAlpha(alpha);
    this.darkBands = [0, 1, 2, 3].map(() =>
      this.scene.add.rectangle(0, 0, 1, 1, colour, alpha).setOrigin(0, 0).setDepth(DARKNESS_DEPTH),
    );
    this.context.areaLayer?.addMultiple([this.darkness, ...this.darkBands]);

    this.handGlow = this.glowSprite();
    this.context.areaLayer?.add(this.handGlow);
    this.syncTorches();
  }

  /** One glow per torch standing on the built floor, redrawn when the placeables change. */
  private syncTorches() {
    const { placeables } = this.context.farm;
    const area = this.context.builtArea;
    if (!area || placeables === this.drawnPlaceables) return;
    this.drawnPlaceables = placeables;
    for (const glow of this.torchGlows) glow.destroy();
    this.torchGlows = [];
    for (const torch of placeablesOn(placeables, area)) {
      if (torch.kind !== 'torch') continue;
      const glow = this.glowSprite().setPosition(
        torch.x * TILE_SIZE + TILE_SIZE / 2,
        torch.y * TILE_SIZE + TILE_SIZE / 2,
      );
      glow.setData('seed', torch.x * 7 + torch.y * 13);
      this.torchGlows.push(glow);
      this.context.areaLayer?.add(glow);
    }
  }

  private glowSprite(): Phaser.GameObjects.Image {
    return this.scene.add
      .image(0, 0, 'glow')
      .setDepth(TORCH_GLOW_DEPTH)
      .setTint(tint('light.4'))
      .setBlendMode(Phaser.BlendModes.ADD)
      .setVisible(false);
  }

  // --- every frame ----------------------------------------------------------

  update(delta: number) {
    this.syncMonsters(delta);
    this.updateDarkness();
    this.updateElevator();
  }

  /**
   * Draws the monsters on the built floor, chasing the state the way the herd
   * does: the reducer moves them once a clock step and the frames between are
   * a straight line at constant speed.
   */
  private syncMonsters(delta: number) {
    const area = this.context.builtArea;
    const here: Monster[] = area ? this.context.farm.monsters.filter((monster) => monster.area === area) : [];
    const present = new Set<string>();
    const now = this.scene.time.now;
    const step = now < this.frozenUntil ? 0 : delta;

    for (const monster of here) {
      present.add(monster.id);
      let drawn = this.monsters.get(monster.id);
      if (!drawn) {
        drawn = this.createMonster(monster);
        this.monsters.set(monster.id, drawn);
      }

      const moving = advanceChase(drawn.chase, monster.x, monster.y, step);
      // A slime breathes; a skeleton's own walk cycle is its movement.
      const bob = drawn.art ? 0 : Math.sin(now / 180 + drawn.phase) * 1.5;
      drawn.sprite.setPosition(Math.round(drawn.chase.x), Math.round(drawn.chase.y - (drawn.art?.lift ?? 6) + bob));
      this.animateMonster(drawn, moving);
      drawn.shadow.setPosition(Math.round(drawn.chase.x), Math.round(drawn.chase.y + 8));
      const row = Math.floor(drawn.chase.y / TILE_SIZE) + AVATAR_DEPTH_BASE;
      drawn.sprite.setDepth(row);
      drawn.shadow.setDepth(row - 1);

      if (monster.health < drawn.health) this.struck(drawn);
      drawn.health = monster.health;
    }

    for (const [id, drawn] of this.monsters) {
      if (present.has(id)) continue;
      // Gone without a `monsterKilled`: its floor was forgotten, or it was
      // never ours to watch die. No ceremony.
      drawn.sprite.destroy();
      drawn.shadow.destroy();
      this.monsters.delete(id);
    }
  }

  /** The walk, attack and death of every monster sheet that loaded, one per direction. */
  createMonsterAnimations() {
    const sheets = new Set(Object.values(MONSTER_ART).map((art) => art.sheet));
    for (const sheet of sheets) {
      for (const { action, frameRate, repeat } of MONSTER_ACTIONS) {
        const texture = `monster-${sheet}-${action}-sheet`;
        if (!this.scene.textures.exists(texture)) continue;
        for (const dir of ['up', 'left', 'down', 'right'] as Direction[]) {
          const key = `monster-${sheet}-${action}-${dir}`;
          if (this.scene.anims.exists(key)) continue;
          const start = WALK_ROW[dir] * ACTION_FRAMES;
          this.scene.anims.create({
            key,
            frames: this.scene.anims.generateFrameNumbers(texture, { start, end: start + ACTION_FRAMES - 1 }),
            frameRate,
            repeat,
          });
        }
      }
    }
  }

  /** The art a monster is drawn from, when its sheet actually loaded. */
  private artFor(kind: MonsterKind): MonsterArt | null {
    const art = MONSTER_ART[kind];
    return art && this.scene.textures.exists(`monster-${art.sheet}-walk-sheet`) ? art : null;
  }

  private createMonster(monster: Monster): MonsterSprite {
    const art = this.artFor(monster.kind);
    const texture = art ? `monster-${art.sheet}-walk-sheet` : `monster-${monster.kind}`;
    const shadow = this.scene.add
      .image(monster.x, monster.y + 8, 'shadow')
      .setScale(monster.kind === 'floor-boss' ? 1.8 : 0.9)
      .setVisible(art?.shadow ?? true);
    const sprite = this.scene.add.sprite(
      monster.x,
      monster.y,
      this.scene.textures.exists(texture) ? texture : 'dust',
      art ? WALK_ROW.down * ACTION_FRAMES : undefined,
    );
    if (art) {
      sprite.setScale(art.scale).setAlpha(art.alpha);
      if (art.tint !== null) sprite.setTint(art.tint);
    }
    this.context.areaLayer?.addMultiple([shadow, sprite]);
    let phase = 0;
    for (let i = 0; i < monster.id.length; i += 1) phase += monster.id.charCodeAt(i);
    return {
      sprite,
      shadow,
      chase: createChase(monster.x, monster.y),
      health: monster.health,
      phase,
      art,
      facing: 'down',
      attackingUntil: 0,
    };
  }

  /**
   * Picks the animation a sheet monster should be showing this frame: its
   * attack while one is playing, its walk while it moves, and its walk's first
   * frame while it stands.
   */
  private animateMonster(drawn: MonsterSprite, moving: boolean) {
    const art = drawn.art;
    if (!art) return;
    if (moving) drawn.facing = chaseFacing(drawn.chase);
    if (this.scene.time.now < drawn.attackingUntil) return;
    const walk = `monster-${art.sheet}-walk-${drawn.facing}`;
    if (!this.scene.anims.exists(walk)) return;
    if (moving) {
      drawn.sprite.anims.play(walk, true);
    } else {
      drawn.sprite.anims.stop();
      drawn.sprite.setFrame(WALK_ROW[drawn.facing] * ACTION_FRAMES);
    }
  }

  /** Swings a sheet monster's weapon, facing whoever it is swinging at. */
  private monsterAttack(drawn: MonsterSprite, target: Point) {
    const art = drawn.art;
    if (!art) return;
    const dx = target.x - drawn.chase.x;
    const dy = target.y - drawn.chase.y;
    drawn.facing = Math.abs(dy) > Math.abs(dx) ? (dy > 0 ? 'down' : 'up') : dx > 0 ? 'right' : 'left';
    const key = `monster-${art.sheet}-attack-${drawn.facing}`;
    if (!this.scene.anims.exists(key)) return;
    drawn.sprite.anims.play(key, true);
    drawn.attackingUntil = this.scene.time.now + (ACTION_FRAMES / 16) * 1000;
  }

  /** A monster lost health: it flashes, and if it was our blow, time holds for a moment. */
  private struck(drawn: MonsterSprite) {
    drawn.sprite.setTint(tint('light.7')).setTintMode(Phaser.TintModes.FILL);
    this.scene.time.delayedCall(FLASH_MS, () => {
      if (!drawn.sprite.active) return;
      drawn.sprite.clearTint();
      if (drawn.art?.tint != null) drawn.sprite.setTint(drawn.art.tint);
    });
    if (this.scene.time.now - this.lastSwingAt < SWING_CREDIT_MS) this.hitstop(HITSTOP_MS);
  }

  /**
   * Hitstop: every animation and tween in the scene paused for a few frames.
   *
   * The whole of combat's feel, per spec 13 — without it a sword passes
   * through a slime like a hand through smoke. Paused rather than slowed,
   * because a slowdown this short is not something an eye can read as one.
   * The monsters' own walk is held by `frozenUntil`, since a chase is not a
   * tween. The simulation is untouched: the server does not stop for anybody.
   */
  private hitstop(ms: number) {
    const now = this.scene.time.now;
    if (now < this.frozenUntil) return;
    this.frozenUntil = now + ms;
    this.scene.anims.pauseAll();
    this.scene.tweens.pauseAll();
    this.scene.cameras.main.shake(ms, 0.002);
    this.scene.time.delayedCall(ms, () => {
      this.scene.anims.resumeAll();
      this.scene.tweens.resumeAll();
    });
  }

  /**
   * The dark follows the local player, with a torch-sized hole round them.
   * Every lit torch on the floor glows on top of it.
   */
  private updateDarkness() {
    const player = this.context.localPlayer;
    if (!this.darkness || !player) return;
    this.syncTorches();
    const seconds = this.scene.time.now / 1000;

    const held = slotAt(player.inventory, player.selectedSlot);
    const torch = held?.item === 'torch';
    const radius = lightRadius(torch) * (torch ? flicker(seconds) : 1);
    // The texture is dark from `MINE_LIGHT_EDGE` of its half-width out, so
    // this is the scale that puts that edge at `radius`.
    const scale = radius / ((MINE_LIGHT_SIZE / 2) * MINE_LIGHT_EDGE);
    const half = Math.round((MINE_LIGHT_SIZE / 2) * scale);
    const avatar = this.avatars.avatarFor(player.id);
    const cx = Math.round(avatar?.sprite.x ?? player.x);
    const cy = Math.round(avatar?.sprite.y ?? player.y);

    this.darkness.setPosition(cx, cy).setDisplaySize(half * 2, half * 2);
    const [top, bottom, left, right] = this.darkBands;
    top.setPosition(cx - half - DARK_REACH, cy - half - DARK_REACH).setSize(half * 2 + DARK_REACH * 2, DARK_REACH);
    bottom.setPosition(cx - half - DARK_REACH, cy + half).setSize(half * 2 + DARK_REACH * 2, DARK_REACH);
    left.setPosition(cx - half - DARK_REACH, cy - half).setSize(DARK_REACH, half * 2);
    right.setPosition(cx + half, cy - half).setSize(DARK_REACH, half * 2);

    if (this.handGlow) {
      this.handGlow.setVisible(torch);
      if (torch) {
        this.handGlow.setPosition(cx, cy - 4).setScale((radius / 48) * 0.6).setAlpha(0.35 * flicker(seconds, 3));
      }
    }
    for (const glow of this.torchGlows) {
      const seed = Number(glow.getData('seed') ?? 0);
      glow.setVisible(true).setScale((PLACED_TORCH_RADIUS / 48) * 0.6 * flicker(seconds, seed)).setAlpha(0.45);
    }
  }

  // --- events ---------------------------------------------------------------

  handleEvent(event: GameEvent, localPlayerId: string | null) {
    if (event.kind === 'monsterKilled') {
      this.dissolve(event.id);
      if (event.playerId === localPlayerId) {
        this.hitstop(KILL_HITSTOP_MS);
        this.flyDrops(event.id, event.drops);
      }
    } else if (event.kind === 'damaged') {
      this.hurt(event.playerId, event.playerId === localPlayerId);
    } else if (event.kind === 'faint' && event.playerId === localPlayerId) {
      this.scene.cameras.main.fadeIn(900, 0, 0, 0);
    } else if (event.kind === 'descended' && event.playerId === localPlayerId) {
      // A floor you drop into should arrive out of the dark, not snap in.
      this.scene.cameras.main.fadeIn(350, 0, 0, 0);
    }
  }

  /** A monster coming apart: motes rising off it while it slumps and fades. */
  private dissolve(id: string) {
    const drawn = this.monsters.get(id);
    if (!drawn) return;
    this.monsters.delete(id);
    const { sprite, shadow } = drawn;

    // A skeleton with its own death plays it through, then fades where it fell.
    const death = drawn.art ? `monster-${drawn.art.sheet}-death-${drawn.facing}` : null;
    if (death && this.scene.anims.exists(death)) {
      sprite.anims.play(death, true);
      sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
        this.scene.tweens.add({
          targets: [sprite, shadow],
          alpha: 0,
          duration: 400,
          delay: 250,
          onComplete: () => {
            sprite.destroy();
            shadow.destroy();
          },
        });
      });
      return;
    }

    sprite.setTint(tint('light.7')).setTintMode(Phaser.TintModes.FILL);

    for (let i = 0; i < 10; i += 1) {
      const angle = (i / 10) * Math.PI * 2;
      const mote = this.scene.add
        .image(sprite.x + Math.cos(angle) * 6, sprite.y + Math.sin(angle) * 4, 'mine-mote')
        .setDepth(sprite.depth + 1)
        .setTint(i % 2 === 0 ? tint('light.7') : tint('light.6'));
      this.context.areaLayer?.add(mote);
      this.scene.tweens.add({
        targets: mote,
        x: mote.x + Math.cos(angle) * 14,
        y: mote.y - 18 - (i % 3) * 6,
        alpha: 0,
        scale: 0.3,
        duration: 420 + i * 25,
        ease: 'Quad.easeOut',
        onComplete: () => mote.destroy(),
      });
    }
    this.scene.tweens.add({
      targets: [sprite, shadow],
      alpha: 0,
      scaleY: 0.2,
      y: sprite.y + 6,
      duration: 260,
      ease: 'Quad.easeIn',
      onComplete: () => {
        sprite.destroy();
        shadow.destroy();
      },
    });
  }

  /** What dropped, flying from where the monster was into the player's hands. */
  private flyDrops(id: string, drops: Array<{ item: string; count: number }>) {
    const player = this.context.localPlayer;
    const from = this.monsterPoint(id) ?? (player ? { x: player.x, y: player.y } : null);
    if (!player || !from) return;
    drops.forEach((drop, index) => {
      const texture = ITEMS[drop.item]?.texture;
      if (!texture || !this.scene.textures.exists(texture)) return;
      const icon = this.scene.add
        .image(from.x + index * 6, from.y - 10, texture)
        .setDepth(DARKNESS_DEPTH + 2);
      this.context.areaLayer?.add(icon);
      this.scene.tweens.add({
        targets: icon,
        x: player.x,
        y: player.y - 12,
        alpha: 0.2,
        duration: 480,
        delay: 120 + index * 60,
        ease: 'Back.easeIn',
        onComplete: () => icon.destroy(),
      });
    });
  }

  private monsterPoint(id: string): Point | null {
    const monster = this.context.farm.monsters.find((entry) => entry.id === id);
    if (monster) return { x: monster.x, y: monster.y };
    return null;
  }

  /** Somebody was hit. Their avatar flashes; if it was you, the glass does too. */
  private hurt(playerId: string, local: boolean) {
    const avatar = this.avatars.avatarFor(playerId);
    // No event names the monster that struck, so the one standing nearest
    // the victim is shown swinging. Only a picture, like everything here.
    const victim = this.context.farm.players[playerId];
    if (victim) {
      let nearest: MonsterSprite | null = null;
      let best = 48;
      for (const drawn of this.monsters.values()) {
        const gap = Math.hypot(drawn.chase.x - victim.x, drawn.chase.y - victim.y);
        if (gap < best) {
          best = gap;
          nearest = drawn;
        }
      }
      if (nearest) this.monsterAttack(nearest, victim);
    }
    if (avatar) {
      avatar.sprite.setTint(tint('building.3')).setTintMode(Phaser.TintModes.FILL);
      this.scene.time.delayedCall(120, () => {
        if (avatar.sprite.active) avatar.sprite.clearTint();
      });
    }
    if (!local) return;
    this.scene.cameras.main.shake(160, 0.006);
    this.scene.tweens.killTweensOf(this.hurtFlash);
    this.hurtFlash.setAlpha(0.28);
    this.scene.tweens.add({ targets: this.hurtFlash, alpha: 0, duration: 320, ease: 'Quad.easeOut' });
  }

  // --- the sword ------------------------------------------------------------

  /**
   * The fan of a swing, drawn the moment the key goes down.
   *
   * Drawn here rather than waited on, because a swing that appears a network
   * round trip after the key is a swing that feels broken. It is only ever a
   * picture: whether anything was in it is the server's answer, and the
   * answer is what flashes the monster and stops time.
   *
   * Drawn as a pie slice in a Graphics object rather than a rotated sprite,
   * which is the one thing this renderer cannot be trusted to draw whole.
   */
  swing(player: PlayerState, target: Point | null) {
    const held = slotAt(player.inventory, player.selectedSlot);
    if (!held || ITEMS[held.item]?.tool !== 'sword') return;
    this.lastSwingAt = this.scene.time.now;

    let aim = FACING_ANGLES[player.facing];
    if (target) {
      const tx = target.x * TILE_SIZE + TILE_SIZE / 2;
      const ty = target.y * TILE_SIZE + TILE_SIZE / 2;
      if (tx !== player.x || ty !== player.y) aim = Math.atan2(ty - player.y, tx - player.x);
    }
    const spread = Math.acos(SWORD_FAN_COS);
    const x = player.x;
    const y = player.y;

    const fan = this.scene.add.graphics().setDepth(SWING_DEPTH);
    this.context.areaLayer?.add(fan);
    const draw = (through: number, alpha: number) => {
      fan.clear();
      const start = aim - spread;
      const end = start + spread * 2 * through;
      fan.fillStyle(tint('light.7'), 0.32 * alpha);
      fan.slice(x, y, SWORD_REACH_PX, start, end, false);
      fan.fillPath();
      fan.lineStyle(2, tint('light.6'), 0.9 * alpha);
      fan.beginPath();
      fan.arc(x, y, SWORD_REACH_PX - 2, start, end, false);
      fan.strokePath();
    };

    const sweep = { through: 0, alpha: 1 };
    this.scene.tweens.add({
      targets: sweep,
      through: 1,
      duration: SWING_SWEEP_MS,
      ease: 'Quad.easeOut',
      onUpdate: () => draw(sweep.through, sweep.alpha),
      onComplete: () => {
        this.scene.tweens.add({
          targets: sweep,
          alpha: 0,
          duration: SWING_FADE_MS,
          onUpdate: () => draw(1, sweep.alpha),
          onComplete: () => fan.destroy(),
        });
      },
    });
    draw(0, 1);
  }

  // --- the elevator ---------------------------------------------------------

  /**
   * Opens the list of stops this farm has opened.
   *
   * On an elevator floor, the stops. At the mouth of the mine, the stops and
   * the first floor as well, because from up there the ladder to floor 1 is
   * the other way down. Returns false when there is nothing to list.
   */
  openElevator(player: PlayerState, fromSurface: boolean): boolean {
    const stops = elevatorStops(this.context.farm);
    if (stops.length === 0) return false;
    const choices = fromSurface ? [1, ...stops] : stops;

    for (const button of this.elevatorButtons) button.destroy();
    this.elevatorButtons = choices.map((depth) => {
      const button = this.scene.add
        .text(0, 0, `Tầng ${depth}`, {
          fontFamily: PROSE_FONT,
          fontSize: '15px',
          color: PALETTE['light.7'],
          backgroundColor: PALETTE['soil.2'],
          padding: { x: 10, y: 5 },
        })
        .setInteractive({ useHandCursor: true });
      button.on('pointerover', () => button.setBackgroundColor(PALETTE['soil.4']));
      button.on('pointerout', () => button.setBackgroundColor(PALETTE['soil.2']));
      button.on('pointerdown', () => {
        this.context.audio.play('ui-confirm');
        // Floor 1 is not an elevator stop; from the mouth it is the ladder.
        sendAction(depth === 1 ? { type: 'descend' } : { type: 'useElevator', depth });
        this.closeElevator();
      });
      return button;
    });
    // Pinned to the camera for hit-testing (see `ScreenLayer.add`), but put in
    // the panel's own container rather than the screen's, so they move with it.
    for (const button of this.elevatorButtons) button.setScrollFactor(0);
    this.elevatorPanel.add(this.elevatorButtons);
    this.elevatorOpenedAt = {
      area: player.area,
      x: Math.floor(player.x / TILE_SIZE),
      y: Math.floor(player.y / TILE_SIZE),
    };
    this.elevatorPanel.setVisible(true);
    const { width, height } = this.scene.scale;
    this.placeElevatorPanel(width, height);
    return true;
  }

  get elevatorOpen(): boolean {
    return this.elevatorPanel?.visible ?? false;
  }

  closeElevator() {
    if (!this.elevatorPanel) return;
    this.elevatorPanel.setVisible(false);
    this.elevatorOpenedAt = null;
    this.elevatorBounds.setTo(0, 0, 0, 0);
  }

  /** Whether a screen point is on the elevator's panel, so a click there is not a swing. */
  containsPointer(x: number, y: number): boolean {
    return this.elevatorOpen && this.elevatorBounds.contains(x, y);
  }

  private placeElevatorPanel(width: number, height: number) {
    if (!this.elevatorPanel) return;
    const columns = Math.max(1, Math.min(4, this.elevatorButtons.length));
    const rows = Math.max(1, Math.ceil(this.elevatorButtons.length / 4));
    const panelWidth = 32 + columns * 92;
    const panelHeight = 56 + rows * 38;
    const x = Math.round((width - panelWidth) / 2);
    const y = Math.round(height * 0.3);
    this.elevatorPanel.setPosition(x, y);
    this.elevatorBackdrop.setSize(panelWidth, panelHeight);
    this.elevatorButtons.forEach((button, index) => {
      button.setPosition(16 + (index % 4) * 92, 44 + Math.floor(index / 4) * 38);
    });
    if (this.elevatorOpen) this.elevatorBounds.setTo(x, y, panelWidth, panelHeight);
  }

  /** Walking off the spot it was opened on, or to another floor, puts the panel away. */
  private updateElevator() {
    if (!this.elevatorOpen) return;
    const player = this.context.localPlayer;
    const at = this.elevatorOpenedAt;
    if (
      !player ||
      !at ||
      player.area !== at.area ||
      Math.floor(player.x / TILE_SIZE) !== at.x ||
      Math.floor(player.y / TILE_SIZE) !== at.y
    ) {
      this.closeElevator();
    }
  }
}

/** The way each facing points, as an angle in radians, for the fan. */
const FACING_ANGLES: Record<PlayerState['facing'], number> = {
  right: 0,
  down: Math.PI / 2,
  left: Math.PI,
  up: -Math.PI / 2,
};
