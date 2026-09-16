/**
 * What the game sounds like, as a table.
 *
 * Nothing here touches Phaser or the DOM, so the mapping is testable on its
 * own and the scene stays a thin caller. The reducer knows nothing about any
 * of it: sound is one more listener on `GameEvent`, exactly like the sprites.
 */
import type { GameEvent } from '../state/intents';
import type { FarmAction } from '../systems/farming';
import { isRainy, type TimeState, type Weather } from '../systems/time';
import { areaMap, type AreaId, type TileKind } from '../world/areas';

/** Every effect that ships. Eagerly loaded, so each one stays short. */
export type SoundId =
  | 'tool-hoe'
  | 'tool-water'
  | 'tool-plant'
  | 'crop-pop'
  | 'coins'
  | 'fanfare'
  | 'rooster'
  | 'footstep-grass'
  | 'footstep-path'
  | 'footstep-wood'
  | 'ui-select'
  | 'ui-confirm'
  | 'chime'
  | 'slump'
  | 'wither'
  | 'animal-call'
  | 'tool-chop'
  | 'node-break'
  | 'tool-bounce'
  | 'cast-splash'
  | 'fish-bite'
  | 'fish-caught';

export const SOUND_IDS: readonly SoundId[] = [
  'tool-hoe',
  'tool-water',
  'tool-plant',
  'crop-pop',
  'coins',
  'fanfare',
  'rooster',
  'footstep-grass',
  'footstep-path',
  'footstep-wood',
  'ui-select',
  'ui-confirm',
  'chime',
  'slump',
  'wither',
  'animal-call',
  'tool-chop',
  'node-break',
  'tool-bounce',
  'cast-splash',
  'fish-bite',
  'fish-caught',
];

/**
 * A music track, named rather than enumerated.
 *
 * Beds are named by the map, so adding an area with its own track is a Tiled
 * property and an audio file, with no code change — the same deal
 * `displayName` already gets. Unknown names simply do not load, and
 * `SoundManager` treats a bed that failed to load as silence.
 */
export type MusicId = string;

export const RAIN_MUSIC: MusicId = 'rain-loop';
export const NIGHT_MUSIC: MusicId = 'night-loop';
/**
 * The mine's bed. Named by the generated floors rather than by a Tiled map,
 * so it has to be listed here to be preloaded — no map in `AREA_IDS` names it.
 */
export const MINE_MUSIC: MusicId = 'mine-loop';
/** What an area gets when its map names no track of its own. */
export const DEFAULT_MUSIC: MusicId = 'day-farm-loop';

/** When the day bed gives way to the night one, in hours past midnight. */
export const NIGHT_FROM_HOUR = 20;
export const NIGHT_UNTIL_HOUR = 6;

/**
 * How long a bed takes to become the next one. A hard cut is the single most
 * noticeable cheap-feeling thing in game audio.
 */
export const MUSIC_CROSSFADE_MS = 1500;

/**
 * The URLs for one effect, best format first.
 *
 * Phaser picks the first the browser can decode, so adding `.ogg` and `.m4a`
 * alongside the generated WAVs is a change to this function and nothing else.
 * See `public/assets/audio/CREDITS.md`.
 */
export function soundUrls(id: SoundId): string[] {
  return [`/assets/audio/sfx/${id}.wav`];
}

export function musicUrls(id: MusicId): string[] {
  return [`/assets/audio/music/${id}.wav`];
}

// --- events ------------------------------------------------------------------

/**
 * Events whose sound never depends on anything but the kind.
 *
 * `plotChanged` is missing on purpose: tilling, watering and planting all
 * produce it, so it is resolved through `PLOT_ACTION_SOUNDS` below.
 */
