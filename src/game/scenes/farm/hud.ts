/**
 * The HUD: the prompt bar, the hotbar, the clock, the area plate, the quest
 * tracker, the energy tube, the washes over the whole screen, and the panel
 * that explains a shared night.
 *
 * All of it is built once and redrawn every frame from the store, in the
 * screen layer, and moved whenever the canvas changes size. The morning
 * summary and the fishing bar are screen-space too, but each is a moment of
 * its own and lives in its own file.
 */
import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../../constants';
import { DIAL_SWEEP, SEASON_ICONS, WEATHER_ICONS } from '../../assets/createPixelArtTextures';
import { PALETTE, tint } from '../../assets/palette.generated';
import { HUD, hotbarIconSize, hudLayout, type HudLayout } from '../../ui/hudLayout';
import {
  energyRatio,
  formatClock,
  healthRatio,
  hotbarSlots,
  promptFor,
  showHealthBar,
  waitingOnLabel,
} from '../../state/selectors';
import { farmStore, sendAction, toggleInventory } from '../../state/store';
import type { PlayerState } from '../../state/types';
import { HOTBAR_SIZE } from '../../systems/inventory';
import { ITEMS } from '../../systems/items';
import { DAY_END, DAY_START, seasonLabel, weatherLabel } from '../../systems/time';
import { areaMap } from '../../world/areas';
import type { ScreenLayer } from './screen';
import { DEPTH, PROSE_FONT, type SceneContext } from './shared';

/** One drawn cell. Everything in it is reused frame to frame, never recreated. */
interface HotbarCell {
  frame: Phaser.GameObjects.NineSlice;
  icon: Phaser.GameObjects.Image;
  count: Phaser.GameObjects.Text;
  key: Phaser.GameObjects.Text | null;
}

/**
 * Tube colours: green while there is a day left in you, then amber, then red.
 *
 * `full` was the source literal `7ec85a`. The mechanical nearest is `light.1` (d=0.1038), but
 * `light.1` (#82a204) is an olive-yellow 28° away in hue; `light.0` (#5ea64e,
 * d=0.1051, essentially tied) is 9° away and stays green. The same override
 * applies everywhere else the source literal `7ec85a` appeared in this file, for the same
 * "still green" reason.
 */
const ENERGY_COLOURS = { full: tint('light.0'), low: tint('light.5'), spent: tint('building.3') };
const ENERGY_LOW = 1 / 3;
const ENERGY_SPENT = 1 / 10;

/**
 * Health is red all the way down, because it is a warning at any level; it
 * darkens as it drains, and below a quarter it pulses so a fight going badly
 * is noticed without looking away from the fight.
 */
const HEALTH_COLOURS = { full: tint('building.3'), low: tint('clothWarm.2') };
const HEALTH_LOW = 1 / 4;

/** How grey the world goes on empty. */
const EXHAUSTED_TINT_ALPHA = 0.34;

/** Everything drawn on the glass that is there all the time. */
export class Hud {
  /** Where each piece of the HUD goes, recomputed on every resize. */
  layout: HudLayout = hudLayout(GAME_WIDTH, GAME_HEIGHT);
  /** The same layout as hit-test rectangles, so a click on the HUD is not a hoe. */
  zones: Phaser.Geom.Rectangle[] = [];

  private promptFrame!: Phaser.GameObjects.NineSlice;
  private promptText!: Phaser.GameObjects.Text;
  private heldText!: Phaser.GameObjects.Text;
  private hotbarCells: HotbarCell[] = [];

  private clockPanel!: Phaser.GameObjects.Container;
  private clockFace!: Phaser.GameObjects.Image;
  private clockHand!: Phaser.GameObjects.Image;
  private clockDay!: Phaser.GameObjects.Text;
  private clockTime!: Phaser.GameObjects.Text;
  private seasonIcon!: Phaser.GameObjects.Image;
  private seasonText!: Phaser.GameObjects.Text;
  private weatherIcon!: Phaser.GameObjects.Image;
  private coinIcon!: Phaser.GameObjects.Image;
  private coinText!: Phaser.GameObjects.Text;

