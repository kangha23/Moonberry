/**
 * Fishing, as it is drawn.
 *
 * The cast lives in the state and the server drives it; this is everything a
 * player sees of one. The float and the line in the water, the mark over
 * their head at the bite, the bar they fight the fish on, the card the catch
 * goes up on, and the squares of water a rod in hand could reach.
 */
import type Phaser from 'phaser';
import { PALETTE, tint } from '../../assets/palette.generated';
import type { PlayerState } from '../../state/types';
import { ITEMS, itemDef } from '../../systems/items';
import { TILE_SIZE, isWithinReach, tileAt, worldToTile } from '../../world/areas';
import type { ScreenLayer } from './screen';
import { DEPTH, GROUND_ITEM_DEPTH, PROSE_FONT, type SceneContext } from './shared';

/**
 * The fishing bar, in screen pixels.
 *
 * Vertical, and drawn in the canvas rather than in React — spec 05's rule is
 * that information about the world lives in the world, and this is as
 * world-ish as information gets: it is a fish, on a line, being fought.
 *
 * On the right, because the left is where the prompt bar and the energy tube
 * already are, and a minigame that covered either of those would hide the two
 * things a player checks while deciding whether to keep fishing.
 */
const FISH_BAR = {
  width: 30,
  height: 190,
  /** The gap between the track and the thin progress column beside it. */
  gap: 8,
  progressWidth: 10,
  /** How far in from the right edge of the screen the pair sits. */
  inset: 92,
} as const;

/** How long the card naming a catch stays up before the satchel gets it. */
const CATCH_CARD_MS = 1500;

/** A cast, from the throw to the card. */
export class FishingHud {
  /**
   * The float, the bar, the mark over the head, and the card.
   *
   * Four objects rather than one, because they live in two different spaces:
   * the float and the mark are in the world and follow the water and the
   * player, and the bar and the card are pinned to the screen.
   */
  private bobber!: Phaser.GameObjects.Image;
  private bobberLine!: Phaser.GameObjects.Rectangle;
  private biteMark!: Phaser.GameObjects.Text;
  private fishBar!: Phaser.GameObjects.Container;
  private fishTrack!: Phaser.GameObjects.Rectangle;
  private fishMark!: Phaser.GameObjects.Rectangle;
  private fishSquare!: Phaser.GameObjects.Rectangle;
  private fishProgressBack!: Phaser.GameObjects.Rectangle;
  private fishProgressFill!: Phaser.GameObjects.Rectangle;
  private catchCard!: Phaser.GameObjects.Container;
  private catchFrame!: Phaser.GameObjects.NineSlice;
  private catchIcon!: Phaser.GameObjects.Image;
  private catchText!: Phaser.GameObjects.Text;
  private catchShownAt = 0;
  /** A pool of squares over the water a rod could reach, grown as needed. */
  private waterHints: Phaser.GameObjects.Rectangle[] = [];

  private readonly context: Pick<SceneContext, 'scene' | 'localPlayer'>;
  private readonly scene: Phaser.Scene;
  private readonly screen: ScreenLayer;

  constructor(context: Pick<SceneContext, 'scene' | 'localPlayer'>, screen: ScreenLayer) {
    this.context = context;
    this.scene = context.scene;
    this.screen = screen;
  }

