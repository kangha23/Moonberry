import {
  FISH_DEFS,
  TRASH_DEFS,
  fishDef,
  type FishDef,
  type FishMotion,
  type ItemId,
} from './items';
import type { Season, Weather } from './time';
import type { AreaId, Point } from '../world/areas';

/**
 * The four stages of one cast.
 *
 * `casting` is the line in the air, `waiting` is the float sitting there,
 * `biting` is the second the player has to strike in, and `reeling` is the
 * bar. Everything that is not one of those four is `fishing === null`, which
 * is what a player is for all but a few minutes of a day.
 */
export type CastPhase = 'casting' | 'waiting' | 'biting' | 'reeling';

/**
 * Everything one cast is, and nothing that outlives it.
 *
 * Lives on `PlayerState` and is null nearly always, which is the shape spec 12
 * asks for. Two departures from the spec's sketch, both deliberate:
 *
 * **`endsInMs` counts down in real milliseconds rather than naming an in-game
 * minute.** The clock advances in ten-minute jumps — see `CLOCK_STEP_MINUTES`
 * in the reducer — so a phase that ended on a minute boundary could only ever
 * end on one of those jumps. The bite window is nine tenths of a second wide;
 * pinned to the wall clock it would be exactly one tick wide, arriving on a
 * beat a player could count. The minigame is real-time by the spec's own
 * framing, so its clock is the tick's own `deltaMs`. That is still pure: the
 * elapsed time arrives inside the intent rather than being read from anywhere.
 *
 * **`barWidth`, `reeling`, `reelMs`, `landed` and `size` are here** because
 * each is state the physics needs between two ticks and has nowhere else to
 * live. `barWidth` in particular is frozen at the cast rather than read from
 * the hand each tick, so swapping to a golden rod mid-fight does nothing.
 */
export interface FishingState {
  phase: CastPhase;
  /** The water tile the float is sitting on, in the caster's own area. */
  target: Point;
  /** Drawn at the cast, not at the catch. See `pickFish`. */
  fish: ItemId;
  /** How much longer this phase lasts, in real milliseconds. */
  endsInMs: number;
  /**
   * How long the `waiting` phase will last, fixed at the cast.
   *
   * Carried rather than drawn when the line settles, so that the whole outcome
   * of a cast — the species, the size and the wait — is decided in one place
   * from one tuple. A wait drawn later would be a second draw to keep
   * deterministic, and the first thing to go out of step on a resync.
   */
  waitMs: number;
  /** 0-1, where the fish is on the bar. Only meaningful while reeling. */
  fishAt: number;
  /** Bar units per second, carried for the renderer to lean the sprite with. */
  fishVelocity: number;
  /** 0-1, the bottom edge of the player's square. */
  barAt: number;
  barVelocity: number;
  /** 0-1. Full lands the fish, empty loses it. */
  progress: number;
  /** How much of the bar the square covers, frozen from the rod at the cast. */
  barWidth: number;
  /** Whether the player is holding the reel down right now. */
  reeling: boolean;
  /** Milliseconds spent reeling, which is what the fish's course is drawn from. */
  reelMs: number;
  /**
   * True once the fish was landed but the satchel had no room for it.
   *
   * The cast deliberately stays alive in that state rather than dropping the
   * catch: spec 12 is explicit that a full satchel must not silently eat a
   * fish somebody just spent a minute on. Every tick retries, so making room
   * finishes the catch with no second cast.
   */
  landed: boolean;
  /** Centimetres. Drawn at the cast alongside the species, and only flavour. */
  size: number;
}

// --- what a cast costs and how long each stage takes -------------------------

/**
 * What one cast costs.
 *
 * Charged on the cast and never refunded — a cast that came back free on a
 * miss would make casting repeatedly until something good bites the optimal
 * play, and fishing would stop being a thing you choose to spend an evening
 * on. Eight is two swings of an axe: enough to notice on a tired day, cheap
 * enough that an evening of it is affordable when everything else is done.
 */
export const CAST_ENERGY = 8;

/** The line in the air. Long enough to read as a throw, short enough to repeat. */
const CAST_MS = 700;

