import Phaser from 'phaser';
import { zoomFor } from '../constants';
import { createPixelArtTextures } from '../assets/createPixelArtTextures';
import { LPC_ACTION_SHEETS, LPC_ANIMAL_SHEETS, LPC_IMAGES, LPC_PORTRAITS, LPC_SHEETS } from '../assets/lpc.generated';
import { PALETTE, tint } from '../assets/palette.generated';
import { hudLayout, hudZones } from '../ui/hudLayout';
import { SoundManager } from '../audio/SoundManager';
import { FOOTSTEP_INTERVAL_MS, footstepFor, musicFor } from '../audio/soundtrack';
import { connectToFarm, type FarmConnection } from '../net/client';
import type { NpcId, PortraitMood } from '../npcs/types';
import type { GameEvent } from '../state/intents';
import { hotbarSlots, mineActionFor } from '../state/selectors';
import {
  dispatch,
  farmStore,
  initFarm,
  joinAsLocalPlayer,
  onGameEvent,
  sendAction,
  sendMove,
  setBuildKind,
  setSceneReady,
  setSummaryOpen,
  startAutosave,
  toggleInventory,
} from '../state/store';
import type { PlayerState } from '../state/types';
import { buildingDef, checkPlacement } from '../systems/buildings';
import { checkTool, nodeAt } from '../systems/resources';
import { HOTBAR_SIZE } from '../systems/inventory';
import type { CastPhase } from '../systems/fishing';
import { areaOfEffectOf, itemDef } from '../systems/items';
import { floorFor } from '../systems/mine';
import {
  AREA_IDS,
  START_AREA,
  TILE_SIZE,
  areaMap,
  isWithinReach,
  mineDepth,
  targetTile,
  tileAt,
  worldToTile,
  type AreaId,
  type Point,
} from '../world/areas';
import { mineFloorMap } from '../world/mineMap';
import { AreaView } from './farm/area';
import { AtmosphereView } from './farm/atmosphere';
import { AvatarView } from './farm/avatars';
import { DialogueBox } from './farm/dialogue';
import { FishingHud } from './farm/fishing';
import { GroundView } from './farm/ground';
import { Hud } from './farm/hud';
import { HerdView } from './farm/herd';
import { MineView } from './farm/mine';
import { ScreenLayer } from './farm/screen';
import { MorningSummary } from './farm/summary';
import { VillagerView } from './farm/villagers';
import { AVATAR_DEPTH_BASE, DEPTH, PROSE_FONT, type SceneContext } from './farm/shared';

type KeyMap = Record<string, Phaser.Input.Keyboard.Key>;

/**
 * A palette colour with an alpha channel, for the one place in this file that
 * wants a translucent CSS colour rather than an opaque Phaser tint.
 *
 * The build-hint tooltip below used to hardcode `'rgba(20,13,8,0.86)'`, a
 * near-black brown nobody had checked against the palette — invisible to
 * `scripts/palette-lock.test.mjs` before that test learned to look inside
 * `rgb()`/`rgba()` literals, and the first thing the widened check found once
 * it could. outline.0 (#0f0608) is the nearest palette entry and, like the
 * original, reads as a near-black backdrop. Same helper, same reasoning, as
 * `withAlpha` in `../assets/createPixelArtTextures.ts` — duplicated locally
 * rather than imported because that one is not exported and this file needs
 * exactly one call to it.
 */