  private areaPanel!: Phaser.GameObjects.Container;
  private areaFrame!: Phaser.GameObjects.NineSlice;
  private areaText!: Phaser.GameObjects.Text;

  private questTracker!: Phaser.GameObjects.Container;
  private questLabel!: Phaser.GameObjects.Text;
  private questFill!: Phaser.GameObjects.Rectangle;

  dayNightOverlay!: Phaser.GameObjects.Rectangle;
  sunsetOverlay!: Phaser.GameObjects.Rectangle;
  private exhaustionOverlay!: Phaser.GameObjects.Rectangle;
  private vignetteTop!: Phaser.GameObjects.Rectangle;
  private vignetteBottom!: Phaser.GameObjects.Rectangle;

  private energyPanel!: Phaser.GameObjects.Container;
  private energyFrame!: Phaser.GameObjects.NineSlice;
  private energyFill!: Phaser.GameObjects.Rectangle;
  private energyBolt!: Phaser.GameObjects.Image;
  private energyHit!: Phaser.GameObjects.Rectangle;
  private energyText!: Phaser.GameObjects.Text;

  private healthPanel!: Phaser.GameObjects.Container;
  private healthFrame!: Phaser.GameObjects.NineSlice;
  private healthFill!: Phaser.GameObjects.Rectangle;
  private healthIcon!: Phaser.GameObjects.Image;
  private healthText!: Phaser.GameObjects.Text;

  private waitingPanel!: Phaser.GameObjects.Container;
  private waitingBackdrop!: Phaser.GameObjects.Rectangle;
  private waitingText!: Phaser.GameObjects.Text;

  private readonly context: Pick<SceneContext, 'scene' | 'farm' | 'localPlayer' | 'audio'>;
  private readonly scene: Phaser.Scene;
  private readonly screen: ScreenLayer;

  constructor(context: Pick<SceneContext, 'scene' | 'farm' | 'localPlayer' | 'audio'>, screen: ScreenLayer) {
    this.context = context;
    this.scene = context.scene;
    this.screen = screen;
  }

  createUi() {
    // The bottom bar: what is in hand, and what the game last said.
    this.promptFrame = this.screen.frame('plate', 0, 0, 100, HUD.promptHeight);
    this.heldText = this.screen.pixelText(0, 0, 18);
    // What is in hand is also the button that opens the bag, so the mouse has
    // a way in and the label naming the key is the thing you click.
    this.heldText.setInteractive({ useHandCursor: true }).on('pointerdown', () => {
      this.context.audio.play('ui-select');
      toggleInventory();
    });
    // A sentence, so Nunito: this is the one part of the HUD that is prose.
    this.promptText = this.scene.add.text(0, 0, '', {
      fontFamily: PROSE_FONT,
      fontSize: '13px',
      color: PALETTE['light.7'],
    });
    this.screen.add(this.promptFrame, this.heldText, this.promptText);

    this.createClock();
    this.createAreaPlate();
    this.createQuestTracker();
    this.createEnergyTube();
    this.createHealthTube();
    this.createHotbar();

    this.dayNightOverlay = this.scene.add.rectangle(0, 0, 1, 1, tint('outline.2'), 0).setDepth(DEPTH.overlay);
    // Running on empty drains the colour out of the day.
    this.exhaustionOverlay = this.scene.add.rectangle(0, 0, 1, 1, tint('building.0'), 0).setDepth(DEPTH.overlay - 2);
    this.sunsetOverlay = this.scene.add.rectangle(0, 0, 1, 1, tint('light.4'), 0).setDepth(DEPTH.overlay - 1);
    this.vignetteTop = this.scene.add.rectangle(0, 0, 1, 16, 0x000000, 0.22).setDepth(DEPTH.overlay + 1);
    this.vignetteBottom = this.scene.add.rectangle(0, 0, 1, 16, 0x000000, 0.25).setDepth(DEPTH.overlay + 1);
    this.screen.add(
      this.dayNightOverlay,
      this.exhaustionOverlay,
      this.sunsetOverlay,
      this.vignetteTop,
      this.vignetteBottom,
    );

    this.createWaitingPanel();
  }

