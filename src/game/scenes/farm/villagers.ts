/**
 * The villagers, as they are drawn.
 *
 * The reducer walks the village on the clock; this is the renderer's half of
 * that bargain. A sprite, a shadow and a name per person on the built area,
 * the star over whoever is carrying the quest, and the heart a liked gift
 * earns.
 */
import type Phaser from 'phaser';
import { LPC_SHEETS } from '../../assets/lpc.generated';
import { PALETTE } from '../../assets/palette.generated';
import { npcDef, type NpcId } from '../../npcs/definitions';
import type { NpcActor } from '../../npcs/schedule';
import { advanceChase, chaseFacing, createChase, type TickChase } from '../../view/tickChase';
import { TILE_SIZE, type Direction } from '../../world/areas';
import { AVATAR_DEPTH_BASE, PROSE_FONT, WALK_FRAMES, standFrame, type SceneContext } from './shared';

/**
 * One villager on screen.
 *
 * `facing` is kept here rather than read off the state because the state does
 * not have one: which way somebody is turned is a consequence of the direction
 * they are being drawn moving, which only the renderer knows.
 */
interface Villager {
  sprite: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  sheet: string;
  facing: Direction;
  /** The walk between the last clock step's position and this one's. */
  chase: TickChase;
}

/** Which way to turn to look at a point: the axis it is further along wins. */
export function facingToward(fromX: number, fromY: number, toX: number, toY: number): Direction {
  const dx = toX - fromX;
  const dy = toY - fromY;
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 'left' : 'right';
  return dy < 0 ? 'up' : 'down';
}

/** The people standing on the built area, and the marks they carry. */
export class VillagerView {
  /** One record per villager standing on the built area. */
  private villagers = new Map<NpcId, Villager>();
  private questIcon: Phaser.GameObjects.Image | null = null;
  /**
   * Who is in a conversation with this player, and the point they are looking
   * at. Held here rather than in the state: the reducer walks the village for
   * everybody at once, and a villager stopping for one player's chat would stop
   * them on every other player's screen too. So they stop on yours, and the
   * walk catches up when the box closes.
   */
  private listener: { npc: NpcId; x: number; y: number } | null = null;

  private readonly context: Pick<SceneContext, 'scene' | 'farm' | 'builtArea' | 'areaLayer'>;
  private readonly scene: Phaser.Scene;

  constructor(context: Pick<SceneContext, 'scene' | 'farm' | 'builtArea' | 'areaLayer'>) {
    this.context = context;
    this.scene = context.scene;
  }

  /** Lets go of the quest marker, which went with the layer it was drawn in. */
  forgetArea() {
    this.questIcon = null;
  }

  /** Turns somebody to face a point, and keeps them there until `stopListening`. */
  listen(npc: NpcId, x: number, y: number) {
    this.listener = { npc, x, y };
  }

  stopListening() {
    this.listener = null;
  }

  /**
   * Draws the people standing on the built area.
   *
   * Their positions only change on a clock step — every 1.2 real seconds —
   * because that is when the reducer walks them, so drawing them straight onto
   * the state position would be a hop every second rather than a walk. The
   * sprite chases the state instead, which is the renderer's job and not the
   * reducer's: the world stays cheap to send and the village still moves.
   */
  syncNpcs(delta: number) {
    const here = this.context.farm.npcs.filter((actor) => actor.area === this.context.builtArea);
    const present = new Set(here.map((actor) => actor.id));

    for (const actor of here) {
      let villager = this.villagers.get(actor.id);
      if (!villager) {
        villager = this.createVillager(actor);
        this.villagers.set(actor.id, villager);
      }

      const { sprite, shadow, label, chase } = villager;

      if (this.listener?.npc === actor.id) {
        // Stood still and turned to you, on the spot the sprite is drawn at
        // rather than the one the state has moved on to. The chase is not
        // advanced, so when the box closes the walk resumes from here.
        villager.facing = facingToward(sprite.x, sprite.y, this.listener.x, this.listener.y);
        sprite.anims.stop();
        if (this.scene.anims.exists(`${villager.sheet}-walk-down`)) sprite.setFrame(standFrame(villager.facing));
        continue;
      }

      // The same walk the herd gets, and for the same reason — a villager
      // covers 120 world pixels a step rather than an animal's 60, so the old
      // exponential ease launched them at 462 px/s against a true pace of 100.
      // Rowan crossing the square looked like Rowan being thrown across it.
      const walking = advanceChase(chase, actor.x, actor.y, delta);
      sprite.setPosition(chase.x, chase.y);
      const facing = chaseFacing(chase);

      // The same row-based band the players and the buildings sort into, so a
      // villager walks behind the market stall and in front of the well.
      sprite.setDepth(Math.floor(sprite.y / TILE_SIZE) + AVATAR_DEPTH_BASE);
      shadow.setPosition(sprite.x, sprite.y + 16);
      shadow.setDepth(sprite.depth - 1);
      label.setPosition(sprite.x, sprite.y - 26);
      label.setDepth(sprite.depth + 4);

      const walkKey = `${villager.sheet}-walk-${walking ? facing : villager.facing}`;
      if (walking) villager.facing = facing;
      if (this.scene.anims.exists(walkKey)) {
        if (walking) sprite.anims.play(walkKey, true);
        else {
          sprite.anims.stop();
          sprite.setFrame(standFrame(villager.facing));
        }
      }
    }

    for (const [id, villager] of this.villagers) {
      if (present.has(id)) continue;
      villager.sprite.destroy();
      villager.shadow.destroy();
      villager.label.destroy();
      this.villagers.delete(id);
    }

    // The quest marker belongs over whoever is carrying the quest, which is a
    // person who walks rather than a tile on the map — so it follows them
    // instead of being pinned where they happened to be standing at dawn.
    const giver = here.find((actor) => npcDef(actor.id).questGiver);
    const carrier = giver ? this.villagers.get(giver.id) : undefined;
    if (carrier && !this.questIcon) {
      this.questIcon = this.scene.add.image(carrier.sprite.x, carrier.sprite.y - 42, 'quest-star');
      this.context.areaLayer?.add(this.questIcon);
      this.scene.tweens.add({
        targets: this.questIcon,
        scale: 1.18,
        yoyo: true,
        repeat: -1,
        duration: 900,
        ease: 'Sine.inOut',
      });
    }
    if (this.questIcon && carrier) {
      this.questIcon.setPosition(carrier.sprite.x, carrier.sprite.y - 42);
      this.questIcon.setDepth(carrier.sprite.depth + 5);
    }
    this.questIcon?.setVisible(Boolean(carrier) && !this.context.farm.quest.rewarded);
  }