  /**
   * Everything a cast draws.
   *
   * Built once and hidden, like the build ghost and the morning panel, rather
   * than created when a line goes out: a minigame that allocated nine objects
   * on the frame the fish bit would stutter at exactly the moment it must not.
   */
  createFishingUi() {
    // In the world: the float on the water, the line down to it, and the mark
    // over the player's head at the bite.
    this.bobberLine = this.scene.add
      .rectangle(0, 0, 1, 1, tint('light.7'), 0.7)
      .setOrigin(0.5, 1)
      .setDepth(DEPTH.weather - 2)
      .setVisible(false);
    this.bobber = this.scene.add
      .image(0, 0, 'icon-coin')
      .setDisplaySize(10, 10)
      .setTint(tint('building.3'))
      .setDepth(DEPTH.weather - 1)
      .setVisible(false);
    // A mark rather than a sprite, and a big one. This is the thing the whole
    // system hangs off: nine tenths of a second to notice, possibly while
    // looking at the clock. It is drawn in the world, over the player's own
    // head, because that is where their eyes already are.
    this.biteMark = this.scene.add
      .text(0, 0, '!', {
        fontFamily: PROSE_FONT,
        fontSize: '28px',
        color: PALETTE['light.7'],
        stroke: PALETTE['soil.0'],
        strokeThickness: 5,
      })
      .setOrigin(0.5, 1)
      .setDepth(DEPTH.weather)
      .setVisible(false);

    // On the screen: the bar.
    this.fishTrack = this.scene.add
      .rectangle(0, 0, FISH_BAR.width, FISH_BAR.height, tint('shadow.1'), 0.85)
      .setOrigin(0, 0)
      .setStrokeStyle(2, tint('water.2'), 0.9);
    // The square the player drives. Drawn under the fish so a fish inside it
    // is still visible, which is the one thing the player is watching for.
    this.fishSquare = this.scene.add
      .rectangle(0, 0, FISH_BAR.width - 6, 10, tint('light.0'), 0.45)
      .setOrigin(0, 1)
      .setStrokeStyle(2, tint('light.0'), 0.95);
    // The fish: gold, and outlined in near-black so it stays legible whichever
    // colour the square behind it happens to be.
    this.fishMark = this.scene.add
      .rectangle(0, 0, FISH_BAR.width - 14, 12, tint('light.7'), 1)
      .setOrigin(0.5, 0.5)
      .setStrokeStyle(2, tint('outline.3'), 0.95);
    this.fishProgressBack = this.scene.add
      .rectangle(0, 0, FISH_BAR.progressWidth, FISH_BAR.height, tint('shadow.1'), 0.85)
      .setOrigin(0, 0)
      .setStrokeStyle(2, tint('water.2'), 0.9);
    this.fishProgressFill = this.scene.add
      .rectangle(0, 0, FISH_BAR.progressWidth - 4, 1, tint('light.0'), 0.95)
      .setOrigin(0, 1);

    this.fishBar = this.scene.add
      .container(0, 0, [
        this.fishTrack,
        this.fishSquare,
        this.fishMark,
        this.fishProgressBack,
        this.fishProgressFill,
      ])
      .setDepth(DEPTH.hud + 2)
      .setVisible(false);
    this.screen.add(this.fishBar);

    // And the card, which is what a catch is for.
    this.catchFrame = this.screen.frame('panel', 0, 0, 260, 64);
    this.catchIcon = this.scene.add.image(0, 0, 'icon-coin').setDisplaySize(32, 32);
    this.catchText = this.screen.pixelText(0, 0, 20).setOrigin(0, 0.5);
    this.catchCard = this.scene.add
      .container(0, 0, [this.catchFrame, this.catchIcon, this.catchText])
      .setDepth(DEPTH.hud + 3)
      .setVisible(false);
    this.screen.add(this.catchCard);
  }

  /** Puts the bar and the card where a canvas of this size has room for them. */
  layout(width: number, height: number) {
    // The bar hugs the right edge and is centred vertically, so it sits where
    // neither the prompt bar nor the hotbar ever reaches.
    const barX = width - FISH_BAR.inset;
    const barY = (height - FISH_BAR.height) / 2;
    this.fishBar.setPosition(barX, barY);
    this.fishProgressBack.setPosition(FISH_BAR.width + FISH_BAR.gap, 0);
    this.fishProgressFill.setPosition(FISH_BAR.width + FISH_BAR.gap + 2, FISH_BAR.height);
    this.catchCard.setPosition(width / 2, Math.min(150, height * 0.22));
    this.catchFrame.setPosition(-130, -32);
    this.catchIcon.setPosition(-96, 0);
    this.catchText.setPosition(-70, 0);
  }

