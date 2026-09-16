/**
 * The herd, as it is drawn.
 *
 * The reducer moves the animals once a clock step and knows nothing about
 * which way one is facing or what it looks like mid-stride. This is the half
 * that does: a sprite per animal out of doors, chasing the state, and the
 * heart that floats off one when it is stroked.
 */
import type Phaser from 'phaser';
import { LPC_ANIMAL_SHEETS } from '../../assets/lpc.generated';
import { animalsOn, type Animal, type AnimalKind } from '../../systems/animals';
import { advanceChase, chaseFacing, createChase, type TickChase } from '../../view/tickChase';
import { START_AREA, TILE_SIZE, type Direction } from '../../world/areas';
import { AVATAR_DEPTH_BASE, WALK_ROW, type SceneContext } from './shared';

/**
 * How big each animal is drawn, as a multiplier on its own art.
 *
 * Mostly 0.62, which is not a number picked for animals at all: it is what the
 * player's LPC sheet is drawn at, and it is the factor that turns LPC's world
 * into this one's. Anything imported from the same set and drawn at the same
 * number is in proportion with everybody else for free.
 *
 * The goat is the exception, and it is an exception in the art rather than in
 * the taste: bluecarrot16 drew it over daneeklu's llama, so it stands a head
 * taller than the cow's shoulder and at 0.62 it would look down on the farmer.
 * Scaled to what a goat is instead, which is about waist height.
 */
const ANIMAL_SCALE: Record<AnimalKind, number> = {
  chicken: 0.62,
  duck: 0.62,
  cow: 0.62,
  goat: 0.46,
};

/** An animal walk sheet: four frames a row, four rows, same order as the people. */
const ANIMAL_WALK_FRAMES = 4;

/** The same, on an animal sheet, where a row is four frames rather than nine. */
function animalStandFrame(facing: Direction): number {
  return WALK_ROW[facing] * ANIMAL_WALK_FRAMES;
}

/**
 * One animal on screen.
 *
 * `facing` is a `Direction` and not a sign any more. It was a sign because the
 * animals used to be one side-on drawing apiece, mirrored for the other way,
 * and a mirrored cow is a cow whose head is on the wrong end of a sheet that
 * only has one head. The real art has all four, so the renderer picks a row
 * instead of a flip — and a hen walking away from you now shows you her back.
 *
 * It is kept here and not read off the state for the same reason a villager's
 * is: the state has no such field, because which way something is turned is a
 * consequence of how it is being drawn moving.
 *
 * `x`/`y` are the animal's own position, kept apart from the sprite's. The
 * sprite's `y` carries the graze sway on top of it, and sway written back into
 * the position it was measured from is a number that climbs.
 */
interface AnimalSprite {
  sprite: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Image;
  /** The exclamation over a hungry animal. Hidden the moment it is fed. */
  marker: Phaser.GameObjects.Image;
  facing: Direction;
  /** The walk sheet it is drawn on, or null while it is on the fallback art. */
  sheet: string | null;
  /** The walk between the last clock step's position and this one's. */
  chase: TickChase;
}

/** The animals out of doors on the built area, and everything they do on screen. */
export class HerdView {
  /** One record per animal out of doors, keyed by animal id. */
  private animalSprites = new Map<string, AnimalSprite>();

  private readonly context: Pick<SceneContext, 'scene' | 'farm' | 'builtArea' | 'areaLayer'>;
  private readonly scene: Phaser.Scene;

  constructor(context: Pick<SceneContext, 'scene' | 'farm' | 'builtArea' | 'areaLayer'>) {
    this.context = context;
    this.scene = context.scene;
  }