export const EVENT_SOUNDS: Partial<Record<GameEvent['kind'], SoundId>> = {
  harvested: 'crop-pop',
  sold: 'coins',
  questRewarded: 'fanfare',
  dayStarted: 'rooster',
  // The one sound in the game that is purely bad news, so it is the one sound
  // that falls rather than rises.
  cropsWithered: 'wither',
  bought: 'coins',
  panelChanged: 'ui-select',
  // Money leaving the wallet, both of them, and the same sound the stall makes.
  upgradeOrdered: 'coins',
  buildingPlaced: 'coins',
  // The two moments the farm is measurably better than it was yesterday.
  upgradeReady: 'chime',
  buildingFinished: 'fanfare',
  upgradeCollected: 'ui-confirm',
  sleepChanged: 'ui-confirm',
  exhausted: 'slump',
  collapsed: 'slump',
  playerJoined: 'chime',
  areaChanged: 'footstep-path',
  // Somebody turning to answer you. The softest blip in the set, because it
  // happens every time you walk past anybody and press a key.
  npcSpoke: 'ui-select',
  // Upgraded to a fanfare by `soundForEvent` when the gift crossed a heart,
  // which is the moment worth hearing about.
  giftGiven: 'chime',
  // The herd. A stroke is the animal answering, which is the one sound in this
  // set that is a voice rather than an object; everything else borrows from
  // what the farm already sounds like — produce pops like a harvest because it
  // is one, and money is money whichever counter it crosses.
  animalPetted: 'animal-call',
  produceCollected: 'crop-pop',
  animalBought: 'coins',
  animalSold: 'coins',
  hayBought: 'coins',
  animalFed: 'tool-plant',
  doorToggled: 'ui-confirm',
  // The ground. A swing that lands and a thing that falls are two sounds
  // rather than one, because the second is the whole reward for the first —
  // five identical thwacks and then a crash is what makes a tree a tree.
  nodeHit: 'tool-chop',
  nodeCleared: 'node-break',
  // The only refusal in the table with a sound of its own. Everything else
  // that is turned down says so in a sentence; this one has to be audible,
  // because a player hearing the same chop five times has no way to tell
  // "not yet" from "not ever".
  toolTooWeak: 'tool-bounce',
  // The workbench that is not a workbench. A craft is a decision confirmed
  // rather than an object struck, so it borrows the interface's own click.
  crafted: 'ui-confirm',
  // Putting a thing down and taking it back up, which sound like planting and
  // picking because that is exactly what they are.
  itemPlaced: 'tool-plant',
  itemPickedUp: 'crop-pop',
  machineLoaded: 'tool-plant',
  // The one machine event that is not local: a keg finishing is the farm's
  // news, and the bubble over it is something everybody can see.
  machineReady: 'chime',
  machineCollected: 'crop-pop',
  // The same fanfare a finished building gets, and for the same reason: the
  // farm can do something this morning that it could not do last night.
  recipeLearned: 'fanfare',
  // The water. A cast is a plop, and it is the quietest of the three because
  // it happens every twenty seconds all evening.
  cast: 'cast-splash',
  // The most important sound in spec 12 and the reason it is not borrowed
  // from anything: this is the moment the player has to answer, they have
  // nine tenths of a second to do it, and they may well be looking at the
  // clock rather than at the float. Nothing else in the game sounds like it,
  // on purpose — a bite that could be mistaken for a chicken is a bite missed.
  bite: 'fish-bite',
  fishCaught: 'fish-caught',
  // The loss, and it borrows the one sound already in the set that means
  // "that did not work": a tool skidding off something it could not mark.
  fishEscaped: 'tool-bounce',
  // The mine (spec 13), borrowing until it has a bed and a set of its own.
  // Being hit is the tool skidding sound because both mean "that hurt the
  // wrong party"; a kill breaks like a rock because it is the same reward.
  damaged: 'tool-bounce',
  monsterKilled: 'node-break',
  descended: 'footstep-path',
  faint: 'slump',
  // The farm's news, like a finished building: everybody can go deeper now.
  newDepthRecord: 'fanfare',
};

/**
 * Events that are deliberately silent, and why.
 *
 * Written down rather than left out so that the test below can insist every
 * event kind has been considered: a new event that nobody thought about is a
 * missing sound, and this is what makes that a failing test rather than a
 * thing somebody notices a month later.
 */
export const SILENT_EVENTS: Partial<Record<GameEvent['kind'], string>> = {
  message: 'Prose is the fallback channel, not an event worth a sound of its own.',
  playerLeft: 'Arriving is worth announcing to the farm; leaving quietly is kinder.',
  farmReplaced: 'A resync or a new farm is bookkeeping, not something that happened in the world.',
  animalsHungry:
    'Arrives in the same frame as the rooster, and two sounds at once is one clipped sound. The morning panel is where this one is read, not heard.',
  nodesGrew:
    'Grass spreading overnight is not something anybody was there to hear. It arrives with the rooster, like the hungry animals, and belongs in the morning panel.',
  sprinklersRan:
    'Arrives with the rooster like the other two overnight tallies, and a hiss of water at dawn would be the third sound in that frame. This one is shown instead: the scene sprays every sprinkler on the map when it lands.',
};

/** Which swing made the plot change. Harvest shares the crop pop. */
export const PLOT_ACTION_SOUNDS: Record<FarmAction, SoundId> = {
  till: 'tool-hoe',
  plant: 'tool-plant',
  water: 'tool-water',
  harvest: 'crop-pop',
};

/**
 * Events worth hearing only when they happened to you.
 *
 * Positional audio is out of scope, so the alternative to filtering is a
 * footstep from somebody two maps away. The shared ones are left alone on
 * purpose: coins are the farm's wallet, and a new arrival is the whole point
 * of a shared farm.
 */