function withAlpha(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Which way a swing at a tile turns the swordsman, by the longer axis. */
function facingToward(from: Point, tile: Point): 'up' | 'down' | 'left' | 'right' {
  const dx = tile.x * TILE_SIZE + TILE_SIZE / 2 - from.x;
  const dy = tile.y * TILE_SIZE + TILE_SIZE / 2 - from.y;
  if (Math.abs(dy) > Math.abs(dx)) return dy > 0 ? 'down' : 'up';
  return dx > 0 ? 'right' : 'left';
}

/** Player id used while playing offline. Online, the server's session id wins. */
const OFFLINE_PLAYER_ID = 'local';

/** Long enough that a key still held from last night cannot eat the summary. */
const SUMMARY_MIN_MS = 700;

/**
 * How often a held act repeats.
 *
 * The same cadence for a held key and a held mouse button, because they are
 * the same action: dragging across a row to till it is most of why the mouse
 * is better, and the keyboard must not be the slower way to do it.
 */
const ACT_REPEAT_MS = 240;

/**
 * Renders the world and turns input into intents.
 *
 * The scene owns no game state. Everything it draws it reads from the farm
 * store, and every change it makes it requests through the store. Which map is
 * on screen follows the local player's `area`, so walking through a doorway
 * rebuilds the world rather than switching to a different scene.
 */
export default class FarmScene extends Phaser.Scene {
  /** The area currently built. Null until the first build. */
  private builtArea: AreaId | null = null;

  /** Everything belonging to the current area, dropped wholesale on a rebuild. */
  private areaLayer: Phaser.GameObjects.Group | null = null;

  /** The tiles, props and buildings of the built area, drawn. */
  private areaView!: AreaView;
  /** The beds, the nodes and the placeables, drawn. */
  private groundView!: GroundView;
  /** The players standing on the built area, drawn. */
  private avatarView!: AvatarView;
  /** The people standing on the built area, drawn. */
  private villagerView!: VillagerView;
  /** The animals out of doors, drawn. */
  private herdView!: HerdView;
  /** The monsters, the sword, the dark and the elevator. */
  private mineView!: MineView;

  private cursor!: Phaser.GameObjects.Image;
  /** Drawn on the tile under the mouse when that tile is out of reach. */
  private outOfReachCursor!: Phaser.GameObjects.Image;
  /**
   * The translucent footprint that follows the cursor in build mode, and the
   * line above it naming what is wrong when placement is refused.
   *
   * Green where a building could go and red where it could not, decided by the
   * very function the reducer will run on the command — so the ghost is the
   * truth rather than an approximation of it.
   */
  private buildGhost!: Phaser.GameObjects.Rectangle;
  private buildHint!: Phaser.GameObjects.Text;
  /** The rectangle a swing would work, when what is in hand covers more than one tile. */
  private sweepGhost!: Phaser.GameObjects.Rectangle;
  private keys!: KeyMap;

  /**
   * Everything drawn in screen space, in one container.
   *
   * See `ScreenLayer`: the container carries the transform that undoes
   * the camera's zoom, so every child below is positioned in plain screen
   * pixels with the origin at the top-left of the canvas.
   */
  private screen!: ScreenLayer;
  /** The prompt bar, the hotbar, the clock and the rest of the always-on HUD. */
  private hud!: Hud;
  /** The weather, the washes, and what in the area moves with the clock. */
  private atmosphere!: AtmosphereView;
  /** The morning panel, and the tally it reports. */
  private summary!: MorningSummary;
  private dialogue!: DialogueBox;
  /** The float, the line, the bar and the catch card. */
  private fishingHud!: FishingHud;

  /** True while the reel key is down, so only the changes are sent. */
  private reelHeld = false;
  /**
   * The phase the local cast was in last frame, or null between casts.
   *
   * Kept only so a bite that arrives while the key is already down can still
   * be struck. See `handleInteractions`.
   */
  private lastCastPhase: CastPhase | null = null;

  private audio!: SoundManager;

  /**
   * The tile under the mouse, or null when there is no mouse on the world —
   * it has never moved, it is over the HUD, or it has left the canvas. Null is
   * what makes a keyboard-only player see none of this.
   */
  private pointerTile: Point | null = null;
  /** True while the mouse is somewhere on the world rather than on the HUD. */
  private pointerOnWorld = false;
  /** True while a left-press that began on the world is still held. */
  private pointerActArmed = false;
  /** True while Tab belongs to the satchel rather than to the scene. */
  private tabReleased = false;
  /** True while either act input is held, so the first press is not a repeat. */
  private actHeld = false;
  private actRepeatMs = 0;
  /**
   * Set when a held input has done the one thing it is allowed to do once.
   *
   * Placing a building disarms build mode, so without this the next repeat of
   * a still-held click would come back round as an ordinary swing and hoe the
   * ground the barn is now standing on.
   */
  private actSpent = false;
  /**
   * Which input the act in progress came from.
   *
   * A click means the tile under the cursor even when that tile is too far —
   * the player aimed at it, and hearing that it is out of reach is better than
   * a swing at their own feet. A key means the cursor, which falls back to the
   * faced tile exactly as it always has.
   */
  private actSource: 'pointer' | 'key' = 'key';

  private boundsTimer = 0;
  private dustTimer = 0;
  private footstepTimer = 0;
  private unsubscribeEvents: (() => void) | null = null;
  private stopAutosave: (() => void) | null = null;
  private connection: FarmConnection | null = null;

  constructor() {
    super('farm-scene');
  }

  preload() {
    // The wooden frames. Unlike the art below, these are not optional: the
    // whole HUD is drawn in them, and a nine-slice with no texture is a hole.
    // They are generated by `npm run generate:ui` and committed.
    this.load.image('frame-wood', '/assets/ui/frame-wood.png');
    this.load.image('frame-slot', '/assets/ui/frame-slot.png');
    this.load.image('frame-plate', '/assets/ui/frame-plate.png');
    this.load.svg('quest-star', '/assets/pixel/quest-star.svg', { width: 32, height: 32 });
    // The stall has a drawing now. The old ribbon stays behind as its stand-in,
    // under the same key, and is only asked for when the drawing is not there:
    // two loads under one key is a warning and the second one loses.
    if (!LPC_IMAGES.some(([key]) => key === 'market-stall')) {
      this.load.svg('market-stall', '/assets/pixel/market-ribbon.svg', { width: 96, height: 32 });
    }
    // Hand-drawn art (LPC + CC0, see public/assets/lpc/CREDITS.md).
    // Missing files fall back to procedural textures via createPixelArtTextures.
    //
    // Both lists are generated from the folder itself by "npm run lpc:manifest",
    // so this asks for exactly the files that are there. That matters more than
    // it sounds: only two of the thirteen crops have a drawing, and naming the
    // other eleven here would log eleven load errors on every boot — which is
    // how a deliberate fallback starts looking like a bug.
    this.load.on('loaderror', () => undefined);
    LPC_IMAGES.forEach(([key, url]) => this.load.image(key, url));
    LPC_SHEETS.forEach((sheet) =>
      this.load.spritesheet(sheet, `/assets/lpc/${sheet}.png`, { frameWidth: 64, frameHeight: 64 }),
    );
    // The animals carry their own frame size rather than sharing the people's:
    // a cow is 72x72 and a hen is 32x30, and the manifest measured both.
    LPC_ANIMAL_SHEETS.forEach((sheet) =>
      this.load.spritesheet(sheet.key, sheet.url, {
        frameWidth: sheet.frameWidth,
        frameHeight: sheet.frameHeight,
      }),
    );
    // Eight frames of one action per direction: the player's sword swing and
    // each monster's walk, attack and death. Frame size measured by the manifest.
    LPC_ACTION_SHEETS.forEach((sheet) =>
      this.load.spritesheet(sheet.key, sheet.url, {
        frameWidth: sheet.frameWidth,
        frameHeight: sheet.frameHeight,
      }),
    );
    // Four faces a villager, 64px each, in `PORTRAIT_MOODS` order.
    LPC_PORTRAITS.forEach((npc) =>
      this.load.spritesheet(`portrait-${npc}`, `/assets/lpc/portrait-${npc}.png`, { frameWidth: 64, frameHeight: 64 }),
    );
    // Same bargain as the art: a missing file is silence, not a broken game.
    SoundManager.preload(this, AREA_IDS);
  }

  create() {
    // The views are made first and draw nothing yet. What they draw, and in
    // what order, is still decided by the calls below: two things at the same
    // depth are drawn in the order they were added, and the screen layer draws
    // its children in the order they were put in it.
    this.screen = new ScreenLayer(this);
    const context = this.createContext();
    this.groundView = new GroundView(context);
    this.areaView = new AreaView(context, this.groundView);
    this.avatarView = new AvatarView(context);
    this.villagerView = new VillagerView(context);
    this.herdView = new HerdView(context);
    this.mineView = new MineView(context, this.screen, this.avatarView);
    this.hud = new Hud(context, this.screen);
    this.summary = new MorningSummary(this, this.screen);
    this.dialogue = new DialogueBox(this, this.screen);
    this.fishingHud = new FishingHud(context, this.screen);
    this.atmosphere = new AtmosphereView(context, this.screen, this.hud, this.areaView);

    createPixelArtTextures(this);
    this.avatarView.createWalkAnimations();
    this.mineView.createMonsterAnimations();
    this.villagerView.createVillagerAnimations();
    this.herdView.createAnimalAnimations();
    this.screen.create();
    this.atmosphere.createWeatherSprites();
    this.atmosphere.createAmbient();
    this.hud.createUi();
    this.mineView.createUi();
    this.dialogue.create();
    this.summary.createSummaryPanel();
    this.fishingHud.createFishingUi();
    this.bindInput();

    this.cursor = this.add.image(0, 0, 'tile-cursor').setDepth(DEPTH.weather - 10).setAlpha(0.88);
    // Pointing at something you cannot reach has to look different from
    // pointing at something you can, or the reach rule only ever shows up as
    // an action that silently did nothing.
    this.outOfReachCursor = this.add
      .image(0, 0, 'tile-cursor')
      .setDepth(DEPTH.weather - 11)
      .setTint(tint('building.0'))
      .setAlpha(0.45)
      .setVisible(false);

    // Build mode. Sized per building when it is armed, so one rectangle
    // serves every footprint in the catalogue.
    this.sweepGhost = this.add
      .rectangle(0, 0, TILE_SIZE, TILE_SIZE, tint('light.7'), 0.14)
      .setOrigin(0, 0)
      .setStrokeStyle(1, tint('light.7'), 0.5)
      .setDepth(DEPTH.weather - 12)
      .setVisible(false);
    this.buildGhost = this.add
      .rectangle(0, 0, TILE_SIZE, TILE_SIZE, tint('light.0'), 0.36)
      .setOrigin(0, 0)
      .setStrokeStyle(2, tint('light.0'), 0.9)
      .setDepth(DEPTH.weather - 9)
      .setVisible(false);
    // Two short lines and a reason, so Nunito for the reason and the pixel
    // face for neither: this is a sentence explaining a refusal.
    this.buildHint = this.add
      .text(0, 0, '', {
        fontFamily: PROSE_FONT,
        fontSize: '14px',
        color: PALETTE['light.7'],
        align: 'center',
        backgroundColor: withAlpha(PALETTE['outline.0'], 0.86),
        padding: { x: 12, y: 7 },
      })
      .setOrigin(0.5, 0)
      .setDepth(DEPTH.hud + 2)
      .setVisible(false);
    this.screen.add(this.buildHint);

    // The canvas is the window now, so the HUD has to be told how big the
    // window is — and told again every time it changes, full screen included.
    this.layout(this.scale.width, this.scale.height);
    this.scale.on(Phaser.Scale.Events.RESIZE, (size: Phaser.Structs.Size) =>
      this.layout(size.width, size.height),
    );

    // Built before the farm, so the join that follows is already audible.
    this.audio = new SoundManager(this);

    initFarm();
    this.unsubscribeEvents = onGameEvent((events) => this.handleEvents(events));
    joinAsLocalPlayer(OFFLINE_PLAYER_ID, 'Bạn');

    this.buildArea(this.localPlayer?.area ?? START_AREA);

    // Start playable immediately, then hand authority to the server if one
    // answers. Waiting on the network before the world draws would make a slow
    // or missing server look like a broken game.
    void this.goOnline();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unsubscribeEvents?.();
      this.unsubscribeEvents = null;
      this.stopAutosave?.();
      this.stopAutosave = null;
      this.connection?.disconnect();
      this.connection = null;
      this.audio.destroy();
      this.scale.off(Phaser.Scale.Events.RESIZE);
    });

    this.hud.refreshUi();
    setSceneReady();
  }

  update(time: number, delta: number) {
    // The world keeps running behind the morning summary — the server does not
    // stop for one player reading it — but this player's input is suspended,
    // so the key that dismisses it does not also swing a tool.
    // Told to the store rather than kept here alone, because Escape's ladder
    // is decided in one place and it has to be able to see this panel.
    // The dialogue box rides on the same flag: it is the other thing Escape
    // closes rather than opening the menu over, and the scene reads that key
    // for itself in both cases.
    setSummaryOpen(this.summary.summaryPanel.visible || this.dialogue.isOpen);

    if (this.summary.summaryPanel.visible) {
      if (this.summary.dismissRequested && time - this.summary.summaryShownAt > SUMMARY_MIN_MS) {
        this.summary.summaryPanel.setVisible(false);
        setSummaryOpen(false);
      }
      this.summary.dismissRequested = false;
      this.releaseAct();
      sendMove(0, 0, delta);
    } else if (this.dialogue.isOpen) {
      // Somebody is talking to you, so you stand and listen. The key that
      // closes the box is still down on the frame it closes, and left alone it
      // would act again at once and start the same conversation over — so the
      // act is marked spent, and nothing more happens until it is let go of.
      if (this.dialogue.update(time)) {
        this.villagerView.stopListening();
        this.actHeld = true;
        this.actSpent = true;
      } else {
        this.releaseAct();
      }
      sendMove(0, 0, delta);
    } else if (farmStore.getState().inventoryOpen || this.localPlayer?.panel) {
      // The grid is a document the DOM is drawing over the canvas. The world
      // keeps running behind it, but nothing this player presses reaches the
      // game, so dragging a stack cannot also swing a hoe or walk them off a
      // cliff. The one key still read is the one that closes it. The stall and
      // the forge are the same bargain, suspended by the same branch.
      if (!this.localPlayer?.panel) this.handleInventoryToggle();
      this.releaseAct();
      sendMove(0, 0, delta);
    } else {
      this.handleInventoryToggle();
      this.handleSlotHotkeys();
      this.handleMovement(delta, time);
      this.handleInteractions(delta);
    }
    // Online the server drives time for everyone; offline this client does.
    if (!farmStore.getState().online) dispatch({ type: 'world/tick', deltaMs: delta });

    // The local player may have walked through a doorway since the last frame.
    const area = this.localPlayer?.area;
    if (area && area !== this.builtArea) this.buildArea(area);

    // Where the canvas sits on the page, re-read a couple of times a second.
    // One layout read, and it is the difference between a click landing on the
    // tile it was aimed at and landing a fixed distance away for as long as
    // the page's idea of where the canvas is disagrees with Phaser's.
    this.boundsTimer += delta;
    if (this.boundsTimer > 500) {
      this.boundsTimer = 0;
      this.scale.updateBounds();
    }

    // A stationary mouse still changes what it is pointing at: the camera
    // follows the player, so walking slides the world under the cursor. Aimed
    // again every frame rather than only on `pointermove`, or holding the
    // button and walking would till the same tile over and over.
    if (this.pointerOnWorld) this.trackPointer(this.input.activePointer);

    this.syncTabCapture();
    this.areaView.syncBuildings();
    this.groundView.syncNodes();
    this.groundView.syncPlaceables();
    this.villagerView.syncNpcs(delta);
    this.herdView.syncAnimals(delta);
    this.avatarView.syncAvatars();
    this.mineView.update(delta);
    this.updateCursor();
    this.updateBuildGhost();
    this.fishingHud.updateFishing(time);
    this.atmosphere.updateAtmosphere(delta);
    this.updateMusic();
    this.hud.refreshUi();
  }

  /**
   * Picks the bed for where and when the player is.
   *
   * Asked every frame rather than tracked, because three things move it — the
   * doorway, the weather, and the clock — and a listener per source would be
   * three chances to miss one. `playMusic` ignores a repeat of what is
   * already playing, so the cost is a comparison.
   */
  private updateMusic() {
    const area = this.localPlayer?.area ?? this.builtArea ?? START_AREA;
    const { weather, time } = this.farm;
    this.audio.playMusic(musicFor({ area, weather, time }));
  }

  private async goOnline() {
    this.connection = await connectToFarm(import.meta.env.VITE_GAME_SERVER);
    // Browser saves are for offline play only; online, the server owns the farm.
    if (!this.connection) this.stopAutosave = startAutosave();
  }

  // --- state plumbing -------------------------------------------------------

  /**
   * The scene as its views see it.
   *
   * Getters rather than values, so a view always reads the area that is built
   * now rather than the one that was built when the view was made.
   */
  private createContext(): SceneContext {
    const self = () => this;
    return {
      scene: this,
      get farm() {
        return self().farm;
      },
      get localPlayer() {
        return self().localPlayer;
      },
      get builtArea() {
        return self().builtArea;
      },
      get areaLayer() {
        return self().areaLayer;
      },
      get audio() {
        return self().audio;
      },
    };
  }

  private get farm() {
    return farmStore.getState().farm;
  }

  private get localPlayer(): PlayerState | null {
    const { farm, localPlayerId } = farmStore.getState();
    return localPlayerId ? (farm.players[localPlayerId] ?? null) : null;
  }

  /**
   * Holds up what a villager said, and turns them to face whoever they said it to.
   *
   * The box opens on the frame the event lands; the key that asked for it was
   * pressed before the box existed, so it can never also be the key that closes it.
   */
  private showDialogue(npc: NpcId, line: string, mood: PortraitMood) {
    const player = this.localPlayer;
    if (player) this.villagerView.listen(npc, player.x, player.y);
    this.dialogue.open(npc, line, mood, this.time.now);
  }

  /** Turns simulation events into sprites, tweens, and re-renders. */
  private handleEvents(events: GameEvent[]) {
    const { localPlayerId } = farmStore.getState();
    for (const event of events) {
      this.audio.handleEvent(event, localPlayerId);
      // The mine reads its own events: the numbers are all the reducer's, the
      // flash and the stillness are the view's.
      this.mineView.handleEvent(event, localPlayerId);

      if (event.kind === 'plotChanged') {
        this.groundView.refreshPlot(event.key);
        // Shown rather than narrated. Watering had a sound and a change of
        // texture and nothing at all in between, which left the one action a
        // player repeats forty times a morning as the only one with no moment.
        if (event.action === 'water') {
          const plot = this.farm.plots[event.key];
          if (plot) this.groundView.splash(plot.x, plot.y);
        }
      } else if (event.kind === 'sprinklersRan') {
        // Arrives in the same batch as `dayStarted`, so the field this draws
        // over is already the new morning's field.
        this.groundView.spraySprinklers();
      } else if (event.kind === 'npcSpoke') {
        // Yours only. Somebody else chatting to Maeve across the yard is not a
        // box over your screen.
        if (event.playerId === localPlayerId) this.showDialogue(event.npc, event.line, event.mood);
      } else if (event.kind === 'giftGiven') {
        // Shown rather than narrated: the box carries the words and the face,
        // and the heart is what you actually watch for. Only for the player who
        // gave it — somebody else's gift is not your moment.
        if (event.playerId === localPlayerId) {
          if (event.heartGained) this.villagerView.popHeart(event.npc);
          if (event.line) this.showDialogue(event.npc, event.line, event.mood);
        }
      } else if (event.kind === 'cropsWithered') {
        // Stashed rather than shown now: it arrives in the same frame as
        // `dayStarted`, and the morning panel is where it belongs.
        this.summary.witheredOvernight = event;
      } else if (event.kind === 'dayStarted') {
        this.atmosphere.updateWeatherPresentation();
        // Every plot, not only the ones that changed: the wilt tint depends on
        // the date, so on the twenty-sixth of a season a field that did nothing
        // overnight still has to be repainted grey.
        this.groundView.refreshAllPlots();
        this.summary.showDaySummary(event.day, event.grown);
      } else if (event.kind === 'fishCaught') {
        // Only your own. Somebody else's sturgeon is their moment, and a card
        // over your screen naming it is a notification rather than a reward.
        if (event.playerId === localPlayerId) {
          this.fishingHud.showCatch(event.fish, event.size);
          // Its own tally, not the coop's: `collected` is drawn with an egg
          // beside it and reads "món từ chuồng", so a trout counted into it
          // would have the morning panel quietly lying about the henhouse.
          this.summary.today.fished += 1;
        }
      } else if (event.kind === 'farmReplaced') {
        this.buildArea(this.localPlayer?.area ?? START_AREA);
      } else if (event.kind === 'harvested') {
        this.summary.today.harvested += 1;
      } else if (event.kind === 'sold' || event.kind === 'questRewarded') {
        this.summary.today.coins += event.coins;
      } else if (event.kind === 'upgradeReady' && event.playerId === localPlayerId) {
        // Stashed rather than shown now: it arrives in the same frame as
        // `dayStarted`, and the morning panel is where it belongs. The picture
        // is the tool itself — the same texture the hotbar will draw for it an
        // hour from now, which is how you know it is the same tool.
        this.summary.finishedOvernight.push({
          texture: itemDef(event.item).texture,
          text: `${itemDef(event.item).label} đã xong ở lò rèn`,
        });
      } else if (event.kind === 'buildingFinished') {
        this.summary.finishedOvernight.push({
          texture: `building-${event.building}`,
          text: `${buildingDef(event.building).label} đã dựng xong`,
        });
      } else if (event.kind === 'nodeHit') {
        this.groundView.shakeNode(event.id, event.node);
      } else if (event.kind === 'nodeCleared') {
        // Burst it where it stood, before `syncNodes` notices it has gone: the
        // sprite is still there this frame and is the only thing that knows
        // where "there" was.
        this.groundView.burstNode(event.id, event.node);
        if (event.playerId === localPlayerId) this.summary.today.cleared += 1;
      } else if (event.kind === 'nodesGrew') {
        this.summary.grewOvernight = event;
      } else if (event.kind === 'animalPetted') {
        // Shown, not narrated. Only for the player whose hand it was — a heart
        // over somebody else's goat across the field is not your moment.
        if (event.playerId === localPlayerId) this.herdView.popAnimalHeart(event.animalId);
      } else if (event.kind === 'produceCollected') {
        if (event.playerId === localPlayerId) this.summary.today.collected += 1;
      } else if (event.kind === 'animalSold') {
        this.summary.today.coins += event.coins;
      } else if (event.kind === 'animalsHungry') {
        this.summary.hungryOvernight = event.count;
      } else if (event.kind === 'collapsed') {
        this.summary.collapsedFor = event.coinsLost;
      } else if (event.kind === 'exhausted' && event.playerId === localPlayerId) {
        this.cameras.main.shake(200, 0.004);
      }
    }
  }

  // --- input ----------------------------------------------------------------

  private bindInput() {
    const keyboard = this.input.keyboard;
    if (!keyboard) return;
    this.keys = keyboard.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
      arrowUp: Phaser.Input.Keyboard.KeyCodes.UP,
      arrowDown: Phaser.Input.Keyboard.KeyCodes.DOWN,
      arrowLeft: Phaser.Input.Keyboard.KeyCodes.LEFT,
      arrowRight: Phaser.Input.Keyboard.KeyCodes.RIGHT,
      one: Phaser.Input.Keyboard.KeyCodes.ONE,
      two: Phaser.Input.Keyboard.KeyCodes.TWO,
      three: Phaser.Input.Keyboard.KeyCodes.THREE,
      four: Phaser.Input.Keyboard.KeyCodes.FOUR,
      five: Phaser.Input.Keyboard.KeyCodes.FIVE,
      six: Phaser.Input.Keyboard.KeyCodes.SIX,
      seven: Phaser.Input.Keyboard.KeyCodes.SEVEN,
      eight: Phaser.Input.Keyboard.KeyCodes.EIGHT,
      nine: Phaser.Input.Keyboard.KeyCodes.NINE,
      q: Phaser.Input.Keyboard.KeyCodes.Q,
      e: Phaser.Input.Keyboard.KeyCodes.E,
      i: Phaser.Input.Keyboard.KeyCodes.I,
      tab: Phaser.Input.Keyboard.KeyCodes.TAB,
      b: Phaser.Input.Keyboard.KeyCodes.B,
      f: Phaser.Input.Keyboard.KeyCodes.F,
      space: Phaser.Input.Keyboard.KeyCodes.SPACE,
      enter: Phaser.Input.Keyboard.KeyCodes.ENTER,
    }) as KeyMap;

    // Tab would otherwise walk the browser's focus ring off the canvas.
    keyboard.addCapture([Phaser.Input.Keyboard.KeyCodes.TAB]);

    // Any key at all dismisses the morning summary; `update` decides whether
    // it is old enough to be dismissed yet.
    //
    // The dialogue box is narrower: the act keys and Escape. Walking keys are
    // left out so a player already heading off does not skip a line they never
    // saw, and a key held down since it opened the box repeats without ever
    // being a fresh press.
    keyboard.on('keydown', (event: KeyboardEvent) => {
      if (this.summary.summaryPanel.visible) {
        this.summary.dismissRequested = true;
        return;
      }
      if (event.repeat || !this.dialogue.isOpen) return;
      if (event.code === 'Escape') {
        this.dialogue.close();
        this.villagerView.stopListening();
      } else if (event.code === 'Space' || event.code === 'Enter' || event.code === 'NumpadEnter') {
        this.dialogue.requestAdvance();
      }
    });

    this.bindPointer();

    // Scrolling the wheel over the canvas walks the hotbar, the way it does in
    // every game that has one. Registered on the scene rather than on each
    // cell so it works wherever the pointer is.
    this.input.on(
      'wheel',
      (_pointer: Phaser.Input.Pointer, _over: unknown, _dx: number, dy: number) => {
        if (farmStore.getState().inventoryOpen || this.summary.summaryPanel.visible || this.dialogue.isOpen) return;
        if (dy === 0) return;
        this.cycleSlot(dy > 0 ? 1 : -1);
      },
    );
  }

  /**
   * The mouse.
   *
   * Everything here goes through Phaser's input system rather than raw DOM
   * events, because the canvas is scaled to fit: a DOM clientX is in CSS
   * pixels of a canvas that is not its design size, and only Phaser knows the
   * difference.
   */
  private bindPointer() {
    // Phaser turns a screen position into a game position using the canvas's
    // position on the page, measured once and re-measured only when the window
    // resizes or scrolls. The page around the canvas can move it without doing
    // either — a web font swapping in above it, the React shell re-laying out,
    // the second mount that strict mode does in development — and a stale
    // measurement puts every click a fixed distance from where it was aimed.
    // Re-measuring as the mouse arrives costs one layout read per entry, and
    // `update` re-measures on a slow timer as well, for the case where the
    // page shifts while the mouse is already sitting over the world.
    //
    // `updateBounds`, not `refresh`: the latter re-runs the whole scale and
    // centre pipeline and can move the canvas out from under the click that
    // prompted it. All that is wanted here is a fresh measurement.
    this.input.on('gameover', () => this.scale.updateBounds());

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => this.trackPointer(pointer));

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.trackPointer(pointer);
      // A click anywhere turns the page, the way a key does.
      if (this.dialogue.isOpen && this.summary.summaryPanel.visible === false) this.dialogue.requestAdvance();
      // A press that begins on the HUD stays a press on the HUD for as long as
      // it is held, so dragging off the hotbar does not start tilling.
      this.pointerActArmed =
        pointer.leftButtonDown() && !this.isOverHud(pointer) && !this.inputSuspended();
      if (!this.pointerActArmed) return;

      // Acted on here rather than polled in `update`, because a quick click
      // can begin and end between two frames: a poll would never see it, and
      // the mouse would work only when the button was held.
      this.actHeld = true;
      this.actRepeatMs = 0;
      this.actSource = 'pointer';
      this.act();
    });

    this.input.on('pointerup', () => {
      this.pointerActArmed = false;
    });

    // The mouse leaving the canvas is the mouse ceasing to aim: the cursor
    // goes back to the faced tile rather than staying stuck where it left.
    this.input.on('gameout', () => {
      this.pointerOnWorld = false;
      this.pointerTile = null;
      this.pointerActArmed = false;
    });
  }

  /**
   * Records which tile the mouse is over.
   *
   * Converted through the camera rather than by adding the scroll offset by
   * hand: the camera follows the player with a lerp, and hand arithmetic is
   * a frame behind it every frame the player is moving.
   */
  private trackPointer(pointer: Phaser.Input.Pointer) {
    if (this.isOverHud(pointer)) {
      this.pointerOnWorld = false;
      this.pointerTile = null;
      return;
    }
    this.pointerOnWorld = true;
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    this.pointerTile = { x: worldToTile(world.x), y: worldToTile(world.y) };
  }

  private isOverHud(pointer: Phaser.Input.Pointer): boolean {
    return (
      this.hud.zones.some((zone) => zone.contains(pointer.x, pointer.y)) ||
      this.mineView.containsPointer(pointer.x, pointer.y)
    );
  }

  /**
   * Whether the game is taking input at all.
   *
   * The morning summary, the satchel and the market stall each hold the world
   * still for this player. `update` already routes around them; the pointer
   * has to ask, because a press arrives as an event rather than as a poll.
   */
  private inputSuspended(): boolean {
    return (
      this.summary.summaryPanel.visible ||
      this.dialogue.isOpen ||
      farmStore.getState().inventoryOpen ||
      Boolean(this.localPlayer?.panel)
    );
  }

  /**
   * The tile a keypress should land on, or null meaning "the one I am facing".
   *
   * Null rather than the computed faced tile on purpose: an absent target is
   * the command the keyboard has always sent, so a player who never touches
   * the mouse produces byte-identical traffic to before. A mouse resting on
   * something unreachable is the same as no mouse at all here — a keypress
   * should not be refused because the cursor is parked across the river.
   */
  private actionTile(): Point | null {
    const player = this.localPlayer;
    const hovered = this.pointerTile;
    if (!player || !hovered) return null;
    return isWithinReach(player, hovered.x, hovered.y) ? hovered : null;
  }

  /** Steps the held slot along the hotbar, wrapping at both ends. */
  private cycleSlot(step: number) {
    const player = this.localPlayer;
    if (!player) return;
    const slot = (player.selectedSlot + step + HOTBAR_SIZE) % HOTBAR_SIZE;
    this.audio.play('ui-select');
    sendAction({ type: 'selectSlot', slot });
  }

  private handleMovement(delta: number, time: number) {
    if (!this.keys) return;
    const left = this.keys.left.isDown || this.keys.arrowLeft.isDown;
    const right = this.keys.right.isDown || this.keys.arrowRight.isDown;
    const up = this.keys.up.isDown || this.keys.arrowUp.isDown;
    const down = this.keys.down.isDown || this.keys.arrowDown.isDown;
    const dx = (right ? 1 : 0) - (left ? 1 : 0);
    const dy = (down ? 1 : 0) - (up ? 1 : 0);

    // Reported every frame, releases included: the server holds the last input
    // it was told about, so it has to hear when the player stops.
    sendMove(dx, dy, delta);
    if (dx === 0 && dy === 0) return;

    const player = this.localPlayer;
    if (!player) return;

    // Dust puffs are pure decoration, so they stay here rather than in state.
    this.dustTimer += delta;
    if (this.dustTimer > 220) {
      this.dustTimer = 0;
      const dust = this.add
        .image(player.x + Phaser.Math.Between(-6, 6), player.y + 13, 'dust')
        .setDepth(Math.floor(player.y / TILE_SIZE) + AVATAR_DEPTH_BASE - 1)
        .setScale(0.7)
        .setAlpha(0.7);
      this.areaLayer?.add(dust);
      this.tweens.add({ targets: dust, y: dust.y - 8, alpha: 0, scale: 1.1, duration: 420, onComplete: () => dust.destroy() });
    }

    // Footsteps are a cadence, not an event: they belong here beside the dust
    // rather than in the reducer. Local player only — a remote player's steps
    // are, without positional audio, just noise.
    this.footstepTimer += delta;
    if (this.footstepTimer > FOOTSTEP_INTERVAL_MS) {
      this.footstepTimer = 0;
      const under = tileAt(player.area, worldToTile(player.x), worldToTile(player.y));
      // The mine's shell says "floor" everywhere, which is the farmhouse's
      // boards; underfoot down there is rock, which sounds like the path.
      const step = mineDepth(player.area) !== null ? footstepFor('path') : footstepFor(under?.kind);
      if (step) this.audio.play(step);
    }

    const avatar = this.avatarView.avatarFor(player.id);
    if (avatar && !this.anims.exists(`player-walk-${player.facing}`)) {
      avatar.sprite.setAngle(Math.sin(time / 130) * 1.5);
    }
  }

  private handleSlotHotkeys() {
    if (!this.keys) return;
    const hotkeys = [
      this.keys.one,
      this.keys.two,
      this.keys.three,
      this.keys.four,
      this.keys.five,
      this.keys.six,
      this.keys.seven,
      this.keys.eight,
      this.keys.nine,
    ];
    hotkeys.forEach((key, index) => {
      if (Phaser.Input.Keyboard.JustDown(key)) {
        // Clicked here rather than off an event: choosing a slot is a UI action
        // the player took, not a thing that happened on the farm, and online it
        // would otherwise wait for the server to agree before it made a noise.
        this.audio.play('ui-select');
        sendAction({ type: 'selectSlot', slot: index });
      }
    });

    if (Phaser.Input.Keyboard.JustDown(this.keys.q)) this.cycleSlot(-1);
    if (Phaser.Input.Keyboard.JustDown(this.keys.e)) this.cycleSlot(1);
  }

  /**
   * Tab or I opens the full grid; I closes it again.
   *
   * Read every frame, including while the grid is open, because it is also how
   * the grid is closed — and it is the one piece of input that still runs then.
   *
   * Tab only opens. Once the grid is up it is a real dialog in the DOM, and
   * Tab is how you move between its slots; a scene that kept claiming the key
   * would make the satchel the one part of the game a keyboard cannot use.
   */
  private handleInventoryToggle() {
    if (!this.keys) return;
    const open = farmStore.getState().inventoryOpen;
    const pressed =
      Phaser.Input.Keyboard.JustDown(this.keys.i) ||
      (!open && Phaser.Input.Keyboard.JustDown(this.keys.tab));
    if (!pressed) return;
    this.audio.play('ui-select');
    toggleInventory();
  }

  /**
   * Hands Tab to the satchel while it is open, and takes it back afterwards.
   *
   * Phaser captures Tab so the browser's focus ring cannot wander off the
   * canvas mid-game. That same capture would stop focus moving *within* the
   * satchel, so the capture is lifted for exactly as long as the panel is up.
   */
  private syncTabCapture() {
    const open = farmStore.getState().inventoryOpen;
    if (open === this.tabReleased) return;
    this.tabReleased = open;

    const keyboard = this.input.keyboard;
    if (!keyboard) return;
    if (open) keyboard.removeCapture(Phaser.Input.Keyboard.KeyCodes.TAB);
    else keyboard.addCapture(Phaser.Input.Keyboard.KeyCodes.TAB);
  }

  /**
   * Acting, from either input.
   *
   * Held rather than tapped, and held identically: the first press acts at
   * once, then every `ACT_REPEAT_MS` for as long as the button or the key is
   * down. Whichever hand you use, a row is tilled by holding and moving.
   */
  private handleInteractions(delta: number) {
    if (!this.keys) return;
    if (Phaser.Input.Keyboard.JustDown(this.keys.b)) {
      sendAction({ type: 'sleep' });
      return;
    }

    // Full screen is the browser's state, not the farm's: it is not in
    // `FarmState`, it is not in the save, and a player who reloads comes back
    // in a window. Coming out of it is an ordinary resize, which the layout
    // already handles.
    if (Phaser.Input.Keyboard.JustDown(this.keys.f)) {
      this.audio.play('ui-select');
      this.scale.toggleFullscreen();
      return;
    }

    // Escape is not read here any more. It means three different things
    // depending on what is open — cancel a placement, close a panel, open the
    // menu — and the order between them is a decision, not an accident of
    // which handler happens to be mounted. `pressEscape` in the store is that
    // order, and the shell is the one place that calls it.

    const pointer = this.input.activePointer;
    const clicking = this.pointerActArmed && pointer.leftButtonDown();
    const pressing = this.keys.space.isDown || this.keys.enter.isDown;

    // With a line in the water the action key is the reel and nothing else.
    // Only the edges are sent — a held key is one command, not one per frame —
    // which is the same bargain `sendMove` takes with the movement axes, and
    // for the same reason: the server is running the simulation, and all it
    // needs from here is when the button changed.
    if (this.localPlayer?.fishing) {
      const down = clicking || pressing;
      const phase = this.localPlayer.fishing.phase;
      // A bite that arrives while the key is *already* down still has to be
      // struck, and only edges are sent — so without this the one player who
      // holds the button from the throw onwards is the one player who can
      // never hook anything, which reads as the game being broken rather than
      // as a rule. The moment the phase turns to `biting` counts as an edge.
      const justBit = phase === 'biting' && phase !== this.lastCastPhase;
      if (down !== this.reelHeld || (down && justBit)) {
        this.reelHeld = down;
        sendAction({ type: 'reel', down });
      }
      this.lastCastPhase = phase;
      // The held-act bookkeeping is reset rather than advanced, so letting go
      // of a fish and pressing again tills the bank immediately rather than
      // after a repeat delay.
      this.releaseAct();
      return;
    }
    // A cast that ended with the key still down must not leave the flag set,
    // or the first press of the next cast would look like no change at all.
    this.reelHeld = false;
    this.lastCastPhase = null;

    if (!clicking && !pressing) {
      this.releaseAct();
      return;
    }
    // A press that has already placed a building does nothing more until it is
    // let go of.
    if (this.actSpent) return;

    // Read every frame, not only on the first: letting go of the mouse while
    // still holding the key hands the aiming back to the keyboard mid-repeat.
    this.actSource = clicking ? 'pointer' : 'key';

    // A click has already acted, on the press. A key has not, so its first
    // frame acts here — and from then on both are the same held input.
    if (!this.actHeld) {
      this.actHeld = true;
      this.actRepeatMs = 0;
      this.act();
      return;
    }

    this.actRepeatMs += delta;
    if (this.actRepeatMs < ACT_REPEAT_MS) return;
    this.actRepeatMs = 0;
    this.act();
  }

  /** Forgets a held act, so the next press acts immediately rather than late. */
  private releaseAct() {
    this.actHeld = false;
    this.actRepeatMs = 0;
    this.actSpent = false;
  }

  /**
   * Where a building armed at the forge would go, given the cursor.
   *
   * The cursor names the top-left tile rather than the centre, because a
   * footprint is read from its corner when you are lining it up against a
   * fence — and an even-sided barn has no centre tile to speak of.
   */
  private buildTarget(): Point | null {
    const hovered = this.pointerTile;
    if (hovered) return hovered;
    // Keyboard-only: the tile being faced, so build mode is not mouse-only.
    const player = this.localPlayer;
    return player ? targetTile(player.area, player, player.facing) : null;
  }

  /**
   * Draws the footprint, and says why it is red when it is.
   *
   * The check is `checkPlacement`, which is the same function the reducer runs
   * on the command that follows. Two implementations of "can this go here"
   * would disagree the first time somebody built next to the pond.
   */
  private updateBuildGhost() {
    const kind = farmStore.getState().buildKind;
    const player = this.localPlayer;
    const spot = kind ? this.buildTarget() : null;

    // Hidden behind the morning panel and the satchel, which are the moments
    // a click cannot reach the world anyway.
    if (!kind || !player || !spot || this.inputSuspended()) {
      this.buildGhost.setVisible(false);
      this.buildHint.setVisible(false);
      return;
    }

    const def = buildingDef(kind);
    const farm = this.farm;
    const placement = checkPlacement(player.area, farm.buildings, farm.plots, kind, spot.x, spot.y);
    const affordable = def.cost <= farm.coins;
    const ok = placement.ok && affordable;

    this.buildGhost.setVisible(true);
    this.buildGhost.setPosition(spot.x * TILE_SIZE, spot.y * TILE_SIZE);
    this.buildGhost.setSize(def.width * TILE_SIZE, def.height * TILE_SIZE);
    this.buildGhost.setFillStyle(ok ? tint('light.0') : tint('building.3'), 0.36);
    this.buildGhost.setStrokeStyle(2, ok ? tint('light.0') : tint('building.3'), 0.9);

    const reason = !placement.ok
      ? placement.reason
      : !affordable
        ? `${def.label} giá ${def.cost}g, mà nông trại chỉ có ${farm.coins}g.`
        : `Bấm chuột để động thổ. ${def.cost}g, ${def.days} ngày.`;
    this.buildHint.setVisible(true);
    this.buildHint.setText([`Đang đặt ${def.label.toLowerCase()}`, reason, 'Escape để hủy']);
  }

  /**
   * A click in build mode.
   *
   * Sent even when the ghost is red, for the same reason a click out of reach
   * is sent: the refusal comes back as a line the player reads, and a click
   * that silently does nothing is the one that looks broken.
   */
  private placeBuilding() {
    const kind = farmStore.getState().buildKind;
    const spot = this.buildTarget();
    if (!kind || !spot) return;
    sendAction({ type: 'placeBuilding', kind, x: spot.x, y: spot.y });
    setBuildKind(null);
    this.actSpent = true;
  }

  private act() {
    // Build mode takes the click before the tools do: while a footprint is on
    // the cursor, that is what a click is for.
    if (farmStore.getState().buildKind) {
      this.placeBuilding();
      return;
    }

    if (this.actInMine()) return;

    // Where a click lands is never silently redirected. Sending a target the
    // reach rule will refuse is the point: the refusal comes back as a line in
    // the prompt bar, and the player learns the rule instead of watching their
    // farmhand hoe the ground they are standing on.
    if (this.actSource === 'pointer' && this.pointerTile) {
      sendAction({ type: 'act', target: this.pointerTile });
      return;
    }
    const target = this.actionTile();
    sendAction(target ? { type: 'act', target } : { type: 'act' });
  }

  /**
   * The action key in and at the mouth of the mine. Returns true when it was
   * the mine's to handle.
   *
   * Which intent to send is decided by `mineActionFor`, the same selector the
   * prompt bar reads, so the bar never promises something the key will not
   * do. Whether it happens is still the server's: the fan is drawn at once,
   * but no health moves until an event says it did.
   */
  private actInMine(): boolean {
    const player = this.localPlayer;
    if (!player) return false;
    const aimed = this.actSource === 'pointer' && this.pointerTile !== null;
    const action = mineActionFor(this.farm, player, aimed);
    if (!action) return false;

    if (action === 'attack') {
      const target = aimed ? this.pointerTile : this.actionTile();
      this.mineView.swing(player, target);
      this.avatarView.swing(player.id, target ? facingToward(player, target) : player.facing);
      sendAction(target ? { type: 'attack', target } : { type: 'attack' });
      return true;
    }

    // Everything else is one press, not a held repeat: arriving at the foot
    // of a ladder puts you on the next floor's way out, and a key still held
    // would climb straight back up it.
    this.actSpent = true;
    if (action === 'elevator') {
      if (this.mineView.elevatorOpen) this.mineView.closeElevator();
      else this.mineView.openElevator(player, false);
      return true;
    }
    if (action === 'descend' && mineDepth(player.area) === null) {
      // At the mouth: straight down to floor 1, or the elevator's list once
      // the farm has opened a stop worth riding to.
      if (!this.mineView.elevatorOpen && this.mineView.openElevator(player, true)) return true;
    }
    this.audio.play('ui-confirm');
    sendAction({ type: action });
    return true;
  }

  // --- world building -------------------------------------------------------

  /**
   * Draws one area from scratch and points the camera at it.
   *
   * Everything area-specific lives in a group, so a rebuild is one destroy call
   * rather than a teardown list that has to be kept in step with a list of
   * constructors.
   */
  private buildArea(area: AreaId) {
    this.areaLayer?.destroy(true);
    this.groundView.forgetArea();
    this.areaView.forgetArea();
    this.avatarView.forgetArea();
    this.mineView.forgetArea();
    this.villagerView.forgetArea();

    this.areaLayer = this.add.group();
    this.builtArea = area;
    // The tile under the cursor belonged to the map that just went away.
    this.pointerTile = null;

    // A mine floor is drawn from today's seed, down the same path a Tiled map
    // is: the reducer's shell for it has the size and no walls.
    const depth = mineDepth(area);
    const map = depth === null ? areaMap(area) : mineFloorMap(floorFor(this.farm.mineSeed, depth));
    this.areaView.renderTiles(map, area);
    this.areaView.renderProps(map);
    this.areaView.renderScatter(map);
    this.mineView.buildDarkness();

    this.areaView.fitCameraBounds();

    this.groundView.refreshAllPlots();
    // Force the weather presentation to reapply against the new camera.
    this.atmosphere.lastWeather = '';
    this.atmosphere.updateWeatherPresentation();
  }

  // --- screen-space effects --------------------------------------------------
  //
  // Weather, overlays, and the HUD are pinned to the camera rather than to the
  // world, so they cover the viewport instead of one corner of a large map.

  /**
   * Re-points the camera and the HUD at a canvas of this size.
   *
   * Called on every resize, and a full-screen toggle is a resize — the browser
   * owns whether the game is full screen, which is why that is not in
   * `FarmState` and not in the save. Coming back out of it lands here too, so
   * the HUD cannot stay stuck at the size it had while it was full screen.
   */
  private layout(width: number, height: number) {
    const camera = this.cameras.main;
    const zoom = zoomFor(width, height);
    camera.setSize(width, height);
    camera.setZoom(zoom);

    // The cancelling transform. `screen = origin + zoom * (position - origin)`
    // for anything pinned to the camera, so placing the container here and
    // scaling it by 1/zoom puts its local (0, 0) exactly on the top-left pixel.
    this.screen.container.setScale(1 / zoom);
    this.screen.container.setPosition((width / 2) * (1 - 1 / zoom), (height / 2) * (1 - 1 / zoom));

    this.hud.layout = hudLayout(width, height);
    this.hud.zones = hudZones(this.hud.layout).map(
      (box) => new Phaser.Geom.Rectangle(box.x, box.y, box.width, box.height),
    );

    this.layoutHud();
    this.atmosphere.spreadAtmosphere();
    this.areaView.fitCameraBounds();
  }

  /**
   * Puts every piece of the HUD, and everything else pinned to the glass,
   * where this canvas size says it goes.
   */
  private layoutHud() {
    const { width, height } = this.hud.layout;
    this.hud.layoutHud();
    this.buildHint.setPosition(width / 2, Math.min(96, height * 0.14));
    this.fishingHud.layout(width, height);
    this.mineView.layout(width, height);
    this.summary.layout(width, height);
    this.dialogue.layout(this.hud.layout);
  }

  // --- cursors --------------------------------------------------------------

  /**
   * Draws where an action would land.
   *
   * The mouse wins when it is pointing at something in reach; otherwise the
   * cursor sits on the faced tile, which is exactly what a keyboard-only
   * player has always seen — a keypress goes where this cursor is.
   *
   * A tile pointed at but out of reach gets the greyed marker instead. That is
   * still where a click would go, and it is drawn that way so the rule is
   * visible before it is enforced rather than only afterwards, in a sentence.
   */
  private updateCursor() {
    const player = this.localPlayer;
    if (!player || !this.builtArea) return;

    const hovered = this.pointerTile;
    const reachable = hovered ? isWithinReach(player, hovered.x, hovered.y) : false;
    const target = hovered && reachable ? hovered : targetTile(player.area, player, player.facing);
    const tx = target.x * TILE_SIZE + 16;
    const ty = target.y * TILE_SIZE + 16;

    // Snapped under the mouse, eased behind the player: a cursor that lerps
    // towards the pointer reads as lag, and one that snaps between faced tiles
    // reads as a jump.
    if (hovered && reachable) {
      this.cursor.setPosition(tx, ty);
    } else {
      this.cursor.x = Phaser.Math.Linear(this.cursor.x, tx, 0.35);
      this.cursor.y = Phaser.Math.Linear(this.cursor.y, ty, 0.35);
    }
    this.cursor.setVisible(tileAt(player.area, target.x, target.y)?.kind !== 'water');
    // The alpha pulse alone. The slow turn this used to have was a rotation,
    // and a rotated sprite is the one thing this renderer cannot be trusted
    // to draw whole.
    this.cursor.setAlpha(0.82 + Math.sin(this.time.now / 280) * 0.1);

    // Greyed out over anything the tool in hand cannot mark, which is what
    // makes the tier rule visible before it is enforced. Swinging ten times at
    // a boulder a copper pick will never break is an interface failure rather
    // than a difficulty, and this is where that is fixed.
    const blocked = this.toolWouldBounce(target);
    this.cursor.setTint(blocked ? tint('building.3') : 0xffffff);

    const showOutOfReach = Boolean(hovered) && !reachable;
    this.outOfReachCursor.setVisible(showOutOfReach);
    if (hovered && showOutOfReach) {
      this.outOfReachCursor.setPosition(hovered.x * TILE_SIZE + 16, hovered.y * TILE_SIZE + 16);
    }

    this.updateSweepGhost(target);
  }

  /**
   * Whether a swing at this tile would bounce off.
   *
   * Asks the reducer's own function with the reducer's own arguments, so the
   * red cursor can never promise a refusal the key then goes ahead with, or
   * the other way round.
   */
  private toolWouldBounce(tile: Point): boolean {
    const player = this.localPlayer;
    if (!player) return false;
    const node = nodeAt(this.farm.nodes, player.area, tile.x, tile.y);
    if (!node) return false;
    const held = hotbarSlots(player)[player.selectedSlot];
    const check = checkTool(node, held?.item ?? null);
    // Only the tier refusal goes red. Holding a hoe in front of a tree is not
    // a wall, it is the wrong slot, and the prompt bar says so in words.
    return !check.ok && check.tooWeak !== null;
  }

  /**
   * The rectangle the held tool would work, drawn under the cursor.
   *
   * Only for a tool that covers more than one tile: a basic hoe has always
   * shown exactly one cursor and does not need a second outline round it.
   */
  private updateSweepGhost(target: Point) {
    const player = this.localPlayer;
    const held = player ? hotbarSlots(player)[player.selectedSlot] : null;
    const size = held ? areaOfEffectOf(held.item) : { width: 1, height: 1 };
    if (!player || (size.width === 1 && size.height === 1) || farmStore.getState().buildKind) {
      this.sweepGhost.setVisible(false);
      return;
    }
    this.sweepGhost.setVisible(true);
    this.sweepGhost.setPosition(
      (target.x - Math.floor((size.width - 1) / 2)) * TILE_SIZE,
      (target.y - Math.floor((size.height - 1) / 2)) * TILE_SIZE,
    );
    this.sweepGhost.setSize(size.width * TILE_SIZE, size.height * TILE_SIZE);
  }
}