  /**
   * Everything a cast looks like, redrawn each frame.
   *
   * Reads the cast straight off the state rather than keeping a copy, because
   * the server owns it: online, the bar the player is driving is the server's
   * bar arriving a frame or two late, and a local mirror would be a second
   * truth to reconcile. The one thing predicted locally is nothing at all —
   * spec 12 allows predicting the square, and it is deliberately not done
   * here, because a square that snaps back on every correction is worse to
   * play than one that answers a frame late.
   */
  updateFishing(time: number) {
    const player = this.context.localPlayer;
    const fishing = player?.fishing ?? null;

    this.updateWaterHints(player ?? null, fishing !== null);

    if (!player || !fishing) {
      this.bobber.setVisible(false);
      this.bobberLine.setVisible(false);
      this.biteMark.setVisible(false);
      this.fishBar.setVisible(false);
      this.hideCatchCard(time);
      return;
    }

    // The float, on the tile the line was thrown at, bobbing a little so the
    // water reads as water rather than as a dot on a texture.
    const floatX = (fishing.target.x + 0.5) * TILE_SIZE;
    const floatY = (fishing.target.y + 0.5) * TILE_SIZE + Math.sin(time / 260) * 1.6;
    this.bobber.setVisible(true).setPosition(floatX, floatY);
    // Tugged under at the bite, which is the visual half of the sound.
    this.bobber.setDisplaySize(10, fishing.phase === 'biting' ? 6 : 10);

    // The line, as a thin rectangle rotated onto the float. The rod is held at
    // about shoulder height, so it leaves the hand rather than the feet.
    const handX = player.x;
    const handY = player.y - 18;
    const dx = floatX - handX;
    const dy = floatY - handY;
    this.bobberLine
      .setVisible(true)
      .setPosition(handX, handY)
      .setSize(1.5, Math.hypot(dx, dy))
      .setOrigin(0.5, 0)
      .setRotation(Math.atan2(dy, dx) - Math.PI / 2);

    // The mark over the head. Only at the bite, and big.
    const biting = fishing.phase === 'biting';
    this.biteMark.setVisible(biting);
    if (biting) this.biteMark.setPosition(player.x, player.y - 34);

    // And the bar, which only exists once something is actually on the line.
    const reeling = fishing.phase === 'reeling';
    this.fishBar.setVisible(reeling);
    if (reeling) {
      // The bar's 0 is the bottom, and the screen's is the top, so every
      // position here is measured down from `FISH_BAR.height`.
      const squareHeight = Math.max(8, fishing.barWidth * FISH_BAR.height);
      this.fishSquare
        .setSize(FISH_BAR.width - 6, squareHeight)
        .setPosition(3, FISH_BAR.height - fishing.barAt * FISH_BAR.height);
      this.fishMark.setPosition(
        FISH_BAR.width / 2,
        FISH_BAR.height - fishing.fishAt * FISH_BAR.height,
      );
      // Green while it is going your way, cold grey-blue while it is not.
      //
      // Emphatically *not* amber for the second one, which is what this was
      // first written as and is wrong for a reason that is only obvious once
      // you look at the thing: the fish is amber, and the two objects a player
      // must tell apart at a glance cannot be the same colour. Green against
      // gold reads instantly; gold against gold is a puzzle.
      const covered =
        fishing.fishAt >= fishing.barAt && fishing.fishAt <= fishing.barAt + fishing.barWidth;
      // Fill was the source literal `7ec85a` -> `light.0` (see ENERGY_COLOURS above). Stroke
      // was the source literal `9fe37a`, whose mechanical nearest is `light.6` (d=0.1393) - but
      // that entry is nearly grey (S13 vs the original's S65), which would
      // make a "you're on the fish" highlight read as dull grey instead of a
      // brighter green riding on top of the fill. `light.1` (#82a204,
      // d=0.1863) costs more distance but stays saturated and green, and
      // keeps the fill/stroke pair visually distinct from each other rather
      // than collapsing both to `light.0`.
      this.fishSquare.setFillStyle(covered ? tint('light.0') : tint('building.2'), 0.4);
      this.fishSquare.setStrokeStyle(2, covered ? tint('light.1') : tint('light.6'), 0.95);
      this.fishProgressFill
        .setSize(FISH_BAR.progressWidth - 4, Math.max(1, fishing.progress * FISH_BAR.height))
        .setFillStyle(fishing.progress < 0.25 ? tint('building.3') : tint('light.0'), 0.95);
    }

    this.hideCatchCard(time);
  }