const LOCAL_ONLY: ReadonlySet<GameEvent['kind']> = new Set([
  'harvested',
  // All four of the fishing events. A cast is one person on one bank, and the
  // bite in particular has to mean "answer this" — hearing somebody else's
  // from across the valley would train the player to ignore the one sound in
  // the game that cannot afford to be ignored.
  'cast',
  'bite',
  'fishCaught',
  'fishEscaped',
  // One person's fight on one floor, and one person's fall.
  'damaged',
  'monsterKilled',
  'descended',
  'faint',
  // One person's axe. Four farmhands clearing four corners of the wood should
  // not sound like one person standing in the middle of all of it.
  'nodeHit',
  'nodeCleared',
  'toolTooWeak',
  // One person's hand on one animal, and one person's satchel. The purchases
  // are left shared, because they came out of the wallet everybody spends —
  // and the coop door is left shared because it is one door, and everybody's
  // herd just changed its plans for the afternoon.
  'animalPetted',
  'produceCollected',
  'animalFed',
  'sleepChanged',
  'exhausted',
  'areaChanged',
  // One person's satchel, one person's hands, and one person's friendship with
  // Maeve. `machineReady` is deliberately not here: a finished keg is the
  // farm's news rather than one player's.
  'crafted',
  'itemPlaced',
  'itemPickedUp',
  'machineLoaded',
  'machineCollected',
  'recipeLearned',
  // Somebody else opening a panel is not an event in the world. The purchase
  // itself is left shared, because it came out of the wallet everyone spends.
  'panelChanged',
  // One person's hoe, in and out of one person's satchel. The order is left
  // shared: it is the farm's coins that paid for the work.
  'upgradeReady',
  'upgradeCollected',
  // A conversation is between two people. Somebody else's hello across the
  // village is not an event in your world, and neither is their gift.
  'npcSpoke',
  'giftGiven',
]);

/** Whether this event should be heard by a client the event is not about. */
export function isLocalOnly(event: GameEvent): boolean {
  return LOCAL_ONLY.has(event.kind);
}

/**
 * The sound one event makes, or null for silence.
 *
 * A `plotChanged` with no action is the overnight roll-over, which fires once
 * per plot in a single frame; forty tool sounds at 6am would be a siren, so
 * the morning gets the rooster and nothing else.
 */
export function soundForEvent(event: GameEvent): SoundId | null {
  if (event.kind === 'plotChanged') {
    return event.action ? PLOT_ACTION_SOUNDS[event.action] : null;
  }
  // A gift is a chime; a gift that gained a heart is the same fanfare a
  // finished building gets, because it is the same kind of moment.
  if (event.kind === 'giftGiven' && event.heartGained) return 'fanfare';
  return EVENT_SOUNDS[event.kind] ?? null;
}

// --- music -------------------------------------------------------------------

/** The bed an area names for itself, falling back when it names none. */
export function areaMusic(area: AreaId): MusicId {
  return areaMap(area).music ?? DEFAULT_MUSIC;
}

export interface MusicContext {
  area: AreaId;
  weather: Weather;
  time: TimeState;
}

/**
 * Which bed should be playing.
 *
 * Rain outranks night: on a wet evening the rain is what you are standing in,
 * and layering the two would need a mixer this does not have.
 *
 * Indoors outranks both. Under a roof the rain is something outside the
 * window, which is a sound effect's job rather than the music's — and if the
 * night bed followed you in, stepping through the door at eight in the evening
 * would change nothing you could hear.
 */
export function musicFor({ area, weather, time }: MusicContext): MusicId {
  if (areaMap(area).indoor) return areaMusic(area);
  if (isRainy(weather)) return RAIN_MUSIC;
  const hour = time.hour;
  if (hour >= NIGHT_FROM_HOUR || hour < NIGHT_UNTIL_HOUR) return NIGHT_MUSIC;
  return areaMusic(area);
}

/** Every bed that can come up, so they can all be queued in `preload`. */
export function allMusic(areas: readonly AreaId[]): MusicId[] {
  return [...new Set([RAIN_MUSIC, NIGHT_MUSIC, DEFAULT_MUSIC, MINE_MUSIC, ...areas.map(areaMusic)])];
}

// --- footsteps ---------------------------------------------------------------

/** How often a walking player's foot lands, in milliseconds. */
export const FOOTSTEP_INTERVAL_MS = 330;

const FOOTSTEP_SOUNDS: Record<TileKind, SoundId | null> = {
  grass: 'footstep-grass',
  plot: 'footstep-grass',
  path: 'footstep-path',
  floor: 'footstep-wood',
  // Nobody can stand on water, so a footstep there would be a bug telling on
  // itself rather than a sound.
  water: null,
  // Nor on a wall, for the same reason.
  wall: null,
};

export function footstepFor(kind: TileKind | undefined): SoundId | null {
  return kind ? FOOTSTEP_SOUNDS[kind] : null;
}