/**
 * The longest slice of time one step of the minigame will advance by.
 *
 * A stall must never cost a fish, and without this one would. The reducer
 * already clamps a tick at five seconds, which is right for the crops — they
 * only care what time it is — and catastrophic here: a backgrounded tab, a
 * garbage collection or one slow frame would arrive as a single enormous
 * step, the fish would cross the whole bar inside it, and the progress would
 * drain the entire way from wherever the square happened to be sitting. The
 * player would lose a sturgeon to their browser.
 *
 * So a long gap advances a cast by a tenth of a second and no further. The
 * clock, the crops and the herd still catch up on the real elapsed time; only
 * the minigame runs slow for a frame, which is the failure that costs nobody
 * anything.
 */
const MAX_STEP_MS = 120;

/** How long the float may sit there before something takes an interest. */
const WAIT_MIN_MS = 1800;
const WAIT_MAX_MS = 7000;

/**
 * The window to strike in.
 *
 * The single most important number in the file. Too short and the game is
 * reflexes; too long and the bite stops being a moment. Nine tenths of a
 * second is about a beat — long enough to answer, short enough that answering
 * feels like something you did.
 */
export const BITE_MS = 900;

/** What bait is worth: half the wait, and nothing else at all. */
export const BAIT_WAIT_SCALE = 0.5;
export const BAIT_ITEM: ItemId = 'bait';

// --- the bar -----------------------------------------------------------------
//
// Everything here is per second, and integrated against the tick's own delta,
// so the physics is the same at 30fps and at 144.

/** Upward acceleration while the reel is held, in bar units per second squared. */
const BAR_LIFT = 2.1;
/** Downward acceleration when it is not. Lower than the lift, so holding wins. */
const BAR_GRAVITY = 1.5;
/** As fast as the square may ever travel, so a long hold cannot slingshot it. */
const BAR_MAX_SPEED = 1.15;
/**
 * What is left of the square's speed when it hits an end of the bar.
 *
 * Not zero, and not one. Zero makes the ends sticky, which rewards parking the
 * square at the bottom and holding; one makes them trampolines, which is
 * uncontrollable. A third of it back is a bump.
 */
const BAR_BOUNCE = -0.3;

/** Where the progress bar starts. Stardew's, near enough, and for its reasons. */
const START_PROGRESS = 0.3;

/** How fast progress fills while the square is over the fish. */
const CATCH_RATE = 0.38;

/**
 * How fast it drains while the square is not, as a function of difficulty.
 *
 * This is the whole of what difficulty means for the player, and it is on the
 * drain rather than on the fish's speed on purpose: a fast fish you can follow
 * is fun, and a fast fish that also empties the bar in a second is a fish
 * nobody catches twice. The motion makes a species feel different; this makes
 * it hard.
 */
function escapeRate(difficulty: number): number {
  return 0.12 + difficulty * 0.022;
}

/** How fast the fish itself travels toward wherever it has decided to go. */
function fishSpeed(difficulty: number): number {
  return 0.34 + difficulty * 0.055;
}

/**
 * How long a fish holds one course before picking another.
 *
 * The other half of what makes four motions four motions. A darter redraws
 * three times a second and a smooth fish barely once, so the same speed reads
 * as a flick or as a glide.
 */
const COURSE_MS: Record<FishMotion, number> = {
  smooth: 1400,
  darter: 450,
  sinker: 900,
  floater: 900,
};

// --- the deterministic draw --------------------------------------------------

/**
 * FNV-1a, the same hash `resources.ts` and `animals.ts` draw from.
 *
 * Copied rather than shared, and that is worth a word: three modules each
 * hashing their own tuples cannot collide with one another, and a shared
 * helper would tempt somebody to reuse a draw between two of them — which is
 * how two unrelated things start correlating. It is eight lines.
 */