  private createVillager(actor: NpcActor): Villager {
    const def = npcDef(actor.id);
    // The two real LPC walk cycles that ship, recoloured per person. A sheet
    // that is not loaded falls back to the procedural sprite, exactly as the
    // player's avatar already does.
    const hasSheet = this.scene.textures.exists(def.sheet);
    const shadow = this.scene.add.image(actor.x, actor.y + 16, 'shadow');
    const sprite = this.scene.add
      .sprite(actor.x, actor.y, hasSheet ? def.sheet : def.texture, hasSheet ? standFrame('down') : undefined)
      .setScale(hasSheet ? 0.6 : 1.15);
    if (hasSheet && def.tint !== 0xffffff) sprite.setTint(def.tint);

    const label = this.scene.add
      .text(actor.x, actor.y - 26, def.name, {
        // Not VT323: a name over a head is drawn well under the 16px where its
        // tone marks survive, so it is set like the players' own labels.
        fontFamily: PROSE_FONT,
        fontSize: '11px',
        color: PALETTE['light.7'],
        stroke: PALETTE['outline.2'],
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1);

    this.context.areaLayer?.addMultiple([shadow, sprite, label]);
    return {
      sprite,
      shadow,
      label,
      sheet: hasSheet ? def.sheet : def.texture,
      facing: 'down',
      chase: createChase(actor.x, actor.y),
    };
  }

  /**
   * A walk cycle per sheet, built once.
   *
   * The animation keys are named for the sheet rather than for the villager,
   * so a sheet two people share — the player's, say, lent to somebody whose
   * own is not drawn yet — is one set of four rather than two.
   */
  createVillagerAnimations() {
    for (const sheet of LPC_SHEETS) {
      if (!this.scene.textures.exists(sheet)) continue;
      (['up', 'left', 'down', 'right'] as Direction[]).forEach((dir) => {
        const key = `${sheet}-walk-${dir}`;
        if (this.scene.anims.exists(key)) return;
        this.scene.anims.create({
          key,
          frames: this.scene.anims.generateFrameNumbers(sheet, {
            start: standFrame(dir),
            end: standFrame(dir) + WALK_FRAMES - 1,
          }),
          // A shade slower than the player, because they are ambling and the
          // player is usually late for something.
          frameRate: 8,
          repeat: -1,
        });
      });
    }
  }

  /** A heart, floating off somebody who just got a gift they liked. */
  popHeart(npc: NpcId) {
    const villager = this.villagers.get(npc);
    if (!villager) return;
    const heart = this.scene.add
      .image(villager.sprite.x, villager.sprite.y - 30, 'heart')
      .setDepth(villager.sprite.depth + 6)
      .setScale(1.6);
    this.context.areaLayer?.add(heart);
    this.scene.tweens.add({
      targets: heart,
      y: heart.y - 26,
      alpha: 0,
      duration: 1100,
      ease: 'Sine.out',
      onComplete: () => heart.destroy(),
    });
  }
}