  /**
   * The clock, as an object rather than as two lines of text.
   *
   * It used to read "Ngày 5 · 9:10 AM / Xuân · 17g" — the same facts, set as a
   * caption laid over the world. A dial with a hand on it, a leaf for the
   * season and a coin for the money say it in things instead of in words, and
   * things belong to the world in a way a caption never does.
   *
   * The hand sweeps the working day: six in the morning at the left of the
   * arc, two the next morning at the right, noon straight up.
   */
  private createClock() {
    const { width, height } = HUD.clock;
    const dial = { x: 42, y: height / 2 };

    this.clockFace = this.scene.add.image(dial.x, dial.y, 'clock-face');
    // Pivoted at its foot, so one angle turns it about the dial's centre.
    this.clockHand = this.scene.add.image(dial.x, dial.y, 'clock-hand').setOrigin(0.5, 1);
    this.clockDay = this.screen.pixelText(70, 8, 18, PALETTE['light.7']);
    this.clockTime = this.screen.pixelText(70, 28, 28);
    this.seasonIcon = this.scene.add.image(78, 70, 'icon-season-spring');
    this.seasonText = this.screen.pixelText(90, 60, 16, PALETTE['light.7']);
    this.weatherIcon = this.scene.add.image(width - 22, 20, 'icon-weather-sunny');
    // Sized rather than left at the texture's own size: the drawn coin is 32px
    // and the procedural stand-in 16, and the plate has room for 16.
    this.coinIcon = this.scene.add.image(148, 70, 'icon-coin').setDisplaySize(16, 16);
    this.coinText = this.screen.pixelText(158, 60, 18, PALETTE['light.7']);

    this.clockPanel = this.scene.add
      .container(0, 0, [
        this.screen.frame('plate', 0, 0, width, height),
        this.clockFace,
        this.clockHand,
        this.clockDay,
        this.clockTime,
        this.seasonIcon,
        this.seasonText,
        this.weatherIcon,
        this.coinIcon,
        this.coinText,
      ])
      .setDepth(DEPTH.hud + 1);
    this.screen.add(this.clockPanel);
  }

  /** Where you are and what the sky is doing, top left. */
  private createAreaPlate() {
    this.areaFrame = this.screen.frame('plate', 0, 0, 180, 46);
    this.areaText = this.screen.pixelText(12, 9, 16);
    this.areaText.setLineSpacing(2);
    this.areaPanel = this.scene.add.container(0, 0, [this.areaFrame, this.areaText]).setDepth(DEPTH.hud + 1);
    this.screen.add(this.areaPanel);
  }

  /**
   * Redraws the hotbar from the player's first twelve slots.
   *
   * Cheap enough to run every frame: twelve setters on objects that already
   * exist, with no allocation unless a texture actually changed.
   */
  private refreshHotbar(player: PlayerState) {
    const slots = hotbarSlots(player);

    this.hotbarCells.forEach((cell, index) => {
      const stack = slots[index];
      const selected = index === player.selectedSlot;

      // VT323 has one weight, so a selected cell is said in colour and in the
      // brightness of its frame. There is no bolder to go to.
      cell.frame.setTint(selected ? tint('light.7') : 0xffffff);
      cell.frame.setAlpha(selected ? 1 : 0.86);

      if (!stack) {
        cell.icon.setVisible(false);
        cell.count.setText('');
        return;
      }

      const def = ITEMS[stack.item];
      const texture = def?.texture ?? '';
      cell.icon.setVisible(true);
      if (texture && this.scene.textures.exists(texture) && cell.icon.texture.key !== texture) {
        cell.icon.setTexture(texture);
      }

      // A charged item shows what is left in it; anything else shows how many
      // it is. A stack of one shows nothing, because the icon already says so.
      const charges = stack.charges;
      cell.count.setText(charges !== undefined ? String(charges) : stack.count > 1 ? String(stack.count) : '');
      cell.count.setColor(charges !== undefined && charges === 0 ? PALETTE['light.3'] : PALETTE['light.7']);
    });

    const held = slots[player.selectedSlot];
    const label = held ? (ITEMS[held.item]?.label ?? held.item) : 'Tay không';
    this.heldText.setText(`${label}    Tab: túi đồ`);
  }