  /**
   * Draws the animals that are out of doors.
   *
   * The same arrangement the villagers get and for the same reason: the
   * reducer only moves them on a clock step, every 1.2 real seconds, so a
   * sprite drawn straight onto the state position would hop once a second
   * rather than amble. The sprite chases the state instead — which is the
   * renderer's job, and is what keeps fourteen animals out of the state on
   * every frame and off the wire on every tick.
   *
   * An animal with no `position` is indoors and simply has no sprite. There
   * are no interiors in this game, so "indoors" is drawn as "not there", which
   * is honest: the door being shut is the thing the player can see.
   */
  syncAnimals(delta: number) {
    const here = animalsOn(this.context.farm.animals, this.context.builtArea ?? START_AREA);
    const present = new Set(here.map((animal) => animal.id));

    for (const animal of here) {
      if (!animal.position) continue;
      let drawn = this.animalSprites.get(animal.id);
      if (!drawn) {
        drawn = this.createAnimalSprite(animal);
        this.animalSprites.set(animal.id, drawn);
      }

      const { sprite, shadow, marker, chase } = drawn;

      // One step of the reducer's walk, drawn at one speed across the 1.2
      // seconds it has to cover.
      const moving = advanceChase(chase, animal.position.x, animal.position.y, delta);

      // Which way it is going, as one of the four the art has. Held through a
      // standstill: an animal that stopped should still face the way it walked.
      if (moving) drawn.facing = chaseFacing(chase);

      if (drawn.sheet) {
        const anim = `${drawn.sheet}-walk-${drawn.facing}`;
        if (this.scene.anims.exists(anim)) {
          if (moving) sprite.anims.play(anim, true);
          else {
            sprite.anims.stop();
            sprite.setFrame(animalStandFrame(drawn.facing));
          }
        }
      } else {
        // The fallback art is one side-on drawing, so it can only be flipped.
        sprite.setFlipX(drawn.facing === 'left');
      }

      // No sway. There used to be one, back when the whole of an animal's
      // animation was a sine wave applied to a single static drawing — and it
      // is worth saying why it is gone rather than just deleting it. The
      // camera rounds to whole pixels, so a wobble smaller than a pixel does
      // not read as a gentle rock: it reads as the sprite snapping between two
      // pixel rows, twice a second, which is the exact thing this pass set out
      // to remove. The walk cycle is the animation now.
      sprite.setPosition(chase.x, chase.y);

      // The same row-based band the players, the villagers and the buildings
      // sort into, so a cow south of the barn is drawn in front of it.
      sprite.setDepth(Math.floor(chase.y / TILE_SIZE) + AVATAR_DEPTH_BASE);
      shadow.setPosition(chase.x, chase.y + sprite.displayHeight / 2 - 2);
      shadow.setDepth(sprite.depth - 1);

      // The one piece of information an animal carries on its head: it has not
      // eaten. Shown rather than narrated, per the house rule — a line in the
      // prompt bar about a hungry goat is a line nobody standing across the
      // field would ever see.
      marker.setPosition(chase.x, chase.y - sprite.displayHeight / 2 - 8);
      marker.setDepth(sprite.depth + 4);
      marker.setVisible(!animal.fedToday);
    }

    for (const [id, drawn] of this.animalSprites) {
      if (present.has(id)) continue;
      drawn.sprite.destroy();
      drawn.shadow.destroy();
      drawn.marker.destroy();
      this.animalSprites.delete(id);
    }
  }

  private createAnimalSprite(animal: Animal): AnimalSprite {
    const at = animal.position ?? { x: 0, y: 0 };
    const sheet = `animal-${animal.kind}-sheet`;
    const hasSheet = this.scene.textures.exists(sheet);

    const shadow = this.scene.add.image(at.x, at.y + 8, 'shadow').setScale(0.8);
    const sprite = hasSheet
      ? this.scene.add.sprite(at.x, at.y, sheet, animalStandFrame('down')).setScale(ANIMAL_SCALE[animal.kind])
      : this.scene.add.sprite(at.x, at.y, `animal-${animal.kind}`);
    const marker = this.scene.add.image(at.x, at.y - 20, 'animal-hungry').setVisible(false);
    this.context.areaLayer?.addMultiple([shadow, sprite, marker]);
    return {
      sprite,
      shadow,
      marker,
      facing: 'down',
      sheet: hasSheet ? sheet : null,
      chase: createChase(at.x, at.y),
    };
  }

  /**
   * A walk cycle per animal sheet, built once.
   *
   * Four frames rather than the people's eight, which is what the source art
   * has — and a four-frame amble at eight frames a second is what a grazing
   * animal looks like. Built here rather than per animal, because fourteen hens
   * are fourteen sprites playing the same four pictures.
   */
  createAnimalAnimations() {
    for (const { key } of LPC_ANIMAL_SHEETS) {
      if (!this.scene.textures.exists(key)) continue;
      (['up', 'left', 'down', 'right'] as Direction[]).forEach((dir) => {
        const anim = `${key}-walk-${dir}`;
        if (this.scene.anims.exists(anim)) return;
        this.scene.anims.create({
          key: anim,
          frames: this.scene.anims.generateFrameNumbers(key, {
            start: animalStandFrame(dir),
            end: animalStandFrame(dir) + ANIMAL_WALK_FRAMES - 1,
          }),
          frameRate: 8,
          repeat: -1,
        });
      });
    }
  }

  /** A heart, floating off an animal that has just been stroked. */
  popAnimalHeart(animalId: string) {
    const drawn = this.animalSprites.get(animalId);
    if (!drawn) return;
    const heart = this.scene.add
      .image(drawn.sprite.x, drawn.sprite.y - 18, 'heart')
      .setDepth(drawn.sprite.depth + 6)
      .setScale(1.3);
    this.context.areaLayer?.add(heart);
    this.scene.tweens.add({
      targets: heart,
      y: heart.y - 22,
      alpha: 0,
      duration: 950,
      ease: 'Sine.out',
      onComplete: () => heart.destroy(),
    });
  }
}
