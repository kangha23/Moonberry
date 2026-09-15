import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, zoomFor } from '../constants';
import {
  DIAL_SWEEP,
  FRINGE_BOUNDARIES,
  SEASON_ICONS,
  WEATHER_ICONS,
  createPixelArtTextures,
  fringeTexture,
} from '../assets/createPixelArtTextures';
import { LPC_IMAGES, LPC_SHEETS } from '../assets/lpc.generated';
import { PALETTE, tint } from '../assets/palette.generated';
import { HUD, hudLayout, hudZones, type HudLayout } from '../ui/hudLayout';
import { SoundManager } from '../audio/SoundManager';
import { FOOTSTEP_INTERVAL_MS, footstepFor, musicFor } from '../audio/soundtrack';
import { connectToFarm, type FarmConnection } from '../net/client';
import type { GameEvent } from '../state/intents';
import { energyRatio, hotbarSlots, promptFor, waitingOnLabel } from '../state/selectors';
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
import type { FarmState, PlayerId, PlayerState } from '../state/types';
import { npcDef, type NpcId } from '../npcs/definitions';
import { animalsOn, type Animal } from '../systems/animals';
import type { NpcActor } from '../npcs/schedule';
import {
  BUILDING_AREA,
  buildingBounds,
  buildingDef,
  checkPlacement,
  isComplete,
} from '../systems/buildings';
import { isWithering } from '../systems/farming';
import {
  checkTool,
  nodeAt,
  nodesOn,
  type NodeKind,
  type ResourceNode,
} from '../systems/resources';
import {
  isMachine,
  isSprinkler,
  machineIsReady,
  placeableDef,
  placeablesOn,
  sprinkledPlotKeys,
  sprinklerTiles,
  type Placeable,
} from '../systems/placeables';
import { HOTBAR_SIZE } from '../systems/inventory';
import type { CastPhase } from '../systems/fishing';
import { ITEMS, areaOfEffectOf, itemDef } from '../systems/items';
import { DAY_END, DAY_START, seasonLabel, weatherLabel } from '../systems/time';
import {
  AREA_IDS,
  START_AREA,
  TILE_SIZE,
  edgeMask,
  pairKindAt,
  areaMap,
  isWithinReach,
  plotKey,
  targetTile,
  tileAt,
  worldToTile,
  type AreaId,
  type AreaMap,
  type Direction,
  type Point,
} from '../world/areas';

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

/** Which drawing a node gets. A tree's is the one for the stage it has reached. */
function nodeTexture(node: ResourceNode): string {
  if (node.kind === 'tree') return `node-tree-${node.stage ?? 0}`;
  if (node.kind === 'forage') return `node-forage-${node.item}`;
  return `node-${node.kind}`;
}

/**
 * Where a node's drawing is centred.
 *
 * The art is taller than its tile and stands *in* it rather than filling it:
 * the floor line inside every node texture is at `NODE_FLOOR`, and that line
 * has to land on the bottom edge of the tile the node occupies. Anything above
 * it — a canopy, the top of a boulder — then rises out of the tile, which is
 * what you walk behind.
 */
const NODE_ART = { height: 80, floor: 74 };

function nodeCentreY(node: ResourceNode): number {
  return (node.y + 1) * TILE_SIZE - (NODE_ART.floor - NODE_ART.height / 2);
}

/**
 * How many drawings each sort of ground has. Matches `generate-plot-art.mjs`.
 *
 * The field is most of the screen for most of the game, and one drawing of a
 * tile repeated forty times is the wallpaper effect — the eye picks up the
 * period long before it can say why the picture looks cheap. Three is enough
 * to break it, and cheap enough to be three small files.
 */
const PLOT_VARIANTS = 3;

/**
 * Which drawing of a ground tile this position gets.
 *
 * A hash of the tile rather than a draw, so a plot keeps the same face for the
 * life of the save: a field that reshuffled itself every time it was redrawn
 * would shimmer every morning. The variants are interchangeable by
 * construction — the furrows line up across all three — so nothing but the
 * grain depends on which one lands where.
 */
function plotVariant(base: string, tileX: number, tileY: number): string {
  let h = (tileX * 374761393 + tileY * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  const pick = ((h ^ (h >>> 16)) >>> 0) % PLOT_VARIANTS;
  return pick === 0 ? base : `${base}-${pick + 1}`;
}

/** LPC walkcycle rows: 0 = up, 1 = left, 2 = down, 3 = right (9 frames each). */
const WALK_ROW: Record<Direction, number> = { up: 0, left: 1, down: 2, right: 3 };

/** Player id used while playing offline. Online, the server's session id wins. */
const OFFLINE_PLAYER_ID = 'local';

/**
 * Depth bands. World objects sort by tile row below `weather`; everything at or
 * above it is screen-space and pinned to the camera.
 */
const DEPTH = {
  weather: 1000,
  overlay: 1100,
  hud: 1200,
  modal: 1300,
};

/**
 * What a walker adds to its tile row to get its depth.
 *
 * Avatars sort above every Tiled prop by sitting in a band of their own, and
 * anything that has to occlude a player — a building — has to be in the same
 * band or the comparison is between two different scales.
 */
const AVATAR_DEPTH_BASE = 40;

/**
 * Where a thing that is walked over sits: above the tilled-plot fringe at 0.5
 * and below everything that stands on the ground. Paths and sprinklers.
 */
const GROUND_ITEM_DEPTH = 0.75;

/**
 * How many tiles the dawn spray draws before it gives up.
 *
 * A farm late in a save can carry fifty sprinklers, and several hundred tweens
 * in the single frame the day turns is a stutter on the one frame nobody wants
 * one. The first few dozen read as the field being watered; the rest would
 * only be arithmetic.
 */
const MAX_SPRAY_TILES = 60;

/**
 * The two faces, and which is for what.
 *
 * VT323 for anything short: the clock, the coins, the energy, a cell number, a
 * panel heading. It is one of exactly two pixel faces on Google Fonts that
 * carry the Vietnamese tone marks, and the readable one of the two at HUD
 * sizes. It is monospaced, so numbers in the HUD line up in a column, and it
 * has no bold at all — emphasis here is a colour, never a weight.
 *
 * Nunito for anything that is a sentence: a line of dialogue, a description,
 * the prompt bar. A terminal face set in paragraphs is a chore to read.
 */
const PIXEL_FONT = 'VT323, "Courier New", monospace';
const PROSE_FONT = 'Nunito, system-ui, sans-serif';

/** Below 16px VT323 loses its tone marks into the letters above them. */
const PIXEL_MIN_SIZE = 16;

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

/** How grey the world goes on empty. */
const EXHAUSTED_TINT_ALPHA = 0.34;

/** Long enough that a key still held from last night cannot eat the summary. */
/** What a doomed crop is tinted. Drained of colour rather than made lurid. */
const WILT_TINT = tint('light.2');

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
 * The nine-slice frames, and how deep each one's border runs.
 *
 * The same three files the stylesheet uses. That is the point of them being
 * files: a panel edge drawn once in CSS and once in canvas drifts, and the two
 * halves of this interface arguing with each other is what this whole pass is
 * about.
 */
const FRAMES = {
  panel: { key: 'frame-wood', slice: 12 },
  slot: { key: 'frame-slot', slice: 4 },
  plate: { key: 'frame-plate', slice: 6 },
} as const;

/** One line of the morning summary: a picture, and what it is a picture of. */
interface SummaryRow {
  texture: string;
  text: string;
  tint?: number;
}

/**
 * The morning panel.
 *
 * Six rows, and six is the honest limit rather than an arbitrary one: a day
 * that did seven notable things has a seventh worth cutting, and a panel that
 * grows until it runs off the bottom of a short window is worse than one that
 * stops.
 */
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

const SUMMARY = {
  width: 460,
  /** The tallest it ever gets, which is what the card is first built at. */
  height: 300,
  /** Above the first row: the frame, and the greeting set at 26px. */
  head: 86,
  /** Below the last: the frame again, and the line telling you to press a key. */
  foot: 52,
  rowHeight: 34,
  icon: 32,
  maxRows: 6,
} as const;

interface Avatar {
  sprite: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Image;
  lastX: number;
  lastY: number;
}

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
}

/**
 * One animal on screen.
 *
 * `facing` is a sign rather than a `Direction`: the drawings are side-on, so
 * the only thing the renderer has to remember is which way to flip. It is kept
 * here and not read off the state for the same reason a villager's is — the
 * state has no such field, because which way something is turned is a
 * consequence of how it is being drawn moving.
 */
interface AnimalSprite {
  sprite: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  /** The exclamation over a hungry animal. Hidden the moment it is fed. */
  marker: Phaser.GameObjects.Image;
  facing: 1 | -1;
}

/**
 * One thing standing on the ground.
 *
 * `texture` is kept beside the sprite so a tree that put on a stage overnight
 * can be spotted without asking Phaser what it is currently drawing, which is
 * the only property of a node that ever changes its picture.
 */
interface NodeSprite {
  sprite: Phaser.GameObjects.Image;
  texture: string;
}

/**
 * One crafted thing standing on the ground, and the bubble over it.
 *
 * `ready` is kept beside the sprite for the same reason `texture` is above:
 * it is the one property that changes the picture, and comparing a boolean is
 * cheaper than asking Phaser what it is currently drawing.
 */
interface PlaceableSprite {
  sprite: Phaser.GameObjects.Image;
  bubble: Phaser.GameObjects.Image | null;
  ready: boolean;
}