  /**
   * Builds the twelve cells once.
   *
   * Cells are created here and only ever updated in `refreshUi` and moved in
   * `layoutHud`: rebuilding them each frame would churn a dozen game objects
   * sixty times a second for a bar that usually has not changed.
   */
  private createHotbar() {
    for (let i = 0; i < HOTBAR_SIZE; i += 1) {
      const frame = this.screen.frame('slot', 0, 0, HUD.cell, HUD.cell).setDepth(DEPTH.hud);

      const icon = this.scene.add
        .image(0, 0, 'item-hoe')
        .setDepth(DEPTH.hud + 1)
        .setVisible(false);

      // Bottom-right, the way every inventory since Minecraft has done it.
      //
      // Outlined, because this is the one HUD label with a picture behind it:
      // a pale "12" sitting on the pale tin of a watering can is a number you
      // have to lean in to read. One pixel of outline either side, which is
      // all a nine-pixel digit has room for — the villagers' name labels use a
      // heavier one, but they are over a whole farm rather than over 36px of
      // wood. The key number needs none of this: it sits in the corner on bare
      // frame, and outlining it only made it shout over the item it labels.
      const count = this.screen.pixelText(0, 0, 16).setOrigin(1, 1).setDepth(DEPTH.hud + 2);
      count.setStroke(PALETTE['outline.2'], 2);

      // Only the first nine have a key, so only those are labelled.
      const key =
        i < 9
          ? this.screen.pixelText(0, 0, 16, PALETTE['light.7']).setAlpha(0.7).setDepth(DEPTH.hud + 2)
          : null;
      key?.setText(String(i + 1));

      // Clicking a cell is the same request the number key makes.
      //
      // The hit area is given explicitly rather than inferred. A nine-slice is
      // stretched from a 12px source frame, and the size Phaser would work out
      // for itself is the size of the source — so an inferred hit area would
      // be a small square in the corner of the cell, and a click aimed at the
      // middle of a slot would fall straight through onto the farm.
      frame.setInteractive(
        new Phaser.Geom.Rectangle(0, 0, HUD.cell, HUD.cell),
        Phaser.Geom.Rectangle.Contains,
      );
      frame.on('pointerdown', () => {
        if (farmStore.getState().inventoryOpen) return;
        this.context.audio.play('ui-select');
        sendAction({ type: 'selectSlot', slot: i });
      });

      this.screen.add(frame, icon, count);
      if (key) this.screen.add(key);
      this.hotbarCells.push({ frame, icon, count, key });
    }
  }

  /**
   * Rowan's request, under the clock: what is wanted and how far along it is.
   *
   * In the canvas because it is about the world, and gone from the React panel
   * for the same reason. It hides itself once the reward is claimed rather
   * than sitting there reading 3 of 3 for the rest of the game.
   */
  private createQuestTracker() {
    const { width, height, bar } = HUD.quest;
    const inset = 12;

    this.questLabel = this.screen.pixelText(inset, 9, 16);
    this.questLabel.setLineSpacing(2);
    const track = this.scene.add
      .rectangle(inset, height - inset - bar / 2, width - inset * 2, bar, tint('outline.0'), 0.85)
      .setOrigin(0, 0.5);
    this.questFill = this.scene.add
      .rectangle(inset, height - inset - bar / 2, 1, bar, tint('light.0'), 0.95)
      .setOrigin(0, 0.5);

    this.questTracker = this.scene.add
      .container(0, 0, [this.screen.frame('plate', 0, 0, width, height), this.questLabel, track, this.questFill])
      .setDepth(DEPTH.hud + 1);
    this.screen.add(this.questTracker);
  }

  private refreshQuestTracker() {
    const { quest } = this.context.farm;
    this.questTracker.setVisible(!quest.rewarded);
    if (quest.rewarded) return;

    const ratio = quest.target > 0 ? Math.min(1, quest.progress / quest.target) : 0;
    this.questLabel.setText([
      quest.title,
      quest.completed ? 'Xong rồi - tìm Rowan' : `${quest.progress}/${quest.target} củ cải`,
    ]);
    this.questFill.setSize(Math.max(1, (HUD.quest.width - 24) * ratio), HUD.quest.bar);
  }