function hash(...parts: Array<string | number>): number {
  let value = 0x811c9dc5;
  const text = parts.join(':');
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

/** The same hash as a fraction of 1. */
function roll(...parts: Array<string | number>): number {
  return hash(...parts) / 0x100000000;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// --- which fish ---------------------------------------------------------------

/**
 * Everything the draw needs to know about the world.
 *
 * Passed in rather than reached for, because this runs inside the reducer and
 * the reducer is a function of its arguments. `totalMinutes` is in it for the
 * reason spec 12 gives: two casts into the same tile in the same minute should
 * be the same fish, and two casts a minute apart should not.
 */
export interface FishDraw {
  seed: number;
  totalMinutes: number;
  area: AreaId;
  tile: Point;
  season: Season;
  weather: Weather;
  /**
   * Hours since midnight of the day that began, so 6 through 25.
   *
   * Not `time.hour`, which wraps at 24 and would put two in the morning before
   * six in the evening. See `FishDef.fromHour`.
   */
  hour: number;
}

/**
 * How often the water gives up rubbish instead.
 *
 * Roughly one cast in six, and it is not a punishment: without something to
 * fail into, every cast is a win and the bar is a formality nobody would sit
 * through twice.
 */
const TRASH_CHANCE = 0.17;

/** Whether a species is in this water, in this weather, at this hour, today. */
export function isAvailable(def: FishDef, draw: Omit<FishDraw, 'seed' | 'tile' | 'totalMinutes'>): boolean {
  if (!def.seasons.includes(draw.season)) return false;
  if (def.weather && !def.weather.includes(draw.weather)) return false;
  if (!def.areas.includes(draw.area)) return false;
  // `toHour` is exclusive, so a row reading 6 to 19 is the working day and a
  // row reading 20 to 26 is the evening, with no hour belonging to both.
  return draw.hour >= def.fromHour && draw.hour < def.toHour;
}

/** Every species that could bite here and now, in table order. */
export function availableFish(draw: Omit<FishDraw, 'seed' | 'tile' | 'totalMinutes'>): FishDef[] {
  return FISH_DEFS.filter((def) => isAvailable(def, draw));
}

/**
 * Picks one row from a list, weighted so the hard ones are the rare ones.
 *
 * Weight is `11 - difficulty`, so a difficulty-1 chub is five times as likely
 * as a difficulty-9 moonfish standing in the same water. That is the only
 * place rarity is expressed: there is no second `rarity` column to keep in
 * step with the difficulty column, because in this game they are the same
 * statement made twice.
 */
function weightedPick(rows: readonly FishDef[], fraction: number): FishDef {
  const total = rows.reduce((sum, row) => sum + (11 - row.difficulty), 0);
  let remaining = fraction * total;
  for (const row of rows) {
    remaining -= 11 - row.difficulty;
    if (remaining < 0) return row;
  }
  return rows[rows.length - 1];
}

/**
 * What is on the end of the line, decided the moment it hits the water.
 *
 * **The fish is drawn at the cast, not at the catch**, which is the decision
 * this whole system turns on and is worth restating where it happens. Playing
 * the bar well decides *whether* you land it, never *what* it is — so a hard
 * fish is a hard fish rather than a reward for being good at bars, and a
 * modified client watching for the draw has nothing to watch: it learns the
 * species at the bite, by which time the value is already fixed in state the
 * server owns.
 *
 * Falls back to rubbish when nothing is in season here, which is the honest
 * answer for a farm pond in a dry January rather than a reason to refuse the
 * cast.
 */
export function pickFish(draw: FishDraw): { fish: ItemId; size: number } {
  const parts = [draw.seed, 'fish', draw.totalMinutes, draw.area, draw.tile.x, draw.tile.y] as const;
  const candidates = availableFish(draw);
  const rubbish = candidates.length === 0 || roll(...parts, 'trash') < TRASH_CHANCE;
  const table = rubbish ? TRASH_DEFS : candidates;
  const picked = weightedPick(table, roll(...parts, 'which'));
  const size =
    picked.minSize + (picked.maxSize - picked.minSize) * roll(...parts, 'size');
  return { fish: picked.id, size: Math.round(size) };
}

// --- one cast, from the throw to the bar --------------------------------------

/**
 * How long the float sits there, drawn from the same tuple the fish was.
 *
 * Halved by bait and by nothing else. The floor is there so that even a baited
 * cast is a wait rather than an instant: a bite that arrives before the player
 * has looked up is a bite they miss through no fault of their own.
 */
export function waitMs(draw: FishDraw, baited: boolean): number {
  const parts = [draw.seed, 'wait', draw.totalMinutes, draw.area, draw.tile.x, draw.tile.y];
  const span = WAIT_MIN_MS + (WAIT_MAX_MS - WAIT_MIN_MS) * roll(...parts);
  return Math.round(span * (baited ? BAIT_WAIT_SCALE : 1));
}

/** The state a fresh cast starts in. The fish is already decided; see above. */
export function startCast(draw: FishDraw, barWidth: number, baited: boolean): FishingState {
  const { fish, size } = pickFish(draw);
  return {
    phase: 'casting',
    target: { x: draw.tile.x, y: draw.tile.y },
    fish,
    endsInMs: CAST_MS,
    waitMs: waitMs(draw, baited),
    fishAt: 0.5,
    fishVelocity: 0,
    barAt: 0.5 - barWidth / 2,
    barVelocity: 0,
    progress: START_PROGRESS,
    barWidth,
    reeling: false,
    reelMs: 0,
    landed: false,
    // Drawn with the species and from the same tuple, so a cast's whole
    // outcome is settled the moment the line leaves the rod.
    size,
  };
}

/**
 * What one step of the simulation did, beyond moving numbers around.
 *
 * `missed` and `escaped` are two different failures and are kept apart: one is
 * a bite nobody answered, the other is a fish that beat you on the bar. They
 * deserve different sounds and, more to the point, the second one is the game
 * working and the first one is the player not looking.
 */
export type FishingOutcome = 'none' | 'bite' | 'missed' | 'caught' | 'escaped';

export interface FishingStep {
  /** Null when the cast is over, whatever ended it. */
  fishing: FishingState | null;
  outcome: FishingOutcome;
}

/**
 * Where a fish has decided to go on this stretch of the bar.
 *
 * Drawn from the reel clock rather than from anything ambient, so the same
 * fish fought from the same tick swims the same course — which is what makes
 * the whole minigame testable rather than merely watchable.
 */
function courseFor(motion: FishMotion, fraction: number): number {
  switch (motion) {
    // Hugs the bottom: squaring a fraction in 0..1 pulls it down, and the
    // three-quarter cap keeps a sinker from ever being a top-of-the-bar fish.
    case 'sinker':
      return fraction * fraction * 0.75;
    case 'floater':
      return 1 - fraction * fraction * 0.75;
    case 'smooth':
    case 'darter':
      return fraction;
  }
}

/**
 * One tick of a cast.
 *
 * Every phase advances here, including the ones with no physics in them, so
 * there is exactly one place a cast can change and exactly one place to look
 * when it changes wrongly. `seed` and `playerId` are what the fish's course is
 * drawn from: two people fighting two fish in two ponds must not swim in step.
 */
export function stepFishing(
  fishing: FishingState,
  deltaMs: number,
  seed: number,
  playerId: string,
): FishingStep {
  // A landed fish waiting for a slot is not simulated, only held. Nothing can
  // now lose it; the reducer retries the satchel each tick.
  if (fishing.landed) return { fishing, outcome: 'none' };

  // Clamped before anything reads it, so the phase timers and the bar are
  // advanced by the same slice and cannot disagree about how long a frame was.
  const elapsed = Math.min(deltaMs, MAX_STEP_MS);
  const remaining = fishing.endsInMs - elapsed;

  switch (fishing.phase) {
    case 'casting':
      if (remaining > 0) return { fishing: { ...fishing, endsInMs: remaining }, outcome: 'none' };
      // The wait was drawn at the cast and only starts counting now, so the
      // throw itself is never part of it.
      return { fishing: { ...fishing, phase: 'waiting', endsInMs: fishing.waitMs }, outcome: 'none' };

    case 'waiting':
      if (remaining > 0) return { fishing: { ...fishing, endsInMs: remaining }, outcome: 'none' };
      return { fishing: { ...fishing, phase: 'biting', endsInMs: BITE_MS }, outcome: 'bite' };

    case 'biting':
      if (remaining > 0) return { fishing: { ...fishing, endsInMs: remaining }, outcome: 'none' };
      // Nobody struck. The cast is over and the energy is spent, which is the
      // cost of not watching.
      return { fishing: null, outcome: 'missed' };

    case 'reeling':
      return stepBar(fishing, elapsed, seed, playerId);
  }
}

/** The bar itself: the square, the fish, and the tug of war between them. */
function stepBar(
  fishing: FishingState,
  deltaMs: number,
  seed: number,
  playerId: string,
): FishingStep {
  const dt = deltaMs / 1000;
  const def = fishDef(fishing.fish);
  const difficulty = def?.difficulty ?? 1;
  const motion = def?.motion ?? 'smooth';

  // The square. Held up, falling otherwise, and stopped at both ends.
  let barVelocity = clamp(
    fishing.barVelocity + (fishing.reeling ? BAR_LIFT : -BAR_GRAVITY) * dt,
    -BAR_MAX_SPEED,
    BAR_MAX_SPEED,
  );
  let barAt = fishing.barAt + barVelocity * dt;
  const ceiling = 1 - fishing.barWidth;
  if (barAt <= 0) {
    barAt = 0;
    barVelocity = Math.max(0, barVelocity * BAR_BOUNCE);
  } else if (barAt >= ceiling) {
    barAt = ceiling;
    barVelocity = Math.min(0, barVelocity * BAR_BOUNCE);
  }

  // The fish. It picks somewhere to be every so often and swims at it.
  const reelMs = fishing.reelMs + deltaMs;
  const course = Math.floor(reelMs / COURSE_MS[motion]);
  const goal = courseFor(motion, roll(seed, 'course', playerId, fishing.fish, course));
  const step = fishSpeed(difficulty) * dt;
  const fishAt = clamp(
    fishing.fishAt + clamp(goal - fishing.fishAt, -step, step),
    0,
    1,
  );

  // The tug of war. Overlap is measured against the square's whole span, so a
  // wider rod is straightforwardly more forgiving and nothing else changes.
  const covered = fishAt >= barAt && fishAt <= barAt + fishing.barWidth;
  const progress = clamp(
    fishing.progress + (covered ? CATCH_RATE : -escapeRate(difficulty)) * dt,
    0,
    1,
  );

  const next: FishingState = {
    ...fishing,
    barAt,
    barVelocity,
    fishAt,
    fishVelocity: dt > 0 ? (fishAt - fishing.fishAt) / dt : 0,
    reelMs,
    progress,
  };

  if (progress <= 0) return { fishing: null, outcome: 'escaped' };
  // Landed, but the satchel is the reducer's business: it says whether this
  // becomes an item or a fish held in hand until a slot frees up.
  if (progress >= 1) return { fishing: { ...next, landed: true }, outcome: 'caught' };
  return { fishing: next, outcome: 'none' };
}

/**
 * Striking at a bite.
 *
 * Returns null for a press that is not a strike, so the caller can tell "this
 * hooked something" from "this was a button held at the wrong moment" without
 * comparing phases itself.
 */
export function hookFish(fishing: FishingState): FishingState | null {
  if (fishing.phase !== 'biting') return null;
  return { ...fishing, phase: 'reeling', endsInMs: 0, reeling: true, reelMs: 0 };
}

/** Whether this is a moment where holding the reel means anything. */
export function acceptsReel(fishing: FishingState): boolean {
  return fishing.phase === 'biting' || fishing.phase === 'reeling';
}

/** What the catch is called, for the line the player reads. */
export function describeCatch(fishing: FishingState): string {
  const def = fishDef(fishing.fish);
  if (!def) return 'Bạn bắt được một thứ gì đó.';
  if (def.sellPrice === 0) return `${def.label}. Không phải cá, nhưng cũng là một thứ.`;
  return `${def.label}, ${fishing.size}cm.`;
}