/** What a chip flying off a struck node is coloured, by what it came off. */
const CHIP_TINTS: Record<NodeKind, number> = {
  tree: tint('soil.4'),
  stump: tint('soil.3'),
  rock: tint('light.6'),
  boulder: tint('light.6'),
  weed: tint('leaf.2'),
  grass: tint('light.0'),
  forage: tint('light.7'),
};

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

  private plotSprites = new Map<string, Phaser.GameObjects.Image>();
  private cropSprites = new Map<string, Phaser.GameObjects.Image>();
  /** One sprite per building on the built area, keyed by building id. */
  private buildingSprites = new Map<string, Phaser.GameObjects.Image>();
  /** What `buildingSprites` was last drawn from, so it is only rebuilt on change. */
  private drawnBuildings: FarmState['buildings'] | null = null;
  private sparkles = new Map<string, Phaser.GameObjects.Image>();
  private waterSprites: Phaser.GameObjects.Image[] = [];
  private avatars = new Map<PlayerId, Avatar>();
  /** One record per villager standing on the built area. */
  private villagers = new Map<NpcId, Villager>();
  /** One record per animal out of doors, keyed by animal id. */
  private animalSprites = new Map<string, AnimalSprite>();
  /** One sprite per node on the built area, keyed by node id. */
  private nodeSprites = new Map<string, NodeSprite>();
  /** What `nodeSprites` was last drawn from, so it is only diffed on change. */
  private drawnNodes: FarmState['nodes'] | null = null;
  /**
   * One record per crafted thing standing on the built area.
   *
   * The bubble is the second half of spec 11's "the finished state must be
   * visible from across the farm": a keg is thirty-two pixels and a keg with
   * wine in it is the same thirty-two pixels, so what actually reads at
   * distance is the thing floating above it.
   */
  private placeableSprites = new Map<string, PlaceableSprite>();
  /** What `placeableSprites` was last drawn from, so it is only diffed on change. */
  private drawnPlaceables: FarmState['placeables'] | null = null;
  /**
   * Which plots the sprinklers keep wet, cached on the array that decided it.
   *
   * `refreshPlot` asks this on every plot it redraws, and a field redraw is
   * every plot on the map — so recomputing the set each time would walk every
   * sprinkler forty times a morning for an answer that only changes when
   * somebody puts one down.
   */
  private sprinkled: ReadonlySet<string> = new Set();
  private sprinkledFrom: FarmState['placeables'] | null = null;
  private questIcon: Phaser.GameObjects.Image | null = null;
  private houseGlow: Phaser.GameObjects.Image | null = null;
  private chimney: { x: number; y: number } | null = null;

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
   * See `createScreenLayer`: the container carries the transform that undoes
   * the camera's zoom, so every child below is positioned in plain screen
   * pixels with the origin at the top-left of the canvas.
   */
  private screen!: Phaser.GameObjects.Container;
  /** Where each piece of the HUD goes, recomputed on every resize. */
  private hud: HudLayout = hudLayout(GAME_WIDTH, GAME_HEIGHT);
  /** The same layout as hit-test rectangles, so a click on the HUD is not a hoe. */
  private hudZones: Phaser.Geom.Rectangle[] = [];

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

  private dayNightOverlay!: Phaser.GameObjects.Rectangle;
  private sunsetOverlay!: Phaser.GameObjects.Rectangle;
  private exhaustionOverlay!: Phaser.GameObjects.Rectangle;
  private vignetteTop!: Phaser.GameObjects.Rectangle;
  private vignetteBottom!: Phaser.GameObjects.Rectangle;

  private energyPanel!: Phaser.GameObjects.Container;
  private energyFrame!: Phaser.GameObjects.NineSlice;
  private energyFill!: Phaser.GameObjects.Rectangle;
  private energyBolt!: Phaser.GameObjects.Image;
  private energyHit!: Phaser.GameObjects.Rectangle;
  private energyText!: Phaser.GameObjects.Text;

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
  /** True while the reel key is down, so only the changes are sent. */
  private reelHeld = false;
  /**
   * The phase the local cast was in last frame, or null between casts.
   *
   * Kept only so a bite that arrives while the key is already down can still
   * be struck. See `handleInteractions`.
   */
  private lastCastPhase: CastPhase | null = null;

  private waitingPanel!: Phaser.GameObjects.Container;
  private waitingBackdrop!: Phaser.GameObjects.Rectangle;
  private waitingText!: Phaser.GameObjects.Text;

  private summaryPanel!: Phaser.GameObjects.Container;
  private summaryCard!: Phaser.GameObjects.NineSlice;
  private summaryTitle!: Phaser.GameObjects.Text;
  private summaryHint!: Phaser.GameObjects.Text;
  private summaryRows: Array<{ icon: Phaser.GameObjects.Image; text: Phaser.GameObjects.Text }> = [];

  private rainDrops: Phaser.GameObjects.Image[] = [];
  private fireflies: Phaser.GameObjects.Image[] = [];
  private clouds: Phaser.GameObjects.Image[] = [];
  private petals: Phaser.GameObjects.Image[] = [];
  private butterflies: Phaser.GameObjects.Image[] = [];

  /** What the farm did today, tallied from events for the morning summary. */
  private today = { coins: 0, harvested: 0, collected: 0, cleared: 0, fished: 0 };
  /**
   * What came up while nobody was looking, held for the morning panel.
   *
   * Stashed rather than shown as it arrives, like the withered crops and the
   * hungry animals: it lands in the same frame as `dayStarted`, and a farm
   * quietly going back to scrub is news that belongs in the summary rather
   * than flashing past on the prompt bar.
   */
  private grewOvernight: Extract<GameEvent, { kind: 'nodesGrew' }> | null = null;
  /**
   * What finished overnight, held until the morning panel can report it.
   *
   * The whole point of this spec is that each day ends more capable than it
   * began, and the morning summary is where a player finds out that it did.
   */
  private finishedOvernight: SummaryRow[] = [];
  /** Set by a `collapsed` event so the next morning can explain the missing gold. */
  private collapsedFor = 0;
  /**
   * How many animals went to bed hungry, for the morning panel.
   *
   * Stashed rather than shown as it arrives, like the withered crops: the
   * event lands in the same frame as `dayStarted`, and this is news that
   * belongs in the summary rather than flashing past on the prompt bar.
   */
  private hungryOvernight = 0;
  private summaryShownAt = 0;
  private dismissRequested = false;

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

  private smokeTimer = 0;
  private boundsTimer = 0;
  private dustTimer = 0;
  private footstepTimer = 0;
  private waterTimer = 0;
  private waterFrame = 0;
  private lastWeather = '';
  /** Last night's losses, held until the morning panel can report them. */
  private witheredOvernight: Extract<GameEvent, { kind: 'cropsWithered' }> | null = null;
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
    this.load.svg('market-ribbon', '/assets/pixel/market-ribbon.svg', { width: 96, height: 32 });
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
    // Same bargain as the art: a missing file is silence, not a broken game.
    SoundManager.preload(this, AREA_IDS);
  }

  create() {
    createPixelArtTextures(this);
    this.createWalkAnimations();
    this.createVillagerAnimations();
    this.createScreenLayer();
    this.createWeatherSprites();
    this.createAmbient();
    this.createUi();
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
    this.toScreen(this.buildHint);

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

    this.refreshUi();
    setSceneReady();
  }

  update(time: number, delta: number) {
    // The world keeps running behind the morning summary — the server does not
    // stop for one player reading it — but this player's input is suspended,
    // so the key that dismisses it does not also swing a tool.
    // Told to the store rather than kept here alone, because Escape's ladder
    // is decided in one place and it has to be able to see this panel.
    setSummaryOpen(this.summaryPanel.visible);

    if (this.summaryPanel.visible) {
      if (this.dismissRequested && time - this.summaryShownAt > SUMMARY_MIN_MS) {
        this.summaryPanel.setVisible(false);
        setSummaryOpen(false);
      }
      this.dismissRequested = false;
      this.releaseAct();
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
    this.syncBuildings();
    this.syncNodes();
    this.syncPlaceables();
    this.syncNpcs(delta);
    this.syncAnimals(delta);
    this.syncAvatars();
    this.updateCursor();
    this.updateBuildGhost();
    this.updateFishing(time);
    this.updateAtmosphere(delta);
    this.updateMusic();
    this.refreshUi();
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

  private get farm() {
    return farmStore.getState().farm;
  }

  private get localPlayer(): PlayerState | null {
    const { farm, localPlayerId } = farmStore.getState();
    return localPlayerId ? (farm.players[localPlayerId] ?? null) : null;
  }

  /** Turns simulation events into sprites, tweens, and re-renders. */
  private handleEvents(events: GameEvent[]) {
    const { localPlayerId } = farmStore.getState();
    for (const event of events) {
      this.audio.handleEvent(event, localPlayerId);

      if (event.kind === 'plotChanged') {
        this.refreshPlot(event.key);
        // Shown rather than narrated. Watering had a sound and a change of
        // texture and nothing at all in between, which left the one action a
        // player repeats forty times a morning as the only one with no moment.
        if (event.action === 'water') {
          const plot = this.farm.plots[event.key];
          if (plot) this.splash(plot.x, plot.y);
        }
      } else if (event.kind === 'sprinklersRan') {
        // Arrives in the same batch as `dayStarted`, so the field this draws
        // over is already the new morning's field.
        this.spraySprinklers();
      } else if (event.kind === 'giftGiven') {
        // Shown rather than narrated: the prompt bar carries the words, and
        // the heart is what you actually watch for. Only for the player who
        // gave it — somebody else's gift is not your moment.
        if (event.playerId === localPlayerId && event.heartGained) this.popHeart(event.npc);
      } else if (event.kind === 'cropsWithered') {
        // Stashed rather than shown now: it arrives in the same frame as
        // `dayStarted`, and the morning panel is where it belongs.
        this.witheredOvernight = event;
      } else if (event.kind === 'dayStarted') {
        this.updateWeatherPresentation();
        // Every plot, not only the ones that changed: the wilt tint depends on
        // the date, so on the twenty-sixth of a season a field that did nothing
        // overnight still has to be repainted grey.
        this.refreshAllPlots();
        this.showDaySummary(event.day, event.grown);
      } else if (event.kind === 'fishCaught') {
        // Only your own. Somebody else's sturgeon is their moment, and a card
        // over your screen naming it is a notification rather than a reward.
        if (event.playerId === localPlayerId) {
          this.showCatch(event.fish, event.size);
          // Its own tally, not the coop's: `collected` is drawn with an egg
          // beside it and reads "món từ chuồng", so a trout counted into it
          // would have the morning panel quietly lying about the henhouse.
          this.today.fished += 1;
        }
      } else if (event.kind === 'farmReplaced') {
        this.buildArea(this.localPlayer?.area ?? START_AREA);
      } else if (event.kind === 'harvested') {
        this.today.harvested += 1;
      } else if (event.kind === 'sold' || event.kind === 'questRewarded') {
        this.today.coins += event.coins;
      } else if (event.kind === 'upgradeReady' && event.playerId === localPlayerId) {
        // Stashed rather than shown now: it arrives in the same frame as
        // `dayStarted`, and the morning panel is where it belongs. The picture
        // is the tool itself — the same texture the hotbar will draw for it an
        // hour from now, which is how you know it is the same tool.
        this.finishedOvernight.push({
          texture: itemDef(event.item).texture,
          text: `${itemDef(event.item).label} đã xong ở lò rèn`,
        });
      } else if (event.kind === 'buildingFinished') {
        this.finishedOvernight.push({
          texture: `building-${event.building}`,
          text: `${buildingDef(event.building).label} đã dựng xong`,
        });
      } else if (event.kind === 'nodeHit') {
        this.shakeNode(event.id, event.node);
      } else if (event.kind === 'nodeCleared') {
        // Burst it where it stood, before `syncNodes` notices it has gone: the
        // sprite is still there this frame and is the only thing that knows
        // where "there" was.
        this.burstNode(event.id, event.node);
        if (event.playerId === localPlayerId) this.today.cleared += 1;
      } else if (event.kind === 'nodesGrew') {
        this.grewOvernight = event;
      } else if (event.kind === 'animalPetted') {
        // Shown, not narrated. Only for the player whose hand it was — a heart
        // over somebody else's goat across the field is not your moment.
        if (event.playerId === localPlayerId) this.popAnimalHeart(event.animalId);
      } else if (event.kind === 'produceCollected') {
        if (event.playerId === localPlayerId) this.today.collected += 1;
      } else if (event.kind === 'animalSold') {
        this.today.coins += event.coins;
      } else if (event.kind === 'animalsHungry') {
        this.hungryOvernight = event.count;
      } else if (event.kind === 'collapsed') {
        this.collapsedFor = event.coinsLost;
      } else if (event.kind === 'exhausted' && event.playerId === localPlayerId) {
        this.cameras.main.shake(200, 0.004);
      }
    }
  }

  /**
   * The morning panel: what yesterday came to, and why the wallet is lighter
   * if it is. A silent loss of money reads as a bug.
   *
   * A row is a picture and a short phrase rather than a paragraph. The house
   * style says feeling is shown rather than told and that the prompt bar is
   * the fallback channel rather than the main one — and "0 luống đã lớn lên
   * qua đêm" was a sentence doing a sprout's job.
   */
  private showDaySummary(day: number, grown: number) {
    const rows: SummaryRow[] = [
      { texture: 'icon-coin', text: `${this.today.coins}g kiếm được hôm qua` },
      { texture: 'item-basket', text: `${this.today.harvested} nông sản đã thu` },
      { texture: 'crop-sprout', text: `${grown} luống lớn lên qua đêm` },
    ];

    // The herd, but only when it did something: a farm with no animals should
    // not be told every morning that nought eggs were collected.
    if (this.today.collected > 0) {
      rows.push({ texture: 'item-egg', text: `${this.today.collected} món từ chuồng` });
    }
    // Yesterday evening on the bank, on the same terms as the coop: only when
    // there was one.
    if (this.today.fished > 0) {
      rows.push({ texture: 'item-carp', text: `${this.today.fished} mẻ câu được` });
    }
    if (this.hungryOvernight > 0) {
      rows.push({
        texture: 'animal-hungry',
        text: `${this.hungryOvernight} con vật đói qua đêm — kho cỏ cạn rồi`,
        tint: tint('building.3'),
      });
    }

    // What the land did without you. Only when it did something, so a farm
    // that is entirely cleared is not told every morning that nothing grew.
    const grew = this.grewOvernight;
    if (grew && grew.spawned > 0) {
      rows.push({ texture: 'node-weed', text: `${grew.spawned} thứ mọc lên qua đêm` });
    }
    if (grew && grew.cleared > 0) {
      rows.push({
        texture: 'node-grass',
        text: `Mùa mới dọn sạch ${grew.cleared} đám ngoài đồng`,
        tint: WILT_TINT,
      });
    }
    if (this.today.cleared > 0) {
      rows.push({ texture: 'item-wood', text: `${this.today.cleared} thứ đã dọn hôm qua` });
    }

    if (this.collapsedFor > 0) {
      rows.push({
        texture: 'icon-energy-bolt',
        text: `Gục lúc 2 giờ sáng — mất ${this.collapsedFor}g`,
        tint: tint('building.3'),
      });
    }

    // The ratchet, reported. A farm that is better than it was yesterday
    // should say so on the morning it becomes true.
    rows.push(...this.finishedOvernight);

    // Named, not counted, and pictured: "6 crops withered" is the line that
    // reads as a bug, where three greyed-out crop icons read as a season
    // ending. The tint is the same grey the doomed plants wore in the field.
    const withered = this.witheredOvernight;
    if (withered) {
      const names = withered.crops.map((crop) => itemDef(crop).label.toLowerCase());
      const list =
        names.length === 1
          ? names[0]
          : `${names.slice(0, -1).join(', ')} và ${names[names.length - 1]}`;
      rows.push({
        texture: itemDef(withered.crops[0]).texture,
        text: `Mùa ${seasonLabel(withered.season)} lấy đi ${withered.count} luống: ${list}`,
        tint: WILT_TINT,
      });
    }

    this.drawSummary(`Chào buổi sáng — Ngày ${day}`, rows.slice(0, SUMMARY.maxRows));
    this.summaryPanel.setVisible(true);
    this.summaryShownAt = this.time.now;
    this.dismissRequested = false;
    this.today = { coins: 0, harvested: 0, collected: 0, cleared: 0, fished: 0 };
    this.collapsedFor = 0;
    this.hungryOvernight = 0;
    this.witheredOvernight = null;
    this.grewOvernight = null;
    this.finishedOvernight = [];
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
    keyboard.on('keydown', () => {
      this.dismissRequested = true;
    });

    this.bindPointer();

    // Scrolling the wheel over the canvas walks the hotbar, the way it does in
    // every game that has one. Registered on the scene rather than on each
    // cell so it works wherever the pointer is.
    this.input.on(
      'wheel',
      (_pointer: Phaser.Input.Pointer, _over: unknown, _dx: number, dy: number) => {
        if (farmStore.getState().inventoryOpen || this.summaryPanel.visible) return;
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
    return this.hudZones.some((zone) => zone.contains(pointer.x, pointer.y));
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
      this.summaryPanel.visible ||
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
      const step = footstepFor(under?.kind);
      if (step) this.audio.play(step);
    }

    const avatar = this.avatars.get(player.id);
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
    this.plotSprites.clear();
    this.cropSprites.clear();
    this.buildingSprites.clear();
    // The sprites went with the layer, so the next `syncBuildings` has to draw
    // them again even though the array itself has not changed.
    this.drawnBuildings = null;
    this.sparkles.clear();
    this.nodeSprites.clear();
    // The sprites went with the layer, so the next `syncNodes` has to draw them
    // again even though the array itself has not changed.
    this.drawnNodes = null;
    this.placeableSprites.clear();
    this.drawnPlaceables = null;
    this.waterSprites = [];
    this.avatars.clear();
    this.questIcon = null;
    this.houseGlow = null;
    this.chimney = null;

    this.areaLayer = this.add.group();
    this.builtArea = area;
    // The tile under the cursor belonged to the map that just went away.
    this.pointerTile = null;

    const map = areaMap(area);
    this.renderTiles(map, area);
    this.renderProps(map);
    this.renderScatter(map);

    this.cameras.main.setBounds(0, 0, map.pixelWidth, map.pixelHeight);

    this.refreshAllPlots();
    // Force the weather presentation to reapply against the new camera.
    this.lastWeather = '';
    this.updateWeatherPresentation();
  }

  private renderTiles(map: AreaMap, area: AreaId) {
    for (let y = 0; y < map.height; y += 1) {
      for (let x = 0; x < map.width; x += 1) {
        const tile = map.tiles[y * map.width + x];
        if (!tile) continue;
        const image = this.add
          .image(x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE / 2, tile.texture)
          .setDepth(0);
        this.areaLayer?.add(image);
        if (tile.kind === 'plot') this.plotSprites.set(plotKey(area, x, y), image);
        if (tile.kind === 'water') this.waterSprites.push(image);
      }
    }
    this.renderEdges(map);
  }

  /**
   * Softens the three boundaries where one kind of ground meets another.
   *
   * A dirt path used to be cut out of the lawn with a hard rectangular edge,
   * which is what made a map read as a grid of squares rather than as a piece
   * of land. Here the higher material spills a few pixels over the lower one —
   * grass over a path, grass over a bank, a path over water — with a dithered,
   * uneven leading edge, and the squares stop being visible.
   *
   * Once per area build, never per frame. `edgeMask` is pure and the mask only
   * changes when the map does, which is never: these are the same forty-five
   * textures laid down in the same places every time this area is entered.
   */
  private renderEdges(map: AreaMap) {
    const kindAt = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= map.width || y >= map.height) return null;
      return map.tiles[y * map.width + x]?.kind ?? null;
    };

    for (const { over, under } of FRINGE_BOUNDARIES) {
      // Read the map as if only these two kinds existed, so a tile touching
      // both grass and water gets one mask per boundary rather than one
      // muddled mask describing neither.
      const paired = pairKindAt(kindAt, under, over);

      for (let y = 0; y < map.height; y += 1) {
        for (let x = 0; x < map.width; x += 1) {
          // The fringe is drawn on the lower material, looking up.
          if (kindAt(x, y) !== under) continue;
          const mask = edgeMask(paired, x, y);
          if (mask === 0) continue;

          const texture = fringeTexture(over, under, mask);
          if (!this.textures.exists(texture)) continue;
          const fringe = this.add
            .image(x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE / 2, texture)
            // Above the ground and below everything that stands on it, so a
            // tilled plot drawn later still covers its own tile.
            .setDepth(0.5);
          this.areaLayer?.add(fringe);
        }
      }
    }
  }

  private renderProps(map: AreaMap) {
    for (const prop of map.props) {
      const centreX = prop.x + prop.width / 2;
      const centreY = prop.y + prop.height / 2;

      const image = this.add.image(centreX, centreY, prop.texture).setDepth(prop.depth);
      // Props are sized by their Tiled footprint, so resizing one in the editor
      // resizes it in game without touching this file — but the footprint sets
      // the width only, and the height follows the drawing's own proportions.
      //
      // Stretching to the full footprint is what squashed the trees: `tree.png`
      // is 96x136 and its object is two tiles square, so a tall tree was being
      // pressed into a 64x64 box and came out a shrub with a wide hat. Every
      // other prop is already drawn at exactly its footprint, so this changes
      // nothing for them — and it means a tree's collision can stay the tile or
      // two of trunk you actually walk into while the canopy rises above it.
      //
      // Art taller than its box grows upwards out of the ground rather than
      // spilling equally past both ends, so the drawn rectangle is moved up by
      // half its overhang instead of being re-anchored.
      //
      // Moved rather than re-anchored deliberately. `setOrigin(0.5, 1)` says
      // the same thing far more plainly, and it cannot be used: Phaser 4 draws
      // a sprite wrong when it is rotated *and* its origin is off centre, and
      // the trees are rotated by the wind sway. It tears the quad into wedges
      // with the background showing through. Measured on this tree at 1.4
      // degrees: origin 0.5/1 tears at every size tried, origin 0.5/0.5 is
      // clean, and at angle 0 both are clean. So the origin stays centred and
      // the position does the work.
      const source = this.textures.get(prop.texture)?.getSourceImage();
      const naturalWidth = source && 'width' in source ? source.width : prop.width;
      const naturalHeight = source && 'height' in source ? source.height : prop.height;
      const drawnHeight = naturalWidth > 0 ? (prop.width * naturalHeight) / naturalWidth : prop.height;
      image.setDisplaySize(prop.width, drawnHeight);
      image.setPosition(centreX, prop.y + prop.height - drawnHeight / 2);
      this.areaLayer?.add(image);

      if (prop.texture === 'farmhouse') {
        const shadow = this.add
          .image(centreX, prop.y + prop.height, 'shadow-soft')
          .setDepth(prop.depth - 1)
          .setScale(3.2, 2.4)
          .setAlpha(0.85);
        // The windows and the chimney belong to the drawing, not to the box
        // the map drew around it: a house is as tall as its art, and the art
        // stands on the footprint's bottom edge rather than filling it. Read
        // off `image` and the smoke leaves the chimney at whatever height the
        // house happens to be drawn at, instead of a measurement from the top
        // of the footprint that only held for one picture.
        const top = image.y - image.displayHeight / 2;
        const glow = this.add.image(centreX, image.y, 'glow').setDepth(prop.depth + 2).setScale(2.6).setAlpha(0);
        this.areaLayer?.addMultiple([shadow, glow]);
        this.houseGlow = glow;
        this.chimney = { x: centreX + prop.width / 3, y: top + 2 };
      }

      if (prop.texture === 'tree') {
        const shadow = this.add
          .image(centreX, prop.y + prop.height, 'shadow-soft')
          .setDepth(prop.depth - 1)
          .setScale(1.5, 1.1)
          .setAlpha(0.8);
        this.areaLayer?.add(shadow);
        // A pixel of lean, not a rotation.
        //
        // This used to tween `angle`, and Phaser 4 draws a rotated sprite
        // wrong: measured on this tree at 24 frames a run, a swaying tree came
        // back torn into wedges in 12 of them, and with the sway switched off
        // all 24 frames were identical to the pixel. It is not the size, the
        // origin, `roundPixels` or the camera — every one of those was held
        // and varied — and 4.2.1 does the same. It is the rotation.
        //
        // Sliding one pixel is what a 2D game did about wind before it could
        // rotate anything, it reads as the same breeze at this zoom, and it
        // lands on the pixel grid rather than between it.
        const rest = image.x;
        this.tweens.add({
          targets: image,
          x: rest + ((prop.x / TILE_SIZE) % 2 === 0 ? 1 : -1),
          yoyo: true,
          repeat: -1,
          duration: 2400 + ((prop.x / TILE_SIZE) % 5) * 400,
          ease: 'Sine.inOut',
        });
      }
    }
  }

  /**
   * Draws what has been built, and keeps it drawn.
   *
   * Buildings are state rather than map, so they cannot go up with the props:
   * one can appear while the player is standing there. Rebuilt only when the
   * array's identity changes, which — because the reducer is immutable — is
   * exactly when something was actually placed or finished.
   */
  private syncBuildings() {
    const { buildings } = this.farm;
    if (buildings === this.drawnBuildings) return;
    this.drawnBuildings = buildings;

    for (const sprite of this.buildingSprites.values()) sprite.destroy();
    this.buildingSprites.clear();
    if (this.builtArea !== BUILDING_AREA) return;

    for (const building of buildings) {
      const def = buildingDef(building.kind);
      const bounds = buildingBounds(building);
      const done = isComplete(building);
      const sprite = this.add
        .image(
          bounds.x + bounds.width / 2,
          bounds.y + bounds.height / 2,
          done ? `building-${building.kind}` : 'building-scaffold',
        )
        .setDisplaySize(bounds.width, bounds.height)
        // Sorted by the row the building's feet stand on, in the avatars' own
        // band rather than the props' — `+ AVATAR_DEPTH_BASE` is what an
        // avatar adds to its row, and matching it is the whole point: a player
        // north of a barn has the lower row and is drawn behind it, and a
        // player south of it has the higher row and is drawn in front.
        .setDepth(building.y + def.height - 1 + AVATAR_DEPTH_BASE);
      this.areaLayer?.add(sprite);
      this.buildingSprites.set(building.id, sprite);
    }
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

  /** Grass tufts, scattered deterministically so an area always looks the same. */
  private renderScatter(map: AreaMap) {
    let placed = 0;
    const limit = Math.floor((map.width * map.height) / 28);
    for (let y = 0; y < map.height && placed < limit; y += 1) {
      for (let x = 0; x < map.width && placed < limit; x += 1) {
        if (map.tiles[y * map.width + x]?.kind !== 'grass') continue;
        if ((x * 13 + y * 29) % 11 !== 0) continue;
        const tuft = this.add
          .image(x * TILE_SIZE + 16, y * TILE_SIZE + 18, 'grass-tuft')
          .setDepth(y)
          .setAlpha(0.95);
        this.areaLayer?.add(tuft);
        placed += 1;
      }
    }
  }

  private createWalkAnimations() {
    if (!this.textures.exists('player-sheet')) return;
    (['up', 'left', 'down', 'right'] as Direction[]).forEach((dir) => {
      const key = `player-walk-${dir}`;
      if (this.anims.exists(key)) return;
      this.anims.create({
        key,
        frames: this.anims.generateFrameNumbers('player-sheet', {
          start: WALK_ROW[dir] * 9 + 1,
          end: WALK_ROW[dir] * 9 + 8,
        }),
        frameRate: 10,
        repeat: -1,
      });
    });
  }

  // --- avatars --------------------------------------------------------------

  private createAvatar(player: PlayerState): Avatar {
    const hasSheet = this.textures.exists('player-sheet');
    const shadow = this.add.image(player.x, player.y + 16, 'shadow');
    const sprite = this.add
      .sprite(player.x, player.y, hasSheet ? 'player-sheet' : 'player', hasSheet ? WALK_ROW.down * 9 : undefined)
      .setScale(hasSheet ? 0.62 : 1.2);
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
    this.areaLayer?.addMultiple([shadow, sprite]);
    return { sprite, shadow, lastX: player.x, lastY: player.y };
  }

  /**
   * Draws the players standing on the built area, adding and removing avatars
   * as people arrive, leave, or walk through a doorway to somewhere else.
   */
  private syncAvatars() {
    const { farm, localPlayerId } = farmStore.getState();
    // Members who are logged out keep their place in the world but are not
    // standing in it, so they are not drawn.
    const here = Object.values(farm.players).filter(
      (player) => player.online && player.area === this.builtArea,
    );
    const present = new Set(here.map((player) => player.id));

    for (const player of here) {
      let avatar = this.avatars.get(player.id);
      if (!avatar) {
        avatar = this.createAvatar(player);
        this.avatars.set(player.id, avatar);
        if (player.id === localPlayerId) this.cameras.main.startFollow(avatar.sprite, true, 0.12, 0.12);
      }

      const moved = Math.abs(player.x - avatar.lastX) > 0.01 || Math.abs(player.y - avatar.lastY) > 0.01;
      avatar.sprite.setPosition(player.x, player.y);
      avatar.sprite.setDepth(Math.floor(player.y / TILE_SIZE) + AVATAR_DEPTH_BASE);
      avatar.shadow.setPosition(player.x, player.y + 16);
      avatar.shadow.setDepth(avatar.sprite.depth - 1);

      const walkKey = `player-walk-${player.facing}`;
      if (this.anims.exists(walkKey)) {
        if (moved) avatar.sprite.anims.play(walkKey, true);
        else {
          avatar.sprite.anims.stop();
          avatar.sprite.setFrame(WALK_ROW[player.facing] * 9);
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

  // --- screen-space effects --------------------------------------------------
  //
  // Weather, overlays, and the HUD are pinned to the camera rather than to the
  // world, so they cover the viewport instead of one corner of a large map.

  /**
   * The screen layer, and why the HUD lives inside one container.
   *
   * The camera zooms the world, and a zoom scales everything it draws —
   * including objects pinned to it with `setScrollFactor(0)`. Left alone, a
   * 13px label would be 26px on a screen big enough for zoom 2, and a HUD laid
   * out in screen pixels would spread out from the middle of the viewport.
   *
   * So everything screen-space goes in one container which is scaled by 1/zoom
   * and placed so that the two transforms cancel exactly. Its children are then
   * in plain screen pixels with the origin at the top-left of the canvas, which
   * is the coordinate system `pointer.x` already speaks.
   */
  private createScreenLayer() {
    this.screen = this.add.container(0, 0).setScrollFactor(0).setDepth(DEPTH.weather - 1);
  }

  /**
   * Adds objects to the screen layer, in screen pixels.
   *
   * Each one is pinned to the camera on the way in, even though the container
   * already is and overrides them when it draws. Input is why: Phaser's hit
   * test reads the scroll factor off the object itself rather than off the
   * container holding it, so a hotbar cell left at the default would be
   * hit-tested in world coordinates while it is drawn in screen ones — and
   * every click on it would fall through onto the farm behind.
   */
  private toScreen(...objects: Phaser.GameObjects.GameObject[]) {
    for (const object of objects) {
      (object as Partial<Phaser.GameObjects.Components.ScrollFactor>).setScrollFactor?.(0);
    }
    this.screen.add(objects);
  }

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
    this.screen.setScale(1 / zoom);
    this.screen.setPosition((width / 2) * (1 - 1 / zoom), (height / 2) * (1 - 1 / zoom));

    this.hud = hudLayout(width, height);
    this.hudZones = hudZones(this.hud).map(
      (box) => new Phaser.Geom.Rectangle(box.x, box.y, box.width, box.height),
    );

    this.layoutHud();
    this.spreadAtmosphere();
  }

  /** Puts every piece of the HUD where this canvas size says it goes. */
  private layoutHud() {
    const { width, height, prompt, hotbar, clock, quest, area, energy } = this.hud;

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

    this.hotbarCells.forEach((cell, index) => {
      const x = hotbar.x + index * (hotbar.cell + hotbar.gap);
      const centre = x + hotbar.cell / 2;
      cell.frame.setPosition(x, hotbar.y - hotbar.cell / 2).setSize(hotbar.cell, hotbar.cell);
      // The hit area is a shape of its own, so resizing the cell has to resize
      // it too — otherwise clicks keep landing on the size it used to be.
      const hit = cell.frame.input?.hitArea as Phaser.Geom.Rectangle | undefined;
      hit?.setSize(hotbar.cell, hotbar.cell);
      cell.icon.setPosition(centre, hotbar.y).setScale((hotbar.cell / HUD.cell) * HUD.iconScale);
      cell.count.setPosition(x + hotbar.cell - 3, hotbar.y + hotbar.cell / 2 - 2);
      cell.key?.setPosition(x + 3, hotbar.y - hotbar.cell / 2 + 1);
      cell.key?.setVisible(hotbar.cell >= 28);
    });

    // The full-screen washes and the vignette are the size of the screen, and
    // the screen just changed size.
    for (const overlay of [this.dayNightOverlay, this.sunsetOverlay, this.exhaustionOverlay]) {
      overlay.setPosition(width / 2, height / 2).setSize(width, height);
    }
    this.vignetteTop.setPosition(width / 2, 8).setSize(width, 16);
    this.vignetteBottom.setPosition(width / 2, height - 8).setSize(width, 16);

    this.buildHint.setPosition(width / 2, Math.min(96, height * 0.14));

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

    this.waitingBackdrop.setSize(width, height);
    this.waitingPanel.setPosition(width / 2, height / 2);
    this.waitingText.setWordWrapWidth(Math.min(520, width - 120));
    this.summaryPanel.setPosition(width / 2, height / 2);
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
  private updateFishing(time: number) {
    const player = this.localPlayer;
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
    return this.add
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
  private showCatch(item: string, size: number) {
    const def = itemDef(item);
    this.catchIcon.setTexture(def.texture);
    this.catchText.setText(def.sellPrice > 0 ? `${def.label} · ${size}cm` : def.label);
    this.catchCard.setVisible(true);
    this.catchShownAt = this.time.now;
  }

  /**
   * The weather, which is drawn on the glass rather than in the world.
   *
   * Rain, fireflies, petals and cloud shadows are pinned to the screen, so
   * they belong to the screen layer and have to be re-scattered whenever it
   * changes size. Their drifts are tweens, and a tween remembers the numbers
   * it was built with, so this kills and rebuilds them rather than trying to
   * move a target mid-flight.
   */
  private spreadAtmosphere() {
    const { width, height } = this.hud;

    this.rainDrops.forEach((drop, i) => drop.setPosition((i * 73) % width, (i * 43) % height));

    this.fireflies.forEach((firefly, i) => {
      this.tweens.killTweensOf(firefly);
      firefly.setPosition((i * 131) % width, height * 0.12 + ((i * 47) % Math.max(60, height * 0.7)));
      this.tweens.add({
        targets: firefly,
        x: firefly.x + 16,
        y: firefly.y - 12,
        yoyo: true,
        repeat: -1,
        duration: 1200 + i * 35,
        ease: 'Sine.inOut',
      });
    });

    this.clouds.forEach((cloud, i) => {
      cloud.setPosition((i * 317) % width, height * 0.06 + ((i * 97) % Math.max(40, height * 0.32)));
    });

    this.petals.forEach((petal, i) => petal.setPosition((i * 173) % width, (i * 89) % height));

    this.butterflies.forEach((butterfly, i) => {
      this.tweens.killTweensOf(butterfly);
      butterfly.setPosition(
        Math.min(width - 40, 200 + i * 220),
        Math.min(height - 120, 200 + ((i * 130) % 240)),
      );
      this.tweens.add({
        targets: butterfly,
        x: butterfly.x + 42,
        y: butterfly.y - 26,
        yoyo: true,
        repeat: -1,
        duration: 2600 + i * 700,
        ease: 'Sine.inOut',
      });
      this.tweens.add({
        targets: butterfly,
        scaleX: 0.6,
        yoyo: true,
        repeat: -1,
        duration: 180,
        ease: 'Sine.inOut',
      });
    });
  }

  private createWeatherSprites() {
    for (let i = 0; i < 58; i += 1) {
      const drop = this.add.image(0, 0, 'rain-drop').setDepth(DEPTH.weather).setAlpha(0);
      this.toScreen(drop);
      this.rainDrops.push(drop);
    }

    for (let i = 0; i < 20; i += 1) {
      const firefly = this.add.image(0, 0, 'firefly').setDepth(DEPTH.weather + 1).setAlpha(0);
      this.toScreen(firefly);
      this.fireflies.push(firefly);
    }
  }

  private createAmbient() {
    for (let i = 0; i < 4; i += 1) {
      const cloud = this.add
        .image(0, 0, 'cloud-shadow')
        .setDepth(DEPTH.weather - 2)
        .setAlpha(0.8)
        .setScale(1 + (i % 3) * 0.4);
      this.toScreen(cloud);
      this.clouds.push(cloud);
    }
    for (let i = 0; i < 14; i += 1) {
      const petal = this.add
        .image(0, 0, i % 3 === 0 ? 'petal' : 'firefly')
        .setDepth(DEPTH.weather + 2)
        .setAlpha(i % 3 === 0 ? 0.85 : 0);
      petal.setData('seed', i * 1.7);
      petal.setData('isPetal', i % 3 === 0);
      this.toScreen(petal);
      this.petals.push(petal);
    }
    for (let i = 0; i < 3; i += 1) {
      const butterfly = this.add.image(0, 0, 'butterfly').setDepth(DEPTH.weather + 3).setScale(1.2);
      this.toScreen(butterfly);
      this.butterflies.push(butterfly);
    }
  }

  /**
   * A framed box, in the same wood as the panels in the DOM.
   *
   * Always this, never `this.add.rectangle` with a stroke on it. The point of
   * the frames being files is that a box in the canvas and a box in React are
   * the same picture; a rounded rectangle drawn here would be the old argument
   * starting again in a new place.
   */
  private frame(
    kind: keyof typeof FRAMES,
    x: number,
    y: number,
    width: number,
    height: number,
  ): Phaser.GameObjects.NineSlice {
    const { key, slice } = FRAMES[kind];
    return this.add
      .nineslice(x, y, key, undefined, width, height, slice, slice, slice, slice)
      .setOrigin(0, 0);
  }

  /** Short text: the clock, a count, a label. Never below 16px. */
  private pixelText(x: number, y: number, size = PIXEL_MIN_SIZE, colour = PALETTE['light.7']) {
    return this.add.text(x, y, '', {
      fontFamily: PIXEL_FONT,
      fontSize: `${Math.max(PIXEL_MIN_SIZE, size)}px`,
      color: colour,
    });
  }

  private createUi() {
    // The bottom bar: what is in hand, and what the game last said.
    this.promptFrame = this.frame('plate', 0, 0, 100, HUD.promptHeight);
    this.heldText = this.pixelText(0, 0, 18);
    // What is in hand is also the button that opens the bag, so the mouse has
    // a way in and the label naming the key is the thing you click.
    this.heldText.setInteractive({ useHandCursor: true }).on('pointerdown', () => {
      this.audio.play('ui-select');
      toggleInventory();
    });
    // A sentence, so Nunito: this is the one part of the HUD that is prose.
    this.promptText = this.add.text(0, 0, '', {
      fontFamily: PROSE_FONT,
      fontSize: '13px',
      color: PALETTE['light.7'],
    });
    this.toScreen(this.promptFrame, this.heldText, this.promptText);

    this.createClock();
    this.createAreaPlate();
    this.createQuestTracker();
    this.createEnergyTube();
    this.createHotbar();

    this.dayNightOverlay = this.add.rectangle(0, 0, 1, 1, tint('outline.2'), 0).setDepth(DEPTH.overlay);
    // Running on empty drains the colour out of the day.
    this.exhaustionOverlay = this.add.rectangle(0, 0, 1, 1, tint('building.0'), 0).setDepth(DEPTH.overlay - 2);
    this.sunsetOverlay = this.add.rectangle(0, 0, 1, 1, tint('light.4'), 0).setDepth(DEPTH.overlay - 1);
    this.vignetteTop = this.add.rectangle(0, 0, 1, 16, 0x000000, 0.22).setDepth(DEPTH.overlay + 1);
    this.vignetteBottom = this.add.rectangle(0, 0, 1, 16, 0x000000, 0.25).setDepth(DEPTH.overlay + 1);
    this.toScreen(
      this.dayNightOverlay,
      this.exhaustionOverlay,
      this.sunsetOverlay,
      this.vignetteTop,
      this.vignetteBottom,
    );

    this.createWaitingPanel();
    this.createSummaryPanel();
    this.createFishingUi();
  }

  /**
   * Everything a cast draws.
   *
   * Built once and hidden, like the build ghost and the morning panel, rather
   * than created when a line goes out: a minigame that allocated nine objects
   * on the frame the fish bit would stutter at exactly the moment it must not.
   */
  private createFishingUi() {
    // In the world: the float on the water, the line down to it, and the mark
    // over the player's head at the bite.
    this.bobberLine = this.add
      .rectangle(0, 0, 1, 1, tint('light.7'), 0.7)
      .setOrigin(0.5, 1)
      .setDepth(DEPTH.weather - 2)
      .setVisible(false);
    this.bobber = this.add
      .image(0, 0, 'icon-coin')
      .setDisplaySize(10, 10)
      .setTint(tint('building.3'))
      .setDepth(DEPTH.weather - 1)
      .setVisible(false);
    // A mark rather than a sprite, and a big one. This is the thing the whole
    // system hangs off: nine tenths of a second to notice, possibly while
    // looking at the clock. It is drawn in the world, over the player's own
    // head, because that is where their eyes already are.
    this.biteMark = this.add
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
    this.fishTrack = this.add
      .rectangle(0, 0, FISH_BAR.width, FISH_BAR.height, tint('shadow.1'), 0.85)
      .setOrigin(0, 0)
      .setStrokeStyle(2, tint('water.2'), 0.9);
    // The square the player drives. Drawn under the fish so a fish inside it
    // is still visible, which is the one thing the player is watching for.
    this.fishSquare = this.add
      .rectangle(0, 0, FISH_BAR.width - 6, 10, tint('light.0'), 0.45)
      .setOrigin(0, 1)
      .setStrokeStyle(2, tint('light.0'), 0.95);
    // The fish: gold, and outlined in near-black so it stays legible whichever
    // colour the square behind it happens to be.
    this.fishMark = this.add
      .rectangle(0, 0, FISH_BAR.width - 14, 12, tint('light.7'), 1)
      .setOrigin(0.5, 0.5)
      .setStrokeStyle(2, tint('outline.3'), 0.95);
    this.fishProgressBack = this.add
      .rectangle(0, 0, FISH_BAR.progressWidth, FISH_BAR.height, tint('shadow.1'), 0.85)
      .setOrigin(0, 0)
      .setStrokeStyle(2, tint('water.2'), 0.9);
    this.fishProgressFill = this.add
      .rectangle(0, 0, FISH_BAR.progressWidth - 4, 1, tint('light.0'), 0.95)
      .setOrigin(0, 1);

    this.fishBar = this.add
      .container(0, 0, [
        this.fishTrack,
        this.fishSquare,
        this.fishMark,
        this.fishProgressBack,
        this.fishProgressFill,
      ])
      .setDepth(DEPTH.hud + 2)
      .setVisible(false);
    this.toScreen(this.fishBar);

    // And the card, which is what a catch is for.
    this.catchFrame = this.frame('panel', 0, 0, 260, 64);
    this.catchIcon = this.add.image(0, 0, 'icon-coin').setDisplaySize(32, 32);
    this.catchText = this.pixelText(0, 0, 20).setOrigin(0, 0.5);
    this.catchCard = this.add
      .container(0, 0, [this.catchFrame, this.catchIcon, this.catchText])
      .setDepth(DEPTH.hud + 3)
      .setVisible(false);
    this.toScreen(this.catchCard);
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

    this.clockFace = this.add.image(dial.x, dial.y, 'clock-face');
    // Pivoted at its foot, so one angle turns it about the dial's centre.
    this.clockHand = this.add.image(dial.x, dial.y, 'clock-hand').setOrigin(0.5, 1);
    this.clockDay = this.pixelText(70, 8, 18, PALETTE['light.7']);
    this.clockTime = this.pixelText(70, 28, 28);
    this.seasonIcon = this.add.image(78, 70, 'icon-season-spring');
    this.seasonText = this.pixelText(90, 60, 16, PALETTE['light.7']);
    this.weatherIcon = this.add.image(width - 22, 20, 'icon-weather-sunny');
    this.coinIcon = this.add.image(148, 70, 'icon-coin');
    this.coinText = this.pixelText(158, 60, 18, PALETTE['light.7']);

    this.clockPanel = this.add
      .container(0, 0, [
        this.frame('plate', 0, 0, width, height),
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
    this.toScreen(this.clockPanel);
  }

  /** Where you are and what the sky is doing, top left. */
  private createAreaPlate() {
    this.areaFrame = this.frame('plate', 0, 0, 180, 46);
    this.areaText = this.pixelText(12, 9, 16);
    this.areaText.setLineSpacing(2);
    this.areaPanel = this.add.container(0, 0, [this.areaFrame, this.areaText]).setDepth(DEPTH.hud + 1);
    this.toScreen(this.areaPanel);
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
      if (texture && this.textures.exists(texture) && cell.icon.texture.key !== texture) {
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
      const frame = this.frame('slot', 0, 0, HUD.cell, HUD.cell).setDepth(DEPTH.hud);

      const icon = this.add
        .image(0, 0, 'item-hoe')
        .setDepth(DEPTH.hud + 1)
        .setVisible(false);

      // Bottom-right, the way every inventory since Minecraft has done it.
      const count = this.pixelText(0, 0, 16).setOrigin(1, 1).setDepth(DEPTH.hud + 2);

      // Only the first nine have a key, so only those are labelled.
      const key =
        i < 9
          ? this.pixelText(0, 0, 16, PALETTE['light.7']).setAlpha(0.7).setDepth(DEPTH.hud + 2)
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
        this.audio.play('ui-select');
        sendAction({ type: 'selectSlot', slot: i });
      });

      this.toScreen(frame, icon, count);
      if (key) this.toScreen(key);
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

    this.questLabel = this.pixelText(inset, 9, 16);
    this.questLabel.setLineSpacing(2);
    const track = this.add
      .rectangle(inset, height - inset - bar / 2, width - inset * 2, bar, tint('outline.0'), 0.85)
      .setOrigin(0, 0.5);
    this.questFill = this.add
      .rectangle(inset, height - inset - bar / 2, 1, bar, tint('light.0'), 0.95)
      .setOrigin(0, 0.5);

    this.questTracker = this.add
      .container(0, 0, [this.frame('plate', 0, 0, width, height), this.questLabel, track, this.questFill])
      .setDepth(DEPTH.hud + 1);
    this.toScreen(this.questTracker);
  }

  private refreshQuestTracker() {
    const { quest } = this.farm;
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

    this.energyFrame = this.frame('plate', 0, 0, width, height);
    this.energyFill = this.add
      .rectangle(width / 2, height - 5, width - 10, 1, ENERGY_COLOURS.full, 0.95)
      .setOrigin(0.5, 1);
    this.energyBolt = this.add.image(width / 2, -12, 'icon-energy-bolt');
    this.energyText = this.pixelText(0, 0, 16).setOrigin(1, 0.5).setVisible(false);
    // An invisible box, so there is something with a size to hover over: the
    // frame is a nine-slice and the fill is a sliver when it matters most.
    this.energyHit = this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0);

    this.energyPanel = this.add
      .container(0, 0, [this.energyHit, this.energyFrame, this.energyFill, this.energyBolt, this.energyText])
      .setDepth(DEPTH.hud + 1);
    this.energyPanel.on('pointerover', () => this.energyText.setVisible(true));
    this.energyPanel.on('pointerout', () => this.energyText.setVisible(false));
    this.toScreen(this.energyPanel);
  }

  /**
   * Why nothing is happening when you have gone to bed and somebody else has
   * not. Without it, a shared night is the most likely thing in the game to
   * feel broken.
   */
  private createWaitingPanel() {
    this.waitingBackdrop = this.add.rectangle(0, 0, 1, 1, tint('outline.0'), 0.72);
    this.waitingText = this.add
      .text(0, 0, '', {
        fontFamily: PROSE_FONT,
        fontSize: '17px',
        color: PALETTE['light.7'],
        align: 'center',
        wordWrap: { width: 520 },
      })
      .setOrigin(0.5);
    this.waitingPanel = this.add
      .container(0, 0, [this.waitingBackdrop, this.waitingText])
      .setDepth(DEPTH.modal)
      .setVisible(false);
    this.toScreen(this.waitingPanel);
  }

  /**
   * The morning panel, with pictures.
   *
   * It used to be a paragraph: "Ngày 5 bắt đầu. 0 luống đã lớn lên qua đêm."
   * The house style says feeling is shown rather than narrated and the prompt
   * bar is the fallback channel, not the main one — and a sentence about how
   * many beds grew overnight is narration where a row of sprouts would do.
   *
   * So the rows are built here and the pictures come from the same item
   * textures the hotbar and the satchel draw: the turnip the frost took is the
   * turnip you were carrying.
   */
  private createSummaryPanel() {
    this.summaryCard = this.frame('panel', 0, 0, SUMMARY.width, SUMMARY.height);
    this.summaryTitle = this.pixelText(0, 0, 26).setOrigin(0.5, 0);
    this.summaryRows = [];
    for (let i = 0; i < SUMMARY.maxRows; i += 1) {
      // Every icon is drawn at the same size whatever its source is, so a
      // 16px coin and a 32px sprout sit in one column rather than in two.
      const icon = this.add
        .image(0, 0, 'icon-coin')
        .setDisplaySize(SUMMARY.icon, SUMMARY.icon)
        .setVisible(false);
      const text = this.pixelText(0, 0, 18).setOrigin(0, 0.5).setVisible(false);
      this.summaryRows.push({ icon, text });
    }
    this.summaryHint = this.pixelText(0, 0, 16, PALETTE['light.7']).setOrigin(0.5, 0);
    this.summaryHint.setText('Nhấn phím bất kỳ');

    this.summaryPanel = this.add
      .container(0, 0, [
        this.summaryCard,
        this.summaryTitle,
        ...this.summaryRows.flatMap((row) => [row.icon, row.text]),
        this.summaryHint,
      ])
      .setDepth(DEPTH.modal + 1)
      .setVisible(false);
    this.toScreen(this.summaryPanel);
  }

  /**
   * Fills the morning panel's rows, and shrinks it to the day it is reporting.
   *
   * A fixed-height card with three lines in it and a hand's width of empty
   * board underneath reads as a panel with something missing from it. The card
   * is as tall as the morning was eventful.
   */
  private drawSummary(title: string, rows: SummaryRow[]) {
    const height = SUMMARY.head + rows.length * SUMMARY.rowHeight + SUMMARY.foot;
    const top = -height / 2;

    this.summaryCard.setPosition(-SUMMARY.width / 2, top).setSize(SUMMARY.width, height);
    this.summaryTitle.setPosition(0, top + 18).setText(title);
    this.summaryHint.setPosition(0, top + height - 34);

    this.summaryRows.forEach((slot, index) => {
      const row = rows[index];
      slot.icon.setVisible(Boolean(row));
      slot.text.setVisible(Boolean(row));
      if (!row) return;

      const y = top + SUMMARY.head + index * SUMMARY.rowHeight - SUMMARY.rowHeight / 2;
      if (this.textures.exists(row.texture)) slot.icon.setTexture(row.texture);
      slot.icon.setDisplaySize(SUMMARY.icon, SUMMARY.icon);
      slot.icon.setPosition(-SUMMARY.width / 2 + 44, y);
      slot.icon.setTint(row.tint ?? 0xffffff);
      slot.text.setPosition(-SUMMARY.width / 2 + 72, y).setText(row.text);
    });
  }

  private updateAtmosphere(delta: number) {
    const farm = this.farm;
    const time = this.time.now / 1000;

    this.waterTimer += delta;
    if (this.waterTimer > 380 && this.textures.exists('tile-water-2') && this.textures.exists('tile-water-3')) {
      this.waterTimer = 0;
      this.waterFrame = (this.waterFrame + 1) % 3;
      const key = this.waterFrame === 0 ? 'tile-water' : this.waterFrame === 1 ? 'tile-water-2' : 'tile-water-3';
      this.waterSprites.forEach((sprite) => sprite.setTexture(key));
    }
    this.waterSprites.forEach((sprite, i) => {
      sprite.setAlpha(0.96 + Math.sin(time * 2 + i * 0.7) * 0.04);
    });

    this.clouds.forEach((cloud, i) => {
      cloud.x += delta * 0.008 * (1 + (i % 3) * 0.4);
      if (cloud.x > this.hud.width + 100) cloud.x = -100;
    });

    // Hours past this morning's midnight, so 1am reads as 25 and the night
    // keeps getting darker instead of brightening back into dawn.
    const hour = farm.time.totalMinutes / 60;
    const fireflyNight = farm.weather === 'Firefly Shower' || hour >= 19 || hour < 6;
    this.petals.forEach((petal) => {
      const seed = Number(petal.getData('seed') ?? 0);
      const isPetal = Boolean(petal.getData('isPetal'));
      petal.y += delta * 0.012;
      petal.x += Math.sin(time * 1.2 + seed) * delta * 0.01;
      petal.setAngle(Math.sin(time + seed) * 18);
      if (petal.y > this.hud.height + 12) {
        petal.y = -12;
        petal.x = (seed * 137) % this.hud.width;
      }
      if (!isPetal) petal.setAlpha(fireflyNight ? 0.7 + Math.sin(time * 3 + seed) * 0.25 : 0);
    });

    if (this.chimney) {
      this.smokeTimer += delta;
      if (this.smokeTimer > 900) {
        this.smokeTimer = 0;
        const smoke = this.add
          .image(this.chimney.x + Phaser.Math.Between(-2, 2), this.chimney.y, 'smoke')
          .setDepth(7)
          .setScale(0.5)
          .setAlpha(0.6);
        this.areaLayer?.add(smoke);
        this.tweens.add({
          targets: smoke,
          y: smoke.y - 34,
          x: smoke.x + 10,
          scale: 1.2,
          alpha: 0,
          duration: 2400,
          onComplete: () => smoke.destroy(),
        });
      }
    }

    const eveningAlpha = Phaser.Math.Clamp((hour - 18) / 4, 0, 0.42);
    const dawnAlpha = Phaser.Math.Clamp((7 - hour) / 2, 0, 0.18);
    this.dayNightOverlay.setAlpha(Math.max(eveningAlpha, dawnAlpha));
    const sunset = hour >= 16.5 && hour <= 19 ? Math.sin(((hour - 16.5) / 2.5) * Math.PI) * 0.16 : 0;
    this.sunsetOverlay.setAlpha(sunset);

    if (this.houseGlow) {
      const nightGlow = hour >= 18 || hour < 6.5 ? 0.75 : hour >= 17 ? 0.35 : 0;
      this.houseGlow.setAlpha(nightGlow + Math.sin(time * 2.2) * 0.05);
    }

    const showButterflies = farm.weather !== 'Drizzle' && hour >= 8 && hour < 18;
    this.butterflies.forEach((b) => b.setVisible(showButterflies));

    const rainy = farm.weather === 'Drizzle';
    this.rainDrops.forEach((drop, index) => {
      if (!rainy) return;
      drop.y += delta * (0.28 + (index % 5) * 0.018);
      drop.x += delta * 0.05;
      if (drop.y > this.hud.height + 10) {
        drop.y = -10;
        drop.x = (drop.x + 173) % this.hud.width;
      }
    });
  }

  private updateWeatherPresentation() {
    const { weather } = this.farm;
    if (weather === this.lastWeather) return;
    this.lastWeather = weather;
    const rainy = weather === 'Drizzle';
    const fireflyWeather = weather === 'Firefly Shower';
    this.rainDrops.forEach((drop) => drop.setAlpha(rainy ? 0.72 : 0));
    this.fireflies.forEach((fly) => fly.setAlpha(fireflyWeather ? 0.85 : 0));
    // Rainy was the source literal `203142`, whose mechanical nearest is `shadow.2` (d=0.0507)
    // - but firefly weather (the source literal `1c2636`) also lands on `shadow.2` (d=0.0308),
    // and these three backdrops must stay distinct or two different weathers
    // look identical. `shadow.3` (#332f66, H244) is the second-nearest for
    // rainy (d=0.0738) and a closer hue match to its blue (H210) than
    // `shadow.2`'s blue-purple (H286) is, so rainy moves there instead.
    this.cameras.main.setBackgroundColor(
      rainy ? PALETTE['shadow.3'] : fireflyWeather ? PALETTE['shadow.2'] : PALETTE['shadow.1'],
    );
  }

  // --- plots ----------------------------------------------------------------

  /** Redraws every plot on this map, which the wilt tint needs once a day. */
  private refreshAllPlots() {
    for (const key of this.plotSprites.keys()) this.refreshPlot(key);
  }

  /**
   * Redraws one plot. Keys carry their area, so a plot that changed on another
   * map simply has no sprite here and is skipped.
   */
  private refreshPlot(key: string) {
    const plot = this.farm.plots[key];
    const base = this.plotSprites.get(key);
    if (!plot || !base) return;

    const { x, y } = plot;
    // Wet if somebody watered it, or if a sprinkler has it covered. The second
    // half is what makes a sprinkler visible at all: the water it lays down is
    // spent by the growth step in the same roll-over, so `wateredToday` is
    // false again before anybody wakes up. See `sprinkledPlotKeys`.
    const damp = plot.wateredToday || (plot.stage !== 'wild' && this.sprinkledKeys().has(key));
    const ground = damp ? 'plot-watered' : plot.stage === 'wild' ? 'plot-wild' : 'plot-tilled';
    base.setTexture(plotVariant(ground, x, y));

    this.cropSprites.get(key)?.destroy();
    this.cropSprites.delete(key);
    this.sparkles.get(key)?.destroy();
    this.sparkles.delete(key);

    if (!plot.crop) return;
    // A shoot is a shoot, so only the ripe plant gets art of its own.
    const cropTexture =
      plot.stage === 'mature'
        ? `crop-${plot.crop}`
        : plot.stage === 'sprout'
          ? 'crop-sprout'
          : 'crop-seeded';
    const crop = this.add.image(x * TILE_SIZE + 16, y * TILE_SIZE + 16, cropTexture).setDepth(y + 2);
    this.areaLayer?.add(crop);
    this.cropSprites.set(key, crop);

    // The warning spec 04 gives that Stardew does not: in the last three days
    // of a season, anything the turn will kill goes grey and droops. Losing a
    // field to a rule you had not noticed reads as unfair rather than hard.
    const doomed = isWithering(plot.crop, this.farm.time.day);
    // Droop and sway are both a pixel of movement rather than a rotation, for
    // the reason set out where the trees are built: Phaser 4 tears a rotated
    // sprite about half the frames it draws.
    if (doomed) {
      crop.setTint(WILT_TINT);
      crop.setY(crop.y + 1);
    }

    if (!doomed && (plot.stage === 'sprout' || plot.stage === 'mature')) {
      this.tweens.add({
        targets: crop,
        x: crop.x + 1,
        yoyo: true,
        repeat: -1,
        duration: 1600 + (x + y) * 40,
        ease: 'Sine.inOut',
      });
    }
    // No sparkle on a plant that is about to die, however ripe it is: the
    // "come and pick me" cue and the "you are about to lose this" cue would
    // be arguing on the same tile.
    if (!doomed && plot.stage === 'mature') {
      const sparkle = this.add.image(x * TILE_SIZE + 22, y * TILE_SIZE + 6, 'sparkle').setDepth(y + 3).setScale(0.8);
      this.areaLayer?.add(sparkle);
      this.sparkles.set(key, sparkle);
      this.tweens.add({ targets: sparkle, alpha: 0.2, scale: 1.2, yoyo: true, repeat: -1, duration: 700, ease: 'Sine.inOut' });
      crop.setScale(0.6);
      this.tweens.add({ targets: crop, scale: 1, duration: 260, ease: 'Back.easeOut' });
    }
  }

  // --- hud ------------------------------------------------------------------

  private refreshUi() {
    const store = farmStore.getState();
    const farm = store.farm;
    const player = this.localPlayer;
    if (!player) return;

    this.refreshHotbar(player);
    this.promptText.setText(promptFor(store));
    this.refreshClock();
    this.areaText.setText(`${areaMap(player.area).name}\n${weatherLabel(farm.weather)}`);
    // The plate is sized to the name it happens to be carrying, and the names
    // are different lengths in different areas.
    this.areaFrame.setSize(
      Math.min(this.hud.area.maxWidth, this.areaText.width + 24),
      this.areaText.height + 18,
    );
    this.refreshQuestTracker();
    this.refreshEnergy(player);

    // Eased rather than switched, so the colour draining out reads as the
    // player tiring rather than as a rendering glitch.
    const tint = player.energy > 0 ? 0 : EXHAUSTED_TINT_ALPHA;
    this.exhaustionOverlay.setAlpha(Phaser.Math.Linear(this.exhaustionOverlay.alpha, tint, 0.05));

    const waiting = player.asleep ? waitingOnLabel(farm, store.localPlayerId) : '';
    this.waitingPanel.setVisible(waiting !== '');
    if (waiting) this.waitingText.setText(`${waiting}\n\nPress Space/Enter or B to get up again.`);
  }

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
   * The dial, the season, the sky and the wallet.
   *
   * The hand runs across the working day: six in the morning at the left of
   * the sweep, noon straight up, two the next morning at the right. The same
   * twenty hours the reducer counts, read off the same numbers, so there is no
   * second clock here to fall out of step with the first.
   */
  private refreshClock() {
    const { time, season, weather, coins } = this.farm;

    const through = Phaser.Math.Clamp(
      (time.totalMinutes - DAY_START) / (DAY_END - DAY_START),
      0,
      1,
    );
    this.clockHand.setAngle(-DIAL_SWEEP + through * DIAL_SWEEP * 2);

    this.clockDay.setText(`Ngày ${time.day}`);
    this.clockTime.setText(this.formatClock());
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
    const { width, height } = this.hud.energy;

    this.energyFill.setPosition(width / 2, height - 5);
    this.energyFill.setSize(width - 10, Math.max(1, (height - 10) * ratio));
    this.energyFill.setFillStyle(
      ratio <= ENERGY_SPENT ? ENERGY_COLOURS.spent : ratio <= ENERGY_LOW ? ENERGY_COLOURS.low : ENERGY_COLOURS.full,
      0.95,
    );
    this.energyFill.setVisible(player.energy > 0);
    this.energyText.setText(`${player.energy}/${player.maxEnergy}`);
  }

  private formatClock() {
    const { time } = this.farm;
    const minutes = time.minute.toString().padStart(2, '0');
    const suffix = time.hour >= 12 ? 'CH' : 'SA';
    const displayHours = time.hour % 12 === 0 ? 12 : time.hour % 12;
    return `${displayHours}:${minutes} ${suffix}`;
  }

  // --- the herd ---------------------------------------------------------------

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
  private syncAnimals(delta: number) {
    const here = animalsOn(this.farm.animals, this.builtArea ?? START_AREA);
    const present = new Set(here.map((animal) => animal.id));

    for (const animal of here) {
      if (!animal.position) continue;
      let drawn = this.animalSprites.get(animal.id);
      if (!drawn) {
        drawn = this.createAnimalSprite(animal);
        this.animalSprites.set(animal.id, drawn);
      }

      const { sprite, shadow, marker } = drawn;
      const before = sprite.x;
      const lerp = Math.min(1, delta / 260);
      const nextX = sprite.x + (animal.position.x - sprite.x) * lerp;
      const nextY = sprite.y + (animal.position.y - sprite.y) * lerp;
      const settled = Math.hypot(animal.position.x - nextX, animal.position.y - nextY) < 0.5;
      sprite.setPosition(
        settled ? animal.position.x : nextX,
        settled ? animal.position.y : nextY,
      );

      // The drawings all face right, so which way an animal is going is a flip
      // rather than a second sheet. Held through a standstill: an animal that
      // stopped should still be facing the way it was walking.
      const dx = sprite.x - before;
      if (Math.abs(dx) > 0.05) drawn.facing = dx > 0 ? 1 : -1;
      sprite.setFlipX(drawn.facing < 0);

      // A small bob while it is moving, which is the whole of the animation:
      // four hand-drawn walk cycles would be four things that are nearly right,
      // and a grazing animal that rocks reads better than one that glides.
      const bob = Math.abs(dx) > 0.05 ? Math.sin(this.time.now / 110) * 1.5 : 0;
      sprite.setY(sprite.y + bob);

      // The same row-based band the players, the villagers and the buildings
      // sort into, so a cow south of the barn is drawn in front of it.
      sprite.setDepth(Math.floor(sprite.y / TILE_SIZE) + AVATAR_DEPTH_BASE);
      shadow.setPosition(sprite.x, sprite.y + sprite.displayHeight / 2 - 2);
      shadow.setDepth(sprite.depth - 1);

      // The one piece of information an animal carries on its head: it has not
      // eaten. Shown rather than narrated, per the house rule — a line in the
      // prompt bar about a hungry goat is a line nobody standing across the
      // field would ever see.
      marker.setPosition(sprite.x, sprite.y - sprite.displayHeight / 2 - 8);
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

  // --- the ground ------------------------------------------------------------

  /**
   * Draws what is standing on this map, and keeps it drawn.
   *
   * Diffed by id rather than torn down and rebuilt, unlike the buildings: a
   * farm carries a couple of hundred nodes and every single swing changes the
   * array, so a rebuild would drop and recreate two hundred sprites every time
   * somebody clipped a weed. The array's identity is still the gate — the
   * reducer is immutable, so an unchanged array means nothing to do at all.
   *
   * Sorted into the avatars' own band, by the row the node's feet stand on, so
   * a player north of a tree is drawn behind its trunk and a player south of
   * it walks in front of the canopy. The same rule the buildings follow, for
   * the same reason: a tree that is two tiles of drawing and one tile of
   * collision only reads right if the sorting agrees with the collision.
   */
  private syncNodes() {
    const { nodes } = this.farm;
    if (nodes === this.drawnNodes) return;
    this.drawnNodes = nodes;

    const here = nodesOn(nodes, this.builtArea ?? START_AREA);
    const present = new Set<string>();

    for (const node of here) {
      present.add(node.id);
      const texture = nodeTexture(node);
      const drawn = this.nodeSprites.get(node.id);
      if (drawn) {
        // The only thing that ever changes a node's picture is a tree putting
        // on a stage overnight.
        if (drawn.texture !== texture) {
          drawn.sprite.setTexture(texture);
          drawn.texture = texture;
        }
        continue;
      }
      this.nodeSprites.set(node.id, { sprite: this.createNodeSprite(node, texture), texture });
    }

    for (const [id, drawn] of this.nodeSprites) {
      // Anything felled has already had its burst played from the event; this
      // is only the bookkeeping, and the sprite may well be gone already.
      if (present.has(id)) continue;
      drawn.sprite.destroy();
      this.nodeSprites.delete(id);
    }
  }

  /**
   * Chests, machines, sprinklers, fences and paths.
   *
   * Diffed against the array's identity exactly as the nodes and the buildings
   * are: the reducer is immutable, so a farm where nobody has put anything
   * down this frame hands back the same array and this returns immediately.
   */
  private syncPlaceables() {
    const { placeables } = this.farm;
    const day = this.farm.time.day;
    if (placeables === this.drawnPlaceables) return;
    this.drawnPlaceables = placeables;

    const area = this.builtArea ?? START_AREA;
    const present = new Set<string>();
    const coverageBefore = this.sprinkledKeys();

    for (const placeable of placeablesOn(placeables, area)) {
      present.add(placeable.id);
      const ready = isMachine(placeable) && machineIsReady(placeable, day);
      const drawn = this.placeableSprites.get(placeable.id);

      if (drawn) {
        if (drawn.ready !== ready) {
          drawn.bubble?.destroy();
          drawn.bubble = ready ? this.createBubble(placeable) : null;
          drawn.ready = ready;
        }
        continue;
      }

      const sprite = this.add
        .image(
          placeable.x * TILE_SIZE + TILE_SIZE / 2,
          placeable.y * TILE_SIZE + TILE_SIZE / 2,
          `placeable-${placeable.kind}`,
        )
        // Paths and sprinklers are walked over, so they are drawn under
        // everything that walks; a chest is walked behind, like a node.
        // A path is walked *on*, so it sits just above the ground and below
        // everything standing on it; a chest is walked *behind*, so it joins
        // the avatars' band and sorts against them by tile row.
        .setDepth(
          placeableDef(placeable.kind).solid ? placeable.y + AVATAR_DEPTH_BASE : GROUND_ITEM_DEPTH,
        );
      this.areaLayer?.add(sprite);
      this.placeableSprites.set(placeable.id, {
        sprite,
        bubble: ready ? this.createBubble(placeable) : null,
        ready,
      });
    }

    for (const [id, drawn] of this.placeableSprites) {
      if (present.has(id)) continue;
      drawn.sprite.destroy();
      drawn.bubble?.destroy();
      this.placeableSprites.delete(id);
    }

    // A sprinkler that has just been put down — or taken up — changes which
    // beds are drawn wet, and those beds did not themselves change.
    if (this.coverageDiffers(coverageBefore)) this.refreshAllPlots();
  }

  /** Whether sprinkler coverage differs from what the beds were drawn with. */
  private coverageDiffers(before: ReadonlySet<string>): boolean {
    const after = this.sprinkledKeys();
    if (before.size !== after.size) return true;
    for (const key of after) if (!before.has(key)) return true;
    return false;
  }

  /** The little bob over a machine with something waiting in it. */
  private createBubble(placeable: Placeable): Phaser.GameObjects.Image {
    const bubble = this.add
      .image(placeable.x * TILE_SIZE + TILE_SIZE / 2, placeable.y * TILE_SIZE - 6, 'machine-bubble')
      .setDepth(placeable.y + AVATAR_DEPTH_BASE + 1);
    this.areaLayer?.add(bubble);
    // A slow bob rather than a flash: it has to catch the eye from the far
    // side of a field without being the brightest thing on the screen.
    this.tweens.add({
      targets: bubble,
      y: bubble.y - 3,
      yoyo: true,
      repeat: -1,
      duration: 900,
      ease: 'Sine.inOut',
    });
    return bubble;
  }

  private createNodeSprite(node: ResourceNode, texture: string): Phaser.GameObjects.Image {
    const sprite = this.add
      .image(node.x * TILE_SIZE + TILE_SIZE / 2, nodeCentreY(node), texture)
      .setDepth(node.y + AVATAR_DEPTH_BASE);
    this.areaLayer?.add(sprite);
    return sprite;
  }

  /**
   * A swing that landed and did not finish the job.
   *
   * One pixel of lean and back, which is what the trees on the map already do
   * for wind and for the reason set out where those are built: Phaser 4 tears
   * a rotated sprite about half the frames it draws, so nothing in this
   * renderer rotates.
   */
  private shakeNode(id: string, kind: NodeKind) {
    const drawn = this.nodeSprites.get(id);
    if (!drawn) return;
    const rest = drawn.sprite.x;
    this.tweens.killTweensOf(drawn.sprite);
    drawn.sprite.setX(rest);
    this.tweens.add({
      targets: drawn.sprite,
      x: rest + 2,
      yoyo: true,
      repeat: 1,
      duration: 55,
      ease: 'Sine.inOut',
      onComplete: () => drawn.sprite.setX(rest),
    });
    this.chips(drawn.sprite.x, drawn.sprite.y + drawn.sprite.displayHeight / 4, kind, 3);
  }

  /** It came down: a scatter of chips, and the sprite dropping out of sight. */
  private burstNode(id: string, kind: NodeKind) {
    const drawn = this.nodeSprites.get(id);
    if (!drawn) return;
    this.nodeSprites.delete(id);
    this.chips(drawn.sprite.x, drawn.sprite.y + drawn.sprite.displayHeight / 4, kind, 7);
    this.tweens.killTweensOf(drawn.sprite);
    this.tweens.add({
      targets: drawn.sprite,
      y: drawn.sprite.y + 6,
      alpha: 0,
      scaleY: 0.4,
      duration: 220,
      ease: 'Quad.easeIn',
      onComplete: () => drawn.sprite.destroy(),
    });
  }

  /** The sprinkler coverage for this map, recomputed only when it can change. */
  private sprinkledKeys(): ReadonlySet<string> {
    const { placeables } = this.farm;
    if (this.sprinkledFrom !== placeables) {
      this.sprinkledFrom = placeables;
      this.sprinkled = sprinkledPlotKeys(placeables, this.builtArea ?? START_AREA);
    }
    return this.sprinkled;
  }

  /**
   * Water landing on a tile.
   *
   * The beads arc outward and *settle* rather than flying off the way the
   * chips a struck rock throws do: they end lower than they started and fade
   * on the ground, because water falls. The same helper serves a can and a
   * sprinkler, so the two read as the same substance.
   */
  private splash(tileX: number, tileY: number, count = 5) {
    const x = tileX * TILE_SIZE + TILE_SIZE / 2;
    const y = tileY * TILE_SIZE + TILE_SIZE / 2;
    for (let i = 0; i < count; i += 1) {
      const bead = this.add
        .image(x, y - 10, 'water-bead')
        .setDepth(tileY + AVATAR_DEPTH_BASE - 2)
        .setAlpha(0.95);
      this.areaLayer?.add(bead);
      this.tweens.add({
        targets: bead,
        x: x + Phaser.Math.Between(-13, 13),
        y: y + Phaser.Math.Between(2, 9),
        alpha: 0,
        scaleX: 0.6,
        scaleY: 0.4,
        duration: 320 + i * 25,
        ease: 'Quad.easeIn',
        onComplete: () => bead.destroy(),
      });
    }
  }

  /**
   * Every sprinkler on this map, going off at once.
   *
   * Played on the morning they run, which is the only moment they actually do
   * anything. Capped, because a farm late in a save can carry a great many of
   * them and several hundred tweens in the frame the day turns is a stutter on
   * the one frame nobody wants one.
   */
  private spraySprinklers() {
    const area = this.builtArea ?? START_AREA;
    let drawn = 0;
    for (const placeable of this.farm.placeables) {
      if (placeable.area !== area || !isSprinkler(placeable)) continue;
      for (const tile of sprinklerTiles(placeable)) {
        if (drawn >= MAX_SPRAY_TILES) return;
        if (this.farm.plots[plotKey(tile.area, tile.x, tile.y)]?.stage === 'wild') continue;
        this.splash(tile.x, tile.y, 3);
        drawn += 1;
      }
    }
  }

  /** Splinters, or stone, or a spray of cut grass. One drawing, tinted. */
  private chips(x: number, y: number, kind: NodeKind, count: number) {
    for (let i = 0; i < count; i += 1) {
      const chip = this.add
        .image(x, y, 'node-chip')
        .setTint(CHIP_TINTS[kind])
        .setDepth(DEPTH.weather - 5);
      this.areaLayer?.add(chip);
      this.tweens.add({
        targets: chip,
        x: x + Phaser.Math.Between(-22, 22),
        y: y + Phaser.Math.Between(-18, 8),
        alpha: 0,
        duration: 340 + i * 20,
        ease: 'Quad.easeOut',
        onComplete: () => chip.destroy(),
      });
    }
  }

  private createAnimalSprite(animal: Animal): AnimalSprite {
    const at = animal.position ?? { x: 0, y: 0 };
    const shadow = this.add.image(at.x, at.y + 8, 'shadow').setScale(0.8);
    const sprite = this.add.image(at.x, at.y, `animal-${animal.kind}`);
    const marker = this.add.image(at.x, at.y - 20, 'animal-hungry').setVisible(false);
    this.areaLayer?.addMultiple([shadow, sprite, marker]);
    return { sprite, shadow, marker, facing: 1 };
  }

  /** A heart, floating off an animal that has just been stroked. */
  private popAnimalHeart(animalId: string) {
    const drawn = this.animalSprites.get(animalId);
    if (!drawn) return;
    const heart = this.add
      .image(drawn.sprite.x, drawn.sprite.y - 18, 'heart')
      .setDepth(drawn.sprite.depth + 6)
      .setScale(1.3);
    this.areaLayer?.add(heart);
    this.tweens.add({
      targets: heart,
      y: heart.y - 22,
      alpha: 0,
      duration: 950,
      ease: 'Sine.out',
      onComplete: () => heart.destroy(),
    });
  }

  // --- villagers -------------------------------------------------------------

  /**
   * Draws the people standing on the built area.
   *
   * Their positions only change on a clock step — every 1.2 real seconds —
   * because that is when the reducer walks them, so drawing them straight onto
   * the state position would be a hop every second rather than a walk. The
   * sprite chases the state instead, which is the renderer's job and not the
   * reducer's: the world stays cheap to send and the village still moves.
   */
  private syncNpcs(delta: number) {
    const here = this.farm.npcs.filter((actor) => actor.area === this.builtArea);
    const present = new Set(here.map((actor) => actor.id));

    for (const actor of here) {
      let villager = this.villagers.get(actor.id);
      if (!villager) {
        villager = this.createVillager(actor);
        this.villagers.set(actor.id, villager);
      }

      const { sprite, shadow, label } = villager;
      const before = { x: sprite.x, y: sprite.y };

      // Chase the authoritative position rather than snapping to it. The
      // factor is capped so a big frame cannot overshoot, and the last stretch
      // is closed outright so a sprite never creeps forever toward a target it
      // is already standing on.
      const lerp = Math.min(1, delta / 260);
      const nextX = sprite.x + (actor.x - sprite.x) * lerp;
      const nextY = sprite.y + (actor.y - sprite.y) * lerp;
      const settled = Math.hypot(actor.x - nextX, actor.y - nextY) < 0.5;
      sprite.setPosition(settled ? actor.x : nextX, settled ? actor.y : nextY);

      const dx = sprite.x - before.x;
      const dy = sprite.y - before.y;
      const walking = Math.hypot(dx, dy) > 0.05;
      const facing: Direction =
        Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';

      // The same row-based band the players and the buildings sort into, so a
      // villager walks behind the market stall and in front of the well.
      sprite.setDepth(Math.floor(sprite.y / TILE_SIZE) + AVATAR_DEPTH_BASE);
      shadow.setPosition(sprite.x, sprite.y + 16);
      shadow.setDepth(sprite.depth - 1);
      label.setPosition(sprite.x, sprite.y - 26);
      label.setDepth(sprite.depth + 4);

      const walkKey = `${villager.sheet}-walk-${walking ? facing : villager.facing}`;
      if (walking) villager.facing = facing;
      if (this.anims.exists(walkKey)) {
        if (walking) sprite.anims.play(walkKey, true);
        else {
          sprite.anims.stop();
          sprite.setFrame(WALK_ROW[villager.facing] * 9);
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
      this.questIcon = this.add.image(carrier.sprite.x, carrier.sprite.y - 42, 'quest-star');
      this.areaLayer?.add(this.questIcon);
      this.tweens.add({
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
    this.questIcon?.setVisible(Boolean(carrier) && !this.farm.quest.rewarded);
  }

  private createVillager(actor: NpcActor): Villager {
    const def = npcDef(actor.id);
    // The two real LPC walk cycles that ship, recoloured per person. A sheet
    // that is not loaded falls back to the procedural sprite, exactly as the
    // player's avatar already does.
    const hasSheet = this.textures.exists(def.sheet);
    const shadow = this.add.image(actor.x, actor.y + 16, 'shadow');
    const sprite = this.add
      .sprite(actor.x, actor.y, hasSheet ? def.sheet : def.texture, hasSheet ? WALK_ROW.down * 9 : undefined)
      .setScale(hasSheet ? 0.6 : 1.15);
    if (hasSheet && def.tint !== 0xffffff) sprite.setTint(def.tint);

    const label = this.add
      .text(actor.x, actor.y - 26, def.name, {
        fontFamily: 'Nunito, monospace',
        fontSize: '11px',
        color: PALETTE['light.7'],
        stroke: PALETTE['outline.2'],
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1);

    this.areaLayer?.addMultiple([shadow, sprite, label]);
    return { sprite, shadow, label, sheet: hasSheet ? def.sheet : def.texture, facing: 'down' };
  }

  /**
   * A walk cycle per sheet, built once.
   *
   * The villagers borrow the two sheets that ship rather than having one
   * each, so the animation keys are named for the sheet: two sets of four,
   * however many people are using them.
   */
  private createVillagerAnimations() {
    for (const sheet of LPC_SHEETS) {
      if (!this.textures.exists(sheet)) continue;
      (['up', 'left', 'down', 'right'] as Direction[]).forEach((dir) => {
        const key = `${sheet}-walk-${dir}`;
        if (this.anims.exists(key)) return;
        this.anims.create({
          key,
          frames: this.anims.generateFrameNumbers(sheet, {
            start: WALK_ROW[dir] * 9 + 1,
            end: WALK_ROW[dir] * 9 + 8,
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
  private popHeart(npc: NpcId) {
    const villager = this.villagers.get(npc);
    if (!villager) return;
    const heart = this.add
      .image(villager.sprite.x, villager.sprite.y - 30, 'heart')
      .setDepth(villager.sprite.depth + 6)
      .setScale(1.6);
    this.areaLayer?.add(heart);
    this.tweens.add({
      targets: heart,
      y: heart.y - 26,
      alpha: 0,
      duration: 1100,
      ease: 'Sine.out',
      onComplete: () => heart.destroy(),
    });
  }
}