  /**
   * Energy, as a tube that fills from the bottom.
   *
   * A horizontal bar with "Thể lực 135/270" written beside it reads as a
   * progress bar in a piece of software. A column of colour that drains as the
   * day goes on is a thing in the world, and you learn to read it at a glance
   * without ever reading a number.
   *
   * The number is still there — it is the difference between "nearly out" and
   * "two more swings" — but only while the mouse is on it. Keyboard players
   * are not shut out of it: the prompt bar says so when it matters, and the
   * screen reader region carries the words either way.
   */
  private createEnergyTube() {
    const { width, height } = HUD.energy;

    this.energyFrame = this.screen.frame('plate', 0, 0, width, height);
    this.energyFill = this.scene.add
      .rectangle(width / 2, height - 5, width - 10, 1, ENERGY_COLOURS.full, 0.95)
      .setOrigin(0.5, 1);
    this.energyBolt = this.scene.add.image(width / 2, -12, 'icon-energy-bolt');
    this.energyText = this.screen.pixelText(0, 0, 16).setOrigin(1, 0.5).setVisible(false);
    // An invisible box, so there is something with a size to hover over: the
    // frame is a nine-slice and the fill is a sliver when it matters most.
    this.energyHit = this.scene.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0);

    this.energyPanel = this.scene.add
      .container(0, 0, [this.energyHit, this.energyFrame, this.energyFill, this.energyBolt, this.energyText])
      .setDepth(DEPTH.hud + 1);
    this.energyPanel.on('pointerover', () => this.energyText.setVisible(true));
    this.energyPanel.on('pointerout', () => this.energyText.setVisible(false));
    this.screen.add(this.energyPanel);
  }

  /**
   * Health, as a second tube beside the energy one (spec 13).
   *
   * The same object as the energy tube, on purpose: the two numbers are read
   * the same way — how much is left — and a second visual language for the
   * second one would be a thing to learn for no reason. It is only on screen
   * underground or when hurt; see `showHealthBar`. Canvas, not React, because
   * it is read mid-fight with the eyes on the slime.
   */
  private createHealthTube() {
    const { width, height } = HUD.energy;
    this.healthFrame = this.screen.frame('plate', 0, 0, width, height);
    this.healthFill = this.scene.add
      .rectangle(width / 2, height - 5, width - 10, 1, HEALTH_COLOURS.full, 0.95)
      .setOrigin(0.5, 1);
    this.healthIcon = this.scene.add.image(width / 2, -12, 'icon-health');
    this.healthText = this.screen.pixelText(0, 0, 16).setOrigin(1, 0.5).setVisible(false);
    const hit = this.scene.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0);
    this.healthPanel = this.scene.add
      .container(0, 0, [hit, this.healthFrame, this.healthFill, this.healthIcon, this.healthText])
      .setDepth(DEPTH.hud + 1)
      .setVisible(false);
    this.healthPanel.on('pointerover', () => this.healthText.setVisible(true));
    this.healthPanel.on('pointerout', () => this.healthText.setVisible(false));
    this.screen.add(this.healthPanel);
  }

  private refreshHealth(player: PlayerState) {
    const visible = showHealthBar(player);
    this.healthPanel.setVisible(visible);
    if (!visible) return;
    const ratio = healthRatio(player);
    const { width, height } = this.layout.health;
    const low = ratio <= HEALTH_LOW;
    this.healthFill.setPosition(width / 2, height - 5);
    this.healthFill.setSize(width - 10, Math.max(1, (height - 10) * ratio));
    this.healthFill.setFillStyle(low ? HEALTH_COLOURS.low : HEALTH_COLOURS.full, 0.95);
    this.healthFill.setVisible(player.health > 0);
    this.healthIcon.setAlpha(low ? 0.6 + Math.sin(this.scene.time.now / 120) * 0.4 : 1);
    this.healthText.setText(`${player.health}/${player.maxHealth}`);
  }

  /**
   * Why nothing is happening when you have gone to bed and somebody else has
   * not. Without it, a shared night is the most likely thing in the game to
   * feel broken.
   */
  private createWaitingPanel() {
    this.waitingBackdrop = this.scene.add.rectangle(0, 0, 1, 1, tint('outline.0'), 0.72);
    this.waitingText = this.scene.add
      .text(0, 0, '', {
        fontFamily: PROSE_FONT,
        fontSize: '17px',
        color: PALETTE['light.7'],
        align: 'center',
        wordWrap: { width: 520 },
      })
      .setOrigin(0.5);
    this.waitingPanel = this.scene.add
      .container(0, 0, [this.waitingBackdrop, this.waitingText])
      .setDepth(DEPTH.modal)
      .setVisible(false);
    this.screen.add(this.waitingPanel);
  }

  /** Puts every piece of the HUD where this canvas size says it goes. */
  layoutHud() {
    const { width, height, prompt, hotbar, clock, quest, area, energy, health } = this.layout;

    this.promptFrame.setPosition(prompt.x, prompt.y).setSize(prompt.width, prompt.height);
    this.heldText.setPosition(prompt.x + 14, prompt.y + 7);
    this.promptText.setPosition(prompt.x + 14, prompt.y + 28);
    this.promptText.setWordWrapWidth(prompt.width - 28);

    this.clockPanel.setPosition(clock.x, clock.y);
    this.questTracker.setPosition(quest.x, quest.y);
    this.areaPanel.setPosition(area.x, area.y);
    this.areaText.setWordWrapWidth(area.maxWidth - 24);
    this.areaFrame.setSize(
      Math.min(area.maxWidth, this.areaText.width + 24),
      this.areaText.height + 18,
    );

    this.energyPanel.setPosition(energy.x, energy.y);
    this.energyFrame.setSize(energy.width, energy.height);
    this.energyBolt.setPosition(energy.width / 2, -12);
    this.energyText.setPosition(-10, energy.height / 2);
    this.energyHit.setSize(energy.width + 16, energy.height + 24);
    this.energyPanel.setInteractive(
      new Phaser.Geom.Rectangle(-8, -20, energy.width + 16, energy.height + 28),
      Phaser.Geom.Rectangle.Contains,
    );

    this.healthPanel.setPosition(health.x, health.y);
    this.healthFrame.setSize(health.width, health.height);
    this.healthIcon.setPosition(health.width / 2, -12);
    this.healthText.setPosition(-10, health.height / 2);
    this.healthPanel.setInteractive(
      new Phaser.Geom.Rectangle(-8, -20, health.width + 16, health.height + 28),
      Phaser.Geom.Rectangle.Contains,
    );

    this.hotbarCells.forEach((cell, index) => {
      const x = hotbar.x + index * (hotbar.cell + hotbar.gap);
      const centre = x + hotbar.cell / 2;
      cell.frame.setPosition(x, hotbar.y - hotbar.cell / 2).setSize(hotbar.cell, hotbar.cell);
      // The hit area is a shape of its own, so resizing the cell has to resize
      // it too — otherwise clicks keep landing on the size it used to be.
      const hit = cell.frame.input?.hitArea as Phaser.Geom.Rectangle | undefined;
      hit?.setSize(hotbar.cell, hotbar.cell);
      const icon = hotbarIconSize(hotbar.cell);
      cell.icon.setPosition(centre, hotbar.y).setDisplaySize(icon, icon);
      // Both labels sit inside the wood rather than on it. The border does not
      // stretch with the cell, so the inset is the border plus a pixel at any
      // cell size.
      const inset = HUD.slotBorder + 1;
      cell.count.setPosition(x + hotbar.cell - inset, hotbar.y + hotbar.cell / 2 - inset);
      cell.key?.setPosition(x + inset, hotbar.y - hotbar.cell / 2 + inset - 2);
      cell.key?.setVisible(hotbar.cell >= 28);
    });

    // The full-screen washes and the vignette are the size of the screen, and
    // the screen just changed size.
    for (const overlay of [this.dayNightOverlay, this.sunsetOverlay, this.exhaustionOverlay]) {
      overlay.setPosition(width / 2, height / 2).setSize(width, height);
    }
    this.vignetteTop.setPosition(width / 2, 8).setSize(width, 16);
    this.vignetteBottom.setPosition(width / 2, height - 8).setSize(width, 16);

    this.waitingBackdrop.setSize(width, height);
    this.waitingPanel.setPosition(width / 2, height / 2);
    this.waitingText.setWordWrapWidth(Math.min(520, width - 120));
  }

  refreshUi() {
    const store = farmStore.getState();
    const farm = store.farm;
    const player = this.context.localPlayer;
    if (!player) return;

    this.refreshHotbar(player);
    this.promptText.setText(promptFor(store));
    this.refreshClock();
    this.areaText.setText(`${areaMap(player.area).name}\n${weatherLabel(farm.weather)}`);
    // The plate is sized to the name it happens to be carrying, and the names
    // are different lengths in different areas.
    this.areaFrame.setSize(
      Math.min(this.layout.area.maxWidth, this.areaText.width + 24),
      this.areaText.height + 18,
    );
    this.refreshQuestTracker();
    this.refreshEnergy(player);
    this.refreshHealth(player);

    // Eased rather than switched, so the colour draining out reads as the
    // player tiring rather than as a rendering glitch.
    const tint = player.energy > 0 ? 0 : EXHAUSTED_TINT_ALPHA;
    this.exhaustionOverlay.setAlpha(Phaser.Math.Linear(this.exhaustionOverlay.alpha, tint, 0.05));

    const waiting = player.asleep ? waitingOnLabel(farm, store.localPlayerId) : '';
    this.waitingPanel.setVisible(waiting !== '');
    if (waiting) this.waitingText.setText(`${waiting}\n\nPress Space/Enter or B to get up again.`);
  }

  /**
   * The dial, the season, the sky and the wallet.
   *
   * The hand runs across the working day: six in the morning at the left of
   * the sweep, noon straight up, two the next morning at the right. The same
   * twenty hours the reducer counts, read off the same numbers, so there is no
   * second clock here to fall out of step with the first.
   */
  private refreshClock() {
    const { time, season, weather, coins } = this.context.farm;

    const through = Phaser.Math.Clamp(
      (time.totalMinutes - DAY_START) / (DAY_END - DAY_START),
      0,
      1,
    );
    this.clockHand.setAngle(-DIAL_SWEEP + through * DIAL_SWEEP * 2);

    this.clockDay.setText(`Ngày ${time.day}`);
    this.clockTime.setText(formatClock(this.context.farm.time.totalMinutes));
    this.seasonText.setText(seasonLabel(season));
    this.coinText.setText(`${coins}g`);

    const seasonIcon = SEASON_ICONS[season];
    if (seasonIcon && this.seasonIcon.texture.key !== seasonIcon) {
      this.seasonIcon.setTexture(seasonIcon);
    }
    const weatherIcon = WEATHER_ICONS[weather];
    if (weatherIcon && this.weatherIcon.texture.key !== weatherIcon) {
      this.weatherIcon.setTexture(weatherIcon);
    }
  }

  /**
   * The tube, filled from the bottom.
   *
   * Green while there is a day left in you, amber when there is not much of
   * one, red when there is nearly none — and no number unless the mouse asks
   * for one, because the height of the column is the reading you actually
   * take. The words still reach a screen reader through the prompt bar, which
   * is the channel that was always going to have to carry them.
   */
  private refreshEnergy(player: PlayerState) {
    const ratio = energyRatio(player);
    const { width, height } = this.layout.energy;

    this.energyFill.setPosition(width / 2, height - 5);
    this.energyFill.setSize(width - 10, Math.max(1, (height - 10) * ratio));
    this.energyFill.setFillStyle(
      ratio <= ENERGY_SPENT ? ENERGY_COLOURS.spent : ratio <= ENERGY_LOW ? ENERGY_COLOURS.low : ENERGY_COLOURS.full,
      0.95,
    );
    this.energyFill.setVisible(player.energy > 0);
    this.energyText.setText(`${player.energy}/${player.maxEnergy}`);
  }
}