  /**
   * The water a rod could reach, lit up.
   *
   * Spec 12 asks for this so nobody has to guess which tiles take a line, and
   * it is drawn from the same `isWithinReach` the reducer enforces rather than
   * from a radius written out again here — two implementations of reach would
   * disagree the first time somebody stood on a corner.
   *
   * Hidden while a line is already in the water: at that point the question
   * the highlight answers has been answered.
   */
  private updateWaterHints(player: PlayerState | null, fishing: boolean) {
    const held = player ? this.heldItem(player) : null;
    const show = Boolean(player) && !fishing && ITEMS[held ?? '']?.tool === 'rod';

    let used = 0;
    if (show && player) {
      const centreX = worldToTile(player.x);
      const centreY = worldToTile(player.y);
      for (let y = centreY - 1; y <= centreY + 1; y += 1) {
        for (let x = centreX - 1; x <= centreX + 1; x += 1) {
          if (!isWithinReach(player, x, y)) continue;
          if (tileAt(player.area, x, y)?.kind !== 'water') continue;
          const hint = this.waterHints[used] ?? this.createWaterHint();
          this.waterHints[used] = hint;
          hint
            .setVisible(true)
            .setPosition((x + 0.5) * TILE_SIZE, (y + 0.5) * TILE_SIZE);
          used += 1;
        }
      }
    }
    for (let i = used; i < this.waterHints.length; i += 1) this.waterHints[i].setVisible(false);
  }

  private createWaterHint(): Phaser.GameObjects.Rectangle {
    // Fill was the source literal `6fd3ef`, stroke the source literal `9fe8ff` - both pale cyan. Mechanically
    // both land on `light.6`/`light.7` (d=0.099-0.127): close in distance
    // only because both are pale; in hue they are 60-90 degrees away, grey
    // and cream respectively, which would make a "this tile is water" cue
    // look like dust. `water.3` (#1896b3, H191) is within a few degrees of
    // both originals' hue (H193/H194) - it is darker and more saturated, but
    // at this alpha (0.16/0.55) that reads as a cool cyan wash rather than a
    // hue-mismatched one. Fill and stroke now share one entry; the alpha
    // difference still keeps them visually distinct from each other.
    return this.scene.add
      .rectangle(0, 0, TILE_SIZE - 4, TILE_SIZE - 4, tint('water.3'), 0.16)
      .setStrokeStyle(1, tint('water.3'), 0.55)
      .setDepth(GROUND_ITEM_DEPTH);
  }

  /** What is in this player's hand, or null for an empty slot. */
  private heldItem(player: PlayerState): string | null {
    return player.inventory[player.selectedSlot]?.item ?? null;
  }

  /** Takes the catch card down once it has had its beat. */
  private hideCatchCard(time: number) {
    if (!this.catchCard.visible) return;
    if (time - this.catchShownAt < CATCH_CARD_MS) return;
    this.catchCard.setVisible(false);
  }

  /**
   * The card a catch goes up on.
   *
   * Spec 12 asks for the catch to hold a beat before it disappears into the
   * satchel, and it is right to: a fish that went straight into a slot would
   * be a minute of play with no moment at the end of it.
   */
  showCatch(item: string, size: number) {
    const def = itemDef(item);
    this.catchIcon.setTexture(def.texture);
    this.catchText.setText(def.sellPrice > 0 ? `${def.label} · ${size}cm` : def.label);
    this.catchCard.setVisible(true);
    this.catchShownAt = this.scene.time.now;
  }
}
